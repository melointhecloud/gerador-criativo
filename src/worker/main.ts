import type { Env } from "@/config/env";
import { loadEnv } from "@/config/env";
import { createDb } from "@/db/client";
import type { Deps } from "@/deps";
import { FakeImageModel, FakeTextModel, FakeVideoModel } from "@/providers/fake";
import { type Providers } from "@/providers/types";
import { createStorage } from "@/storage";
import { buildHandlers } from "./handlers";
import { recoverStaleJobs, runOnce } from "./runner";

// TODO(Task 11): remover este seam e importar `createProviders` de "@/providers" (fábrica real).
// Até lá só `PROVIDER=fake` funciona, e o clipe falso não é um MP4 válido (a montagem real falharia).
async function createProviders(env: Env): Promise<Providers> {
  if (env.PROVIDER !== "fake") {
    throw new Error("PROVIDER=gemini ainda não está disponível: a fábrica de providers reais é a Task 11.");
  }
  return {
    text: new FakeTextModel([]),
    image: new FakeImageModel(),
    video: new FakeVideoModel({ clip: Buffer.from("fake-clip") }),
  };
}

// Job `running` há mais que isso é considerado órfão. Jobs são curtos (a geração de vídeo usa
// RetryLater); a montagem com ffmpeg é o mais longo e deve ficar bem abaixo deste limite.
const STALE_AFTER_MS = 10 * 60_000;
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
