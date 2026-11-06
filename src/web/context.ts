import { loadEnv, type Env } from "@/config/env";
import { createDb } from "@/db/client";
import type { Deps } from "@/deps";
import { createProviders } from "@/providers";
import { createStorage } from "@/storage";

export type WebContext = { env: Env; deps: Deps };

const g = globalThis as unknown as { __gcContext?: Promise<WebContext> };
let override: WebContext | null = null;

async function createContext(): Promise<WebContext> {
  const env = loadEnv();
  // Providers antes do pool: se falharem (ex.: ffmpeg ausente com PROVIDER=fake), nenhum pool fica vazando.
  const providers = await createProviders(env);
  const { db } = createDb(env.DATABASE_URL, 10);
  const deps: Deps = {
    db,
    storage: createStorage(env),
    providers,
    config: { maxSceneReferences: env.MAX_SCENE_REFERENCES, sceneMaxSeconds: env.SCENE_MAX_SECONDS },
  };
  return { env, deps };
}

// Reaproveitado entre requests e entre recarregamentos do dev server.
// Uma falha NÃO fica em cache: a próxima request tenta de novo.
export function getContext(): Promise<WebContext> {
  if (override) return Promise.resolve(override);
  if (!g.__gcContext) {
    const p = createContext();
    g.__gcContext = p;
    p.catch(() => {
      if (g.__gcContext === p) delete g.__gcContext;
    });
  }
  return g.__gcContext;
}

export function setContextForTests(ctx: WebContext | null) {
  override = ctx;
}
