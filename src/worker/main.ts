import { loadEnv } from "@/config/env";
import { createDb } from "@/db/client";
import type { Deps } from "@/deps";
import { createProviders } from "@/providers";
import { createStorage } from "@/storage";
import { buildHandlers } from "./handlers";
import { recoverStaleJobs, runOnce } from "./runner";

// Job `running` há mais que isso é considerado órfão. Deve superar com folga o timeout do ffmpeg
// (FFMPEG_TIMEOUT_MS = 10 min) somado às transferências de/para o storage, senão uma montagem
// lenta porém legítima seria reclamada e executada duas vezes.
const STALE_AFTER_MS = 30 * 60_000;
const RECLAIM_EVERY_MS = 60_000;
const IDLE_POLL_MS = 2_000;

const env = loadEnv();
const { db, sql } = createDb(env.DATABASE_URL, env.WORKER_CONCURRENCY + 2);
const deps: Deps = {
  db,
  storage: createStorage(env),
  providers: await createProviders(env),
  config: { maxSceneReferences: env.MAX_SCENE_REFERENCES, sceneMaxSeconds: env.SCENE_MAX_SECONDS },
};
const handlers = buildHandlers(deps);

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (stopping) {
      console.log(`${sig} recebido de novo, saindo imediatamente`);
      process.exit(1);
    }
    console.log(`${sig} recebido, encerrando após os jobs em andamento`);
    stopping = true;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loop(n: number) {
  while (!stopping) {
    const worked = await runOnce(db, handlers).catch((e) => {
      console.error(`loop ${n}:`, e);
      return false;
    });
    if (!worked) await sleep(IDLE_POLL_MS);
  }
}

// Jobs presos em "running" por um worker que morreu voltam para a fila, ou falham com onDead se esgotaram as tentativas (rodar uma única réplica do worker).
function reclaim() {
  return recoverStaleJobs(db, handlers, STALE_AFTER_MS)
    .then(({ requeued, dead }) => {
      if (requeued) console.log(`${requeued} job(s) travado(s) devolvido(s) à fila`);
      if (dead) console.log(`${dead} job(s) travado(s) marcado(s) como failed (onDead executado)`);
    })
    .catch((e) => console.error("recoverStaleJobs:", e));
}
await reclaim(); // na partida: recupera o que o worker anterior deixou pendurado
const reclaimTimer = setInterval(reclaim, RECLAIM_EVERY_MS);

console.log(`worker iniciado (provider=${env.PROVIDER}, concorrência=${env.WORKER_CONCURRENCY})`);
await Promise.all(Array.from({ length: env.WORKER_CONCURRENCY }, (_, i) => loop(i)));
clearInterval(reclaimTimer);
await sql.end({ timeout: 5 });
process.exit(0);
