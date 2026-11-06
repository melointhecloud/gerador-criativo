# Gerador de Criativos TikTok — Plano 3: Web e Deploy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expor o pipeline para o time: autenticação por senha única, API HTTP, UI do fluxo completo (briefing → personagens → roteiro → cenas → revisão → vídeo final), imagens de deploy no Railway e roteiro de teste de fumaça.

**Architecture:** Next.js App Router. Route handlers finos que só validam entrada (zod) e chamam os serviços do Plano 2 através de um wrapper `api()` que cuida de auth e erros. Arquivos (imagens e vídeos) são servidos por uma rota autenticada com suporte a `Range`. A UI é uma página de projeto que renderiza um painel por etapa e faz polling enquanto houver trabalho em andamento. Dois serviços no Railway: `web` e `worker`.

**Tech Stack:** Next.js (App Router), React, Web Crypto para sessão, Docker, Railway.

**Pré-requisito:** Planos 1 e 2 concluídos (`pnpm test` verde).

**Spec:** `docs/superpowers/specs/2026-11-03-gerador-criativos-tiktok-design.md`

---

## Mapa de arquivos deste plano

| Arquivo | Responsabilidade |
|---|---|
| `src/auth/session.ts` | Cookie de sessão assinado (HMAC) e checagem de senha |
| `src/web/context.ts` | Singleton de `env` + `Deps` para a web |
| `src/web/http.ts` | Wrapper `api()`, parse de cookie, mapeamento de erros |
| `src/web/range.ts` | Parser do header `Range` |
| `src/app/api/**/route.ts` | Endpoints (auth, projetos, referências, personagens, roteiro, cenas, montagem, arquivos) |
| `src/lib/api.ts`, `useProject.ts`, `types.ts`, `labels.ts` | Cliente HTTP, polling, tipos e textos da UI |
| `src/components/*.tsx` | Painéis por etapa |
| `src/app/layout.tsx`, `globals.css`, `page.tsx`, `login/page.tsx`, `projects/[id]/page.tsx` | Páginas |
| `Dockerfile.web`, `Dockerfile.worker`, `.dockerignore` | Imagens de deploy |
| `README.md` | Como rodar, variáveis e deploy |

---

### Task 1: Sessão e senha

**Files:**
- Create: `src/auth/session.ts`
- Test: `tests/auth/session.test.ts`

- [ ] **Step 1: Escrever os testes**

`tests/auth/session.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createSession, passwordMatches, verifySession } from "@/auth/session";

const secret = "s".repeat(40);

describe("sessão", () => {
  it("aceita um token recém-criado", async () => {
    expect(await verifySession(await createSession(secret), secret)).toBe(true);
  });
  it("rejeita token adulterado", async () => {
    const t = await createSession(secret);
    const [exp, sig] = t.split(".");
    expect(await verifySession(`${Number(exp) + 1000}.${sig}`, secret)).toBe(false);
    expect(await verifySession(`${exp}.${sig!.slice(0, -2)}xx`, secret)).toBe(false);
  });
  it("rejeita segredo diferente, token vazio e token malformado", async () => {
    const t = await createSession(secret);
    expect(await verifySession(t, "outro".repeat(10))).toBe(false);
    expect(await verifySession(undefined, secret)).toBe(false);
    expect(await verifySession("sem-ponto", secret)).toBe(false);
  });
  it("rejeita token expirado", async () => {
    const t = await createSession(secret, Date.now() - 15 * 24 * 3600 * 1000);
    expect(await verifySession(t, secret)).toBe(false);
  });
});

describe("passwordMatches", () => {
  it("compara a senha", async () => {
    expect(await passwordMatches("segredo", "segredo")).toBe(true);
    expect(await passwordMatches("errada", "segredo")).toBe(false);
    expect(await passwordMatches("", "segredo")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/auth/session.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `src/auth/session.ts`**

```ts
// Web Crypto (funciona em Node e em qualquer runtime do Next).
export const SESSION_COOKIE = "gc_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 14;

const enc = new TextEncoder();

function toBase64Url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSession(secret: string, now = Date.now()): Promise<string> {
  const payload = String(now + SESSION_MAX_AGE_S * 1000);
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifySession(token: string | undefined, secret: string, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  if (!safeEqual(sig, await hmac(secret, payload))) return false;
  return Number(payload) > now;
}

export async function passwordMatches(input: string, expected: string): Promise<boolean> {
  return safeEqual(await hmac("password-check", input), await hmac("password-check", expected));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run tests/auth/session.test.ts`
Expected: 5 testes PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth tests/auth
git commit -m "feat(auth): signed session cookie and password check"
```

---

### Task 2: Infra HTTP (contexto, wrapper `api`, Range)

**Files:**
- Create: `src/web/context.ts`, `src/web/http.ts`, `src/web/range.ts`
- Modify: `src/services/projects.ts` (acrescentar `getAsset`)
- Test: `tests/web/range.test.ts`

- [ ] **Step 1: Escrever os testes do parser de Range**

`tests/web/range.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseRange } from "@/web/range";

describe("parseRange", () => {
  it("sem header devolve null (corpo inteiro)", () => {
    expect(parseRange(null, 100)).toBeNull();
  });
  it("intervalo fechado e aberto", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
  });
  it("sufixo: últimos N bytes", () => {
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 });
  });
  it("limita o fim ao tamanho", () => {
    expect(parseRange("bytes=50-500", 100)).toEqual({ start: 50, end: 99 });
  });
  it("inválido: início além do fim, formato errado, vazio", () => {
    expect(parseRange("bytes=100-120", 100)).toBe("invalid");
    expect(parseRange("bytes=9-5", 100)).toBe("invalid");
    expect(parseRange("items=0-1", 100)).toBe("invalid");
    expect(parseRange("bytes=-", 100)).toBe("invalid");
    expect(parseRange("bytes=-0", 100)).toBe("invalid");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/web/range.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `src/web/range.ts`**

```ts
export type ByteRange = { start: number; end: number };

// null = sem Range (corpo inteiro); "invalid" = 416.
export function parseRange(header: string | null, size: number): ByteRange | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return "invalid";
  const [, s, e] = m as unknown as [string, string, string];
  if (s === "" && e === "") return "invalid";

  let start: number;
  let end: number;
  if (s === "") {
    const n = Number(e);
    if (n === 0) return "invalid";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(s);
    end = e === "" ? size - 1 : Math.min(Number(e), size - 1);
  }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}
```

- [ ] **Step 4: Implementar `src/web/context.ts`**

```ts
import { loadEnv, type Env } from "@/config/env";
import { createDb } from "@/db/client";
import type { Deps } from "@/deps";
import { createProviders } from "@/providers";
import { createStorage } from "@/storage";

export type WebContext = { env: Env; deps: Deps };

const g = globalThis as unknown as { __gcContext?: Promise<WebContext> };
let override: WebContext | null = null;

// Reaproveitado entre requests e entre recarregamentos do dev server.
export function getContext(): Promise<WebContext> {
  if (override) return Promise.resolve(override);
  g.__gcContext ??= (async () => {
    const env = loadEnv();
    const { db } = createDb(env.DATABASE_URL, 10);
    const deps: Deps = {
      db,
      storage: createStorage(env),
      providers: await createProviders(env),
      config: { maxSceneReferences: env.MAX_SCENE_REFERENCES, sceneMaxSeconds: env.SCENE_MAX_SECONDS },
    };
    return { env, deps };
  })();
  return g.__gcContext;
}

export function setContextForTests(ctx: WebContext | null) {
  override = ctx;
}
```

- [ ] **Step 5: Implementar `src/web/http.ts`**

```ts
import { z } from "zod";
import { SESSION_COOKIE, verifySession } from "@/auth/session";
import type { Env } from "@/config/env";
import type { Deps } from "@/deps";
import { DomainError } from "@/services/errors";
import { getContext } from "./context";

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

export async function isAuthedCookie(cookieHeader: string | null): Promise<boolean> {
  const { env } = await getContext();
  return verifySession(readCookie(cookieHeader, SESSION_COOKIE), env.SESSION_SECRET);
}

type ApiArgs = { req: Request; params: Record<string, string>; deps: Deps; env: Env };
type RouteCtx = { params: Promise<Record<string, string>> };

const uuid = z.guid(); // qualquer id no formato 8-4-4-4-12; evita que um id malformado chegue ao Postgres

// Envolve um endpoint: autentica, valida ids da URL, converte erros de domínio e de validação em JSON.
export function api(handler: (a: ApiArgs) => Promise<unknown>, opts: { auth?: boolean } = {}) {
  return async (req: Request, ctx?: RouteCtx): Promise<Response> => {
    try {
      const { deps, env } = await getContext();
      if (opts.auth !== false && !(await isAuthedCookie(req.headers.get("cookie")))) {
        return Response.json({ error: "Não autorizado" }, { status: 401 });
      }
      const params = ctx?.params ? await ctx.params : {};
      for (const v of Object.values(params)) uuid.parse(v);
      const out = await handler({ req, params, deps, env });
      return out instanceof Response ? out : Response.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof DomainError) return Response.json({ error: e.message }, { status: e.status });
      if (e instanceof z.ZodError) return Response.json({ error: "Dados inválidos", details: e.issues }, { status: 400 });
      console.error(e);
      return Response.json({ error: "Erro interno" }, { status: 500 });
    }
  };
}
```

- [ ] **Step 6: Acrescentar `getAsset` em `src/services/projects.ts`**

Adicionar depois de `getProject`:
```ts
export async function getAsset(db: Db, id: string): Promise<Asset> {
  const [row] = await db.select().from(assets).where(eq(assets.id, id));
  if (!row) throw new DomainError("Arquivo não encontrado", 404);
  return row;
}
```

- [ ] **Step 7: Rodar testes e typecheck**

Run: `pnpm vitest run tests/web/range.test.ts && pnpm typecheck`
Expected: 5 testes PASS; typecheck limpo.

- [ ] **Step 8: Commit**

```bash
git add src/web src/services/projects.ts tests/web
git commit -m "feat(web): request context, api wrapper and range parser"
```

---

### Task 3: Endpoints da API

**Files:**
- Create: todos os `route.ts` abaixo
- Test: `tests/web/api.test.ts`

- [ ] **Step 1: Escrever os testes de integração dos endpoints**

`tests/web/api.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession, SESSION_COOKIE } from "@/auth/session";
import { loadEnv } from "@/config/env";
import { getContext, setContextForTests } from "@/web/context";
import * as login from "@/app/api/auth/login/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as projectRoute from "@/app/api/projects/[id]/route";
import * as stageRoute from "@/app/api/projects/[id]/stage/route";
import * as assetRoute from "@/app/api/assets/[assetId]/route";
import { makeDeps } from "../helpers/deps";
import { resetDb, testDb } from "../helpers/db";
import { seedAsset, seedProject } from "../helpers/seed";

const env = loadEnv({
  DATABASE_URL: "postgres://x",
  PROVIDER: "fake",
  STORAGE: "fs",
  ACCESS_PASSWORD: "segredo",
  SESSION_SECRET: "s".repeat(40),
});

let cleanup: () => Promise<void>;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  const m = await makeDeps();
  cleanup = m.cleanup;
  setContextForTests({ env, deps: m.deps });
  cookie = `${SESSION_COOKIE}=${await createSession(env.SESSION_SECRET)}`;
});
afterEach(async () => {
  setContextForTests(null);
  await cleanup();
});

type Handler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;

function call(
  handler: Handler,
  o: { method?: string; url?: string; body?: unknown; cookie?: string | null; params?: Record<string, string>; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  const c = o.cookie === undefined ? cookie : o.cookie;
  if (c) headers.cookie = c;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`http://test${o.url ?? "/"}`, {
    method: o.method ?? "GET",
    headers,
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
  });
  return handler(req, { params: Promise.resolve(o.params ?? {}) });
}

describe("auth", () => {
  it("bloqueia sem cookie", async () => {
    const res = await call(projectsRoute.GET, { cookie: null });
    expect(res.status).toBe(401);
  });

  it("login com senha errada falha; certa devolve cookie HttpOnly que libera a API", async () => {
    const bad = await call(login.POST, { method: "POST", body: { password: "errada" }, cookie: null });
    expect(bad.status).toBe(401);

    const ok = await call(login.POST, { method: "POST", body: { password: "segredo" }, cookie: null });
    expect(ok.status).toBe(200);
    const setCookie = ok.headers.get("set-cookie")!;
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");

    const sessionCookie = setCookie.split(";")[0]!;
    expect((await call(projectsRoute.GET, { cookie: sessionCookie })).status).toBe(200);
  });
});

describe("projetos", () => {
  it("cria e busca o snapshot com estimativa de segundos", async () => {
    const created = await call(projectsRoute.POST, { method: "POST", body: { name: "Campanha", mode: "ugc" } });
    expect(created.status).toBe(200);
    const { id } = await created.json();

    const res = await call(projectRoute.GET, { url: `/api/projects/${id}`, params: { id } });
    const snap = await res.json();
    expect(snap.project.stage).toBe("briefing");
    expect(snap.estimatedSeconds).toBe(0);
    expect(snap.scenes).toEqual([]);
  });

  it("rejeita modo inválido (400) e id que não é uuid (400)", async () => {
    const bad = await call(projectsRoute.POST, { method: "POST", body: { name: "x", mode: "outro" } });
    expect(bad.status).toBe(400);
    const res = await call(projectRoute.GET, { params: { id: "não-é-uuid" } });
    expect(res.status).toBe(400);
  });

  it("projeto inexistente é 404 e regra de negócio violada é 400 com mensagem", async () => {
    const missing = await call(projectRoute.GET, { params: { id: "00000000-0000-0000-0000-000000000000" } });
    expect(missing.status).toBe(404);

    const p = await seedProject(testDb, { stage: "briefing" });
    const res = await call(stageRoute.POST, {
      method: "POST",
      params: { id: p.id },
      body: { stage: "review" },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Não é possível");
  });

  it("a rota de etapa não aceita generating nem assembling (só as ações próprias entram nelas)", async () => {
    const p = await seedProject(testDb, { stage: "script" });
    for (const stage of ["generating", "assembling"]) {
      const res = await call(stageRoute.POST, { method: "POST", params: { id: p.id }, body: { stage } });
      expect(res.status).toBe(400);
    }
  });
});

describe("arquivos", () => {
  it("serve o arquivo inteiro e suporta Range (206)", async () => {
    const { deps } = await getContext();
    const p = await seedProject(testDb);
    const asset = await seedAsset(testDb, p.id, { kind: "clip", storageKey: "x/clip.mp4" });
    await deps.storage.put("x/clip.mp4", Buffer.from("0123456789"), "video/mp4");

    const full = await call(assetRoute.GET, { params: { assetId: asset.id } });
    expect(full.status).toBe(200);
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(full.headers.get("content-type")).toBe("video/mp4");
    expect(await full.text()).toBe("0123456789");

    const part = await call(assetRoute.GET, { params: { assetId: asset.id }, headers: { range: "bytes=2-5" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await part.text()).toBe("2345");

    const bad = await call(assetRoute.GET, { params: { assetId: asset.id }, headers: { range: "bytes=50-60" } });
    expect(bad.status).toBe(416);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/web/api.test.ts`
Expected: FAIL — rotas não encontradas.

- [ ] **Step 3: Criar os endpoints de auth**

`src/app/api/auth/login/route.ts`:
```ts
import { z } from "zod";
import { createSession, passwordMatches, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/auth/session";
import { DomainError } from "@/services/errors";
import { api } from "@/web/http";

export const POST = api(
  async ({ req, env }) => {
    const { password } = z.object({ password: z.string() }).parse(await req.json());
    if (!(await passwordMatches(password, env.ACCESS_PASSWORD))) {
      await new Promise((r) => setTimeout(r, 500)); // freia tentativas em sequência
      throw new DomainError("Senha incorreta", 401);
    }
    const token = await createSession(env.SESSION_SECRET);
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return Response.json(
      { ok: true },
      { headers: { "set-cookie": `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_S}${secure}` } },
    );
  },
  { auth: false },
);
```

`src/app/api/auth/logout/route.ts`:
```ts
import { SESSION_COOKIE } from "@/auth/session";
import { api } from "@/web/http";

export const POST = api(
  async () =>
    Response.json({ ok: true }, { headers: { "set-cookie": `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0` } }),
  { auth: false },
);
```

- [ ] **Step 4: Criar os endpoints de projeto**

`src/app/api/projects/route.ts`:
```ts
import { z } from "zod";
import { MODES } from "@/domain/stages";
import { createProject, listProjects } from "@/services/projects";
import { api } from "@/web/http";

export const GET = api(async ({ deps }) => ({ projects: await listProjects(deps.db) }));

export const POST = api(async ({ req, deps }) => {
  const body = z.object({ name: z.string(), mode: z.enum(MODES) }).parse(await req.json());
  return createProject(deps.db, body);
});
```

`src/app/api/projects/[id]/route.ts`:
```ts
import { z } from "zod";
import { getSnapshot, updateBriefing } from "@/services/projects";
import { totalSeconds } from "@/services/scenes";
import { api } from "@/web/http";

export const GET = api(async ({ params, deps }) => {
  const snap = await getSnapshot(deps.db, params.id);
  return { ...snap, estimatedSeconds: totalSeconds(snap.scenes) };
});

export const PATCH = api(async ({ req, params, deps }) => {
  const body = z.object({ name: z.string().optional(), copy: z.string().optional() }).parse(await req.json());
  return updateBriefing(deps.db, params.id, body);
});
```

`src/app/api/projects/[id]/stage/route.ts`:
```ts
import { z } from "zod";
import { STAGES } from "@/domain/stages";
import { setStage } from "@/services/projects";
import { api } from "@/web/http";

// `generating` e `assembling` NÃO podem ser pedidas por aqui: só entram pelas ações que
// também enfileiram os jobs (`generateAllScenes` e `startAssembly`, Plano 2 Task 6).
// Sem isso, uma chamada direta deixaria o projeto preso nessas etapas sem nenhum job rodando.
// Além disso, `setStage` recusa sair de `generating` (DomainError em português): só o worker faz essa transição.
const NAVIGABLE_STAGES = STAGES.filter((s) => s !== "generating" && s !== "assembling");

export const POST = api(async ({ req, params, deps }) => {
  const { stage } = z.object({ stage: z.enum(NAVIGABLE_STAGES as [string, ...string[]]) }).parse(await req.json());
  return setStage(deps.db, params.id, stage as (typeof STAGES)[number]);
});
```

`src/app/api/projects/[id]/references/route.ts`:
```ts
import { DomainError } from "@/services/errors";
import { addReference } from "@/services/projects";
import { api } from "@/web/http";

export const POST = api(async ({ req, params, deps }) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new DomainError("Envie um arquivo de imagem");
  return addReference(deps, {
    projectId: params.id,
    label: String(form.get("label") ?? ""),
    bytes: Buffer.from(await file.arrayBuffer()),
    mimeType: file.type,
  });
});
```

`src/app/api/projects/[id]/generate/route.ts`:
```ts
import { generateAllScenes } from "@/services/scenes";
import { api } from "@/web/http";

export const POST = api(async ({ params, deps }) => {
  await generateAllScenes(deps, params.id);
  return { ok: true };
});
```

`src/app/api/projects/[id]/regenerate-all/route.ts`:
```ts
import { regenerateAllScenes } from "@/services/scenes";
import { api } from "@/web/http";

export const POST = api(async ({ params, deps }) => {
  await regenerateAllScenes(deps, params.id);
  return { ok: true };
});
```

`src/app/api/projects/[id]/assemble/route.ts`:
```ts
import { startAssembly } from "@/services/scenes";
import { api } from "@/web/http";

export const POST = api(async ({ params, deps }) => {
  await startAssembly(deps.db, params.id);
  return { ok: true };
});
```

`src/app/api/projects/[id]/script/plan/route.ts`:
```ts
import { z } from "zod";
import { planProjectScript } from "@/services/scenes";
import { api } from "@/web/http";

export const POST = api(async ({ req, params, deps }) => {
  const body = z.object({ feedback: z.string().optional() }).parse(await req.json().catch(() => ({})));
  await planProjectScript(deps, params.id, body.feedback);
  return { ok: true };
});
```

- [ ] **Step 5: Criar os endpoints de arquivos, personagens e cenas**

`src/app/api/assets/[assetId]/route.ts`:
```ts
import { getAsset, removeReference } from "@/services/projects";
import { api } from "@/web/http";
import { parseRange } from "@/web/range";

export const GET = api(async ({ req, params, deps }) => {
  const asset = await getAsset(deps.db, params.assetId);
  const bytes = await deps.storage.get(asset.storageKey);
  const headers = new Headers({
    "content-type": asset.mimeType,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
  });
  if (new URL(req.url).searchParams.get("download")) {
    headers.set("content-disposition", `attachment; filename="criativo-${asset.id.slice(0, 8)}.mp4"`);
  }

  const range = parseRange(req.headers.get("range"), bytes.length);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${bytes.length}` } });
  }
  if (range) {
    headers.set("content-range", `bytes ${range.start}-${range.end}/${bytes.length}`);
    headers.set("content-length", String(range.end - range.start + 1));
    return new Response(new Uint8Array(bytes.subarray(range.start, range.end + 1)), { status: 206, headers });
  }
  headers.set("content-length", String(bytes.length));
  return new Response(new Uint8Array(bytes), { headers });
});

// Só apaga imagens de referência (o serviço recusa os outros tipos).
export const DELETE = api(async ({ params, deps }) => {
  await removeReference(deps.db, params.assetId);
  return { ok: true };
});
```

`src/app/api/projects/[id]/characters/route.ts`:
```ts
import { z } from "zod";
import { addCharacter } from "@/services/characters";
import { api } from "@/web/http";

export const POST = api(async ({ req, params, deps }) => {
  const body = z.object({ name: z.string(), description: z.string() }).parse(await req.json());
  return addCharacter(deps, params.id, body);
});
```

`src/app/api/projects/[id]/characters/propose/route.ts`:
```ts
import { proposeProjectCharacters } from "@/services/characters";
import { api } from "@/web/http";

export const POST = api(async ({ params, deps }) => {
  await proposeProjectCharacters(deps, params.id);
  return { ok: true };
});
```

`src/app/api/characters/[id]/route.ts`:
```ts
import { z } from "zod";
import { removeCharacter, updateCharacter } from "@/services/characters";
import { api } from "@/web/http";

export const PATCH = api(async ({ req, params, deps }) => {
  const body = z.object({ name: z.string().optional(), description: z.string().optional() }).parse(await req.json());
  return updateCharacter(deps, params.id, body);
});

export const DELETE = api(async ({ params, deps }) => {
  await removeCharacter(deps.db, params.id);
  return { ok: true };
});
```

`src/app/api/characters/[id]/regenerate/route.ts`:
```ts
import { regenerateCharacterImage } from "@/services/characters";
import { api } from "@/web/http";

export const POST = api(async ({ params, deps }) => {
  await regenerateCharacterImage(deps, params.id);
  return { ok: true };
});
```

`src/app/api/characters/[id]/approve/route.ts`:
```ts
import { approveCharacter } from "@/services/characters";
import { api } from "@/web/http";

export const POST = api(async ({ params, deps }) => approveCharacter(deps.db, params.id));
```

`src/app/api/scenes/[id]/route.ts`:
```ts
import { z } from "zod";
import { updateScene } from "@/services/scenes";
import { api } from "@/web/http";

export const PATCH = api(async ({ req, params, deps }) => {
  const body = z
    .object({
      dialogue: z.string().optional(),
      visualPrompt: z.string().optional(),
      targetSeconds: z.number().optional(),
    })
    .parse(await req.json());
  return updateScene(deps.db, params.id, body, deps.config.sceneMaxSeconds);
});
```

`src/app/api/scenes/[id]/regenerate/route.ts`:
```ts
import { z } from "zod";
import { regenerateScene } from "@/services/scenes";
import { api } from "@/web/http";

export const POST = api(async ({ req, params, deps }) => {
  const body = z.object({ prompt: z.string().optional() }).parse(await req.json().catch(() => ({})));
  return regenerateScene(deps, params.id, body.prompt);
});
```

`src/app/api/scenes/[id]/approve/route.ts`:
```ts
import { z } from "zod";
import { approveAttempt } from "@/services/scenes";
import { api } from "@/web/http";

export const POST = api(async ({ req, params, deps }) => {
  const { attemptId } = z.object({ attemptId: z.guid() }).parse(await req.json());
  return approveAttempt(deps.db, params.id, attemptId);
});
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm vitest run tests/web && pnpm typecheck`
Expected: todos PASS; typecheck limpo. Se o typecheck reclamar de `Buffer`/`BodyInit`, manter os `new Uint8Array(...)` das respostas (já aplicados).

- [ ] **Step 7: Commit**

```bash
git add src/app/api tests/web/api.test.ts
git commit -m "feat(api): authenticated endpoints for the whole creative flow"
```

---

### Task 4: UI

> Sem testes automatizados de UI (YAGNI para 2–3 usuários); a verificação é `typecheck` + `build` + o teste de fumaça da Task 6.

**Files:** todos os arquivos abaixo.

- [ ] **Step 1: Base — layout, estilos, tipos, cliente HTTP, polling**

`next.config.ts`:
```ts
import type { NextConfig } from "next";

const config: NextConfig = {};
export default config;
```

`src/app/layout.tsx`:
```tsx
import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Gerador de Criativos" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
```

`src/app/globals.css`:
```css
:root { --bg: #f6f6f4; --card: #fff; --ink: #1b1b1b; --muted: #6b6b6b; --line: #e2e2dc; --accent: #111; --ok: #1a7f37; --warn: #9a6700; --bad: #b42318; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 980px; margin: 0 auto; padding: 24px 16px 80px; }
h1 { font-size: 22px; margin: 0 0 16px; } h2 { font-size: 17px; margin: 24px 0 8px; }
a { color: inherit; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 12px; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.muted { color: var(--muted); font-size: 13px; }
.error { color: var(--bad); margin: 8px 0; }
.notice { color: var(--warn); font-size: 13px; }
input, textarea, select { width: 100%; font: inherit; padding: 8px; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
textarea { min-height: 80px; resize: vertical; }
button { font: inherit; padding: 8px 14px; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer; }
button.secondary { background: #fff; color: var(--accent); }
button:disabled { opacity: .45; cursor: not-allowed; }
.steps { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
.step { padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); font-size: 13px; color: var(--muted); background: #fff; }
.step.current { background: var(--accent); color: #fff; border-color: var(--accent); }
.step.past { color: var(--ok); }
.badge { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #eee; }
.badge.done { background: #dcfce7; color: var(--ok); } .badge.bad { background: #fee4e2; color: var(--bad); } .badge.work { background: #fef3c7; color: var(--warn); }
img.thumb { width: 100%; aspect-ratio: 9 / 16; object-fit: cover; border-radius: 8px; background: #ddd; }
video.clip { width: 100%; max-width: 260px; aspect-ratio: 9 / 16; background: #000; border-radius: 8px; }
.scene { display: grid; grid-template-columns: 270px 1fr; gap: 16px; }
@media (max-width: 700px) { .scene { grid-template-columns: 1fr; } }
.stack > * + * { margin-top: 8px; }
```

`src/lib/types.ts`:
```ts
import type { Snapshot } from "@/services/projects";

export type ProjectView = Snapshot & { estimatedSeconds: number };
export type PanelProps = {
  snap: ProjectView;
  working: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
};
```

`src/lib/labels.ts`:
```ts
import type { Stage } from "@/domain/stages";

export const STAGE_LABELS: Record<Stage, string> = {
  briefing: "Briefing",
  characters: "Personagens",
  script: "Roteiro",
  generating: "Gerando cenas",
  review: "Revisão",
  assembling: "Montando",
  done: "Pronto",
};
```

`src/lib/api.ts`:
```ts
export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const hasBody = init.body !== undefined || init.form !== undefined;
  const res = await fetch(path, {
    method: init.method ?? (hasBody ? "POST" : "GET"),
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined") window.location.href = "/login";
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Erro ${res.status}`);
  return data as T;
}
```

`src/lib/useProject.ts`:
```ts
"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { ProjectView } from "./types";

function isBusy(s: ProjectView): boolean {
  return (
    s.project.stage === "generating" ||
    s.project.stage === "assembling" ||
    s.characters.some((c) => c.imageStatus === "pending") ||
    s.scenes.some((sc) => sc.attempts.some((a) => a.status === "queued" || a.status === "generating"))
  );
}

export function useProject(id: string) {
  const [snap, setSnap] = useState<ProjectView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSnap(await api<ProjectView>(`/api/projects/${id}`));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const busy = snap ? isBusy(snap) : false;
  useEffect(() => {
    const t = setInterval(() => void reload(), busy ? 3000 : 15000);
    return () => clearInterval(t);
  }, [reload, busy]);

  return { snap, loadError, reload };
}
```

- [ ] **Step 2: Páginas de login e lista**

`src/app/login/page.tsx`:
```tsx
"use client";
import { useState } from "react";
import { api } from "@/lib/api";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api("/api/auth/login", { body: { password } });
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 360 }}>
      <h1>Gerador de Criativos</h1>
      <form className="card stack" onSubmit={submit}>
        <label>
          Senha do time
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </label>
        {error && <div className="error">{error}</div>}
        <button disabled={loading || !password}>Entrar</button>
      </form>
    </main>
  );
}
```

`src/components/NewProjectForm.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"ugc" | "novelinha">("ugc");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const p = await api<{ id: string }>("/api/projects", { body: { name, mode } });
      router.push(`/projects/${p.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>Novo criativo</h2>
      <input placeholder="Nome do projeto" value={name} onChange={(e) => setName(e.target.value)} />
      <select value={mode} onChange={(e) => setMode(e.target.value as "ugc" | "novelinha")}>
        <option value="ugc">UGC (pessoa falando para a câmera)</option>
        <option value="novelinha">Novelinha (história com personagens)</option>
      </select>
      {error && <div className="error">{error}</div>}
      <button disabled={loading || !name.trim()}>Criar</button>
    </form>
  );
}
```

`src/app/page.tsx`:
```tsx
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NewProjectForm } from "@/components/NewProjectForm";
import { STAGE_LABELS } from "@/lib/labels";
import { listProjects } from "@/services/projects";
import { getContext } from "@/web/context";
import { isAuthedCookie } from "@/web/http";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!(await isAuthedCookie((await headers()).get("cookie")))) redirect("/login");
  const { deps } = await getContext();
  const list = await listProjects(deps.db);

  return (
    <main>
      <h1>Gerador de Criativos</h1>
      <NewProjectForm />
      <h2>Projetos</h2>
      {list.length === 0 && <p className="muted">Nenhum projeto ainda.</p>}
      {list.map((p) => (
        <Link key={p.id} href={`/projects/${p.id}`} style={{ textDecoration: "none" }}>
          <div className="card row" style={{ justifyContent: "space-between" }}>
            <strong>{p.name}</strong>
            <span className="row">
              <span className="badge">{p.mode === "ugc" ? "UGC" : "Novelinha"}</span>
              <span className="badge">{STAGE_LABELS[p.stage]}</span>
            </span>
          </div>
        </Link>
      ))}
    </main>
  );
}
```

`src/app/projects/[id]/page.tsx`:
```tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ProjectView } from "@/components/ProjectView";
import { isAuthedCookie } from "@/web/http";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthedCookie((await headers()).get("cookie")))) redirect("/login");
  const { id } = await params;
  return (
    <main>
      <ProjectView id={id} />
    </main>
  );
}
```

- [ ] **Step 3: `ProjectView` e barra de etapas**

`src/components/ProjectView.tsx`:
```tsx
"use client";
import Link from "next/link";
import { useState } from "react";
import { stagesFor, type Stage } from "@/domain/stages";
import { api } from "@/lib/api";
import { STAGE_LABELS } from "@/lib/labels";
import { useProject } from "@/lib/useProject";
import { BriefingPanel } from "./BriefingPanel";
import { CharactersPanel } from "./CharactersPanel";
import { DonePanel } from "./DonePanel";
import { ScenesPanel } from "./ScenesPanel";
import { ScriptPanel } from "./ScriptPanel";

export function ProjectView({ id }: { id: string }) {
  const { snap, loadError, reload } = useProject(id);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setWorking(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  if (!snap) return <p className={loadError ? "error" : "muted"}>{loadError ?? "Carregando…"}</p>;

  const { project } = snap;
  const stages = stagesFor(project.mode);
  const currentIndex = stages.indexOf(project.stage);
  const canGoBack = project.stage !== "generating" && project.stage !== "assembling";
  const goTo = (stage: Stage) => run(() => api(`/api/projects/${id}/stage`, { body: { stage } }));

  return (
    <>
      <p className="muted">
        <Link href="/">← Projetos</Link>
      </p>
      <h1>
        {project.name} <span className="badge">{project.mode === "ugc" ? "UGC" : "Novelinha"}</span>
      </h1>

      <div className="steps">
        {stages.map((s, i) => {
          const past = i < currentIndex;
          const clickable = past && canGoBack && s !== "generating" && s !== "assembling";
          return (
            <button
              key={s}
              className={`step ${i === currentIndex ? "current" : past ? "past" : ""}`}
              style={{ cursor: clickable ? "pointer" : "default" }}
              disabled={!clickable || working}
              onClick={() => void goTo(s)}
            >
              {STAGE_LABELS[s]}
            </button>
          );
        })}
      </div>

      {(error || loadError) && <div className="error">{error ?? loadError}</div>}

      {project.stage === "briefing" && <BriefingPanel snap={snap} run={run} working={working} />}
      {project.stage === "characters" && <CharactersPanel snap={snap} run={run} working={working} />}
      {project.stage === "script" && <ScriptPanel snap={snap} run={run} working={working} />}
      {(project.stage === "generating" || project.stage === "review") && (
        <ScenesPanel snap={snap} run={run} working={working} />
      )}
      {project.stage === "assembling" && (
        <div className="card">Montando o vídeo final… isso leva alguns segundos.</div>
      )}
      {project.stage === "done" && <DonePanel snap={snap} run={run} working={working} />}
    </>
  );
}
```

- [ ] **Step 4: Painel de briefing**

`src/components/BriefingPanel.tsx`:
```tsx
"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import type { PanelProps } from "@/lib/types";

export function BriefingPanel({ snap, run, working }: PanelProps) {
  const { project, references } = snap;
  const [name, setName] = useState(project.name);
  const [copy, setCopy] = useState(project.copy);
  const [label, setLabel] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const isUgc = project.mode === "ugc";

  const saveBriefing = () => api(`/api/projects/${project.id}`, { method: "PATCH", body: { name, copy } });

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file || !label.trim()) throw new Error("Escolha uma imagem e dê um rótulo (ex.: produto, pessoa)");
    const form = new FormData();
    form.set("label", label);
    form.set("file", file);
    await api(`/api/projects/${project.id}/references`, { form });
    setLabel("");
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="stack">
      <div className="card stack">
        <label>
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Copy / storytelling
          <textarea
            style={{ minHeight: 200 }}
            value={copy}
            onChange={(e) => setCopy(e.target.value)}
            placeholder="Cole aqui a copy ou a história do criativo"
          />
        </label>
      </div>

      {isUgc && (
        <div className="card stack">
          <strong>Imagens de referência</strong>
          <p className="muted">
            O produto e/ou a pessoa que devem aparecer. O rótulo (ex.: “produto”) é como o roteiro se refere à imagem.
          </p>
          <div className="grid">
            {references.map((r) => (
              <div key={r.id} className="stack">
                <img className="thumb" src={`/api/assets/${r.id}`} alt={r.label ?? ""} />
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span>{r.label}</span>
                  <button
                    className="secondary"
                    disabled={working}
                    onClick={() => void run(() => api(`/api/assets/${r.id}`, { method: "DELETE" }))}
                  >
                    Remover
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="row">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ flex: 2 }} />
            <input placeholder="Rótulo (ex.: produto)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: 1 }} />
            <button className="secondary" disabled={working} onClick={() => void run(upload)}>
              Enviar
            </button>
          </div>
        </div>
      )}

      <button
        disabled={working || !copy.trim()}
        onClick={() =>
          void run(async () => {
            await saveBriefing();
            await api(`/api/projects/${project.id}/stage`, { body: { stage: isUgc ? "script" : "characters" } });
          })
        }
      >
        {isUgc ? "Continuar para o roteiro" : "Continuar para os personagens"}
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Painel de personagens**

`src/components/CharactersPanel.tsx`:
```tsx
"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import type { PanelProps, ProjectView } from "@/lib/types";

type Character = ProjectView["characters"][number];

function CharacterCard({ c, run, working }: Pick<PanelProps, "run" | "working"> & { c: Character }) {
  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description);
  const dirty = name !== c.name || description !== c.description;

  return (
    <div className="card stack">
      {c.assetId ? (
        <img className="thumb" src={`/api/assets/${c.assetId}`} alt={c.name} />
      ) : (
        <div className="thumb row" style={{ justifyContent: "center" }}>
          <span className="muted">{c.imageStatus === "failed" ? `Falhou: ${c.imageError ?? ""}` : "Gerando imagem…"}</span>
        </div>
      )}
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="row">
        {dirty && (
          <button
            disabled={working}
            onClick={() =>
              void run(() => api(`/api/characters/${c.id}`, { method: "PATCH", body: { name, description } }))
            }
          >
            Salvar
          </button>
        )}
        <button
          className="secondary"
          disabled={working || c.imageStatus === "pending"}
          onClick={() => void run(() => api(`/api/characters/${c.id}/regenerate`, { method: "POST", body: {} }))}
        >
          Regerar imagem
        </button>
        <button
          className={c.approved ? "" : "secondary"}
          disabled={working || c.approved || c.imageStatus !== "ready" || dirty}
          onClick={() => void run(() => api(`/api/characters/${c.id}/approve`, { method: "POST", body: {} }))}
        >
          {c.approved ? "Aprovado ✓" : "Aprovar"}
        </button>
        <button
          className="secondary"
          disabled={working}
          onClick={() => void run(() => api(`/api/characters/${c.id}`, { method: "DELETE" }))}
        >
          Remover
        </button>
      </div>
    </div>
  );
}

export function CharactersPanel({ snap, run, working }: PanelProps) {
  const { project, characters } = snap;
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const allApproved = characters.length > 0 && characters.every((c) => c.approved);

  return (
    <div className="stack">
      <div className="card row" style={{ justifyContent: "space-between" }}>
        <span>
          {characters.length === 0
            ? "Gere os personagens a partir da copy. Você poderá editar, regerar e aprovar cada um."
            : `${characters.filter((c) => c.approved).length} de ${characters.length} personagens aprovados`}
        </span>
        <button
          className={characters.length ? "secondary" : ""}
          disabled={working}
          onClick={() => {
            if (characters.length && !confirm("Isso substitui todos os personagens atuais. Continuar?")) return;
            void run(() => api(`/api/projects/${project.id}/characters/propose`, { method: "POST", body: {} }));
          }}
        >
          {characters.length ? "Sugerir de novo" : "Sugerir personagens"}
        </button>
      </div>

      <div className="grid">
        {characters.map((c) => (
          <CharacterCard key={`${c.id}:${c.name}:${c.description}:${c.assetId}`} c={c} run={run} working={working} />
        ))}
      </div>

      <div className="card stack">
        <strong>Adicionar personagem</strong>
        <input placeholder="Nome" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <textarea
          placeholder="Aparência: idade, rosto, cabelo, roupa…"
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
        />
        <button
          className="secondary"
          disabled={working || !newName.trim() || !newDescription.trim()}
          onClick={() =>
            void run(async () => {
              await api(`/api/projects/${project.id}/characters`, { body: { name: newName, description: newDescription } });
              setNewName("");
              setNewDescription("");
            })
          }
        >
          Adicionar
        </button>
      </div>

      <button
        disabled={working || !allApproved}
        onClick={() => void run(() => api(`/api/projects/${project.id}/stage`, { body: { stage: "script" } }))}
      >
        Continuar para o roteiro
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Painel de roteiro**

`src/components/ScriptPanel.tsx`:
```tsx
"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import type { PanelProps, ProjectView } from "@/lib/types";

type Scene = ProjectView["scenes"][number];

function SceneEditor({ scene, index, run, working }: Pick<PanelProps, "run" | "working"> & { scene: Scene; index: number }) {
  const [dialogue, setDialogue] = useState(scene.dialogue);
  const [visualPrompt, setVisualPrompt] = useState(scene.visualPrompt);
  const [seconds, setSeconds] = useState(String(scene.targetSeconds));
  const dirty =
    dialogue !== scene.dialogue || visualPrompt !== scene.visualPrompt || Number(seconds) !== scene.targetSeconds;

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>Cena {index + 1}</strong>
        <span className="muted">
          {scene.references.length ? `Usa: ${scene.references.map((r) => r.label).join(", ")}` : "Sem imagens de referência"}
        </span>
      </div>
      <label>
        Fala
        <textarea value={dialogue} onChange={(e) => setDialogue(e.target.value)} />
      </label>
      <label>
        Descrição visual
        <textarea value={visualPrompt} onChange={(e) => setVisualPrompt(e.target.value)} />
      </label>
      <label style={{ maxWidth: 140 }}>
        Duração (s)
        <input type="number" min={3} value={seconds} onChange={(e) => setSeconds(e.target.value)} />
      </label>
      {scene.notice && <div className="notice">{scene.notice}</div>}
      {dirty && (
        <button
          disabled={working}
          onClick={() =>
            void run(() =>
              api(`/api/scenes/${scene.id}`, {
                method: "PATCH",
                body: { dialogue, visualPrompt, targetSeconds: Number(seconds) },
              }),
            )
          }
        >
          Salvar cena
        </button>
      )}
    </div>
  );
}

export function ScriptPanel({ snap, run, working }: PanelProps) {
  const { project, scenes, estimatedSeconds } = snap;
  const [feedback, setFeedback] = useState("");
  const hasScenes = scenes.length > 0;

  return (
    <div className="stack">
      <div className="card stack">
        <strong>{hasScenes ? "Pedir ajustes ao roteiro" : "Gerar roteiro a partir da copy"}</strong>
        {hasScenes && (
          <textarea
            placeholder="Ex.: tire a cena 3, deixe a abertura mais curta, mais emoção no final…"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
        )}
        <button
          className={hasScenes ? "secondary" : ""}
          disabled={working || (hasScenes && !feedback.trim())}
          onClick={() => {
            if (hasScenes && !confirm("Reescrever o roteiro descarta as edições manuais e as cenas já geradas. Continuar?")) return;
            void run(async () => {
              await api(`/api/projects/${project.id}/script/plan`, { body: { feedback: feedback.trim() || undefined } });
              setFeedback("");
            });
          }}
        >
          {working ? "Trabalhando…" : hasScenes ? "Reescrever com estes ajustes" : "Gerar roteiro"}
        </button>
      </div>

      {scenes.map((s, i) => (
        <SceneEditor key={`${s.id}:${s.dialogue}:${s.visualPrompt}:${s.targetSeconds}`} scene={s} index={i} run={run} working={working} />
      ))}

      {hasScenes && (
        <div className="card row" style={{ justifyContent: "space-between" }}>
          <span>
            {scenes.length} cenas · {estimatedSeconds} s de vídeo a gerar
          </span>
          <button
            disabled={working}
            onClick={() => {
              if (!confirm(`Serão geradas ${scenes.length} cenas (${estimatedSeconds} s de vídeo). Continuar?`)) return;
              void run(() => api(`/api/projects/${project.id}/generate`, { method: "POST", body: {} }));
            }}
          >
            Aprovar roteiro e gerar cenas
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Painel de cenas (geração e revisão)**

`src/components/ScenesPanel.tsx`:
```tsx
"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import type { PanelProps, ProjectView } from "@/lib/types";

type Scene = ProjectView["scenes"][number];

const STATUS: Record<string, { text: string; cls: string }> = {
  queued: { text: "Na fila", cls: "work" },
  generating: { text: "Gerando…", cls: "work" },
  done: { text: "Pronta", cls: "done" },
  failed: { text: "Falhou", cls: "bad" },
  blocked: { text: "Bloqueada", cls: "bad" },
};

function SceneCard({ scene, index, run, working, reviewing }: Pick<PanelProps, "run" | "working"> & { scene: Scene; index: number; reviewing: boolean }) {
  const attempts = scene.attempts;
  const latest = attempts[attempts.length - 1];
  const latestDone = [...attempts].reverse().find((a) => a.status === "done");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(latest?.prompt ?? "");

  const shown = attempts.find((a) => a.id === (selectedId ?? scene.approvedAttemptId)) ?? latestDone;
  const pending = latest?.status === "queued" || latest?.status === "generating";
  const approved = shown && shown.id === scene.approvedAttemptId;
  const status = latest ? STATUS[latest.status] : undefined;

  return (
    <div className="card scene">
      <div>
        {shown?.clipAssetId ? (
          <video className="clip" src={`/api/assets/${shown.clipAssetId}`} controls playsInline preload="metadata" />
        ) : (
          <div className="clip row" style={{ justifyContent: "center", background: "#222", color: "#bbb" }}>
            {pending ? "Gerando…" : "Sem vídeo"}
          </div>
        )}
      </div>
      <div className="stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>Cena {index + 1}</strong>
          <span className="row">
            {approved && <span className="badge done">Aprovada ✓</span>}
            {status && <span className={`badge ${status.cls}`}>{status.text}</span>}
          </span>
        </div>
        <div className="muted">{scene.dialogue ? `“${scene.dialogue}”` : "(sem fala)"}</div>
        {latest?.error && <div className="error">{latest.error}</div>}

        {attempts.length > 1 && (
          <div className="row">
            <span className="muted">Versões:</span>
            {attempts.map((a, i) => (
              <button
                key={a.id}
                className={shown?.id === a.id ? "" : "secondary"}
                style={{ padding: "2px 10px" }}
                disabled={a.status !== "done"}
                onClick={() => setSelectedId(a.id)}
              >
                v{i + 1}
              </button>
            ))}
          </div>
        )}

        {reviewing && (
          <>
            <div className="row">
              <button
                disabled={working || !shown || shown.status !== "done" || Boolean(approved)}
                onClick={() =>
                  void run(() => api(`/api/scenes/${scene.id}/approve`, { body: { attemptId: shown!.id } }))
                }
              >
                Aprovar esta versão
              </button>
              <button className="secondary" disabled={working || pending} onClick={() => setEditing((v) => !v)}>
                Ajustar prompt
              </button>
              <button
                className="secondary"
                disabled={working || pending}
                onClick={() =>
                  void run(() =>
                    api(`/api/scenes/${scene.id}/regenerate`, { body: editing ? { prompt } : {} }),
                  ).then(() => setEditing(false))
                }
              >
                Regerar{editing ? " com este prompt" : ""}
              </button>
            </div>
            {editing && <textarea style={{ minHeight: 140 }} value={prompt} onChange={(e) => setPrompt(e.target.value)} />}
          </>
        )}
      </div>
    </div>
  );
}

export function ScenesPanel({ snap, run, working }: PanelProps) {
  const { project, scenes } = snap;
  const reviewing = project.stage === "review";
  const approvedCount = scenes.filter((s) => s.approvedAttemptId).length;
  const doneCount = scenes.filter((s) => s.attempts.some((a) => a.status === "done")).length;

  return (
    <div className="stack">
      <div className="card row" style={{ justifyContent: "space-between" }}>
        <span>
          {reviewing
            ? `${approvedCount} de ${scenes.length} cenas aprovadas`
            : `Gerando cenas: ${doneCount} de ${scenes.length} prontas`}
        </span>
        {reviewing && (
          <span className="row">
            <button
              className="secondary"
              disabled={working}
              onClick={() => {
                if (!confirm("Regerar todas as cenas? Isso gera e cobra todos os clipes de novo.")) return;
                void run(() => api(`/api/projects/${project.id}/regenerate-all`, { method: "POST", body: {} }));
              }}
            >
              Regerar todas
            </button>
            <button
              disabled={working || approvedCount !== scenes.length}
              onClick={() => void run(() => api(`/api/projects/${project.id}/assemble`, { method: "POST", body: {} }))}
            >
              Montar vídeo final
            </button>
          </span>
        )}
      </div>
      {reviewing && snap.assembleError && <div className="error">A montagem falhou: {snap.assembleError}</div>}
      {scenes.map((s, i) => (
        <SceneCard key={s.id} scene={s} index={i} run={run} working={working} reviewing={reviewing} />
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Painel final**

`src/components/DonePanel.tsx`:
```tsx
"use client";
import { api } from "@/lib/api";
import type { PanelProps } from "@/lib/types";

export function DonePanel({ snap, run, working }: PanelProps) {
  const { project, finalAsset } = snap;
  return (
    <div className="card stack">
      <strong>Vídeo final</strong>
      {finalAsset ? (
        <>
          <video className="clip" style={{ maxWidth: 320 }} src={`/api/assets/${finalAsset.id}`} controls playsInline />
          <div className="muted">
            {finalAsset.durationSeconds ? `${finalAsset.durationSeconds.toFixed(1)} s · ` : ""}720×1280 · MP4
          </div>
          <div className="row">
            <a href={`/api/assets/${finalAsset.id}?download=1`}>
              <button>Baixar MP4</button>
            </a>
            <button
              className="secondary"
              disabled={working}
              onClick={() => void run(() => api(`/api/projects/${project.id}/stage`, { body: { stage: "review" } }))}
            >
              Voltar para a revisão
            </button>
          </div>
        </>
      ) : (
        <span className="muted">Vídeo final não encontrado.</span>
      )}
    </div>
  );
}
```

- [ ] **Step 9: Verificar build e tipos**

Run: `pnpm typecheck && pnpm build`
Expected: typecheck limpo; `next build` termina com a lista de rotas, incluindo `/`, `/login`, `/projects/[id]` e as rotas `/api/**` (todas dinâmicas `ƒ`). Se o build tentar conectar ao banco ou exigir variáveis de ambiente, é sinal de que algo chama `getContext()` no topo de um módulo: mover a chamada para dentro do handler.

- [ ] **Step 10: Rodar a suíte completa**

Run: `pnpm test`
Expected: tudo PASS.

- [ ] **Step 11: Commit**

```bash
git add src/app src/components src/lib next.config.ts
git commit -m "feat(ui): pages and stage panels for the full creative flow"
```

---

### Task 5: Imagens de deploy e README

**Files:**
- Create: `Dockerfile.web`, `Dockerfile.worker`, `.dockerignore`, `README.md`

- [ ] **Step 1: Criar `.dockerignore`**

```
node_modules
.next
.git
.env
.env.local
storage-data
spike-out
docs
tests
```

- [ ] **Step 2: Criar `Dockerfile.web`**

```dockerfile
FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "start"]
```

- [ ] **Step 3: Criar `Dockerfile.worker`**

```dockerfile
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV NODE_ENV=production
CMD ["pnpm", "worker"]
```

- [ ] **Step 4: Validar as imagens localmente**

Run:
```bash
docker build -f Dockerfile.web -t gerador-web . && docker build -f Dockerfile.worker -t gerador-worker .
docker run --rm gerador-worker ffmpeg -version | head -1
```
Expected: os dois builds terminam sem erro; a última linha imprime `ffmpeg version …`.

- [ ] **Step 5: Criar `README.md`**

````markdown
# Gerador de Criativos TikTok

Ferramenta interna para gerar criativos em vídeo (UGC e novelinha) para TikTok Ads, com aprovação humana em cada etapa.

Docs: `docs/superpowers/specs/` (design) e `docs/superpowers/plans/` (implementação). Resultado da validação do provider de vídeo: `docs/provider-spike.md`.

## Rodar localmente (sem custo, providers falsos)

Requisitos: Node 22, pnpm, Docker, ffmpeg.

```bash
cp .env.example .env          # PROVIDER=fake já é o padrão do exemplo
docker compose up -d          # Postgres em localhost:5433
pnpm install
pnpm db:migrate
pnpm dev                      # terminal 1: http://localhost:3000
pnpm worker                   # terminal 2
```

Senha de acesso: valor de `ACCESS_PASSWORD` no `.env`.

## Testes

```bash
docker compose up -d
pnpm test                     # banco de teste: gerador_test
LIVE=1 PROVIDER=gemini pnpm vitest run tests/live   # opcional, usa a API real (consome crédito)
```

## Produção (Railway)

Dois serviços do mesmo repositório + Postgres + Bucket:

| Serviço | Dockerfile | Observações |
|---|---|---|
| `web` | `Dockerfile.web` | domínio público; **Pre-deploy command:** `pnpm db:migrate` |
| `worker` | `Dockerfile.worker` | sem domínio; **exatamente 1 réplica** (o reaproveitamento de jobs travados assume um único worker) |

Variáveis (nos dois serviços): `DATABASE_URL` (do Postgres do Railway), `PROVIDER=gemini`, `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL`, `GEMINI_IMAGE_MODEL`, `GEMINI_VIDEO_MODEL`, `MAX_SCENE_REFERENCES`, `SCENE_MAX_SECONDS`, `STORAGE=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (do Bucket do Railway), `ACCESS_PASSWORD`, `SESSION_SECRET` (≥ 32 caracteres aleatórios). Só o worker usa `WORKER_CONCURRENCY`.

`MAX_SCENE_REFERENCES` e `SCENE_MAX_SECONDS` devem vir de `docs/provider-spike.md`.
````

- [ ] **Step 6: Commit**

```bash
git add Dockerfile.web Dockerfile.worker .dockerignore README.md
git commit -m "chore: docker images for web and worker, readme"
```

---

### Task 6: Teste de fumaça

> Manual. Cada bloco tem o resultado esperado; se algo divergir, corrigir antes de liberar para o time.

- [ ] **Step 1: Fluxo UGC local com providers falsos**

Subir `docker compose up -d`, `pnpm db:migrate`, `pnpm dev` e `pnpm worker`. No navegador (`http://localhost:3000`):

1. Entrar com a senha → lista de projetos vazia.
2. Criar projeto “Teste UGC”, modo UGC → abre o briefing.
3. Colar uma copy, enviar uma imagem com rótulo `produto` → aparece a miniatura.
4. “Continuar para o roteiro” → etapa Roteiro.
5. “Gerar roteiro” → 3 cenas (provider fake). Editar a fala da cena 1 e salvar → persiste ao recarregar.
6. Pedir ajuste (“só uma cena”) → confirmar o aviso de descarte → roteiro regenera.
7. “Aprovar roteiro e gerar cenas” → confirmar → etapa “Gerando cenas” com contador; em ~20–30 s todas ficam prontas e a etapa muda sozinha para Revisão.
8. Tocar um clipe (vídeo de teste colorido com tom). Regerar uma cena → vira v2; alternar entre v1 e v2; aprovar a v1.
9. Aprovar todas → “Montar vídeo final” → etapa “Montando” → etapa Pronto com player. Se a montagem falhar, o projeto volta à Revisão e o aviso “A montagem falhou: …” (`snap.assembleError`) aparece acima das cenas até uma nova montagem ser pedida.
10. “Baixar MP4” e conferir: `ffprobe -v error -show_entries stream=width,height,codec_type -of csv=p=0 <arquivo>` mostra `720,1280` de vídeo e uma trilha de áudio.

- [ ] **Step 2: Fluxo novelinha local**

Novo projeto em modo Novelinha → briefing → “Continuar para os personagens” → “Sugerir personagens” (Marina e Rafael) → imagens aparecem em poucos segundos → editar a descrição de um (imagem regera, aprovação some) → aprovar os dois → roteiro → gerar → revisar → montar.
Esperado: em “Aprovar” só habilita com imagem pronta; “Continuar” só habilita com todos aprovados.

- [ ] **Step 3: Resiliência do worker**

Durante a etapa “Gerando cenas”, parar o worker (`Ctrl+C`), esperar 10 s e subir de novo.
Esperado: a geração retoma e conclui; nenhuma cena fica presa em “Gerando…”.
(Jobs que estavam em execução voltam à fila depois de 30 minutos parados (`STALE_AFTER_MS` do worker) pelo `recoverStaleJobs`, a menos que tenham esgotado as tentativas: nesse caso são marcados como `failed` e o `onDead` limpa as linhas de domínio; para o teste acelerar com: `docker compose exec postgres psql -U postgres gerador -c "update jobs set locked_at = now() - interval '40 minutes' where status='running'"`.)

- [ ] **Step 4: Segurança básica**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/projects` → `401`.
Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/assets/00000000-0000-0000-0000-000000000000` → `401`.
Abrir `http://localhost:3000/` em janela anônima → redireciona para `/login`.

- [ ] **Step 5: Deploy no Railway**

Criar projeto Railway com Postgres e Bucket; dois serviços a partir deste repositório (`web` com `Dockerfile.web` e pre-deploy `pnpm db:migrate`; `worker` com `Dockerfile.worker`, 1 réplica); preencher as variáveis da tabela do README. Para detalhes de CLI/dashboard do Railway, usar a skill `use-railway`.
Esperado: o `web` sobe e o domínio público mostra `/login`; o log do `worker` mostra `worker iniciado (provider=gemini, …)`.

- [ ] **Step 6: Fumaça com provider real (consome crédito; fazer uma vez)**

Em produção, criar um projeto UGC curto (copy de 2 frases, 1 imagem de produto) e gerar **2 cenas**.
Verificar e anotar em `docs/provider-spike.md` (seção “Fumaça de produção”):
- tempo de geração por cena;
- cena com fala em pt-BR audível e boca sincronizada;
- produto reconhecível no clipe (referência respeitada);
- MP4 final baixa e toca; arquivos aparecem no Bucket.

Se a fala não sair, o produto não aparecer ou o tempo de geração for inviável, **não liberar para o time**: reabrir a decisão do provider de vídeo (ver decisões no spike).

- [ ] **Step 7: Commit do registro**

```bash
git add docs/provider-spike.md
git commit -m "docs: record production smoke test"
```

---

## Auto-revisão do Plano 3 contra o spec

- §2 dentro do escopo: acesso por senha única (T1, T3 login); UI do fluxo completo, aprovar/regerar uma/todas/restaurar versão (T4); download do MP4 (T4 DonePanel + rota de arquivos).
- §4 arquitetura: web + worker + Postgres + bucket (T5, T6). Divergência do spec: arquivos servidos por rota autenticada da web com `Range`, em vez de URL assinada do bucket (mantém todo acesso atrás da senha e evita expor o bucket).
- §5 estados: UI mostra o painel de cada etapa e só permite as transições que o serviço aceita; voltar a etapas anteriores pelos botões da barra (T4 `ProjectView`).
- §9 segredos: só em variáveis de ambiente (README); `.env` fora do git (Plano 1).
- Estimativa de segundos antes de gerar: `estimatedSeconds` na API + confirmação no `ScriptPanel` (T3, T4).
- Consistência de nomes: `api()` (wrapper no servidor) vs `api()` (cliente em `src/lib/api.ts`) vivem em módulos diferentes (`@/web/http` e `@/lib/api`) e nunca são importados juntos.
