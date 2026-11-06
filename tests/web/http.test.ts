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
