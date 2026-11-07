import { describe, expect, it } from "vitest";
import {
  buildRequest,
  CHAR1_NAME,
  CHAR2_NAME,
  describeError,
  describeRequest,
  fileNameFromUri,
  formatResultsTable,
  interactionFailure,
  isVertical916,
  parseConfig,
  parseProbe,
  preflightSummary,
  redact,
  runSpike,
  type InteractionLike,
  type SpikeDeps,
  type VideoRequest,
} from "../../scripts/spike-video/lib";

const sizes: Record<string, number> = { "/r/rafael.png": 1000, "/r/marina.jpg": 2000 };
const stat = (p: string) => {
  if (!(p in sizes)) throw new Error("ENOENT");
  return sizes[p];
};
const FAKE_KEY = "chave-falsa-de-teste-1234";
const both = { REF_CHAR1: "/r/rafael.png", REF_CHAR2: "/r/marina.jpg" };

function cfgOf(env: Record<string, string | undefined>, argv: string[] = []) {
  const r = parseConfig(env, argv, stat);
  if (!r.ok) throw new Error(r.error);
  return r.config;
}

describe("parseConfig", () => {
  it("falha em pt-BR sem chave fora do dry-run", () => {
    const r = parseConfig({}, [], stat);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/GEMINI_API_KEY não está definida/);
  });

  it("dry-run não exige chave e usa o modelo padrão", () => {
    const c = cfgOf({}, ["--dry-run"]);
    expect(c.dryRun).toBe(true);
    expect(c.model).toBe("gemini-omni-1.1-flash");
    expect(c.generations.map((g) => g.label)).toEqual(["A-texto-fala"]);
    expect(cfgOf({ SPIKE_DRY_RUN: "1" }).dryRun).toBe(true);
  });

  it("só confirma com SPIKE_CONFIRM=sim exatamente", () => {
    expect(cfgOf({ GEMINI_API_KEY: FAKE_KEY }).confirmed).toBe(false);
    expect(cfgOf({ GEMINI_API_KEY: FAKE_KEY, SPIKE_CONFIRM: "yes" }).confirmed).toBe(false);
    expect(cfgOf({ GEMINI_API_KEY: FAKE_KEY, SPIKE_CONFIRM: "sim" }).confirmed).toBe(true);
  });

  it("monta o teste B com as duas imagens, na ordem Rafael, Marina", () => {
    const c = cfgOf({ ...both }, ["--dry-run"]);
    const b = c.generations[1];
    expect(b.label).toBe("B-novelinha-referencias");
    expect(b.images.map((i) => [i.name, i.mimeType, i.bytes])).toEqual([
      [CHAR1_NAME, "image/png", 1000],
      [CHAR2_NAME, "image/jpeg", 2000],
    ]);
  });

  it("rejeita só uma imagem, imagem inexistente, extensão errada e duração fora de 3–15", () => {
    expect(parseConfig({ REF_CHAR1: "/r/rafael.png" }, ["--dry-run"], stat).ok).toBe(false);
    expect(parseConfig({ REF_CHAR1: "/r/x.png", REF_CHAR2: "/r/marina.jpg" }, ["--dry-run"], stat).ok).toBe(false);
    expect(parseConfig({ REF_CHAR1: "/r/a.gif", REF_CHAR2: "/r/marina.jpg" }, ["--dry-run"], stat).ok).toBe(false);
    expect(parseConfig({ SPIKE_DURATION_SECONDS: "16" }, ["--dry-run"], stat).ok).toBe(false);
    expect(parseConfig({ SPIKE_DURATION_SECONDS: "2" }, ["--dry-run"], stat).ok).toBe(false);
  });
});

describe("buildRequest / describeRequest", () => {
  it("A: input em texto e response_format vertical", () => {
    const c = cfgOf({}, ["--dry-run"]);
    const req = buildRequest(c.generations[0], c, []);
    expect(req.input).toBe(c.generations[0].prompt);
    expect(req.response_format).toEqual({ type: "video", aspect_ratio: "9:16", resolution: "720p", duration: "8s", delivery: "uri" });
    expect(req.automatic_continuation).toBe(false);
  });

  it("B: imagens antes do texto, sem tags <IMAGE_REF_N>, nomes no prompt; log omite o base64", () => {
    const c = cfgOf({ ...both }, ["--dry-run"]);
    const req = buildRequest(c.generations[1], c, ["AAAA", "BBBBBB"]);
    const input = req.input as Exclude<VideoRequest["input"], string>;
    expect(input.map((p) => p.type)).toEqual(["image", "image", "text"]);
    const text = (input[2] as { text: string }).text;
    expect(text).not.toMatch(/IMAGE_REF/);
    expect(text).toContain(CHAR1_NAME);
    expect(text).toContain(CHAR2_NAME);
    const logged = describeRequest(req);
    expect(logged).not.toContain("BBBBBB");
    expect(logged).toContain("<base64 omitido: 6 caracteres>");
  });
});

describe("preflightSummary", () => {
  it("anuncia o número de gerações pagas e não mostra a chave", () => {
    const s = preflightSummary(cfgOf({ GEMINI_API_KEY: FAKE_KEY, ...both }));
    expect(s).toContain("Serão feitas 2 gerações pagas");
    expect(s).toContain("presente (não exibida)");
    expect(s).not.toContain(FAKE_KEY);
    expect(preflightSummary(cfgOf({}, ["--dry-run"]))).toContain("Serão feitas 1 geração paga");
  });
});

describe("redact / describeError", () => {
  it("remove a chave e padrões de chave", () => {
    const msg = `falhou com ${FAKE_KEY} em https://x/v1beta/files/a:download?alt=media&key=${FAKE_KEY} e AIzaSyA1234567890abcdefghijklmnopqrstu`;
    const out = redact(msg, [FAKE_KEY]);
    expect(out).not.toContain(FAKE_KEY);
    expect(out).not.toContain("AIzaSy");
    expect(redact('{"x-goog-api-key": "segredo"}', [])).not.toContain("segredo");
  });

  it("classifica status HTTP", () => {
    const err = Object.assign(new Error("Resource exhausted"), { status: 429 });
    expect(describeError(err)).toMatch(/^cota/);
    expect(describeError(Object.assign(new Error("blocked"), { status: 400 }))).toMatch(/segurança/);
    expect(describeError(Object.assign(new Error("x"), { statusCode: 503 }))).toMatch(/servidor/);
  });
});

describe("interactionFailure / fileNameFromUri / parseProbe / tabela", () => {
  it("detecta falhas e sucesso", () => {
    expect(interactionFailure({ status: "completed", output_video: { uri: "https://g/v1beta/files/abc123" } })).toBeUndefined();
    const f = interactionFailure({
      status: "failed",
      errors: [{ code: "SAFETY", message: "bloqueado" }],
      steps: [{ type: "model_output", error: { code: 3, message: "policy" } }],
    });
    expect(f).toContain("status=failed");
    expect(f).toContain("SAFETY: bloqueado");
    expect(f).toContain("policy");
  });

  it("extrai o nome do arquivo da URI", () => {
    expect(fileNameFromUri("https://generativelanguage.googleapis.com/v1beta/files/abc123:download")).toBe("files/abc123");
    expect(fileNameFromUri("sem-arquivo")).toBeUndefined();
  });

  it("lê o ffprobe e formata a tabela", () => {
    const p = parseProbe(
      JSON.stringify({
        format: { duration: "8.000000" },
        streams: [
          { codec_type: "video", width: 720, height: 1280 },
          { codec_type: "audio", codec_name: "aac" },
        ],
      }),
    );
    expect(p).toEqual({ durationS: 8, width: 720, height: 1280, hasAudio: true, audioCodec: "aac" });
    expect(isVertical916(720, 1280)).toBe(true);
    expect(isVertical916(1280, 720)).toBe(false);
    const t = formatResultsTable([
      { label: "A-texto-fala", waitS: 61.2, file: "spike-out/A-texto-fala.mp4", probe: p, tokens: 46336 },
      { label: "B-novelinha-referencias", waitS: 3, error: "cota | 429" },
    ]);
    expect(t).toContain("| A-texto-fala | 61 | 8.00 | 720x1280 | sim | sim (aac) | 46336 | spike-out/A-texto-fala.mp4 |");
    expect(t).toContain("ERRO: cota / 429");
  });
});

describe("runSpike (deps falsos, sem rede)", () => {
  function fakeDeps(responses: Array<InteractionLike | Error>) {
    const calls: VideoRequest[] = [];
    const written: string[] = [];
    let t = 0;
    const deps: SpikeDeps = {
      createInteraction: async (req) => {
        calls.push(req);
        t += 30_000;
        const r = responses.shift();
        if (!r) throw new Error("chamada a mais");
        if (r instanceof Error) throw r;
        return r;
      },
      getFileState: async () => "ACTIVE",
      downloadFile: async (_n, dest) => {
        written.push(dest);
      },
      readFile: async () => Buffer.from("img"),
      writeFile: async (p) => {
        written.push(p);
      },
      mkdir: async () => {},
      probe: async () => ({ durationS: 8, width: 720, height: 1280, hasAudio: true }),
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      log: () => {},
    };
    return { deps, calls, written };
  }
  const ok: InteractionLike = { id: "i1", status: "completed", output_video: { uri: "https://g/v1beta/files/f1" } };

  it("recusa rodar sem confirmação ou em dry-run", async () => {
    const { deps, calls } = fakeDeps([]);
    await expect(runSpike(cfgOf({ GEMINI_API_KEY: FAKE_KEY }), deps)).rejects.toThrow();
    await expect(runSpike(cfgOf({ SPIKE_CONFIRM: "sim" }, ["--dry-run"]), deps)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("faz exatamente uma chamada por geração", async () => {
    const { deps, calls } = fakeDeps([ok, { ...ok, id: "i2" }]);
    const res = await runSpike(cfgOf({ GEMINI_API_KEY: FAKE_KEY, SPIKE_CONFIRM: "sim", ...both }), deps);
    expect(calls).toHaveLength(2);
    expect(res.every((r) => !r.error)).toBe(true);
  });

  it("para no primeiro erro, sem retry e sem vazar a chave", async () => {
    const err = Object.assign(new Error(`quota exceeded for key ${FAKE_KEY}`), { status: 429 });
    const { deps, calls } = fakeDeps([err, ok]);
    const res = await runSpike(cfgOf({ GEMINI_API_KEY: FAKE_KEY, SPIKE_CONFIRM: "sim", ...both }), deps);
    expect(calls).toHaveLength(1);
    expect(res).toHaveLength(1);
    expect(res[0].error).toMatch(/cota/);
    expect(res[0].error).not.toContain(FAKE_KEY);
  });

  it("para quando a interação volta bloqueada, sem vídeo", async () => {
    const { deps, calls } = fakeDeps([{ id: "i1", status: "failed", errors: [{ message: "safety" }] }, ok]);
    const res = await runSpike(cfgOf({ GEMINI_API_KEY: FAKE_KEY, SPIKE_CONFIRM: "sim", ...both }), deps);
    expect(calls).toHaveLength(1);
    expect(res[0].error).toContain("safety");
  });

  it("grava vídeo inline quando a resposta traz data", async () => {
    const { deps, written } = fakeDeps([{ id: "i1", status: "completed", output_video: { data: "AAAA" } }]);
    const res = await runSpike(cfgOf({ GEMINI_API_KEY: FAKE_KEY, SPIKE_CONFIRM: "sim" }), deps);
    expect(res[0].error).toBeUndefined();
    expect(written.some((p) => p.endsWith("A-texto-fala.mp4"))).toBe(true);
  });
});
