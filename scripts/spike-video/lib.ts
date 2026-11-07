// Lógica do spike do provider de vídeo (Plano 1, Task 3), separada do SDK para ser testável sem rede.
// A forma da chamada segue https://aistudio.google.com/docs/omni (consultada em 2026-11-07).
import path from "node:path";

export const DEFAULT_MODEL = "gemini-omni-1.1-flash";
export const DEFAULT_DURATION_SECONDS = 8;
export const DEFAULT_TIMEOUT_MINUTES = 20;
/** Faixa documentada para geração a partir de texto/imagem: "3s" a "15s" (default "10s"). */
export const MIN_DURATION_SECONDS = 3;
export const MAX_DURATION_SECONDS = 15;
export const ASPECT_RATIO = "9:16";
export const RESOLUTION = "720p";
/** A doc recomenda `delivery: "uri"` para vídeos acima de 4 MB; o inline é tratado como alternativa. */
export const DELIVERY = "uri";

export const CHAR1_NAME = "Rafael";
export const CHAR2_NAME = "Marina";

export const PROMPT_A =
  'Vídeo vertical estilo UGC, filmado com celular. Uma mulher de 30 anos, em uma cozinha clara, olha para a câmera e diz em português do Brasil, com voz natural: "Eu testei esse produto por uma semana e não acredito no resultado."';

// A doc diz que as tags <IMAGE_REF_N> estão obsoletas ("deprecated and unsupported in future models")
// e manda descrever em linguagem natural como cada imagem deve ser usada. Por isso os nomes dos
// personagens são associados à ordem das imagens no próprio texto.
export const PROMPT_B =
  `Cena curta de novelinha, vídeo vertical. ${CHAR1_NAME} é o rapaz da primeira imagem de referência (moletom preto e mochila). ` +
  `${CHAR2_NAME} é a moça da segunda imagem de referência (top branco e mochila rosa). Os dois se encontram no corredor da escola. ` +
  `${CHAR1_NAME} olha para ${CHAR2_NAME} e diz em português do Brasil: "Você também perdeu o ônibus hoje?" ` +
  `${CHAR2_NAME} sorri e responde em português do Brasil: "Perdi, mas valeu a pena te encontrar aqui." ` +
  `Mantenha exatamente a aparência de cada personagem como na sua imagem de referência: rosto, cabelo, roupa e mochila. ` +
  `Vozes naturais, falas em português do Brasil, com os lábios sincronizados.`;

export type GenerationLabel = "A-texto-fala" | "B-novelinha-referencias";

export interface RefImage {
  name: string;
  path: string;
  mimeType: string;
  bytes: number;
}

export interface Generation {
  label: GenerationLabel;
  purpose: string;
  prompt: string;
  images: RefImage[];
}

export interface SpikeConfig {
  model: string;
  apiKey: string | undefined;
  dryRun: boolean;
  confirmed: boolean;
  durationSeconds: number;
  timeoutMs: number;
  outDir: string;
  generations: Generation[];
  notes: string[];
}

export type ParseResult = { ok: true; config: SpikeConfig } | { ok: false; error: string };

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export function mimeTypeFor(file: string): string | undefined {
  return MIME_BY_EXT[path.extname(file).toLowerCase()];
}

/** `statFile` devolve o tamanho em bytes ou lança se o arquivo não existir. */
export function parseConfig(
  env: Record<string, string | undefined>,
  argv: string[],
  statFile: (p: string) => number,
): ParseResult {
  const dryRun = argv.includes("--dry-run") || env.SPIKE_DRY_RUN === "1";
  const apiKey = env.GEMINI_API_KEY?.trim() || undefined;
  if (!dryRun && !apiKey) {
    return {
      ok: false,
      error:
        "GEMINI_API_KEY não está definida. Coloque a chave no .env (ou no ambiente) antes de rodar o spike. " +
        "Para só ver o que seria enviado, sem custo, use --dry-run.",
    };
  }

  const durationRaw = env.SPIKE_DURATION_SECONDS ?? String(DEFAULT_DURATION_SECONDS);
  const durationSeconds = Number(durationRaw);
  if (!Number.isInteger(durationSeconds) || durationSeconds < MIN_DURATION_SECONDS || durationSeconds > MAX_DURATION_SECONDS) {
    return {
      ok: false,
      error: `SPIKE_DURATION_SECONDS inválido ("${durationRaw}"): use um inteiro de ${MIN_DURATION_SECONDS} a ${MAX_DURATION_SECONDS}.`,
    };
  }

  const timeoutRaw = env.SPIKE_TIMEOUT_MINUTES ?? String(DEFAULT_TIMEOUT_MINUTES);
  const timeoutMinutes = Number(timeoutRaw);
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0 || timeoutMinutes > 120) {
    return { ok: false, error: `SPIKE_TIMEOUT_MINUTES inválido ("${timeoutRaw}"): use um número entre 1 e 120.` };
  }

  const generations: Generation[] = [
    { label: "A-texto-fala", purpose: "Gates 1, 2 e 4: só texto, fala em pt-BR numa única geração", prompt: PROMPT_A, images: [] },
  ];
  const notes: string[] = [];

  const char1 = env.REF_CHAR1?.trim() || undefined;
  const char2 = env.REF_CHAR2?.trim() || undefined;
  if (char1 && char2) {
    const images: RefImage[] = [];
    for (const [name, file] of [
      [CHAR1_NAME, char1],
      [CHAR2_NAME, char2],
    ] as const) {
      const mimeType = mimeTypeFor(file);
      if (!mimeType) return { ok: false, error: `Imagem de ${name} com extensão não suportada: ${file} (use .png, .jpg, .jpeg ou .webp).` };
      let bytes: number;
      try {
        bytes = statFile(file);
      } catch {
        return { ok: false, error: `Imagem de ${name} não encontrada: ${file}` };
      }
      if (bytes === 0) return { ok: false, error: `Imagem de ${name} está vazia: ${file}` };
      images.push({ name, path: file, mimeType, bytes });
    }
    generations.push({
      label: "B-novelinha-referencias",
      purpose: "Gate 3 (e Gate 2 com dois personagens): 2 imagens de referência de personagens, uma fala de cada",
      prompt: PROMPT_B,
      images,
    });
  } else if (char1 || char2) {
    return { ok: false, error: "Defina as duas imagens (REF_CHAR1 e REF_CHAR2) ou nenhuma. Com só uma, o teste B não tem como rodar." };
  } else {
    notes.push("Teste B pulado: defina REF_CHAR1 e REF_CHAR2 (caminhos das imagens dos dois personagens).");
  }

  return {
    ok: true,
    config: {
      model: env.GEMINI_VIDEO_MODEL?.trim() || DEFAULT_MODEL,
      apiKey,
      dryRun,
      confirmed: env.SPIKE_CONFIRM === "sim",
      durationSeconds,
      timeoutMs: Math.round(timeoutMinutes * 60_000),
      outDir: path.resolve(env.SPIKE_OUT_DIR ?? "spike-out"),
      generations,
      notes,
    },
  };
}

// ---------- Corpo da requisição ----------

export interface VideoRequest {
  model: string;
  input: string | Array<{ type: "image"; data: string; mime_type: string } | { type: "text"; text: string }>;
  response_format: { type: "video"; aspect_ratio: string; resolution: string; duration: string; delivery: string };
  /** Opção do SDK: sem saltos automáticos de continuação (cada salto seria outra chamada cobrada). */
  automatic_continuation: false;
}

/** `imageData` traz o base64 de cada imagem, na mesma ordem de `gen.images`. */
export function buildRequest(gen: Generation, cfg: Pick<SpikeConfig, "model" | "durationSeconds">, imageData: string[]): VideoRequest {
  if (imageData.length !== gen.images.length) throw new Error("número de imagens não confere");
  const response_format = {
    type: "video" as const,
    aspect_ratio: ASPECT_RATIO,
    resolution: RESOLUTION,
    duration: `${cfg.durationSeconds}s`,
    delivery: DELIVERY,
  };
  // A doc mostra as imagens antes do bloco de texto no `input`.
  const input: VideoRequest["input"] =
    gen.images.length === 0
      ? gen.prompt
      : [
          ...gen.images.map((img, i) => ({ type: "image" as const, data: imageData[i], mime_type: img.mimeType })),
          { type: "text" as const, text: gen.prompt },
        ];
  return { model: cfg.model, input, response_format, automatic_continuation: false };
}

/** Versão para log: troca o base64 por um marcador com o tamanho. */
export function describeRequest(req: VideoRequest): string {
  const input =
    typeof req.input === "string"
      ? req.input
      : req.input.map((part) => (part.type === "image" ? { ...part, data: `<base64 omitido: ${part.data.length} caracteres>` } : part));
  return JSON.stringify({ ...req, input }, null, 2);
}

// ---------- Resumo pré-voo ----------

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function preflightSummary(cfg: SpikeConfig): string {
  const n = cfg.generations.length;
  const lines = [
    `=== Spike do provider de vídeo ${cfg.dryRun ? "(DRY-RUN: nada será enviado)" : ""}`.trimEnd(),
    `Modelo: ${cfg.model}`,
    `Chave GEMINI_API_KEY: ${cfg.apiKey ? "presente (não exibida)" : "ausente"}`,
    `Formato pedido: ${ASPECT_RATIO}, ${RESOLUTION}, ${cfg.durationSeconds}s, delivery=${DELIVERY}, sem retries automáticos`,
    `Timeout total: ${Math.round(cfg.timeoutMs / 60_000)} min`,
    `Saída: ${cfg.outDir}`,
    `Serão feitas ${n} ${n === 1 ? "geração paga" : "gerações pagas"} (uma por teste, sem nova tentativa em caso de erro).`,
  ];
  for (const gen of cfg.generations) {
    lines.push("", `[${gen.label}] ${gen.purpose}`);
    lines.push(`  Prompt: ${gen.prompt}`);
    if (gen.images.length === 0) lines.push("  Imagens de referência: nenhuma");
    else {
      lines.push(`  Imagens de referência: ${gen.images.length}`);
      gen.images.forEach((img, i) =>
        lines.push(`    ${i + 1}. ${img.name}: ${img.path} (${img.mimeType}, ${formatBytes(img.bytes)})`),
      );
    }
  }
  for (const note of cfg.notes) lines.push("", note);
  return lines.join("\n");
}

// ---------- Erros e segredos ----------

/** Remove a chave (e qualquer coisa com cara de chave Google) de um texto antes de imprimir. */
export function redact(text: string, secrets: Array<string | undefined>): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join("[REDACTED]");
  return out
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED]")
    .replace(/([?&]key=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/(x-goog-api-key["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, "$1[REDACTED]");
}

export function describeError(e: unknown): string {
  if (!(e instanceof Error)) return `erro desconhecido: ${String(e)}`;
  const anyErr = e as Error & { status?: unknown; statusCode?: unknown; body?: unknown };
  const status = typeof anyErr.status === "number" ? anyErr.status : typeof anyErr.statusCode === "number" ? anyErr.statusCode : undefined;
  let kind = "erro";
  if (status === 429) kind = "cota ou limite de requisições (429)";
  else if (status === 400) kind = "requisição inválida ou bloqueada pelo filtro de segurança (400)";
  else if (status === 401 || status === 403) kind = `chave sem permissão para este modelo (${status})`;
  else if (status === 404) kind = "modelo ou recurso não encontrado (404)";
  else if (status !== undefined && status >= 500) kind = `erro do servidor do provider (${status})`;
  else if (status !== undefined) kind = `HTTP ${status}`;
  else if (/timeout|timed out|abort/i.test(`${e.name} ${e.message}`)) kind = "tempo esgotado (a geração pode ter sido cobrada mesmo assim)";
  const body = typeof anyErr.body === "string" && anyErr.body && !e.message.includes(anyErr.body) ? `\n  corpo: ${anyErr.body.slice(0, 2000)}` : "";
  return `${kind}: ${e.message}${body}`;
}

// ---------- Resposta da Interactions API ----------

export interface InteractionLike {
  id?: string;
  status?: string;
  output_video?: { uri?: string; data?: string; mime_type?: string };
  errors?: Array<{ code?: string; message?: string }>;
  steps?: unknown[];
  usage?: { total_input_tokens?: number; total_output_tokens?: number };
}

/** Motivo de falha quando a interação não trouxe vídeo (status, `errors`, erro do passo `model_output`). */
export function interactionFailure(it: InteractionLike): string | undefined {
  if (it.status === "completed" && (it.output_video?.uri || it.output_video?.data)) return undefined;
  const reasons: string[] = [];
  for (const err of it.errors ?? []) reasons.push(`${err.code ?? "erro"}: ${err.message ?? ""}`.trim());
  for (const step of it.steps ?? []) {
    const s = step as { type?: string; error?: { code?: number; message?: string } };
    if (s?.type === "model_output" && s.error) reasons.push(`model_output ${s.error.code ?? ""}: ${s.error.message ?? ""}`.trim());
  }
  if (!it.output_video?.uri && !it.output_video?.data) reasons.push("resposta sem vídeo (output_video vazio)");
  return `status=${it.status ?? "desconhecido"}; ${reasons.join("; ")}`;
}

export function fileNameFromUri(uri: string): string | undefined {
  const id = uri.match(/files\/([a-zA-Z0-9_-]+)/)?.[1];
  return id ? `files/${id}` : undefined;
}

/** Metadados seguros para salvar: sem o input (base64 das imagens) e sem o vídeo inline. */
export function sanitizeInteraction(it: InteractionLike): Record<string, unknown> {
  return {
    id: it.id,
    status: it.status,
    usage: it.usage,
    errors: it.errors,
    output_video: it.output_video
      ? { uri: it.output_video.uri, mime_type: it.output_video.mime_type, inline_data: Boolean(it.output_video.data) }
      : undefined,
  };
}

// ---------- ffprobe e tabela ----------

export interface Probe {
  durationS: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  audioCodec?: string;
}

export function parseProbe(stdout: string): Probe {
  const j = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
  };
  const streams = j.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  return {
    durationS: Number(j.format?.duration ?? NaN),
    width: video?.width,
    height: video?.height,
    hasAudio: Boolean(audio),
    audioCodec: audio?.codec_name,
  };
}

export function isVertical916(width?: number, height?: number): boolean {
  if (!width || !height) return false;
  return Math.abs(width / height - 9 / 16) < 0.01;
}

export interface GenerationResult {
  label: GenerationLabel;
  waitS: number;
  file?: string;
  probe?: Probe;
  tokens?: number;
  error?: string;
}

export function formatResultsTable(results: GenerationResult[]): string {
  const header = "| Geração | Espera (s) | Duração (s) | Resolução | 9:16 | Áudio | Tokens de saída | Arquivo / erro |";
  const sep = "|---|---|---|---|---|---|---|---|";
  const rows = results.map((r) => {
    const p = r.probe;
    const dur = p && Number.isFinite(p.durationS) ? p.durationS.toFixed(2) : "?";
    const res = p?.width && p?.height ? `${p.width}x${p.height}` : "?";
    const vert = p ? (isVertical916(p.width, p.height) ? "sim" : "não") : "?";
    const audio = p ? (p.hasAudio ? `sim (${p.audioCodec ?? "?"})` : "não") : "?";
    const last = r.error ? `ERRO: ${r.error.replace(/\|/g, "/").replace(/\n/g, " ")}` : (r.file ?? "?");
    return `| ${r.label} | ${r.waitS.toFixed(0)} | ${dur} | ${res} | ${vert} | ${audio} | ${r.tokens ?? "?"} | ${last} |`;
  });
  return [header, sep, ...rows].join("\n");
}

// ---------- Execução ----------

export interface SpikeDeps {
  createInteraction(req: VideoRequest, opts: { timeoutMs: number }): Promise<InteractionLike>;
  getFileState(name: string): Promise<string | undefined>;
  downloadFile(name: string, dest: string): Promise<void>;
  readFile(p: string): Promise<Buffer>;
  writeFile(p: string, data: Buffer | string): Promise<void>;
  mkdir(p: string): Promise<void>;
  probe(file: string): Promise<Probe | undefined>;
  now(): number;
  sleep(ms: number): Promise<void>;
  log(msg: string): void;
}

export const FILE_POLL_MS = 5000;

/**
 * Faz no máximo uma chamada paga por geração, em sequência. No primeiro erro, para tudo (sem retry).
 * Quem chama garante que `cfg.dryRun` é falso e `cfg.confirmed` é verdadeiro.
 */
export async function runSpike(cfg: SpikeConfig, deps: SpikeDeps): Promise<GenerationResult[]> {
  if (cfg.dryRun || !cfg.confirmed) throw new Error("runSpike só roda com confirmação e fora do dry-run");
  const deadline = deps.now() + cfg.timeoutMs;
  const secrets = [cfg.apiKey];
  const results: GenerationResult[] = [];
  await deps.mkdir(cfg.outDir);

  // Lê todas as imagens antes da primeira chamada paga, para não gastar A e falhar em B.
  const imageData = new Map<GenerationLabel, string[]>();
  for (const gen of cfg.generations) {
    imageData.set(gen.label, await Promise.all(gen.images.map(async (img) => (await deps.readFile(img.path)).toString("base64"))));
  }

  for (const gen of cfg.generations) {
    const t0 = deps.now();
    const remaining = deadline - t0;
    if (remaining <= 0) {
      results.push({ label: gen.label, waitS: 0, error: "timeout total atingido antes de começar; nada enviado" });
      break;
    }
    deps.log(`[${gen.label}] enviando (1 geração paga)...`);
    const req = buildRequest(gen, cfg, imageData.get(gen.label) ?? []);
    let it: InteractionLike;
    try {
      it = await deps.createInteraction(req, { timeoutMs: remaining });
    } catch (e) {
      results.push({ label: gen.label, waitS: (deps.now() - t0) / 1000, error: redact(describeError(e), secrets) });
      break;
    }
    await deps.writeFile(path.join(cfg.outDir, `${gen.label}.json`), redact(JSON.stringify(sanitizeInteraction(it), null, 2), secrets));
    const failure = interactionFailure(it);
    if (failure) {
      results.push({ label: gen.label, waitS: (deps.now() - t0) / 1000, error: redact(failure, secrets) });
      break;
    }

    const file = path.join(cfg.outDir, `${gen.label}.mp4`);
    try {
      if (it.output_video?.data) {
        await deps.writeFile(file, Buffer.from(it.output_video.data, "base64"));
      } else {
        const name = fileNameFromUri(it.output_video?.uri ?? "");
        if (!name) throw new Error(`URI de vídeo inesperada: ${it.output_video?.uri}`);
        for (;;) {
          const state = await deps.getFileState(name);
          if (state === "ACTIVE") break;
          if (state === "FAILED") throw new Error(`arquivo ${name} ficou FAILED`);
          if (deps.now() + FILE_POLL_MS > deadline) throw new Error(`timeout esperando ${name} ficar ACTIVE (último estado: ${state})`);
          await deps.sleep(FILE_POLL_MS);
        }
        await deps.downloadFile(name, file);
      }
    } catch (e) {
      results.push({
        label: gen.label,
        waitS: (deps.now() - t0) / 1000,
        error: redact(
          `${describeError(e)} — o vídeo já foi gerado (e cobrado); recupere sem gerar de novo via interactions.get("${it.id}"), que devolve o vídeo inline`,
          secrets,
        ),
      });
      break;
    }
    const waitS = (deps.now() - t0) / 1000;
    const probe = await deps.probe(file);
    results.push({ label: gen.label, waitS, file, probe, tokens: it.usage?.total_output_tokens });
    deps.log(`[${gen.label}] pronto em ${waitS.toFixed(0)}s: ${file}`);
  }
  return results;
}
