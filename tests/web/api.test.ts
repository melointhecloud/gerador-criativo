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
import { seedAsset, seedAttempt, seedProject, seedScene } from "../helpers/seed";

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
