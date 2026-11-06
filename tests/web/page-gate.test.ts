import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { createSession, SESSION_COOKIE } from "@/auth/session";
import { config } from "@/proxy";
import { decideGate, isGatedPath } from "@/web/page-gate";

const SECRET = "s".repeat(40);
const EXCLUDED = ["/login", "/login/", "/api/projects", "/api", "/_next/static/x.js", "/_next/image", "/favicon.ico", "/logo.png"];
const GATED = ["/", "/projects/x", "/some/new/page", "/loginx", "/apixyz"];

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
    const re = new RegExp(`^${config.matcher[0]}$`);
    for (const p of [...GATED, ...EXCLUDED]) expect(re.test(p), p).toBe(isGatedPath(p));
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
