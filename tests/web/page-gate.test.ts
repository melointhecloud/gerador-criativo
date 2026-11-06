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
