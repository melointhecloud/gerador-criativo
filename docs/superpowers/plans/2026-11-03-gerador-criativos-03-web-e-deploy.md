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
| `src/components/*.tsx` | Painéis por etapa, `AppHeader` (cabeçalho), `icons` (SVG) |
| `src/app/layout.tsx`, `globals.css`, `page.tsx`, `login/page.tsx`, `projects/[id]/page.tsx`, `loading.tsx` | Páginas (visual: `docs/design/direction.md`) |
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
import { createSession, passwordMatches, SESSION_MAX_AGE_S, verifySession } from "@/auth/session";

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

describe("sessão: tokens malformados e segredo", () => {
  it("rejeita sem lançar: partes demais, base64 inválido, expiração não numérica", async () => {
    const t = await createSession(secret);
    const [exp, sig] = t.split(".");
    expect(await verifySession(`${exp}.${sig}.extra`, secret)).toBe(false);
    expect(await verifySession(`${exp}.!!!`, secret)).toBe(false);
    expect(await verifySession(`${exp}.`, secret)).toBe(false);
    expect(await verifySession(`abc.${sig}`, secret)).toBe(false);
    expect(await verifySession(`-5.${sig}`, secret)).toBe(false);
    expect(await verifySession(".", secret)).toBe(false);
  });
  it("não aceita segredo vazio", async () => {
    await expect(createSession("")).rejects.toThrow();
    const t = await createSession(secret);
    expect(await verifySession(t, "")).toBe(false);
  });
  it("expira exatamente no limite", async () => {
    const now = 1_700_000_000_000;
    const t = await createSession(secret, now);
    const exp = now + SESSION_MAX_AGE_S * 1000;
    expect(await verifySession(t, secret, exp - 1)).toBe(true);
    expect(await verifySession(t, secret, exp)).toBe(false);
  });
});

describe("passwordMatches", () => {
  it("compara a senha", async () => {
    expect(await passwordMatches("segredo", "segredo")).toBe(true);
    expect(await passwordMatches("errada", "segredo")).toBe(false);
    expect(await passwordMatches("", "segredo")).toBe(false);
    expect(await passwordMatches("segredo-mais-longo", "segredo")).toBe(false);
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

// Devolve null se não for base64url válido (nunca lança).
function fromBase64Url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function hmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  if (!secret) throw new Error("Segredo de sessão vazio.");
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);
}

async function hmac(secret: string, data: string): Promise<ArrayBuffer> {
  return crypto.subtle.sign("HMAC", await hmacKey(secret, ["sign"]), enc.encode(data));
}

// Comparação em tempo constante de dois digests de tamanho fixo (32 bytes).
function digestsEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

export async function createSession(secret: string, now = Date.now()): Promise<string> {
  const payload = String(now + SESSION_MAX_AGE_S * 1000);
  return `${payload}.${toBase64Url(await hmac(secret, payload))}`;
}

export async function verifySession(token: string | undefined, secret: string, now = Date.now()): Promise<boolean> {
  try {
    if (!token || !secret) return false;
    const parts = token.split(".");
    if (parts.length !== 2) return false;
    const [payload, sig] = parts as [string, string];
    if (!/^\d{1,16}$/.test(payload)) return false;
    const sigBytes = fromBase64Url(sig);
    if (!sigBytes) return false;
    // crypto.subtle.verify compara a assinatura em tempo constante.
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, ["verify"]), sigBytes, enc.encode(payload));
    return ok && Number(payload) > now;
  } catch {
    return false;
  }
}

// Compara digests HMAC (tamanho fixo) das duas senhas: tempo constante e sem vazar o tamanho.
export async function passwordMatches(input: string, expected: string): Promise<boolean> {
  return digestsEqual(await hmac("password-check", input), await hmac("password-check", expected));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run tests/auth/session.test.ts`
Expected: 8 testes PASS.

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
- Test: `tests/web/range.test.ts`, `tests/web/http.test.ts`, `tests/web/context.test.ts`

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
    expect(parseRange("bytes=0-0", 100)).toEqual({ start: 0, end: 0 });
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
  it("múltiplos intervalos, lixo e números gigantes são inválidos (nunca NaN/negativo)", () => {
    expect(parseRange("bytes=0-1,5-6", 100)).toBe("invalid");
    expect(parseRange("bytes=a-b", 100)).toBe("invalid");
    expect(parseRange("bytes=-5-9", 100)).toBe("invalid");
    expect(parseRange("bytes=99999999999999999999999-", 100)).toBe("invalid");
    expect(parseRange("bytes=0-99999999999999999999999", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=-99999999999999999999999", 100)).toEqual({ start: 0, end: 99 });
  });
  it("arquivo vazio: qualquer Range é inválido", () => {
    expect(parseRange("bytes=0-", 0)).toBe("invalid");
    expect(parseRange("bytes=-5", 0)).toBe("invalid");
  });
});
```


- [ ] **Step 1b: Testes do wrapper `api()` e do contexto**

`tests/web/http.test.ts` e `tests/web/context.test.ts` (cobrem: 401 fail-closed sem rodar o handler, contexto indisponível = 500 e handler não roda, Zod em pt-BR, id malformado, JSON inválido, 500 genérico sem vazar mensagem, `auth:false`, e rejeição do contexto não ficar em cache):

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createSession, SESSION_COOKIE } from "@/auth/session";
import type { WebContext } from "@/web/context";
import { setContextForTests } from "@/web/context";
import { api, describeZodError } from "@/web/http";
import { DomainError } from "@/services/errors";

const SECRET = "s".repeat(40);
const ctx = { env: { SESSION_SECRET: SECRET }, deps: {} } as unknown as WebContext;

async function authed(url = "http://x/api/t", init: RequestInit = {}) {
  const token = await createSession(SECRET);
  return new Request(url, { ...init, headers: { cookie: `${SESSION_COOKIE}=${token}`, ...(init.headers ?? {}) } });
}
const ID = "00000000-0000-0000-0000-000000000000";

afterEach(() => {
  setContextForTests(null);
  vi.restoreAllMocks();
});

describe("api()", () => {
  it("sem cookie, com cookie inválido ou segredo vazio: 401 e o handler não roda", async () => {
    const handler = vi.fn(async () => ({ ok: 1 }));
    setContextForTests(ctx);
    const route = api(handler);
    expect((await route(new Request("http://x/"))).status).toBe(401);
    expect((await route(new Request("http://x/", { headers: { cookie: `${SESSION_COOKIE}=lixo` } }))).status).toBe(401);
    setContextForTests({ ...ctx, env: { SESSION_SECRET: "" } } as unknown as WebContext);
    expect((await route(await authed())).status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("falha fechado quando o contexto não carrega (500, handler não roda, sem vazar detalhes)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("DATABASE_URL", "");
    setContextForTests(null);
    const handler = vi.fn(async () => ({ ok: 1 }));
    const res = await api(handler)(await authed());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Erro interno do servidor. Tente novamente." });
    expect(handler).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("autenticado: roda o handler, devolve JSON e não deixa cachear", async () => {
    setContextForTests(ctx);
    const res = await api(async ({ params }) => ({ id: params.id }))(await authed(), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: ID });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("id malformado na URL: 400 em pt-BR", async () => {
    setContextForTests(ctx);
    const res = await api(async () => ({}))(await authed(), { params: Promise.resolve({ id: "x" }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Identificador inválido");
  });

  it("DomainError vira status + mensagem", async () => {
    setContextForTests(ctx);
    const res = await api(async () => {
      throw new DomainError("Projeto não encontrado", 404);
    })(await authed());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Projeto não encontrado" });
  });

  it("ZodError vira 400 com resumo em pt-BR (sem JSON cru do Zod)", async () => {
    setContextForTests(ctx);
    const schema = z.object({ name: z.string().min(1), n: z.number() });
    const res = await api(async () => {
      schema.parse({ name: "", n: "a" });
    })(await authed());
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toContain("name");
    expect(error).toContain("n");
    expect(error).not.toMatch(/Invalid|expected|Too small/i);
    const missing = await api(async () => {
      schema.parse({});
    })(await authed());
    expect((await missing.json()).error).toContain("obrigatório");
  });

  it("JSON malformado no corpo: 400", async () => {
    setContextForTests(ctx);
    const res = await api(async ({ req }) => req.json())(await authed("http://x/", { method: "POST", body: "{nope" }));
    expect(res.status).toBe(400);
  });

  it("erro desconhecido: 500 genérico, loga no servidor, sem vazar mensagem", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setContextForTests(ctx);
    const res = await api(async () => {
      throw new Error("senha do banco: hunter2");
    })(await authed());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("hunter2");
    expect(spy).toHaveBeenCalled();
  });

  it("auth:false é o único jeito de pular a sessão", async () => {
    setContextForTests(ctx);
    const res = await api(async () => ({ ok: 1 }), { auth: false })(new Request("http://x/"));
    expect(res.status).toBe(200);
  });

  it("describeZodError: tipo errado não vira 'obrigatório'; ausente vira; caminhos aninhados e de array", () => {
    const schema = z.object({ n: z.number(), a: z.string(), o: z.object({ x: z.string() }), l: z.array(z.number()) });
    const wrong = describeZodError(schema.safeParse({ n: "a", a: [1], o: { x: 1 }, l: [1, "b"] }).error!);
    expect(wrong).toContain("n: tipo inválido");
    expect(wrong).toContain("a: tipo inválido");
    expect(wrong).toContain("o.x: tipo inválido");
    expect(wrong).toContain("l.1: tipo inválido");
    expect(wrong).not.toContain("obrigatório");
    const missing = describeZodError(schema.safeParse({ n: 1, a: "x", o: {}, l: [] }).error!);
    expect(missing).toContain("o.x: campo obrigatório");
    expect(missing).not.toContain("tipo inválido");
    expect(describeZodError(schema.safeParse(null).error!)).toContain("corpo da requisição: tipo inválido");
  });

  describe("defesa de origem em métodos que alteram estado", () => {
    const run = async (init: RequestInit, opts?: { auth?: boolean }) => {
      setContextForTests(ctx);
      const handler = vi.fn(async () => ({ ok: 1 }));
      const route = api(handler, opts);
      const req = opts?.auth === false ? new Request("http://app.test/api/t", init) : await authed("http://app.test/api/t", init);
      return { res: await route(req), handler };
    };
    const post = (headers: Record<string, string>) => ({ method: "POST", headers });

    it("Sec-Fetch-Site cross-site/same-site: 403 e o handler não roda", async () => {
      for (const v of ["cross-site", "same-site"]) {
        const { res, handler } = await run(post({ "sec-fetch-site": v }));
        expect(res.status).toBe(403);
        expect((await res.json()).error).toContain("bloqueada");
        expect(handler).not.toHaveBeenCalled();
      }
    });
    it("same-origin e none passam", async () => {
      expect((await run(post({ "sec-fetch-site": "same-origin" }))).res.status).toBe(200);
      expect((await run(post({ "sec-fetch-site": "none" }))).res.status).toBe(200);
    });
    it("Origin igual ao Host passa; diferente ou 'null' dá 403", async () => {
      expect((await run(post({ origin: "http://app.test", host: "app.test" }))).res.status).toBe(200);
      const bad = await run(post({ origin: "http://evil.test", host: "app.test" }));
      expect(bad.res.status).toBe(403);
      expect(bad.handler).not.toHaveBeenCalled();
      expect((await run(post({ origin: "null", host: "app.test" }))).res.status).toBe(403);
    });
    it("Origin confere com X-Forwarded-Host (primeiro valor)", async () => {
      const ok = await run(post({ origin: "https://app.test", "x-forwarded-host": "app.test, proxy.internal", host: "interno:8080" }));
      expect(ok.res.status).toBe(200);
    });
    it("sem Origin nem Sec-Fetch-Site passa (curl, testes)", async () => {
      expect((await run({ method: "POST" })).res.status).toBe(200);
    });
    it("GET com cabeçalhos cross-site passa (somente leitura)", async () => {
      expect((await run({ method: "GET", headers: { "sec-fetch-site": "cross-site", origin: "http://evil.test" } })).res.status).toBe(200);
    });
    it("rota auth:false (login) também bloqueia cross-site", async () => {
      const { res, handler } = await run(post({ "sec-fetch-site": "cross-site" }), { auth: false });
      expect(res.status).toBe(403);
      expect(handler).not.toHaveBeenCalled();
    });
    it("a sessão vem primeiro: sem cookie e cross-site responde 401", async () => {
      setContextForTests(ctx);
      const res = await api(async () => ({}))(new Request("http://app.test/", { method: "POST", headers: { "sec-fetch-site": "cross-site" } }));
      expect(res.status).toBe(401);
    });
  });
});
```

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const createProviders = vi.fn();
vi.mock("@/providers", () => ({ createProviders: (...a: unknown[]) => createProviders(...a) }));

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as { __gcContext?: unknown }).__gcContext;
  createProviders.mockReset();
});

function stubEnv() {
  vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost:5434/x");
  vi.stubEnv("PROVIDER", "fake");
  vi.stubEnv("ACCESS_PASSWORD", "pw");
  vi.stubEnv("SESSION_SECRET", "s".repeat(40));
}

describe("getContext", () => {
  it("não deixa a rejeição em cache: a próxima chamada tenta de novo", async () => {
    stubEnv();
    const { getContext } = await import("@/web/context");
    createProviders.mockRejectedValueOnce(new Error("ffmpeg ausente")).mockResolvedValueOnce({});
    await expect(getContext()).rejects.toThrow("ffmpeg ausente");
    const ok = await getContext();
    expect(ok.env.PROVIDER).toBe("fake");
    expect(createProviders).toHaveBeenCalledTimes(2);
    expect(await getContext()).toBe(ok); // sucesso fica em cache
    expect(createProviders).toHaveBeenCalledTimes(2);
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
// Multi-range ("bytes=0-1,5-6"), formato desconhecido, início fora do arquivo e arquivo vazio são "invalid".
// Nunca devolve NaN, valor negativo ou fim além de size-1.
export function parseRange(header: string | null, size: number): ByteRange | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return "invalid";
  const [, s, e] = m as unknown as [string, string, string];
  if (s === "" && e === "") return "invalid";
  if (size <= 0) return "invalid";

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
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return "invalid";
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
```

- [ ] **Step 5: Implementar `src/web/http.ts`**

```ts
import { z } from "zod";
import { SESSION_COOKIE, verifySession } from "@/auth/session";
import type { Env } from "@/config/env";
import type { Deps } from "@/deps";
import { DomainError } from "@/services/errors";
import { getContext } from "./context";
import { readCookie } from "./cookie";

export { readCookie };

// Cabeçalhos de toda resposta com arquivo do usuário (rotas de arquivo da Task 3): nunca cache público, sem sniffing.
export const FILE_HEADERS = {
  "Cache-Control": "private, max-age=3600",
  Vary: "Cookie", // o cache não vale depois que o cookie muda (logout)
  "X-Content-Type-Options": "nosniff",
} as const;
export const JSON_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

// Falha fechado: qualquer erro (cookie ausente, segredo vazio, contexto indisponível) conta como não autenticado.
export async function isAuthedCookie(cookieHeader: string | null): Promise<boolean> {
  try {
    const { env } = await getContext();
    return await verifySession(readCookie(cookieHeader, SESSION_COOKIE), env.SESSION_SECRET);
  } catch {
    return false;
  }
}

type ApiArgs = { req: Request; params: Record<string, string>; deps: Deps; env: Env };
type RouteCtx = { params: Promise<Record<string, string>> };

const uuid = z.guid(); // qualquer id no formato 8-4-4-4-12; evita que um id malformado chegue ao Postgres

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: JSON_HEADERS });

// Resumo em pt-BR (as mensagens nativas do Zod são em inglês).
export function describeZodError(e: z.ZodError): string {
  const parts = e.issues.slice(0, 5).map((i) => {
    const field = i.path.length ? i.path.map(String).join(".") : "corpo da requisição";
    let why: string;
    switch (i.code) {
      case "invalid_type":
        // O Zod v4 não expõe o valor recebido na issue; a mensagem nativa traz "received undefined" quando falta o campo.
        why = /received undefined/.test(i.message) ? "campo obrigatório" : "tipo inválido";
        break;
      case "too_small":
        why = "valor curto ou pequeno demais";
        break;
      case "too_big":
        why = "valor longo ou grande demais";
        break;
      case "invalid_value":
        why = "valor não permitido";
        break;
      case "invalid_format":
        why = "formato inválido";
        break;
      case "unrecognized_keys":
        why = "campo não reconhecido";
        break;
      default:
        why = "valor inválido";
    }
    return `${field}: ${why}`;
  });
  return `Dados inválidos (${parts.join("; ")})`;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Defesa de CSRF além do SameSite do cookie: em métodos que alteram estado, bloqueia requisições vindas de outra origem.
// Sem Sec-Fetch-Site nem Origin (curl, testes, navegadores antigos em same-origin) a requisição segue.
export function isCrossOrigin(req: Request): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return false;
  const site = req.headers.get("sec-fetch-site");
  if (site !== null) return site !== "same-origin" && site !== "none";
  const origin = req.headers.get("origin");
  if (origin === null) return false;
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

// Envolve um endpoint: autentica (fail closed), valida ids da URL, converte erros em JSON pt-BR.
// `auth: false` existe só para a rota de login; toda outra rota exige a sessão.
export function api(handler: (a: ApiArgs) => Promise<unknown>, opts: { auth?: boolean } = {}) {
  return async (req: Request, ctx?: RouteCtx): Promise<Response> => {
    // Falha ao montar o contexto (env inválido, ffmpeg ausente...) é erro de servidor, nunca "dados inválidos"
    // (um ZodError do loadEnv não pode virar 400 nem vazar nomes de variáveis).
    let context: Awaited<ReturnType<typeof getContext>>;
    try {
      context = await getContext();
    } catch (e) {
      console.error("Falha ao montar o contexto da aplicação:", e instanceof Error ? e.message : "erro desconhecido");
      return json({ error: "Erro interno do servidor. Tente novamente." }, 500);
    }
    const { deps, env } = context;
    try {
      if (opts.auth !== false) {
        let ok = false;
        try {
          ok = await verifySession(readCookie(req.headers.get("cookie"), SESSION_COOKIE), env.SESSION_SECRET);
        } catch {
          ok = false;
        }
        if (!ok) return json({ error: "Não autorizado" }, 401);
      }
      // Vale também para auth:false (login é um POST que altera estado).
      if (isCrossOrigin(req)) return json({ error: "Requisição bloqueada por segurança (origem diferente)." }, 403);
      const params = ctx?.params ? await ctx.params : {};
      for (const v of Object.values(params)) {
        if (!uuid.safeParse(v).success) throw new DomainError("Identificador inválido", 400);
      }
      const out = await handler({ req, params, deps, env });
      return out instanceof Response ? out : json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof DomainError) return json({ error: e.message }, e.status);
      if (e instanceof z.ZodError) return json({ error: describeZodError(e) }, 400);
      if (e instanceof SyntaxError && /JSON/i.test(e.message)) return json({ error: "Corpo da requisição inválido" }, 400);
      console.error(e);
      return json({ error: "Erro interno do servidor. Tente novamente." }, 500);
    }
  };
}
```

> Notas de execução (corrigidas após revisão): `api()` falha fechado (qualquer erro na verificação da sessão = 401; erro ao montar o contexto = 500 sem rodar o handler e sem mapear o ZodError do `loadEnv` para 400); `auth:false` é só para a rota de login; `getContext()` limpa o cache quando a criação rejeita (ex.: ffmpeg ausente com `PROVIDER=fake`); erros Zod viram resumo em pt-BR ("obrigatório" só quando a mensagem nativa diz `received undefined`; o Zod v4 não põe `input` na issue); métodos que não são GET/HEAD/OPTIONS passam por `isCrossOrigin` (Sec-Fetch-Site, senão Origin x Host/X-Forwarded-Host) depois da sessão, inclusive em `auth:false`; `FILE_HEADERS` (`Cache-Control: private`, `nosniff`) deve ser usado nas respostas de arquivo da Task 3. A assinatura `api(async ({ req, params, deps, env }) => ...)` não mudou, então os snippets da Task 3 continuam válidos; `params` é `Promise` no Next 16, já tratado.

**Portão central das páginas (proxy do Next 16).** `readCookie` foi movido para `src/web/cookie.ts` (sem dependências, seguro para o proxy) e é reexportado por `src/web/http.ts`. As páginas continuam checando a sessão (defesa em profundidade), mas agora há UM portão: `src/proxy.ts` (nome do Next 16 para o middleware; exporta `proxy` e `config.matcher`), que redireciona para `/login` toda requisição de página sem sessão válida. Ficam de fora `/login`, `/api/**` (continuam respondendo 401 em JSON via `api()`), `/_next/**` e arquivos estáticos conhecidos (extensões `ico|png|jpe?g|gif|svg|webp|txt|xml|css|js|map|woff2?`; favicon, imagens, fontes). A decisão vive em funções puras testadas.

`src/web/cookie.ts`:
```ts
// Leitura de cookie sem dependências (seguro para o proxy: não importa banco nem storage).
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}
```

`src/web/page-gate.ts`:
```ts
import { SESSION_COOKIE, verifySession } from "@/auth/session";
import { readCookie } from "@/web/cookie";

// Portão central das páginas (usado por src/proxy.ts). Rotas de API ficam de fora: `api()` já responde 401 em JSON.
// Mantenha em sincronia com `config.matcher` de src/proxy.ts (há teste cobrindo os dois). Só extensões estáticas conhecidas
// ficam de fora: um caminho com ponto qualquer (ex.: /projects/abc.def) continua sob o portão.
// Sensível a maiúsculas de propósito: o Next compila o matcher com `i` (/LOGIN pula o proxy), mas esses caminhos são 404.
export function isGatedPath(pathname: string): boolean {
  if (/^\/(login|api|_next)(\/|$)/.test(pathname)) return false;
  if (/\.(?:ico|png|jpe?g|gif|svg|webp|txt|xml|css|js|map|woff2?)$/.test(pathname)) return false; // favicon e estáticos
  return true;
}

export type GateDecision = { action: "allow" } | { action: "redirect"; to: "/login" };

// Falha fechado: qualquer erro, cookie ausente ou segredo vazio vira redirecionamento para /login.
export async function decideGate(a: { pathname: string; cookie: string | null; secret: string | undefined }): Promise<GateDecision> {
  if (!isGatedPath(a.pathname)) return { action: "allow" };
  try {
    if (await verifySession(readCookie(a.cookie, SESSION_COOKIE), a.secret ?? "")) return { action: "allow" };
  } catch {
    // cai no redirecionamento
  }
  return { action: "redirect", to: "/login" };
}
```

`src/proxy.ts`:
```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decideGate } from "@/web/page-gate";

// Portão central das páginas: sem sessão válida, tudo vai para /login. Fica de fora (ver `isGatedPath`):
// /login, /api/** (responde 401 em JSON via `api()`), /_next/**, e arquivos estáticos conhecidos (favicon, imagens, txt, xml, css, js, map, fontes).
export async function proxy(request: NextRequest) {
  const d = await decideGate({
    pathname: request.nextUrl.pathname,
    cookie: request.headers.get("cookie"),
    secret: process.env.SESSION_SECRET,
  });
  if (d.action === "redirect") {
    // Clona nextUrl (origem que o Next resolveu): `request.url` pode trazer o host interno atrás do Railway/Docker.
    const url = request.nextUrl.clone();
    url.pathname = d.to;
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Literal estático (o Next o analisa em build); a lista de extensões deve ser igual à de `isGatedPath` (teste confere).
  matcher: ["/((?!login(?:/|$)|api(?:/|$)|_next(?:/|$)|.*\\.(?:ico|png|jpe?g|gif|svg|webp|txt|xml|css|js|map|woff2?)$).*)"],
};
```

`tests/web/page-gate.test.ts`:
```ts
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { createSession, SESSION_COOKIE } from "@/auth/session";
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";
import { decideGate, isGatedPath } from "@/web/page-gate";

const SECRET = "s".repeat(40);
const EXCLUDED = [
  "/login", "/login/", "/login/x", "/api/projects", "/api", "/api/x", "/_next/static/x.js", "/_next/static/a.js", "/_next/image",
  "/favicon.ico", "/logo.png", "/robots.txt", "/sitemap.xml", "/static.js.map",
];
// Caminhos com ponto que NÃO são estáticos conhecidos continuam sob o portão (ex.: /projects/abc.def casa com a página [id]).
const GATED = ["/", "/projects/x", "/some/new/page", "/loginx", "/login-admin", "/apixyz", "/projects/a.b", "/projects/x.y.z", "/new.page"];

describe("isGatedPath", () => {
  it("protege páginas e deixa de fora login, API, assets do Next e estáticos", () => {
    for (const p of GATED) expect(isGatedPath(p), p).toBe(true);
    for (const p of EXCLUDED) expect(isGatedPath(p), p).toBe(false);
  });
});

describe("decideGate", () => {
  const redirect = { action: "redirect", to: "/login" };
  it("cookie válido: libera", async () => {
    const token = await createSession(SECRET);
    expect(await decideGate({ pathname: "/", cookie: `${SESSION_COOKIE}=${token}`, secret: SECRET })).toEqual({ action: "allow" });
    expect(await decideGate({ pathname: "/projects/x", cookie: `a=b; ${SESSION_COOKIE}=${token}`, secret: SECRET })).toEqual({ action: "allow" });
  });
  it("cookie ausente, inválido ou expirado: redireciona para /login", async () => {
    expect(await decideGate({ pathname: "/", cookie: null, secret: SECRET })).toEqual(redirect);
    expect(await decideGate({ pathname: "/", cookie: `${SESSION_COOKIE}=lixo`, secret: SECRET })).toEqual(redirect);
    const expired = await createSession(SECRET, Date.now() - 15 * 24 * 3600 * 1000);
    expect(await decideGate({ pathname: "/projects/x", cookie: `${SESSION_COOKIE}=${expired}`, secret: SECRET })).toEqual(redirect);
    const other = await createSession("outro".repeat(10));
    expect(await decideGate({ pathname: "/", cookie: `${SESSION_COOKIE}=${other}`, secret: SECRET })).toEqual(redirect);
  });
  it("segredo vazio ou indefinido: redireciona (falha fechado), mesmo com cookie bem formado", async () => {
    const token = await createSession(SECRET);
    expect(await decideGate({ pathname: "/", cookie: `${SESSION_COOKIE}=${token}`, secret: "" })).toEqual(redirect);
    expect(await decideGate({ pathname: "/", cookie: `${SESSION_COOKIE}=${token}`, secret: undefined })).toEqual(redirect);
  });
  it("caminhos fora do portão passam sem cookie", async () => {
    for (const p of EXCLUDED) expect(await decideGate({ pathname: p, cookie: null, secret: SECRET }), p).toEqual({ action: "allow" });
  });
});

describe("matcher do proxy", () => {
  it("cobre exatamente os mesmos caminhos que isGatedPath", () => {
    expect(config.matcher).toHaveLength(1);
    // O Next compila o matcher sem diferenciar maiúsculas (flag `i`). Assim, /LOGIN e /Api/x também pulam o proxy,
    // mas viram 404 porque as rotas do Next diferenciam maiúsculas; por isso `isGatedPath` fica sensível a caixa.
    const re = new RegExp(`^${config.matcher[0]}$`, "i");
    for (const p of [...GATED, ...EXCLUDED]) expect(re.test(p), p).toBe(isGatedPath(p));
  });
});

describe("redirecionamento do proxy", () => {
  it("sem cookie, redireciona para /login usando a origem resolvida pelo Next e sem query", async () => {
    const req = new NextRequest("http://0.0.0.0:3000/projects/x?segredo=1");
    const res = await proxy(req);
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toBe(`${req.nextUrl.origin}/login`);
    expect(location).toBe("http://0.0.0.0:3000/login");
    expect(location).not.toContain("segredo");
  });
});

function pagesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...pagesUnder(full));
    else if (/^page\.(t|j)sx?$/.test(e.name)) out.push(full);
  }
  return out;
}

describe("páginas existentes", () => {
  it("toda página, exceto /login, fica sob o portão central", () => {
    const root = join(process.cwd(), "src", "app");
    const pages = pagesUnder(root);
    expect(pages.length).toBeGreaterThan(2);
    for (const file of pages) {
      const segs = relative(root, file).split(sep).slice(0, -1).filter((s) => !/^\(.*\)$/.test(s));
      const route = "/" + segs.map((s) => s.replace(/^\[\.*(.*?)\]$/, "x")).join("/");
      if (segs[0] === "login") expect(isGatedPath(route), route).toBe(false);
      else expect(isGatedPath(route), route).toBe(true);
    }
  });
});
```

Verificação: `pnpm build` lista `ƒ Proxy (Middleware)`. O teste de páginas falha se surgir uma `page.tsx` fora do portão (tudo exceto `login`). Um caminho com ponto que não seja estático conhecido (`/projects/x.y`) continua sob o portão. O redirecionamento clona `request.nextUrl` (não usa `request.url`, que atrás do Railway/Docker pode ter o host interno) e há teste com `NextRequest` em `0.0.0.0:3000`.

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

Run: `pnpm vitest run tests/web && pnpm typecheck`
Expected: todos PASS (range, http, context); typecheck limpo.

- [ ] **Step 8: Commit**

```bash
git add src/web src/proxy.ts src/services/projects.ts tests/web
git commit -m "feat(web): request context, api wrapper and range parser"
```

---

### Task 3: Endpoints da API

**Files:**
- Create: todos os `route.ts` abaixo, `src/web/login-throttle.ts`, `src/web/storage-errors.ts`
- Test: `tests/web/api.test.ts`, `tests/web/login-throttle.test.ts`

Regras desta task (aplicadas no código abaixo; o código foi executado e os testes passam):
- Toda rota passa por `api()` com auth ligada; **só o login usa `auth: false`** (logout também exige sessão). O teste "nenhuma é pública" lista `src/app/api/**/route.ts` e exige 401 sem cookie em todo handler exportado, e que `GET` exista só nas 3 rotas de leitura.
- Upload de referência: `Content-Length` acima de 10,5 MB é recusado com 413 antes do `formData()`; o `file.size` (10 MB) é checado depois do parse.
- Login: freio em memória (`src/web/login-throttle.ts`: `attempt()` conta a tentativa de forma atômica ANTES de ler o corpo e checar a senha (senão requisições paralelas furam o limite); 30 tentativas em 15 min viram 429 com `Retry-After` e `nosniff`; login certo só desfaz a própria tentativa (`undo()`), nunca zera o contador; atraso de 300 ms após falha, `loginThrottle.failDelayMs = 0` nos testes). Contador global (1 réplica); um atacante pode travar o login por 15 min, aceito.
- Arquivos: `FILE_HEADERS`, `Content-Type` do registro, 416 com `Content-Range: bytes */N`, objeto ausente no storage vira 404 (`isMissingObject`), chave de storage nunca sai na resposta. Lê o objeto inteiro e fatia o Buffer (poucos MB).
- Upload: tipo vem de `File.type` (whitelist), `file.size` checado antes de ler o corpo, rótulo obrigatório.
- `params` chega como `Record<string, string>` (o `api()` resolve a Promise do Next); `noUncheckedIndexedAccess` está desligado, então `params.id` é `string`.
- `tests/web/api.test.ts` usa `readdirSync` + `import()` (não `import.meta.glob`: `vite/client` não é dependência direta).

- [ ] **Step 1: Escrever os testes de integração dos endpoints**

`tests/web/api.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PNG_BYTES } from "../helpers/images";
import { readdirSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSession, SESSION_COOKIE } from "@/auth/session";
import { loadEnv } from "@/config/env";
import { getContext, setContextForTests } from "@/web/context";
import * as login from "@/app/api/auth/login/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as projectRoute from "@/app/api/projects/[id]/route";
import * as stageRoute from "@/app/api/projects/[id]/stage/route";
import * as assetRoute from "@/app/api/assets/[assetId]/route";
import * as logout from "@/app/api/auth/logout/route";
import * as referencesRoute from "@/app/api/projects/[id]/references/route";
import { FsStorage } from "@/storage/fs";
import { loginThrottle } from "@/web/login-throttle";
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
  loginThrottle.reset();
  loginThrottle.failDelayMs = 0;
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
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=");
    expect((await bad.json()).error).toBe("Senha incorreta");

    const sessionCookie = setCookie.split(";")[0]!;
    expect((await call(projectsRoute.GET, { cookie: sessionCookie })).status).toBe(200);
  });
});

describe("auth: freio e logout", () => {
  const login_ = (password: string) => call(login.POST, { method: "POST", body: { password }, cookie: null });

  it("após 30 falhas responde 429 com Retry-After e nosniff, mesmo com a senha certa", async () => {
    for (let i = 0; i < 30; i++) expect((await login_("errada")).status).toBe(401);
    const blocked = await login_("segredo");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(blocked.headers.get("x-content-type-options")).toBe("nosniff");
    expect(blocked.headers.get("cache-control")).toBe("private, no-store");
    expect((await blocked.json()).error).toContain("Muitas tentativas");
  });

  it("40 requisições paralelas com senha errada: só 30 passam pela checagem (401), o resto leva 429", async () => {
    const res = await Promise.all(Array.from({ length: 40 }, () => login_("errada")));
    const statuses = res.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(30);
    expect(statuses.filter((s) => s === 429)).toHaveLength(10);
  });

  it("login certo não devolve orçamento novo: desfaz só a própria tentativa", async () => {
    for (let i = 0; i < 29; i++) expect((await login_("errada")).status).toBe(401);
    expect((await login_("segredo")).status).toBe(200); // conta 30, desfaz -> 29
    expect((await login_("errada")).status).toBe(401); // 30
    expect((await login_("errada")).status).toBe(429); // continua limitado: os 29 anteriores valem
  });

  it("logout (POST, autenticado) limpa o cookie", async () => {
    const res = await call(logout.POST, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await call(logout.POST, { method: "POST", cookie: null })).status).toBe(401);
  });
});

describe("rotas: nenhuma é pública", () => {
  const API_DIR = path.resolve(process.cwd(), "src/app/api");
  const modules: Record<string, () => Promise<unknown>> = {};
  for (const rel of readdirSync(API_DIR, { recursive: true, encoding: "utf8" })) {
    if (path.basename(rel) === "route.ts") modules[rel] = () => import(/* @vite-ignore */ path.join(API_DIR, rel));
  }
  const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

  it("todo handler exportado rejeita requisição sem sessão (401); só o login fica de fora", async () => {
    const paths = Object.keys(modules);
    expect(paths.length).toBeGreaterThanOrEqual(19);
    let checked = 0;
    for (const file of paths) {
      if (file.startsWith("auth/login/")) continue;
      const mod = (await modules[file]!()) as Record<string, unknown>;
      const exported = Object.keys(mod).filter((k) => METHODS.includes(k));
      expect(exported.length, file).toBeGreaterThan(0);
      const params = Object.fromEntries(
        [...file.matchAll(/\[(\w+)\]/g)].map((m) => [m[1]!, "00000000-0000-0000-0000-000000000000"]),
      );
      for (const m of exported) {
        const res = await call(mod[m] as Handler, { method: m, params, cookie: null, body: m === "GET" ? undefined : {} });
        expect(res.status, `${m} ${file}`).toBe(401);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("GET existe só nas rotas de leitura (sem efeitos colaterais)", async () => {
    const withGet: string[] = [];
    for (const file of Object.keys(modules)) {
      const mod = (await modules[file]!()) as Record<string, unknown>;
      if ("GET" in mod) withGet.push(file);
    }
    expect(withGet.sort()).toEqual(["assets/[assetId]/route.ts", "projects/[id]/route.ts", "projects/route.ts"]);
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
    expect(snap.scenesToGenerate).toBe(0);
    expect(snap.scenes).toEqual([]);
    expect(snap.hasPendingGenerations).toBe(false);
  });

  it("hasPendingGenerations vem do servidor: true com tentativa na fila, false sem", async () => {
    const p = await seedProject(testDb, { stage: "review" });
    const scene = await seedScene(testDb, p.id, 0);
    const get = async () => (await call(projectRoute.GET, { url: `/api/projects/${p.id}`, params: { id: p.id } })).json();
    expect((await get()).hasPendingGenerations).toBe(false);
    await seedAttempt(testDb, scene.id, { status: "queued" });
    expect((await get()).hasPendingGenerations).toBe(true);
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
    expect((await res.json()).error).toContain("Não é possível ir de \"Briefing\" para \"Revisão\"");
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

  it("416 traz Content-Range */tamanho e cabeçalhos de arquivo; 404 sem linha ou sem objeto", async () => {
    const { deps } = await getContext();
    const p = await seedProject(testDb);
    const asset = await seedAsset(testDb, p.id, { kind: "clip", storageKey: "x/c2.mp4" });
    await deps.storage.put("x/c2.mp4", Buffer.from("0123456789"), "video/mp4");
    const bad = await call(assetRoute.GET, { params: { assetId: asset.id }, headers: { range: "bytes=50-60" } });
    expect(bad.headers.get("content-range")).toBe("bytes */10");
    const ok = await call(assetRoute.GET, { params: { assetId: asset.id } });
    expect(ok.headers.get("cache-control")).toContain("private");
    expect(ok.headers.get("vary")).toBe("Cookie");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");

    const noRow = await call(assetRoute.GET, { params: { assetId: "00000000-0000-0000-0000-000000000000" } });
    expect(noRow.status).toBe(404);

    const ghost = await seedAsset(testDb, p.id, { kind: "clip", storageKey: "x/ausente.mp4" });
    const root = await mkdtemp(path.join(tmpdir(), "fs-"));
    setContextForTests({ env, deps: { ...deps, storage: new FsStorage(root) } });
    const miss = await call(assetRoute.GET, { params: { assetId: ghost.id } });
    expect(miss.status).toBe(404);
    const body = await miss.json();
    expect(body.error).toBe("Arquivo não encontrado");
    expect(JSON.stringify(body)).not.toContain("ausente");
  });
});

describe("upload de referência", () => {
  function upload(projectId: string, form: FormData) {
    const headers: Record<string, string> = { cookie };
    return referencesRoute.POST(new Request("http://test/", { method: "POST", headers, body: form }), {
      params: Promise.resolve({ id: projectId }),
    });
  }
  const png = () => new File([new Uint8Array(PNG_BYTES)], "a.png", { type: "image/png" });

  it("aceita imagem com rótulo; rejeita sem arquivo, sem rótulo, tipo errado e acima de 10 MB", async () => {
    const p = await seedProject(testDb);
    const f = new FormData();
    f.set("file", png());
    f.set("label", "produto");
    f.set("mimeType", "text/html"); // campo do cliente é ignorado
    const ok = await upload(p.id, f);
    expect(ok.status).toBe(200);
    expect((await ok.json()).mimeType).toBe("image/png");

    const none = new FormData();
    none.set("label", "x");
    expect((await upload(p.id, none)).status).toBe(400);

    const nolabel = new FormData();
    nolabel.set("file", png());
    nolabel.set("label", "  ");
    expect((await upload(p.id, nolabel)).status).toBe(400);

    const fake = new FormData();
    fake.set("file", new File(["só texto, 14b"], "a.png", { type: "image/png" }));
    fake.set("label", "falso");
    const fakeRes = await upload(p.id, fake);
    expect(fakeRes.status).toBe(400);
    expect((await fakeRes.json()).error).toBe("O arquivo não parece ser uma imagem PNG, JPEG ou WebP.");

    const wrong = new FormData();
    wrong.set("file", new File(["<html>"], "a.html", { type: "text/html" }));
    wrong.set("label", "y");
    expect((await upload(p.id, wrong)).status).toBe(400);

    const big = new FormData();
    big.set("file", new File([new Uint8Array(10 * 1024 * 1024 + 1)], "b.png", { type: "image/png" }));
    big.set("label", "z");
    const res = await upload(p.id, big);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("10 MB");
  });

  it("Content-Length acima de 10,5 MB é recusado (413) sem ler o corpo", async () => {
    const p = await seedProject(testDb);
    const req = new Request("http://test/", {
      method: "POST",
      headers: { cookie, "content-type": "multipart/form-data; boundary=x", "content-length": String(11 * 1024 * 1024) },
      body: "--x--",
    });
    let parsed = false;
    req.formData = async () => {
      parsed = true;
      return new FormData();
    };
    const res = await referencesRoute.POST(req, { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toContain("10 MB");
    expect(parsed).toBe(false);
  });
});
```

`tests/web/login-throttle.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createLoginThrottle } from "@/web/login-throttle";

describe("login throttle", () => {
  it("attempt conta na hora: bloqueia na tentativa seguinte ao limite e libera quando a janela expira", () => {
    let t = 1000;
    const th = createLoginThrottle({ max: 3, now: () => t });
    for (let i = 0; i < 3; i++) expect(th.attempt().blocked).toBe(false);
    const r = th.attempt();
    expect(r.blocked).toBe(true);
    if (r.blocked) expect(r.retryAfterS).toBe(900);
    t += 15 * 60 * 1000 - 1;
    expect(th.attempt().blocked).toBe(true);
    t += 1;
    expect(th.attempt().blocked).toBe(false); // janela nova, contador zerado
  });

  it("o limite padrão é 30 tentativas por janela de 15 minutos", () => {
    const th = createLoginThrottle({ now: () => 0 });
    for (let i = 0; i < 30; i++) expect(th.attempt().blocked).toBe(false);
    const r = th.attempt();
    expect(r.blocked).toBe(true);
    if (r.blocked) expect(r.retryAfterS).toBe(900);
  });

  it("undo desfaz só a tentativa corrente (não zera o contador) e nunca passa de zero", () => {
    const th = createLoginThrottle({ max: 3, now: () => 0 });
    th.attempt();
    th.attempt();
    th.attempt(); // 3 no contador
    th.undo(); // 2
    expect(th.attempt().blocked).toBe(false); // 3
    expect(th.attempt().blocked).toBe(true);
    const fresh = createLoginThrottle({ max: 1, now: () => 0 });
    fresh.undo();
    fresh.undo();
    expect(fresh.attempt().blocked).toBe(false);
    expect(fresh.attempt().blocked).toBe(true);
  });

  it("o contador recomeça do zero ao expirar a janela e undo nunca fica abaixo de zero", () => {
    let t = 0;
    const th = createLoginThrottle({ max: 2, now: () => t });
    th.attempt();
    t += 15 * 60 * 1000;
    th.attempt(); // janela nova, contador 1
    th.undo(); // 1 -> 0
    th.undo(); // continua em 0
    expect(th.attempt().blocked).toBe(false);
    expect(th.attempt().blocked).toBe(false);
    expect(th.attempt().blocked).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/web/api.test.ts`
Expected: FAIL — rotas não encontradas.

- [ ] **Step 3: Criar o freio de login, o detector de objeto ausente e os endpoints**

`src/web/login-throttle.ts`:
```ts
// Freio simples de tentativas de login, em memória (o serviço `web` roda com 1 réplica).
// Contador global (não por IP): X-Forwarded-For é forjável e o time é pequeno. Um atacante pode, no pior caso,
// travar o login por 15 min; isso é aceito em troca de impedir força bruta.
// A tentativa é contada ANTES de checar a senha (`attempt` confere e incrementa num único passo síncrono), senão
// requisições paralelas passariam todas pela checagem antes de a primeira falha ser registrada.
export type Throttle = {
  failDelayMs: number;
  attempt(): { blocked: false } | { blocked: true; retryAfterS: number };
  undo(): void;
  reset(): void;
};

export function createLoginThrottle(opts: { max?: number; windowMs?: number; now?: () => number; failDelayMs?: number } = {}): Throttle {
  const max = opts.max ?? 30;
  const windowMs = opts.windowMs ?? 15 * 60 * 1000;
  const now = opts.now ?? Date.now;
  let count = 0;
  let windowStart = 0;

  const expire = () => {
    if (count > 0 && now() - windowStart >= windowMs) count = 0;
  };

  return {
    failDelayMs: opts.failDelayMs ?? 300,
    attempt() {
      expire();
      if (count >= max) return { blocked: true, retryAfterS: Math.max(1, Math.ceil((windowStart + windowMs - now()) / 1000)) };
      if (count === 0) windowStart = now();
      count += 1;
      return { blocked: false };
    },
    // Login certo: desfaz só a tentativa dele (nunca zera o contador: não pode dar orçamento novo a um atacante).
    undo() {
      if (count > 0) count -= 1;
    },
    reset() {
      count = 0;
    },
  };
}

export const loginThrottle: Throttle = createLoginThrottle();
```

`src/web/storage-errors.ts`:
```ts
// Objeto ausente no storage: ENOENT (FsStorage) ou NoSuchKey/404 (S3). Vira 404 em vez de 500.
export function isMissingObject(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const x = e as { code?: unknown; name?: unknown; $metadata?: { httpStatusCode?: number } };
  return x.code === "ENOENT" || x.code === "NoSuchKey" || x.name === "NoSuchKey" || x.name === "NotFound" || x.$metadata?.httpStatusCode === 404;
}
```

`src/app/api/auth/login/route.ts`:
```ts
import { z } from "zod";
import { createSession, passwordMatches, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/auth/session";
import { DomainError } from "@/services/errors";
import { api, JSON_HEADERS } from "@/web/http";
import { loginThrottle } from "@/web/login-throttle";

// Única rota sem sessão. Mensagem de erro genérica: não revela nada além de "senha incorreta".
export const POST = api(
  async ({ req, env }) => {
    // Conta a tentativa antes de qualquer trabalho caro (ler o corpo, checar a senha): ver login-throttle.ts.
    const attempt = loginThrottle.attempt();
    if (attempt.blocked) {
      return Response.json(
        { error: "Muitas tentativas. Tente novamente em alguns minutos." },
        { status: 429, headers: { ...JSON_HEADERS, "Retry-After": String(attempt.retryAfterS) } },
      );
    }
    const { password } = z.object({ password: z.string().max(500) }).parse(await req.json());
    if (!(await passwordMatches(password, env.ACCESS_PASSWORD))) {
      if (loginThrottle.failDelayMs > 0) await new Promise((r) => setTimeout(r, loginThrottle.failDelayMs));
      throw new DomainError("Senha incorreta", 401);
    }
    loginThrottle.undo();
    const token = await createSession(env.SESSION_SECRET);
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return Response.json(
      { ok: true },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "set-cookie": `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_S}${secure}`,
        },
      },
    );
  },
  { auth: false },
);
```

`src/app/api/auth/logout/route.ts`:
```ts
import { SESSION_COOKIE } from "@/auth/session";
import { api } from "@/web/http";

export const POST = api(async () => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return Response.json(
    { ok: true },
    { headers: { "set-cookie": `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}` } },
  );
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

`src/app/api/projects/[id]/generate/route.ts`:
```ts
import { generateAllScenes } from "@/services/scenes";
import { api } from "@/web/http";

export const POST = api(async ({ params, deps }) => {
  await generateAllScenes(deps, params.id);
  return { ok: true };
});
```

`src/app/api/projects/[id]/references/route.ts`:
```ts
import { DomainError } from "@/services/errors";
import { addReference } from "@/services/projects";
import { api } from "@/web/http";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Arquivo de 10 MB mais a sobrecarga do multipart (limite do Content-Length, que pode ser maior que o arquivo).
const MAX_BODY_BYTES = 10.5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export const POST = api(async ({ req, params, deps }) => {
  // Recusa cedo pelo Content-Length declarado, antes de o formData() ler o corpo para a memória.
  // (Cabeçalho ausente ou mentiroso não é barrado aqui; o `file.size` abaixo é a checagem após o parse.)
  const declared = Number(req.headers.get("content-length"));
  if (req.headers.has("content-length") && declared > MAX_BODY_BYTES) throw new DomainError("Imagem maior que 10 MB", 413);
  const form = await req.formData().catch(() => {
    throw new DomainError("Envie o formulário com uma imagem");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new DomainError("Envie um arquivo de imagem");
  // O tipo vem do próprio File (nunca de um campo do formulário); o serviço também valida e confere a assinatura do arquivo (magic bytes).
  if (!IMAGE_TYPES.has(file.type)) throw new DomainError("Formato de imagem não suportado (use PNG, JPEG ou WebP)");
  if (file.size === 0) throw new DomainError("O arquivo está vazio");
  if (file.size > MAX_IMAGE_BYTES) throw new DomainError("Imagem maior que 10 MB"); // depois do parse: o arquivo já está em memória; o limite é por tamanho real, não pelo cabeçalho
  const label = String(form.get("label") ?? "").trim();
  if (!label || label.length > 100) throw new DomainError("Dê um rótulo à imagem (ex.: produto, pessoa), com até 100 caracteres");
  return addReference(deps, {
    projectId: params.id,
    label,
    bytes: Buffer.from(await file.arrayBuffer()),
    mimeType: file.type,
  });
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

`src/app/api/projects/[id]/route.ts`:
```ts
import { z } from "zod";
import { getSnapshot, updateBriefing } from "@/services/projects";
import { generationPlan, sceneIdsWithPendingAttempt } from "@/services/scenes";
import { api } from "@/web/http";

export const GET = api(async ({ params, deps }) => {
  const snap = await getSnapshot(deps.db, params.id);
  const pending = sceneIdsWithPendingAttempt(snap.scenes);
  return { ...snap, ...generationPlan(snap.scenes, pending), hasPendingGenerations: pending.size > 0 };
});

export const PATCH = api(async ({ req, params, deps }) => {
  const body = z.object({ name: z.string().max(200).optional(), copy: z.string().max(20000).optional() }).parse(await req.json());
  return updateBriefing(deps.db, params.id, body);
});
```

`src/app/api/projects/[id]/script/plan/route.ts`:
```ts
import { z } from "zod";
import { planProjectScript } from "@/services/scenes";
import { api } from "@/web/http";

export const POST = api(async ({ req, params, deps }) => {
  const body = z.object({ feedback: z.string().max(5000).optional() }).parse(await req.json().catch(() => ({})));
  await planProjectScript(deps, params.id, body.feedback);
  return { ok: true };
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

`src/app/api/projects/route.ts`:
```ts
import { z } from "zod";
import { MODES } from "@/domain/stages";
import { createProject, listProjects } from "@/services/projects";
import { api } from "@/web/http";

export const GET = api(async ({ deps }) => ({ projects: await listProjects(deps.db) }));

export const POST = api(async ({ req, deps }) => {
  const body = z.object({ name: z.string().max(200), mode: z.enum(MODES) }).parse(await req.json());
  return createProject(deps.db, body);
});
```

`src/app/api/assets/[assetId]/route.ts`:
```ts
import { DomainError } from "@/services/errors";
import { getAsset, removeReference } from "@/services/projects";
import { FILE_HEADERS, api } from "@/web/http";
import { parseRange } from "@/web/range";
import { isMissingObject } from "@/web/storage-errors";

const EXT: Record<string, string> = { "video/mp4": "mp4", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

// Lê o objeto inteiro e fatia o Buffer (o Storage não tem leitura parcial). Os arquivos têm poucos MB;
// se isso crescer, trocar por leitura em stream com range.
export const GET = api(async ({ req, params, deps }) => {
  const asset = await getAsset(deps.db, params.assetId);
  let bytes: Buffer;
  try {
    bytes = await deps.storage.get(asset.storageKey);
  } catch (e) {
    if (isMissingObject(e)) throw new DomainError("Arquivo não encontrado", 404);
    throw e;
  }
  const headers = new Headers({
    ...FILE_HEADERS,
    "Content-Type": asset.mimeType,
    "Accept-Ranges": "bytes",
  });
  if (new URL(req.url).searchParams.get("download")) {
    headers.set("Content-Disposition", `attachment; filename="criativo-${asset.id.slice(0, 8)}.${EXT[asset.mimeType] ?? "bin"}"`);
  }

  const range = parseRange(req.headers.get("range"), bytes.length);
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${bytes.length}`);
    return new Response(null, { status: 416, headers });
  }
  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${bytes.length}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    return new Response(new Uint8Array(bytes.subarray(range.start, range.end + 1)), { status: 206, headers });
  }
  headers.set("Content-Length", String(bytes.length));
  return new Response(new Uint8Array(bytes), { headers });
});

// Só apaga imagens de referência (o serviço recusa os outros tipos).
export const DELETE = api(async ({ params, deps }) => {
  await removeReference(deps.db, params.assetId);
  return { ok: true };
});
```

`src/app/api/characters/[id]/approve/route.ts`:
```ts
import { approveCharacter } from "@/services/characters";
import { api } from "@/web/http";

export const POST = api(async ({ params, deps }) => approveCharacter(deps.db, params.id));
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

`src/app/api/characters/[id]/route.ts`:
```ts
import { z } from "zod";
import { removeCharacter, updateCharacter } from "@/services/characters";
import { api } from "@/web/http";

export const PATCH = api(async ({ req, params, deps }) => {
  const body = z
    .object({ name: z.string().max(200).optional(), description: z.string().max(5000).optional() })
    .parse(await req.json());
  return updateCharacter(deps, params.id, body);
});

export const DELETE = api(async ({ params, deps }) => {
  await removeCharacter(deps.db, params.id);
  return { ok: true };
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

`src/app/api/projects/[id]/characters/route.ts`:
```ts
import { z } from "zod";
import { addCharacter } from "@/services/characters";
import { api } from "@/web/http";

export const POST = api(async ({ req, params, deps }) => {
  const body = z.object({ name: z.string().max(200), description: z.string().max(5000) }).parse(await req.json());
  return addCharacter(deps, params.id, body);
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

`src/app/api/scenes/[id]/regenerate/route.ts`:
```ts
import { z } from "zod";
import { regenerateScene } from "@/services/scenes";
import { api } from "@/web/http";

export const POST = api(async ({ req, params, deps }) => {
  const body = z.object({ prompt: z.string().max(5000).optional() }).parse(await req.json().catch(() => ({})));
  return regenerateScene(deps, params.id, body.prompt);
});
```

`src/app/api/scenes/[id]/route.ts`:
```ts
import { z } from "zod";
import { updateScene } from "@/services/scenes";
import { api } from "@/web/http";

export const PATCH = api(async ({ req, params, deps }) => {
  const body = z
    .object({
      dialogue: z.string().max(5000).optional(),
      visualPrompt: z.string().max(5000).optional(),
      targetSeconds: z.number().int().optional(),
    })
    .parse(await req.json());
  return updateScene(deps.db, params.id, body, deps.config.sceneMaxSeconds);
});
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run tests/web && pnpm typecheck`
Expected: todos PASS; typecheck limpo. Se o typecheck reclamar de `Buffer`/`BodyInit`, manter os `new Uint8Array(...)` das respostas (já aplicados).

- [ ] **Step 5: Commit**

```bash
git add src/app/api src/web tests/web docs
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

// agentRules desligado: o `next dev` não cria/atualiza AGENTS.md no repositório.
const config: NextConfig = {
  agentRules: false,
  // Cabeçalhos de segurança em todas as rotas. Só frame-ancestors na CSP, de propósito (uma CSP completa pode quebrar o Next/React).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};
export default config;
```

`src/app/layout.tsx`:
```tsx
import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";
import "./globals.css";

// Baixada no build e servida pelo próprio app (next/font): nenhuma requisição a terceiros em tempo de execução.
// Eixo de largura: títulos condensados, corpo em largura normal (docs/design/direction.md).
const archivo = Archivo({ subsets: ["latin", "latin-ext"], axes: ["wdth"], display: "swap", variable: "--font-archivo" });

export const metadata: Metadata = {
  title: "Gerador de Criativos",
  description: "Ferramenta interna do time para criar vídeos verticais de anúncio (UGC e novelinha) para o TikTok.",
};

export const viewport: Viewport = {
  themeColor: "#1c1d20",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={archivo.variable}>
      <body>
        <a className="skip-link" href="#conteudo">
          Pular para o conteúdo
        </a>
        <AppHeader />
        <main id="conteudo" tabIndex={-1}>
          {children}
        </main>
      </body>
    </html>
  );
}
```

`src/app/globals.css`: o CSS completo (tokens do tema "escuro de estúdio", base, tipografia, botões, campos, selos, shell, login, lista e compatibilidade das telas do fluxo) está no próprio arquivo do repositório; a direção visual e os contrastes estão em `docs/design/direction.md`. A fonte (Archivo, eixo de largura) vem do `next/font/google` no `layout.tsx`: baixada no build e servida pelo app.

`src/lib/types.ts`:
```ts
import type { Snapshot } from "@/services/projects";

// Resposta de GET /api/projects/:id. As datas chegam como string (JSON), mas a UI não as usa.
export type ProjectView = Snapshot & {
  estimatedSeconds: number; // segundos que a próxima geração vai custar (só cenas sem aprovação)
  scenesToGenerate: number;
  hasPendingGenerations: boolean; // alguma cena com tentativa na fila ou gerando (regra do servidor)
};
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
// URLs sempre relativas (mesma origem): a API recusa requisições de outra origem e usa o cookie de sessão.
export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const hasBody = init.body !== undefined || init.form !== undefined;
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (hasBody ? "POST" : "GET"),
      headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    });
  } catch {
    throw new Error("Sem conexão com o servidor. Verifique a internet e tente de novo.");
  }
  const data = await res.json().catch(() => ({}));
  // Sessão expirada: volta ao login (exceto na própria tela de login, onde 401 = senha incorreta).
  if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Erro ${res.status}`);
  return data as T;
}
```

`src/lib/useProject.ts`:
```ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { ProjectView } from "./types";

const POLL_MS = 3000;

function isBusy(s: ProjectView): boolean {
  return (
    s.project.stage === "generating" ||
    s.project.stage === "assembling" ||
    s.characters.some((c) => c.imageStatus === "pending") ||
    s.hasPendingGenerations
  );
}

export function useProject(id: string) {
  const [snap, setSnap] = useState<ProjectView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const next = await api<ProjectView>(`/api/projects/${id}`);
      if (!alive.current) return;
      setSnap(next);
      setLoadError(null);
    } catch (e) {
      if (alive.current) setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  // Consulta periódica só enquanto há trabalho em andamento. Um timer por vez: a próxima consulta
  // só é agendada depois que a anterior termina (sem acúmulo de requisições se o servidor demorar).
  const busy = snap ? isBusy(snap) : false;
  useEffect(() => {
    if (!busy) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      await reload();
      if (!stopped) timer = setTimeout(() => void tick(), POLL_MS);
    };
    timer = setTimeout(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [busy, reload]);

  return { snap, loadError, reload };
}
```

- [ ] **Step 2: Páginas de login e lista**

`src/app/login/page.tsx`:
```tsx
"use client";
import { useState } from "react";
import { AlertIcon } from "@/components/icons";
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
    <div className="page page-narrow login">
      <form className="panel framed login-form stack stack-lg" onSubmit={submit} noValidate>
        <div className="stack stack-sm">
          <h1>Entrar</h1>
          <p className="hint">Ferramenta interna do time de criativos.</p>
        </div>
        <div className="field">
          <label htmlFor="senha">Senha do time</label>
          <input
            id="senha"
            aria-label="Senha do time"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "senha-erro senha-ajuda" : "senha-ajuda"}
            autoFocus
          />
          {error && (
            <p id="senha-erro" className="field-error" role="alert">
              <AlertIcon />
              {error}
            </p>
          )}
          <p id="senha-ajuda" className="hint">
            A senha é a mesma para todo o time. Se você não tem a senha, peça a quem administra a ferramenta.
          </p>
        </div>
        <button className="button-block" disabled={loading || !password}>
          {loading ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
```

`src/components/NewProjectForm.tsx`:
```tsx
"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { AlertIcon } from "./icons";

const MODES = [
  {
    value: "ugc",
    title: "UGC",
    text: "Uma pessoa fala para a câmera sobre o produto. Você envia as fotos de referência (produto, pessoa).",
  },
  {
    value: "novelinha",
    title: "Novelinha",
    text: "Uma história curta com personagens. A ferramenta sugere os personagens e você aprova cada um.",
  },
] as const;

// O título do formulário fica na página (muda entre a lista vazia e a lista com projetos): `labelledBy` aponta para ele.
export function NewProjectForm({ labelledBy }: { labelledBy: string }) {
  const router = useRouter();
  const uid = useId();
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
    <form className="stack stack-lg" onSubmit={submit} aria-labelledby={labelledBy}>
      <div className="field">
        <label htmlFor={`${uid}-nome`}>Nome do projeto</label>
        <input
          id={`${uid}-nome`}
          aria-label="Nome do projeto"
          placeholder="Ex.: Lançamento sérum vitamina C"
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <fieldset>
        <legend>Tipo de criativo</legend>
        <div className="choice-group">
          {MODES.map((m) => (
            <label key={m.value} className="choice">
              <input
                type="radio"
                name={`${uid}-modo`}
                value={m.value}
                checked={mode === m.value}
                onChange={() => setMode(m.value)}
                aria-describedby={`${uid}-${m.value}`}
              />
              <span className="choice-title">{m.title}</span>
              <span id={`${uid}-${m.value}`} className="choice-text">
                {m.text}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <p className="field-error" role="alert">
          <AlertIcon />
          {error}
        </p>
      )}
      <button className="button-block" disabled={loading || !name.trim()}>
        {loading ? "Criando…" : "Criar e abrir o briefing"}
      </button>
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
import { stagesFor, type Stage } from "@/domain/stages";
import { STAGE_LABELS } from "@/lib/labels";
import { listProjects } from "@/services/projects";
import { getContext } from "@/web/context";
import { isAuthedCookie } from "@/web/http";

export const dynamic = "force-dynamic";

// Duas temperaturas (docs/design/direction.md): tungstênio = etapa em que a pessoa trabalha; luz do dia = a máquina está trabalhando.
const MACHINE_STAGES: Stage[] = ["generating", "assembling"];

const updatedFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function stageTone(stage: Stage): "done" | "work" | "you" {
  if (stage === "done") return "done";
  return MACHINE_STAGES.includes(stage) ? "work" : "you";
}

// Medidor 9:16: uma faixa por etapa, de baixo para cima. Decorativo; a etapa está escrita ao lado.
function StageMeter({ stages, current, tone }: { stages: Stage[]; current: number; tone: "done" | "work" | "you" }) {
  return (
    <span className={`meter meter-${tone}`} aria-hidden="true">
      {stages.map((s, i) => (
        <span key={s} className={i < current ? "is-past" : i === current ? "is-current" : undefined} />
      ))}
    </span>
  );
}

export default async function HomePage() {
  if (!(await isAuthedCookie((await headers()).get("cookie")))) redirect("/login");
  const { deps } = await getContext();
  const list = await listProjects(deps.db);

  if (list.length === 0) {
    return (
      <div className="page page-narrow">
        <div className="page-head">
          <h1>Projetos</h1>
        </div>
        <section className="panel framed stack stack-lg" aria-labelledby="novo-criativo-titulo">
          <div className="stack stack-sm">
            <h2 id="novo-criativo-titulo">Nenhum criativo ainda</h2>
            <p className="hint">
              Dê um nome, escolha o formato e siga as etapas: briefing, roteiro, geração das cenas, revisão e o MP4 final.
            </p>
          </div>
          <NewProjectForm labelledBy="novo-criativo-titulo" />
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Projetos</h1>
        <p>
          {list.length === 1 ? "1 criativo" : `${list.length} criativos`}, do mais recente ao mais antigo.
        </p>
        <div>
          <a className="button secondary jump-to-new" href="#novo-criativo">
            Novo criativo
          </a>
        </div>
      </div>

      <div className="projects-layout">
        <section aria-labelledby="lista-titulo">
          <h2 id="lista-titulo" className="sr-only">
            Lista de projetos
          </h2>
          <div className="panel project-list-panel">
            <ul className="project-list">
              {list.map((p) => {
                const stages = stagesFor(p.mode);
                const index = stages.indexOf(p.stage);
                const tone = stageTone(p.stage);
                return (
                  <li key={p.id}>
                    <Link className="project-row" href={`/projects/${p.id}`}>
                      <StageMeter stages={stages} current={index} tone={tone} />
                      <span className="project-text">
                        <span className="project-name">{p.name}</span>
                        <span className="project-meta">
                          <span>{p.mode === "ugc" ? "UGC" : "Novelinha"}</span>
                          <span className="tabular">
                            Etapa {index + 1} de {stages.length}
                          </span>
                          <span>
                            Atualizado{" "}
                            <time dateTime={p.updatedAt.toISOString()}>{updatedFormat.format(p.updatedAt)}</time>
                          </span>
                        </span>
                      </span>
                      <span className={`badge badge-${tone}`}>{STAGE_LABELS[p.stage]}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <aside className="panel projects-aside stack stack-lg" id="novo-criativo" aria-labelledby="novo-criativo-titulo">
          <h2 id="novo-criativo-titulo">Novo criativo</h2>
          <NewProjectForm labelledBy="novo-criativo-titulo" />
        </aside>
      </div>
    </div>
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

// O <main> e o botão "Sair" vêm do layout raiz (AppHeader).
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthedCookie((await headers()).get("cookie")))) redirect("/login");
  const { id } = await params;
  return (
    <div className="page">
      <ProjectView id={id} />
    </div>
  );
}
```

- [ ] **Step 3: `ProjectView` e barra de etapas**

`src/components/ProjectView.tsx`: o código completo está no próprio arquivo do repositório (redesenho da Fase B1; direção em `docs/design/direction.md`, seções 5, 6 e 10). Resumo: `ConfirmProvider` acima de tudo; `run()` com lock de ação única (o erro vai para um `.alert` com `role="alert"`); trilha `<nav aria-label="Trilha">` "Projetos / nome" e selo do modo ao lado do `h1`; linha do tempo `StageTimeline` alimentada por `buildStepper()`; título da etapa (`h2`, `tabIndex={-1}`) recebe o foco quando a etapa muda (sem salto de rolagem; com movimento reduzido, rolagem instantânea); região `aria-live="polite"` com `progressMessage()`. As chamadas à API e as transições não mudaram.

Arquivos novos da Fase B1 (código completo no repositório):

- `src/lib/stepper.ts`: modelo puro da linha do tempo (`buildStepper`, `backLockReason`). Mesma regra de antes: voltar só para etapas editáveis e nunca durante `generating`/`assembling` nem na revisão com `hasPendingGenerations`; avançar só pelas ações de cada painel. Testes em `tests/lib/stepper.test.ts` (inclui "toda etapa disponível é uma transição que `canTransition` aceita").
- `src/lib/flow.ts`: funções puras das telas (`isDirty`, `formatCharCount`, `characterActions`, `progressMessage`, `guardedDestination`). Testes em `tests/lib/flow.test.ts`.
- `src/lib/useUnsavedGuard.ts`: aviso de alterações não salvas no briefing (`beforeunload` + interceptação de links internos com o diálogo de confirmação); os ouvintes só existem enquanto há edição pendente. Sem salvamento automático e sem chamadas novas à API.
- `src/components/StageTimeline.tsx`: a régua de etapas (`<nav aria-label="Etapas do projeto">` com `<ol>`), estados atual/concluída/disponível/travada/futura e os motivos escritos abaixo da régua.
- `src/components/UnsavedBadge.tsx`: "Alterações não salvas" (região `role="status"` sempre presente).


- [ ] **Step 4: Painel de briefing**

`src/components/BriefingPanel.tsx`: código completo no repositório. Copy e referências lado a lado a partir de 960 px (empilhado abaixo); contador de caracteres; miniaturas e prévia local (URL `blob:`) em quadros 9:16 sobre o palco; erros de arquivo/rótulo junto do campo (`role="alert"`, `aria-invalid`, `aria-describedby`); "Continuar…" com o motivo quando desabilitado; "Alterações não salvas" + `useUnsavedGuard` (o nome e a copy continuam sendo salvos só em "Continuar…", como antes).


- [ ] **Step 5: Painel de personagens**

`src/components/CharactersPanel.tsx`: código completo no repositório. Cartões com a imagem 9:16 no palco e os estados "Gerando imagem…" (barra em Luz do dia) e "Falhou: …"; selo só da aprovação. Correções: a `key` do `CharacterCard` é só o `id` (antes incluía `assetId` e remontava o cartão, perdendo texto não salvo, quando uma imagem terminava) e o formulário volta aos valores do servidor só quando o nome/aparência salvos mudam; "Aprovar" e "Regerar imagem" ficam desabilitados enquanto há edição não salva, com o motivo (`characterActions`); confirmação antes de "Regerar imagem", "Adicionar personagem" e do primeiro "Sugerir personagens" (textos em `src/lib/confirmTexts.ts`).


- [ ] **Step 6: Painel de roteiro**

`src/components/ScriptPanel.tsx`: código completo no repositório. Coluna "Pedir ajustes ao roteiro" (fixa ao rolar no desktop) com a confirmação de descarte; cenas com rótulos visíveis (fala, descrição visual, duração), `notice` como aviso e "Alterações não salvas" junto de "Salvar cena". A `key` de remontagem do `SceneEditor` (`id:fala:prompt:segundos`) não mudou. Barra de ação com os números da API (`scenesToGenerate` de N cenas, `estimatedSeconds`) e o botão por caso: "Ir para a revisão" sem custo, senão "Gerar N cenas (X s)" com confirmação.


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
  const [prompt, setPrompt] = useState(latest?.prompt ?? scene.visualPrompt);

  const shown = attempts.find((a) => a.id === (selectedId ?? scene.approvedAttemptId)) ?? latestDone;
  const pending = latest?.status === "queued" || latest?.status === "generating";
  const approved = shown && shown.id === scene.approvedAttemptId;
  const status = latest ? STATUS[latest.status] : undefined;
  const failed = latest?.status === "failed" || latest?.status === "blocked";

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
        {scene.notice && <div className="notice">{scene.notice}</div>}
        {latest?.error && <div className="error">{latest.error}</div>}
        {failed && reviewing && <div className="muted">Use “Regerar” para tentar de novo.</div>}

        {attempts.length > 1 && (
          <div className="row">
            <span className="muted">Versões:</span>
            {attempts.map((a, i) => (
              <button
                key={a.id}
                className={shown?.id === a.id ? "" : "secondary"}
                style={{ padding: "2px 10px" }}
                disabled={a.status !== "done"}
                aria-label={`Ver versão ${i + 1}`}
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
              <button
                className="secondary"
                disabled={working || pending}
                onClick={() => {
                  if (!editing) setPrompt(latest?.prompt ?? scene.visualPrompt);
                  setEditing((v) => !v);
                }}
              >
                Ajustar prompt
              </button>
              <button
                className="secondary"
                disabled={working || pending}
                onClick={() => {
                  if (!confirm("Gerar esta cena de novo? Isso consome crédito do provedor.")) return;
                  void run(async () => {
                    await api(`/api/scenes/${scene.id}/regenerate`, { body: editing ? { prompt } : {} });
                    setSelectedId(null);
                    setEditing(false);
                  });
                }}
              >
                Regerar{editing ? " com este prompt" : ""}
              </button>
            </div>
            {editing && (
              <textarea aria-label="Prompt da cena" style={{ minHeight: 140 }} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            )}
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
  // Conta a tentativa ATUAL (a mais recente) de cada cena; versões antigas prontas não contam.
  const doneCount = scenes.filter((s) => s.attempts[s.attempts.length - 1]?.status === "done").length;

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
      {reviewing && snap.assembleError && <div className="error" role="alert">A montagem falhou: {snap.assembleError}</div>}
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
          <div className="done-clip">
            <video className="clip" src={`/api/assets/${finalAsset.id}`} controls playsInline />
          </div>
          <div className="muted">
            {finalAsset.durationSeconds ? `${finalAsset.durationSeconds.toFixed(1)} s · ` : ""}720×1280 · MP4
          </div>
          <div className="row">
            <a className="button" href={`/api/assets/${finalAsset.id}?download=1`} download>
              Baixar MP4
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
> **Divergências do código original (Task 4 executada):** (1) `api()` não redireciona para `/login` quando já está em `/login` (401 ali = senha incorreta, e o redirect apagava a mensagem) e traduz falha de rede; (2) `useProject` consulta só enquanto há trabalho em andamento (geração/montagem/personagem pendente), com um timer encadeado (a próxima consulta só é agendada quando a anterior termina) e descarta respostas após desmontar; (3) `run()` recarrega o estado também após erro; (4) `ScenesPanel` mostra o `notice` por cena, pede confirmação antes de regerar uma cena (custa crédito), sincroniza o prompt editável com a última tentativa e volta à versão mais recente após regerar; (5) `DonePanel` usa `<a class="button">` em vez de `<button>` dentro de `<a>`; (6) rótulos `aria-label` e `role="alert"` nos erros; (7) `pnpm build` reescreve o `tsconfig.json` (`jsx: react-jsx`, `allowJs`, `.next/dev/types` no `include`): o arquivo com essas mudanças é commitado (Plano 1, Task 1 atualizado). TypeScript 7 funcionou com o Next 16.4 sem fixar versão.

Expected: typecheck limpo; `next build` termina com a lista de rotas, incluindo `/`, `/login`, `/projects/[id]` e as rotas `/api/**` (todas dinâmicas `ƒ`). Se o build tentar conectar ao banco ou exigir variáveis de ambiente, é sinal de que algo chama `getContext()` no topo de um módulo: mover a chamada para dentro do handler.

> **Fase B1 do redesenho (stepper, briefing, personagens e roteiro):** os componentes desses passos foram redesenhados sem mudar chamadas à API, transições, polling nem o lock de `run()`; o plano aponta para os arquivos do repositório. O `ScenesPanel` e o `DonePanel` ficam para a Fase B2 (só a troca de `confirm()` pelo diálogo, feita antes).

- [ ] **Step 10: Rodar a suíte completa**

Run: `pnpm test`
Expected: tudo PASS.

Páginas auxiliares e botão de sair (rótulos acessíveis em todos os campos; `confirm` ao remover personagem; contador de progresso conta a tentativa atual de cada cena):

`src/components/LogoutButton.tsx` (botão "Sair" no cabeçalho das páginas autenticadas; usado por `AppHeader`):
```tsx
"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { AlertIcon } from "./icons";

// Fica no cabeçalho das páginas autenticadas (AppHeader): apaga o cookie de sessão e volta ao login.
export function LogoutButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    setLoading(true);
    setError(null);
    try {
      await api("/api/auth/logout", { method: "POST", body: {} });
      window.location.href = "/login";
    } catch {
      setError("Não foi possível sair. Tente de novo.");
      setLoading(false);
    }
  }

  return (
    <>
      {error && (
        <span className="field-error" role="alert">
          <AlertIcon />
          {error}
        </span>
      )}
      <button className="ghost" disabled={loading} onClick={() => void logout()}>
        {loading ? "Saindo…" : "Sair"}
      </button>
    </>
  );
}
```

`src/components/AppHeader.tsx` (cabeçalho do layout: marca, navegação e "Sair"; no `/login` só a marca):
```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "./icons";
import { LogoutButton } from "./LogoutButton";

// Cabeçalho de todas as páginas. No /login só a marca; nas demais (todas exigem sessão, ver src/proxy.ts),
// a navegação e o botão "Sair".
export function AppHeader() {
  const pathname = usePathname();
  const isLogin = pathname === "/login";

  return (
    <header className="app-header">
      <div className="app-header-inner">
        {isLogin ? (
          <span className="brand">
            <BrandMark />
            <span>Gerador de Criativos</span>
          </span>
        ) : (
          <>
            <Link className="brand" href="/" aria-label="Gerador de Criativos: início">
              <BrandMark />
              <span className="brand-name">Gerador de Criativos</span>
            </Link>
            <nav className="app-nav" aria-label="Principal">
              <ul>
                <li>
                  <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>
                    Projetos
                  </Link>
                </li>
              </ul>
            </nav>
            <div className="app-header-actions">
              <LogoutButton />
            </div>
          </>
        )}
      </div>
    </header>
  );
}
```

`src/components/icons.tsx` (ícones SVG inline e a marca):
```tsx
// Ícones inline (SVG, traço de 2 px, 24×24). Decorativos: sempre ao lado de texto visível, por isso aria-hidden.
type IconProps = { className?: string };

export function AlertIcon({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </svg>
  );
}

export function CheckIcon({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function LockIcon({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
    </svg>
  );
}

export function PlusIcon({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

// Marca: quadro 9:16 com cantos de visor e o cabeçote (barra de tungstênio) no centro.
export function BrandMark({ className = "brand-mark" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 36" fill="none" aria-hidden="true" focusable="false">
      <path d="M1 7V1h6M13 1h6v6M19 29v6h-6M7 35H1v-6" stroke="currentColor" strokeWidth="2" />
      <rect x="8.5" y="8" width="3" height="20" rx="1" fill="var(--color-accent)" />
    </svg>
  );
}
```

`src/app/loading.tsx` (carregamento enquanto a página é montada no servidor):
```tsx
// Enquanto a página é montada no servidor (lista de projetos, abertura de um projeto).
export default function Loading() {
  return (
    <div className="page" role="status">
      <p className="hint">Carregando…</p>
      <div className="progress-bar loading-bar" aria-hidden="true" />
    </div>
  );
}
```

`src/app/not-found.tsx` (404 em pt-BR):
```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page page-narrow stack stack-lg">
      <div className="page-head">
        <h1>Página não encontrada</h1>
        <p>O endereço que você abriu não existe ou foi removido.</p>
      </div>
      <div>
        <Link className="button" href="/">
          Ir para os projetos
        </Link>
      </div>
    </div>
  );
}
```

`src/app/error.tsx` (erro genérico em pt-BR):
```tsx
"use client";
import { AlertIcon } from "@/components/icons";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="page page-narrow stack stack-lg">
      <h1>Algo deu errado</h1>
      <p className="alert" role="alert">
        <AlertIcon />
        <span>Não foi possível carregar esta página. Tente de novo; se o problema continuar, avise o time.</span>
      </p>
      <div>
        <button onClick={() => reset()}>Tentar de novo</button>
      </div>
    </div>
  );
}
```

`src/app/global-error.tsx` (erro no layout raiz; traz o próprio `<html>`/`<body>` e não mostra `error.message` nem digest):
```tsx
"use client";

// Último recurso: o erro aconteceu no layout raiz, então esta página traz o próprio <html> e <body>.
// Não mostra error.message nem digest (podem vazar detalhes do servidor).
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 480 }}>
        <main>
          <h1>Algo deu errado</h1>
          <p role="alert">Não foi possível carregar a aplicação. Tente de novo; se o problema continuar, avise o time.</p>
          <button onClick={() => reset()}>Tentar de novo</button>
        </main>
      </body>
    </html>
  );
}
```

- [ ] **Step 11: Commit**

```bash
git add src/app src/components src/lib next.config.ts
git commit -m "feat(ui): pages and stage panels for the full creative flow"
```

---

### Task 5: Imagens de deploy e README

**Files:**
- Modify: `package.json` (campos `packageManager` e `engines`)
- Create: `Dockerfile.web`, `Dockerfile.worker`, `.dockerignore`, `README.md`

- [ ] **Step 1: Criar `.dockerignore`**

Conteúdo: o arquivo `.dockerignore` do repositório (exclui `.git`, `.claude`, `.superpowers`, `node_modules`, `.next`, `.env*` exceto `.env.example`, `storage-data`, `spike-out`, `docs`, `tests`, `*.tsbuildinfo`, `next-env.d.ts`, `Dockerfile.*`, `docker-compose.yml`). Não excluir `drizzle/`, `src/`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.ts`.

- [ ] **Step 2: Fixar versões e criar `Dockerfile.web`**

Em `package.json`: `"packageManager": "pnpm@10.33.2"` (o corepack usa esta versão na imagem) e `"engines": {"node": ">=22"}`. Imagem base `node:24-bookworm-slim` (mesmo Node do desenvolvimento). Instala todas as dependências (`--prod=false`) porque o build do Next e o `pnpm db:migrate` (tsx) precisam das devDependencies; roda como usuário `node`; `CMD ["node_modules/.bin/next", "start"]` (binário direto para o SIGTERM chegar ao processo). Ver `Dockerfile.web`. O pnpm 10 não bloqueou nenhum build script necessário (`onlyBuiltDependencies` não foi preciso). O web não precisa de ffmpeg.

- [ ] **Step 3: Criar `Dockerfile.worker`**

Igual ao web, mais `apt-get install -y --no-install-recommends ffmpeg` (inclui `ffprobe`), `STOPSIGNAL SIGTERM` e `CMD ["node_modules/.bin/tsx", "src/worker/main.ts"]`, sem build do Next. Ver `Dockerfile.worker`.

- [ ] **Step 4: Validar as imagens localmente**

Run:
```bash
docker build -f Dockerfile.web -t gerador-web:test . && docker build -f Dockerfile.worker -t gerador-worker:test .
docker run --rm --entrypoint ffmpeg gerador-worker:test -version | head -1
```
Expected: os dois builds terminam sem erro; a última linha imprime `ffmpeg version …`. Opcional: subir o web com `-p 3057:3000` e as variáveis mínimas e conferir `GET /login` = 200; subir o worker e `docker stop` deve imprimir "SIGTERM recebido" e sair com código 0. (Em Docker Desktop, `--network host` não expõe a porta; use `-p 3057:3000` e `host.docker.internal` para o banco. `pnpm db:migrate` também roda dentro da imagem do web.)

- [ ] **Step 5: Criar `README.md`**

Conteúdo: o `README.md` do repositório (visão geral, nota sobre voltar ao roteiro só gerar cenas sem aprovação, execução local com providers falsos, testes, tabela de variáveis de ambiente conferida com `src/config/env.ts`, estado do provider Gemini, deploy no Railway com checklist, notas de segurança e operação; inclui as notas sobre arquivos órfãos no bucket, cookie `Secure` fora de `pnpm dev` e o texto de teste do modo fake).

- [ ] **Step 6: Commit**

```bash
git add Dockerfile.web Dockerfile.worker .dockerignore README.md package.json
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
- Estimativa antes de gerar: `estimatedSeconds`/`scenesToGenerate` (só cenas sem aprovação) na API + confirmação no `ScriptPanel` (T3, T4).
- Consistência de nomes: `api()` (wrapper no servidor) vs `api()` (cliente em `src/lib/api.ts`) vivem em módulos diferentes (`@/web/http` e `@/lib/api`) e nunca são importados juntos.
