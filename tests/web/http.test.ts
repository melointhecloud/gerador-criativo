import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createSession, SESSION_COOKIE } from "@/auth/session";
import type { WebContext } from "@/web/context";
import { setContextForTests } from "@/web/context";
import { api } from "@/web/http";
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
});
