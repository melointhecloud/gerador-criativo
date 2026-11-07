// Spike do provider de vídeo (Plano 1, Task 3). CONSOME CRÉDITO GEMINI quando roda de verdade.
//
//   pnpm spike:video --dry-run                       # sem custo: mostra o que seria enviado
//   SPIKE_CONFIRM=sim REF_CHAR1=... REF_CHAR2=... pnpm spike:video   # paga: 1 ou 2 gerações
//
// Nunca rode sem a autorização do dono da chave. Detalhes em docs/provider-spike.md.
import { GoogleGenAI } from "@google/genai";
import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { formatResultsTable, parseConfig, parseProbe, preflightSummary, redact, describeError, runSpike, buildRequest, describeRequest } from "./spike-video/lib";

const run = promisify(execFile);

async function main(): Promise<number> {
  const parsed = parseConfig(process.env, process.argv.slice(2), (p) => statSync(p).size);
  if (!parsed.ok) {
    console.error(`Erro: ${parsed.error}`);
    return 1;
  }
  const cfg = parsed.config;
  console.log(preflightSummary(cfg));

  if (cfg.dryRun) {
    for (const gen of cfg.generations) {
      // Base64 falso só para medir; as imagens não são lidas no dry-run.
      const fakeData = gen.images.map((img) => "x".repeat(Math.ceil(img.bytes / 3) * 4));
      console.log(`\n--- Corpo de interactions.create para ${gen.label} ---\n${describeRequest(buildRequest(gen, cfg, fakeData))}`);
    }
    console.log("\nDRY-RUN: nenhuma chamada foi feita e nada foi gravado.");
    return 0;
  }

  if (!cfg.confirmed) {
    console.error(
      "\nNada foi enviado. Este comando gasta crédito da chave Gemini. Para rodar de verdade, com autorização do dono da chave, " +
        "repita com SPIKE_CONFIRM=sim na linha de comando (não coloque essa variável no .env).",
    );
    return 2;
  }

  const ai = new GoogleGenAI({ apiKey: cfg.apiKey });
  // Rede de segurança: mata o processo se o timeout total estourar (mais 1 min de folga para gravar).
  setTimeout(() => {
    console.error("Timeout total do spike atingido; encerrando sem nova tentativa.");
    process.exit(3);
  }, cfg.timeoutMs + 60_000).unref();

  const results = await runSpike(cfg, {
    createInteraction: async (req, { timeoutMs }) =>
      ai.interactions.create(req, {
        timeout_ms: timeoutMs,
        // O SDK, por padrão, refaz a chamada até 4 vezes em 408/409/429/5xx; cada retry seria outra geração paga.
        retries: { strategy: "none" },
      }),
    getFileState: async (name) => (await ai.files.get({ name })).state,
    downloadFile: (name, dest) => ai.files.download({ file: name, downloadPath: dest }),
    readFile: (p) => readFile(p),
    writeFile: (p, data) => writeFile(p, data),
    mkdir: async (p) => {
      await mkdir(p, { recursive: true });
    },
    probe: async (file) => {
      try {
        const { stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
        return parseProbe(stdout);
      } catch (e) {
        console.error(`ffprobe falhou em ${file}: ${describeError(e)}`);
        return undefined;
      }
    },
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (m) => console.log(m),
  });

  console.log(`\n${formatResultsTable(results)}`);
  const failed = results.some((r) => r.error) || results.length < cfg.generations.length;
  if (failed) console.error("\nO spike parou no primeiro erro, sem nova tentativa. Registre o motivo em docs/provider-spike.md.");
  else console.log("\nAssista aos vídeos em spike-out/ e preencha docs/provider-spike.md.");
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(redact(`Erro inesperado: ${describeError(e)}`, [process.env.GEMINI_API_KEY]));
    process.exit(1);
  },
);
