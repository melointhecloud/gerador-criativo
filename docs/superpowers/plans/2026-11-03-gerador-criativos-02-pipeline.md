# Gerador de Criativos TikTok — Plano 2: Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a lógica de negócio completa sem UI: helpers de ffmpeg, geração de roteiro e personagens, serviços de projeto/cenas/personagens, handlers de job (cena, personagem, montagem), runner do worker e os providers reais do Gemini.

**Architecture:** Módulos em `src/modules` fazem uma coisa cada (planejar roteiro, desenhar personagem, gerar cena, montar vídeo) e recebem dependências por parâmetro (`Deps`). Serviços em `src/services` aplicam as regras de negócio e são o único caminho que a web usa para escrever no banco. O worker (`src/worker`) só despacha jobs para os handlers. Providers reais ficam atrás das interfaces do Plano 1.

**Tech Stack:** o mesmo do Plano 1, mais `ffmpeg`/`ffprobe` instalados na máquina.

**Pré-requisito:** Plano 1 concluído (`pnpm test` verde). **Task 11 também exige `docs/provider-spike.md` com Gates 1–4 aprovados.**

**Spec:** `docs/superpowers/specs/2026-11-03-gerador-criativos-tiktok-design.md`

---

## Mapa de arquivos deste plano

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/ffmpeg.ts` | `runFfmpeg`, `probe`, `makeTestClip`, `withTempDir` |
| `src/modules/prompt.ts` | Monta o prompt de cena e de imagem de personagem |
| `src/modules/script-planner.ts` | `draftScript`: copy → cenas (Gemini texto) |
| `src/modules/character-designer.ts` | `proposeCharacters`, `handleGenerateCharacter` |
| `src/modules/scene-generator.ts` | `handleGenerateScene`: um clipe por tentativa, resiliente a reinício |
| `src/modules/assembler.ts` | `concatClips`, `handleAssemble` |
| `src/deps.ts` | Tipo `Deps` (db, storage, providers, config) |
| `src/services/errors.ts`, `labels.ts` | `DomainError`, unicidade de rótulos |
| `src/services/projects.ts` | Projeto, briefing, referências, etapas, snapshot |
| `src/services/scenes.ts` | Roteiro, cenas, tentativas, aprovação, montagem |
| `src/services/characters.ts` | Personagens (novelinha) |
| `src/worker/runner.ts`, `handlers.ts`, `main.ts` | Loop de jobs e entrypoint do worker |
| `src/providers/errors.ts`, `gemini.ts`, `omni.ts`, `dev.ts`, `index.ts` | Providers reais, de desenvolvimento e fábrica |
| `tests/helpers/deps.ts`, `tests/helpers/seed.ts` | Helpers de teste |

---

### Task 1: Helpers de ffmpeg

**Files:**
- Create: `src/modules/ffmpeg.ts`
- Test: `tests/modules/ffmpeg.test.ts`

- [ ] **Step 1: Escrever os testes**

`tests/modules/ffmpeg.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import path from "node:path";
import { makeTestClip, probe, withTempDir } from "@/modules/ffmpeg";

describe("ffmpeg helpers", () => {
  it("gera um clipe vertical com áudio e mede duração e resolução", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "a.mp4");
      await makeTestClip(file, 1);
      const p = await probe(file);
      expect(p.durationSeconds).toBeGreaterThan(0.8);
      expect(p.durationSeconds).toBeLessThan(1.5);
      expect(p.hasAudio).toBe(true);
      expect(p.width).toBe(360);
      expect(p.height).toBe(640);
    });
  });

  it("gera clipe sem áudio quando pedido", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "mudo.mp4");
      await makeTestClip(file, 1, { audio: false });
      expect((await probe(file)).hasAudio).toBe(false);
    });
  });

  it("probe falha em arquivo inválido", async () => {
    await withTempDir(async (dir) => {
      await expect(probe(path.join(dir, "nao-existe.mp4"))).rejects.toThrow();
    });
  });

  it("withTempDir apaga a pasta ao final", async () => {
    let captured = "";
    await withTempDir(async (dir) => {
      captured = dir;
    });
    const { access } = await import("node:fs/promises");
    await expect(access(captured)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/modules/ffmpeg.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `src/modules/ffmpeg.ts`**

```ts
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export async function runFfmpeg(args: string[]): Promise<void> {
  try {
    await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (e) {
    const stderr = (e as { stderr?: string }).stderr;
    throw new Error(`ffmpeg falhou: ${stderr || (e as Error).message}`);
  }
}

export type Probe = { durationSeconds: number; hasAudio: boolean; width: number; height: number };

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await exec("ffprobe", [
    "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file,
  ]);
  const j = JSON.parse(stdout) as {
    format: { duration?: string };
    streams: { codec_type: string; width?: number; height?: number }[];
  };
  const video = j.streams.find((s) => s.codec_type === "video");
  if (!video) throw new Error("arquivo sem trilha de vídeo");
  return {
    durationSeconds: Number(j.format.duration ?? 0),
    hasAudio: j.streams.some((s) => s.codec_type === "audio"),
    width: video.width ?? 0,
    height: video.height ?? 0,
  };
}

// Clipe sintético para testes e para o provider de desenvolvimento.
export async function makeTestClip(
  file: string,
  seconds: number,
  opts: { width?: number; height?: number; audio?: boolean } = {},
): Promise<void> {
  const w = opts.width ?? 360;
  const h = opts.height ?? 640;
  const audio = opts.audio ?? true;
  const args = ["-f", "lavfi", "-i", `testsrc2=size=${w}x${h}:rate=30:duration=${seconds}`];
  if (audio) args.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`);
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
  if (audio) args.push("-c:a", "aac", "-shortest");
  args.push(file);
  await runFfmpeg(args);
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "gerador-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run tests/modules/ffmpeg.test.ts`
Expected: 4 testes PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ffmpeg.ts tests/modules/ffmpeg.test.ts
git commit -m "feat(modules): ffmpeg helpers (run, probe, test clip, temp dir)"
```

---

### Task 2: Builders de prompt

**Files:**
- Create: `src/modules/prompt.ts`
- Test: `tests/modules/prompt.test.ts`

- [ ] **Step 1: Escrever os testes**

`tests/modules/prompt.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildCharacterImagePrompt, buildScenePrompt } from "@/modules/prompt";

const scene = { dialogue: "Funciona mesmo!", visualPrompt: "Close no rosto sorrindo", targetSeconds: 5 };

describe("buildScenePrompt", () => {
  it("ugc: estilo celular, 9:16 e fala em pt-BR", () => {
    const p = buildScenePrompt("ugc", scene);
    expect(p).toContain("9:16");
    expect(p).toContain("UGC");
    expect(p).toContain("Close no rosto sorrindo");
    expect(p).toContain('"Funciona mesmo!"');
    expect(p).toContain("5 segundos");
  });
  it("novelinha: estilo dramático", () => {
    expect(buildScenePrompt("novelinha", scene)).toContain("novela");
  });
  it("sem fala: avisa que não há fala", () => {
    expect(buildScenePrompt("ugc", { ...scene, dialogue: "  " })).toContain("Sem fala");
  });
});

describe("buildCharacterImagePrompt", () => {
  it("inclui nome e descrição", () => {
    const p = buildCharacterImagePrompt({ name: "Marina", description: "Mulher de 35 anos, cabelo cacheado" });
    expect(p).toContain("Marina");
    expect(p).toContain("cabelo cacheado");
    expect(p).toContain("9:16");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/modules/prompt.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `src/modules/prompt.ts`**

```ts
import type { Mode } from "@/domain/stages";

export function buildScenePrompt(
  mode: Mode,
  scene: { dialogue: string; visualPrompt: string; targetSeconds: number },
): string {
  const style =
    mode === "ugc"
      ? "Vídeo vertical 9:16 em estilo UGC, filmado com celular, luz natural, câmera na mão, aparência real e sem retoque."
      : "Vídeo vertical 9:16 em estilo cinematográfico de novela dramática, iluminação de cena, interpretação expressiva.";
  const speech = scene.dialogue.trim()
    ? `Fala em português do Brasil, dita em voz alta, com a boca sincronizada: "${scene.dialogue.trim()}"`
    : "Sem fala nesta cena.";
  return `${style} Duração aproximada: ${scene.targetSeconds} segundos.\n${scene.visualPrompt.trim()}\n${speech}`;
}

export function buildCharacterImagePrompt(c: { name: string; description: string }): string {
  return (
    "Retrato de corpo inteiro de um personagem, fundo neutro liso, luz suave de estúdio, " +
    "enquadramento vertical 9:16, imagem de referência para manter o mesmo personagem em várias cenas. " +
    `Personagem: ${c.name}. ${c.description.trim()}`
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run tests/modules/prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/prompt.ts tests/modules/prompt.test.ts
git commit -m "feat(modules): scene and character prompt builders"
```

---

### Task 3: Planejador de roteiro

**Files:**
- Create: `src/modules/script-planner.ts`
- Test: `tests/modules/script-planner.test.ts`

- [ ] **Step 1: Escrever os testes**

`tests/modules/script-planner.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { draftScript } from "@/modules/script-planner";
import { FakeTextModel } from "@/providers/fake";
import { ProviderError } from "@/providers/types";

const base = {
  mode: "novelinha" as const,
  copy: "Maria descobre que o marido a traiu e decide se vingar.",
  availableLabels: ["Maria", "Carlos", "produto"],
  maxReferences: 2,
  maxSeconds: 8,
};

const scene = (over: Record<string, unknown> = {}) => ({
  dialogue: "Eu sei de tudo.",
  visualPrompt: "Maria encara Carlos na sala",
  targetSeconds: 6,
  referenceLabels: ["Maria", "Carlos"],
  ...over,
});

describe("draftScript", () => {
  it("devolve as cenas com referências resolvidas e cortadas pelo limite", async () => {
    const text = new FakeTextModel([
      { scenes: [scene({ referenceLabels: ["maria", "Carlos", "produto", "Fantasma"] })] },
    ]);
    const out = await draftScript(text, base);
    expect(out).toHaveLength(1);
    expect(out[0]!.referenceLabels).toEqual(["Maria", "Carlos"]);
    expect(out[0]!.notice).toContain("Fantasma");
    expect(out[0]!.notice).toContain("produto");
  });

  it("inclui copy, rótulos, limites e modo no prompt", async () => {
    const text = new FakeTextModel([{ scenes: [scene()] }]);
    await draftScript(text, base);
    const call = text.calls[0]!;
    expect(call.task).toBe("script");
    expect(call.prompt).toContain("Maria descobre que o marido");
    expect(call.prompt).toContain("Maria, Carlos, produto");
    expect(call.system).toContain("novela");
    expect(call.system).toContain("8 segundos");
    expect(call.system).toContain("2 referências");
  });

  it("instrui o modelo a priorizar quem aparece em destaque quando excede o limite", async () => {
    const text = new FakeTextModel([{ scenes: [scene()] }]);
    await draftScript(text, base);
    const sys = text.calls[0]!.system;
    expect(sys).toContain("em destaque");
    expect(sys).toContain("só os primeiros serão usados");
  });

  it("modo ugc usa instruções de UGC", async () => {
    const text = new FakeTextModel([{ scenes: [scene({ referenceLabels: [] })] }]);
    await draftScript(text, { ...base, mode: "ugc" });
    expect(text.calls[0]!.system).toContain("UGC");
  });

  it("inclui roteiro atual e feedback quando há revisão", async () => {
    const text = new FakeTextModel([{ scenes: [scene()] }]);
    await draftScript(text, {
      ...base,
      current: [{ dialogue: "Antes", visualPrompt: "Cena antiga", targetSeconds: 5 }],
      feedback: "Corte a cena 2 e deixe mais curto",
    });
    const p = text.calls[0]!.prompt;
    expect(p).toContain("Cena antiga");
    expect(p).toContain("Corte a cena 2 e deixe mais curto");
  });

  it("tenta de novo quando o modelo devolve JSON inválido", async () => {
    const text = new FakeTextModel([{ scenes: [] }, { scenes: [scene()] }]);
    const out = await draftScript(text, base);
    expect(out).toHaveLength(1);
    expect(text.calls).toHaveLength(2);
  });

  it("desiste após 3 respostas inválidas", async () => {
    const text = new FakeTextModel([{ scenes: [] }, { scenes: [] }, { scenes: [] }]);
    await expect(draftScript(text, base)).rejects.toThrow(/roteiro válido/);
    expect(text.calls).toHaveLength(3);
  });

  it("não tenta de novo em erro do provider", async () => {
    const text = new FakeTextModel(() => {
      throw new ProviderError("cota esgotada", true);
    });
    await expect(draftScript(text, base)).rejects.toBeInstanceOf(ProviderError);
    expect(text.calls).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/modules/script-planner.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `src/modules/script-planner.ts`**

```ts
import { z } from "zod";
import { resolveReferences, scriptDraftSchema } from "@/domain/script";
import type { Mode } from "@/domain/stages";
import type { TextModel } from "@/providers/types";

export type DraftedScene = {
  dialogue: string;
  visualPrompt: string;
  targetSeconds: number;
  referenceLabels: string[];
  notice: string | null;
};

export type DraftInput = {
  mode: Mode;
  copy: string;
  availableLabels: string[];
  maxReferences: number;
  maxSeconds: number;
  current?: { dialogue: string; visualPrompt: string; targetSeconds: number }[];
  feedback?: string;
};

function buildSystem(i: DraftInput): string {
  const mode =
    i.mode === "ugc"
      ? "O criativo é UGC: uma pessoa real falando para a câmera, filmada com celular na vertical. " +
        "Todas as cenas são trechos do mesmo vídeo, com a mesma pessoa e o mesmo cenário, em tom natural e direto."
      : "O criativo é uma novela curta (novelinha): uma história dramática, com diálogos entre personagens. " +
        "Cada cena avança a história. Liste em referenceLabels todos os personagens que aparecem na cena.";
  return [
    "Você é diretor de criativos de vídeo para TikTok Ads, escrevendo em português do Brasil.",
    mode,
    "Divida a copy recebida em cenas sequenciais que, juntas, contam a copy inteira, sem inventar ofertas, preços ou promessas que não estejam nela.",
    `Cada cena dura entre 3 e ${i.maxSeconds} segundos (${i.maxSeconds} segundos é o máximo). O campo dialogue é a fala exata, em português do Brasil, que será dita na cena (vazio se não houver fala). Cabem cerca de 2,5 palavras por segundo.`,
    "O campo visualPrompt descreve ação, enquadramento, cenário e luz. Não descreva a aparência física de pessoas ou do produto: imagens de referência definem isso.",
    `O campo referenceLabels só pode conter rótulos da lista de referências disponíveis, e no máximo ${i.maxReferences} referências por cena. Se a cena tiver mais personagens do que o limite, liste primeiro os que aparecem em destaque (quem fala ou ocupa o primeiro plano); só os primeiros serão usados.`,
    "O primeiro segundo da primeira cena deve prender a atenção (gancho). A última cena fecha com a chamada para ação da copy.",
  ].join("\n");
}

function buildPrompt(i: DraftInput): string {
  const parts = [
    `COPY:\n${i.copy.trim()}`,
    `REFERÊNCIAS DISPONÍVEIS: ${i.availableLabels.length ? i.availableLabels.join(", ") : "nenhuma"}`,
  ];
  if (i.current?.length) {
    parts.push(
      "ROTEIRO ATUAL:\n" +
        i.current
          .map((s, n) => `${n + 1}. [${s.targetSeconds}s] ${s.visualPrompt} | fala: ${s.dialogue || "(sem fala)"}`)
          .join("\n"),
    );
  }
  if (i.feedback?.trim()) {
    parts.push(`AJUSTES PEDIDOS PELO USUÁRIO (aplique ao roteiro atual):\n${i.feedback.trim()}`);
  }
  return parts.join("\n\n");
}

export async function draftScript(text: TextModel, input: DraftInput): Promise<DraftedScene[]> {
  const schema = scriptDraftSchema(input.maxSeconds);
  const system = buildSystem(input);
  const prompt = buildPrompt(input);
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const draft = await text.generateJson({ task: "script", system, prompt, schema });
      return draft.scenes.map((s) => {
        const refs = resolveReferences(s.referenceLabels, input.availableLabels, input.maxReferences);
        return {
          dialogue: s.dialogue.trim(),
          visualPrompt: s.visualPrompt.trim(),
          targetSeconds: s.targetSeconds,
          referenceLabels: refs.used,
          notice: refs.notice,
        };
      });
    } catch (e) {
      if (e instanceof z.ZodError || e instanceof SyntaxError) {
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`O modelo não devolveu um roteiro válido após 3 tentativas: ${reason}`);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run tests/modules/script-planner.test.ts`
Expected: 8 testes PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/script-planner.ts tests/modules/script-planner.test.ts
git commit -m "feat(modules): script planner with schema validation and retries"
```

---

### Task 4: Projetista de personagens (proposta)

**Files:**
- Create: `src/modules/character-designer.ts` (a parte do handler de imagem entra na Task 8)
- Test: `tests/modules/character-designer.test.ts`

- [ ] **Step 1: Escrever os testes**

`tests/modules/character-designer.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { proposeCharacters } from "@/modules/character-designer";
import { FakeTextModel } from "@/providers/fake";
import { ProviderError } from "@/providers/types";

const copy = "Maria flagra Carlos com a vizinha Helena e decide se vingar.";

describe("proposeCharacters", () => {
  it("devolve personagens da copy", async () => {
    const text = new FakeTextModel([
      { characters: [{ name: "Maria", description: "Mulher de 35 anos, cabelo cacheado" }, { name: "Carlos", description: "Homem de 40 anos, barba" }] },
    ]);
    const out = await proposeCharacters(text, copy);
    expect(out.map((c) => c.name)).toEqual(["Maria", "Carlos"]);
    expect(text.calls[0]!.task).toBe("characters");
    expect(text.calls[0]!.prompt).toContain("Maria flagra Carlos");
  });

  it("remove nomes repetidos ignorando caixa", async () => {
    const text = new FakeTextModel([
      { characters: [{ name: "Maria", description: "a" }, { name: "maria", description: "b" }] },
    ]);
    const out = await proposeCharacters(text, copy);
    expect(out).toHaveLength(1);
  });

  it("rejeita resposta sem personagens após 3 tentativas", async () => {
    const text = new FakeTextModel([{ characters: [] }, { characters: [] }, { characters: [] }]);
    await expect(proposeCharacters(text, copy)).rejects.toThrow(/após 3 tentativas/);
    expect(text.calls).toHaveLength(3);
  });

  it("tenta de novo quando a primeira resposta é inválida", async () => {
    const text = new FakeTextModel([
      { characters: [] },
      { characters: [{ name: "Maria", description: "Mulher de 35 anos" }] },
    ]);
    const out = await proposeCharacters(text, copy);
    expect(out).toEqual([{ name: "Maria", description: "Mulher de 35 anos" }]);
    expect(text.calls).toHaveLength(2);
  });

  it("não tenta de novo em erro que não é de validação", async () => {
    const boom = new ProviderError("falha", false);
    const text = new FakeTextModel(() => {
      throw boom;
    });
    await expect(proposeCharacters(text, copy)).rejects.toBe(boom);
    expect(text.calls).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/modules/character-designer.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `src/modules/character-designer.ts`**

```ts
import { z } from "zod";
import type { TextModel } from "@/providers/types";

const proposalSchema = z.object({
  characters: z
    .array(z.object({ name: z.string().min(1), description: z.string().min(1) }))
    .min(1)
    .max(6),
});

export type CharacterProposal = { name: string; description: string };

export async function proposeCharacters(text: TextModel, copy: string): Promise<CharacterProposal[]> {
  const system = [
    "Você é diretor de elenco de novelinhas curtas para TikTok Ads, escrevendo em português do Brasil.",
    "Liste os personagens que aparecem na história da copy (no máximo 6, só os que importam).",
    "Para cada um: name (nome curto, único) e description (aparência física detalhada: idade aproximada, rosto, cabelo, pele, roupa, expressão marcante).",
    "A descrição será usada para gerar uma foto de referência: seja concreto e visual, sem contar a história.",
  ].join("\n");
  const prompt = `COPY:\n${copy.trim()}`;
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { characters } = await text.generateJson({ task: "characters", system, prompt, schema: proposalSchema });
      const seen = new Set<string>();
      return characters
        .map((c) => ({ name: c.name.trim(), description: c.description.trim() }))
        .filter((c) => {
          const key = c.name.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    } catch (e) {
      if (e instanceof z.ZodError || e instanceof SyntaxError) {
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`O modelo não devolveu personagens válidos após 3 tentativas: ${reason}`);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run tests/modules/character-designer.test.ts`
Expected: 5 testes PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/character-designer.ts tests/modules/character-designer.test.ts
git commit -m "feat(modules): character proposal from copy"
```

---

### Task 5: Deps, erros de domínio, helpers de teste e serviço de projetos

**Files:**
- Create: `src/deps.ts`, `src/services/errors.ts`, `src/services/labels.ts`, `src/services/projects.ts`, `tests/helpers/deps.ts`, `tests/helpers/seed.ts`
- Test: `tests/services/projects.test.ts`

- [ ] **Step 1: Criar `src/deps.ts` e `src/services/errors.ts`**

`src/deps.ts`:
```ts
import type { Db } from "@/db/client";
import type { Providers } from "@/providers/types";
import type { Storage } from "@/storage/types";

export type Deps = {
  db: Db;
  storage: Storage;
  providers: Providers;
  config: { maxSceneReferences: number; sceneMaxSeconds: number };
};
```

`src/services/errors.ts`:
```ts
// Violação de regra de negócio. `status` é o código HTTP que a API devolve.
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
```

- [ ] **Step 2: Criar os helpers de teste**

`tests/helpers/deps.ts`:
```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Deps } from "@/deps";
import { makeTestClip } from "@/modules/ffmpeg";
import { FakeImageModel, FakeTextModel, FakeVideoModel } from "@/providers/fake";
import { FsStorage } from "@/storage/fs";
import { testDb } from "./db";

export async function makeClipBytes(seconds: number, opts: { audio?: boolean; width?: number; height?: number } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "clip-"));
  try {
    const file = path.join(dir, "c.mp4");
    await makeTestClip(file, seconds, opts);
    return await readFile(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function makeDeps(
  opts: {
    text?: ConstructorParameters<typeof FakeTextModel>[0];
    video?: Partial<ConstructorParameters<typeof FakeVideoModel>[0]>;
  } = {},
) {
  const dir = await mkdtemp(path.join(tmpdir(), "deps-"));
  const text = new FakeTextModel(opts.text ?? []);
  const image = new FakeImageModel();
  const video = new FakeVideoModel({ clip: opts.video?.clip ?? (await makeClipBytes(1)), ...opts.video });
  const deps: Deps = {
    db: testDb,
    storage: new FsStorage(dir),
    providers: { text, image, video },
    config: { maxSceneReferences: 3, sceneMaxSeconds: 8 },
  };
  return { deps, text, image, video, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
```

`tests/helpers/seed.ts`:
```ts
import type { Db } from "@/db/client";
import {
  assets, characters, sceneAttempts, sceneReferences, scenes, projects,
  type AssetKind, type AttemptStatus,
} from "@/db/schema";
import type { Mode, Stage } from "@/domain/stages";

export async function seedProject(
  db: Db,
  o: Partial<{ name: string; mode: Mode; copy: string; stage: Stage }> = {},
) {
  const [row] = await db
    .insert(projects)
    .values({ name: o.name ?? "Projeto", mode: o.mode ?? "ugc", copy: o.copy ?? "Copy de teste", stage: o.stage ?? "briefing" })
    .returning();
  return row!;
}

export async function seedAsset(
  db: Db,
  projectId: string,
  o: Partial<{ kind: AssetKind; label: string | null; storageKey: string; durationSeconds: number }> = {},
) {
  const [row] = await db
    .insert(assets)
    .values({
      projectId,
      kind: o.kind ?? "reference",
      label: o.label === undefined ? null : o.label,
      storageKey: o.storageKey ?? `projects/${projectId}/x-${Math.random().toString(36).slice(2)}.png`,
      mimeType: o.kind === "clip" || o.kind === "final" ? "video/mp4" : "image/png",
      durationSeconds: o.durationSeconds ?? null,
    })
    .returning();
  return row!;
}

export async function seedCharacter(
  db: Db,
  projectId: string,
  o: Partial<{ name: string; approved: boolean; imageStatus: "pending" | "ready" | "failed"; assetId: string | null }> = {},
) {
  const [row] = await db
    .insert(characters)
    .values({
      projectId,
      name: o.name ?? "Maria",
      description: "Mulher de 35 anos",
      approved: o.approved ?? false,
      imageStatus: o.imageStatus ?? "pending",
      assetId: o.assetId ?? null,
    })
    .returning();
  return row!;
}

export async function seedScene(
  db: Db,
  projectId: string,
  position: number,
  o: Partial<{ dialogue: string; visualPrompt: string; targetSeconds: number; assetIds: string[] }> = {},
) {
  const [row] = await db
    .insert(scenes)
    .values({
      projectId,
      position,
      dialogue: o.dialogue ?? `Fala ${position + 1}`,
      visualPrompt: o.visualPrompt ?? `Visual ${position + 1}`,
      targetSeconds: o.targetSeconds ?? 5,
    })
    .returning();
  for (const assetId of o.assetIds ?? []) {
    await db.insert(sceneReferences).values({ sceneId: row!.id, assetId });
  }
  return row!;
}

export async function seedAttempt(
  db: Db,
  sceneId: string,
  o: Partial<{ status: AttemptStatus; providerRef: string | null; clipAssetId: string | null; referenceAssetIds: string[]; prompt: string }> = {},
) {
  const [row] = await db
    .insert(sceneAttempts)
    .values({
      sceneId,
      prompt: o.prompt ?? "prompt",
      status: o.status ?? "queued",
      providerRef: o.providerRef ?? null,
      clipAssetId: o.clipAssetId ?? null,
      referenceAssetIds: o.referenceAssetIds ?? [],
    })
    .returning();
  return row!;
}
```

- [ ] **Step 3: Criar `src/services/labels.ts`**

```ts
import { and, eq, isNotNull, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { assets, characters } from "@/db/schema";
import { DomainError } from "./errors";

// Rótulos identificam imagens de referência e personagens no roteiro; precisam ser únicos no projeto.
export async function assertLabelFree(db: Db, projectId: string, label: string, exceptCharacterId?: string) {
  const key = label.trim().toLowerCase();
  const refs = await db
    .select({ label: assets.label })
    .from(assets)
    .where(and(eq(assets.projectId, projectId), eq(assets.kind, "reference"), isNotNull(assets.label)));
  const chars = await db
    .select({ name: characters.name })
    .from(characters)
    .where(
      exceptCharacterId
        ? and(eq(characters.projectId, projectId), ne(characters.id, exceptCharacterId))
        : eq(characters.projectId, projectId),
    );
  const taken = [...refs.map((r) => r.label!), ...chars.map((c) => c.name)];
  if (taken.some((t) => t.trim().toLowerCase() === key)) {
    throw new DomainError(`Já existe uma referência ou personagem chamado "${label.trim()}"`);
  }
}
```

- [ ] **Step 4: Escrever os testes do serviço de projetos**

`tests/services/projects.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { characters, projects, sceneAttempts } from "@/db/schema";
import { DomainError } from "@/services/errors";
import {
  addReference, advanceToReviewIfIdle, createProject, getSnapshot, removeReference, setStage, updateBriefing,
} from "@/services/projects";
import { makeDeps } from "../helpers/deps";
import { resetDb, testDb as db } from "../helpers/db";
import { seedAttempt, seedCharacter, seedProject, seedScene } from "../helpers/seed";

beforeEach(resetDb);
let cleanup: () => Promise<void>;
afterEach(async () => cleanup?.());

const png = Buffer.from("png");

describe("createProject / updateBriefing", () => {
  it("cria projeto em briefing e exige nome", async () => {
    const p = await createProject(db, { name: " Campanha X ", mode: "ugc", copy: "oi" });
    expect(p.name).toBe("Campanha X");
    expect(p.stage).toBe("briefing");
    await expect(createProject(db, { name: "  ", mode: "ugc" })).rejects.toBeInstanceOf(DomainError);
  });

  it("edita nome e copy só no briefing", async () => {
    const p = await seedProject(db, { stage: "script" });
    await expect(updateBriefing(db, p.id, { copy: "nova" })).rejects.toThrow(/briefing/);
    const b = await seedProject(db, { stage: "briefing" });
    expect((await updateBriefing(db, b.id, { copy: "nova" })).copy).toBe("nova");
  });
});

describe("referências", () => {
  it("salva imagem no storage e cria asset com rótulo", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db);
    const a = await addReference(m.deps, { projectId: p.id, label: "produto", bytes: png, mimeType: "image/png" });
    expect(a.kind).toBe("reference");
    expect(a.label).toBe("produto");
    expect((await m.deps.storage.get(a.storageKey)).toString()).toBe("png");
  });

  it("rejeita tipo de arquivo, rótulo vazio e rótulo repetido", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db);
    await expect(addReference(m.deps, { projectId: p.id, label: "x", bytes: png, mimeType: "text/plain" })).rejects.toThrow(/Formato/);
    await expect(addReference(m.deps, { projectId: p.id, label: " ", bytes: png, mimeType: "image/png" })).rejects.toThrow(/rótulo/);
    await addReference(m.deps, { projectId: p.id, label: "Produto", bytes: png, mimeType: "image/png" });
    await expect(addReference(m.deps, { projectId: p.id, label: "produto", bytes: png, mimeType: "image/jpeg" })).rejects.toThrow(/Já existe/);
  });

  it("remove referência no briefing", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db);
    const a = await addReference(m.deps, { projectId: p.id, label: "produto", bytes: png, mimeType: "image/png" });
    await removeReference(db, a.id);
    expect((await getSnapshot(db, p.id)).references).toHaveLength(0);
  });
});

describe("setStage", () => {
  it("exige copy para sair do briefing", async () => {
    const p = await seedProject(db, { mode: "novelinha", copy: "  " });
    await expect(setStage(db, p.id, "characters")).rejects.toThrow(/copy/);
  });

  it("ugc exige ao menos uma referência para ir ao roteiro", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "ugc" });
    await expect(setStage(db, p.id, "script")).rejects.toThrow(/referência/);
    await addReference(m.deps, { projectId: p.id, label: "produto", bytes: png, mimeType: "image/png" });
    expect((await setStage(db, p.id, "script")).stage).toBe("script");
  });

  it("novelinha exige todos os personagens aprovados para ir ao roteiro", async () => {
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    await expect(setStage(db, p.id, "script")).rejects.toThrow(/personagens/);
    await seedCharacter(db, p.id, { name: "A", approved: true, imageStatus: "ready" });
    await seedCharacter(db, p.id, { name: "B", approved: false, imageStatus: "ready" });
    await expect(setStage(db, p.id, "script")).rejects.toThrow(/personagens/);
    await db.update(characters).set({ approved: true });
    expect((await setStage(db, p.id, "script")).stage).toBe("script");
  });

  it("rejeita transição inválida", async () => {
    const p = await seedProject(db, { stage: "briefing" });
    await expect(setStage(db, p.id, "review")).rejects.toThrow(/Não é possível/);
  });

  it("permite voltar de review para script", async () => {
    const p = await seedProject(db, { stage: "review" });
    expect((await setStage(db, p.id, "script")).stage).toBe("script");
  });
});

describe("advanceToReviewIfIdle", () => {
  it("só avança de generating quando não há tentativas pendentes", async () => {
    const p = await seedProject(db, { stage: "generating" });
    const s = await seedScene(db, p.id, 0);
    const a = await seedAttempt(db, s.id, { status: "generating" });
    await advanceToReviewIfIdle(db, p.id);
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("generating");

    await db.update(sceneAttempts).set({ status: "done" }).where(eq(sceneAttempts.id, a.id));
    await advanceToReviewIfIdle(db, p.id);
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("review");
  });

  it("não mexe em projetos fora de generating", async () => {
    const p = await seedProject(db, { stage: "script" });
    await advanceToReviewIfIdle(db, p.id);
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("script");
  });
});

describe("getSnapshot", () => {
  it("devolve projeto, cenas ordenadas com tentativas e referências", async () => {
    const p = await seedProject(db, { stage: "review" });
    const s1 = await seedScene(db, p.id, 1);
    const s0 = await seedScene(db, p.id, 0);
    await seedAttempt(db, s0.id, { status: "done" });
    const snap = await getSnapshot(db, p.id);
    expect(snap.scenes.map((s) => s.id)).toEqual([s0.id, s1.id]);
    expect(snap.scenes[0]!.attempts).toHaveLength(1);
    expect(snap.finalAsset).toBeNull();
  });

  it("404 para projeto inexistente", async () => {
    await expect(getSnapshot(db, "00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 5: Rodar e ver falhar**

Run: `pnpm vitest run tests/services/projects.test.ts`
Expected: FAIL — `@/services/projects` não encontrado.

- [ ] **Step 6: Implementar `src/services/projects.ts`**

```ts
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import {
  assets, characters, projects, sceneAttempts, sceneReferences, scenes,
} from "@/db/schema";
import { canTransition, stagesFor, type Mode, type Stage } from "@/domain/stages";
import type { Deps } from "@/deps";
import { DomainError } from "./errors";
import { assertLabelFree } from "./labels";

export type Project = typeof projects.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Character = typeof characters.$inferSelect;
export type Scene = typeof scenes.$inferSelect;
export type SceneAttempt = typeof sceneAttempts.$inferSelect;
export type SceneView = Scene & { references: Asset[]; attempts: SceneAttempt[] };
export type Snapshot = {
  project: Project;
  references: Asset[];
  characters: Character[];
  scenes: SceneView[];
  finalAsset: Asset | null;
};

const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function createProject(db: Db, input: { name: string; mode: Mode; copy?: string }): Promise<Project> {
  const name = input.name.trim();
  if (!name) throw new DomainError("Dê um nome ao projeto");
  const [row] = await db.insert(projects).values({ name, mode: input.mode, copy: input.copy ?? "" }).returning();
  return row!;
}

export async function listProjects(db: Db): Promise<Project[]> {
  return db.select().from(projects).orderBy(desc(projects.updatedAt));
}

export async function getProject(db: DbOrTx, id: string): Promise<Project> {
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  if (!row) throw new DomainError("Projeto não encontrado", 404);
  return row;
}

export async function updateBriefing(db: Db, id: string, patch: { name?: string; copy?: string }): Promise<Project> {
  const project = await getProject(db, id);
  if (project.stage !== "briefing") throw new DomainError("A copy só pode ser editada na etapa de briefing");
  const set: Partial<Project> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new DomainError("Dê um nome ao projeto");
    set.name = patch.name.trim();
  }
  if (patch.copy !== undefined) set.copy = patch.copy;
  const [row] = await db.update(projects).set(set).where(eq(projects.id, id)).returning();
  return row!;
}

export async function addReference(
  deps: Pick<Deps, "db" | "storage">,
  input: { projectId: string; label: string; bytes: Buffer; mimeType: string },
): Promise<Asset> {
  const { db, storage } = deps;
  const project = await getProject(db, input.projectId);
  if (project.stage !== "briefing") throw new DomainError("Referências só podem ser alteradas no briefing");
  const ext = IMAGE_TYPES[input.mimeType];
  if (!ext) throw new DomainError("Formato de imagem não suportado (use PNG, JPEG ou WebP)");
  if (input.bytes.length > MAX_IMAGE_BYTES) throw new DomainError("Imagem maior que 10 MB");
  const label = input.label.trim();
  if (!label) throw new DomainError("Dê um rótulo à imagem (ex.: produto, pessoa)");
  await assertLabelFree(db, project.id, label);

  const key = `projects/${project.id}/references/${randomUUID()}.${ext}`;
  await storage.put(key, input.bytes, input.mimeType);
  const [row] = await db
    .insert(assets)
    .values({ projectId: project.id, kind: "reference", label, storageKey: key, mimeType: input.mimeType })
    .returning();
  return row!;
}

export async function removeReference(db: Db, assetId: string): Promise<void> {
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));
  if (!asset || asset.kind !== "reference") throw new DomainError("Referência não encontrada", 404);
  const project = await getProject(db, asset.projectId);
  if (project.stage !== "briefing") throw new DomainError("Referências só podem ser alteradas no briefing");
  await db.delete(assets).where(eq(assets.id, assetId));
}

async function assertCanEnter(db: DbOrTx, project: Project, target: Stage): Promise<void> {
  const order = stagesFor(project.mode);
  if (order.indexOf(target) <= order.indexOf(project.stage)) return; // voltar não tem pré-condição

  if (project.stage === "briefing") {
    if (!project.copy.trim()) throw new DomainError("Escreva a copy antes de continuar");
    if (project.mode === "ugc") {
      const refs = await db
        .select({ id: assets.id })
        .from(assets)
        .where(and(eq(assets.projectId, project.id), eq(assets.kind, "reference")));
      if (refs.length === 0) throw new DomainError("Envie ao menos uma imagem de referência (produto ou pessoa)");
    }
  }
  if (project.stage === "characters") {
    const chars = await db.select().from(characters).where(eq(characters.projectId, project.id));
    if (chars.length === 0 || chars.some((c) => !c.approved)) {
      throw new DomainError("Aprove todos os personagens antes de continuar");
    }
  }
}

// A troca é condicional à etapa lida (compare-and-set): duas chamadas concorrentes não passam juntas.
// Dentro de uma transação, o UPDATE também segura o lock da linha do projeto até o commit.
export async function setStage(db: DbOrTx, projectId: string, target: Stage): Promise<Project> {
  const project = await getProject(db, projectId);
  if (!canTransition(project.mode, project.stage, target)) {
    throw new DomainError(`Não é possível ir de "${project.stage}" para "${target}"`);
  }
  await assertCanEnter(db, project, target);
  const [row] = await db
    .update(projects)
    .set({ stage: target, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.stage, project.stage)))
    .returning();
  if (!row) throw new DomainError("O projeto mudou de etapa; atualize a página e tente de novo");
  return row;
}

// Chamado pelo worker ao terminar cada tentativa: quando nada mais está pendente, o projeto vai para revisão.
export async function advanceToReviewIfIdle(db: DbOrTx, projectId: string): Promise<void> {
  const project = await getProject(db, projectId);
  if (project.stage !== "generating") return;
  const pending = await db
    .select({ id: sceneAttempts.id })
    .from(sceneAttempts)
    .innerJoin(scenes, eq(sceneAttempts.sceneId, scenes.id))
    .where(and(eq(scenes.projectId, projectId), inArray(sceneAttempts.status, ["queued", "generating"])))
    .limit(1);
  if (pending.length === 0) {
    await db.update(projects).set({ stage: "review", updatedAt: new Date() }).where(eq(projects.id, projectId));
  }
}

export async function getSnapshot(db: Db, projectId: string): Promise<Snapshot> {
  const project = await getProject(db, projectId);
  const [allAssets, chars, sceneRows] = await Promise.all([
    db.select().from(assets).where(eq(assets.projectId, projectId)).orderBy(asc(assets.createdAt)),
    db.select().from(characters).where(eq(characters.projectId, projectId)).orderBy(asc(characters.position), asc(characters.createdAt)),
    db.select().from(scenes).where(eq(scenes.projectId, projectId)).orderBy(asc(scenes.position)),
  ]);
  const sceneIds = sceneRows.map((s) => s.id);
  const [attempts, links] = sceneIds.length
    ? await Promise.all([
        db.select().from(sceneAttempts).where(inArray(sceneAttempts.sceneId, sceneIds)).orderBy(asc(sceneAttempts.createdAt)),
        db.select().from(sceneReferences).where(inArray(sceneReferences.sceneId, sceneIds)),
      ])
    : [[], []];

  const assetById = new Map(allAssets.map((a) => [a.id, a]));
  const finals = allAssets.filter((a) => a.kind === "final");
  return {
    project,
    references: allAssets.filter((a) => a.kind === "reference"),
    characters: chars,
    scenes: sceneRows.map((s) => ({
      ...s,
      attempts: attempts.filter((a) => a.sceneId === s.id),
      references: links.filter((l) => l.sceneId === s.id).map((l) => assetById.get(l.assetId)!).filter(Boolean),
    })),
    finalAsset: finals.length ? finals[finals.length - 1]! : null,
  };
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm vitest run tests/services/projects.test.ts && pnpm typecheck`
Expected: todos PASS; typecheck limpo.

- [ ] **Step 8: Commit**

```bash
git add src/deps.ts src/services tests/helpers tests/services
git commit -m "feat(services): project service with stage guards, references and snapshot"
```

---

### Task 6: Serviço de cenas

**Files:**
- Create: `src/services/scenes.ts`
- Test: `tests/services/scenes.test.ts`

- [ ] **Step 1: Escrever os testes**

`tests/services/scenes.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { jobs, projects, sceneAttempts, sceneReferences, scenes } from "@/db/schema";
import { enqueue } from "@/queue/queue";
import {
  approveAttempt, generateAllScenes, planProjectScript, regenerateAllScenes, regenerateScene,
  startAssembly, totalSeconds, updateScene,
} from "@/services/scenes";
import { getSnapshot } from "@/services/projects";
import { makeDeps } from "../helpers/deps";
import { resetDb, testDb as db } from "../helpers/db";
import { seedAsset, seedAttempt, seedCharacter, seedProject, seedScene } from "../helpers/seed";

// enqueue delega ao real; os testes de atomicidade fazem a próxima chamada falhar (mockRejectedValueOnce).
vi.mock("@/queue/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/queue/queue")>();
  return { ...actual, enqueue: vi.fn(actual.enqueue) };
});

beforeEach(resetDb);
let cleanup: () => Promise<void>;
afterEach(async () => cleanup?.());

const draft = (labels: string[] = []) => ({
  scenes: [
    { dialogue: "Olha isso", visualPrompt: "Close no produto", targetSeconds: 5, referenceLabels: labels },
    { dialogue: "Funciona mesmo", visualPrompt: "Plano médio", targetSeconds: 6, referenceLabels: labels },
  ],
});

async function projectWithScript(mode: "ugc" | "novelinha" = "ugc") {
  const m = await makeDeps({ text: [draft(["produto"])] });
  cleanup = m.cleanup;
  const p = await seedProject(db, { mode, stage: "script" });
  const ref = await seedAsset(db, p.id, { kind: "reference", label: "produto" });
  await planProjectScript(m.deps, p.id);
  return { m, p, ref };
}

describe("planProjectScript", () => {
  it("cria cenas ordenadas ligadas aos assets pelos rótulos", async () => {
    const { p, ref } = await projectWithScript();
    const snap = await getSnapshot(db, p.id);
    expect(snap.scenes.map((s) => s.visualPrompt)).toEqual(["Close no produto", "Plano médio"]);
    expect(snap.scenes[0]!.references.map((r) => r.id)).toEqual([ref.id]);
  });

  it("inclui personagens aprovados como referências disponíveis", async () => {
    const m = await makeDeps({ text: [draft(["Maria"])] });
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "script" });
    const img = await seedAsset(db, p.id, { kind: "character", label: "Maria" });
    await seedCharacter(db, p.id, { name: "Maria", approved: true, imageStatus: "ready", assetId: img.id });
    await planProjectScript(m.deps, p.id);
    expect(m.text.calls[0]!.prompt).toContain("Maria");
    expect((await getSnapshot(db, p.id)).scenes[0]!.references.map((r) => r.id)).toEqual([img.id]);
  });

  it("substitui o roteiro anterior ao replanejar com feedback", async () => {
    const { m, p } = await projectWithScript();
    (m.text as unknown as { responses: unknown[] }).responses.push({ scenes: [draft().scenes[0]] });
    await planProjectScript(m.deps, p.id, "só uma cena");
    expect((await getSnapshot(db, p.id)).scenes).toHaveLength(1);
    expect(m.text.calls[1]!.prompt).toContain("só uma cena");
    expect(m.text.calls[1]!.prompt).toContain("Close no produto");
  });

  it("persiste o aviso e limita as referências quando o roteiro cita imagens demais", async () => {
    const labels = ["a", "b", "c", "d", "e"]; // maxSceneReferences = 3
    const m = await makeDeps({ text: [draft(labels)] });
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "ugc", stage: "script" });
    for (const l of labels) await seedAsset(db, p.id, { kind: "reference", label: l });
    await planProjectScript(m.deps, p.id);
    const rows = await db.select().from(scenes).where(eq(scenes.projectId, p.id));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.notice).toBeTruthy();
      const links = await db.select().from(sceneReferences).where(eq(sceneReferences.sceneId, row.id));
      expect(links).toHaveLength(3);
    }
  });

  it("só funciona na etapa de roteiro", async () => {
    const m = await makeDeps({ text: [draft()] });
    cleanup = m.cleanup;
    const p = await seedProject(db, { stage: "review" });
    await expect(planProjectScript(m.deps, p.id)).rejects.toThrow(/etapa de roteiro/);
  });
});

describe("updateScene", () => {
  it("edita e invalida a aprovação da cena", async () => {
    const p = await seedProject(db, { stage: "review" });
    const s = await seedScene(db, p.id, 0);
    const a = await seedAttempt(db, s.id, { status: "done" });
    await db.update(scenes).set({ approvedAttemptId: a.id }).where(eq(scenes.id, s.id));
    const out = await updateScene(db, s.id, { dialogue: "Nova fala" }, 8);
    expect(out.dialogue).toBe("Nova fala");
    expect(out.approvedAttemptId).toBeNull();
  });

  it("valida a duração pelo limite do provider", async () => {
    const p = await seedProject(db, { stage: "script" });
    const s = await seedScene(db, p.id, 0);
    await expect(updateScene(db, s.id, { targetSeconds: 9 }, 8)).rejects.toThrow(/entre 3 e 8/);
    await expect(updateScene(db, s.id, { visualPrompt: " " }, 8)).rejects.toThrow(/descrição visual/);
  });

  it("não edita em outras etapas", async () => {
    const p = await seedProject(db, { stage: "briefing" });
    const s = await seedScene(db, p.id, 0);
    await expect(updateScene(db, s.id, { dialogue: "x" }, 8)).rejects.toThrow(/etapa/);
  });
});

describe("generateAllScenes", () => {
  it("vai para generating, cria uma tentativa e um job por cena, com referências congeladas", async () => {
    const { m, p, ref } = await projectWithScript();
    await generateAllScenes(m.deps, p.id);
    const snap = await getSnapshot(db, p.id);
    expect(snap.project.stage).toBe("generating");
    expect(snap.scenes.every((s) => s.attempts.length === 1 && s.attempts[0]!.status === "queued")).toBe(true);
    expect(snap.scenes[0]!.attempts[0]!.referenceAssetIds).toEqual([ref.id]);
    expect(snap.scenes[0]!.attempts[0]!.prompt).toContain("UGC");
    const queued = await db.select().from(jobs);
    expect(queued).toHaveLength(2);
    expect(queued.every((j) => j.type === "generate_scene")).toBe(true);
  });

  it("chamadas concorrentes criam uma única tentativa e um único job por cena", async () => {
    const { m, p } = await projectWithScript();
    const results = await Promise.allSettled([generateAllScenes(m.deps, p.id), generateAllScenes(m.deps, p.id)]);
    // Comportamento escolhido: a segunda chamada é rejeitada com erro em português (não é no-op).
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason.message)).toMatch(/etapa/);
    const attempts = await db.select().from(sceneAttempts);
    expect(attempts).toHaveLength(2);
    expect(new Set(attempts.map((a) => a.sceneId)).size).toBe(2);
    expect(await db.select().from(jobs)).toHaveLength(2);
  });

  it("se o enqueue falha no meio, nada é gravado e o projeto continua em roteiro", async () => {
    const { m, p } = await projectWithScript();
    const real = await vi.importActual<typeof import("@/queue/queue")>("@/queue/queue");
    vi.mocked(enqueue)
      .mockImplementationOnce(real.enqueue)
      .mockRejectedValueOnce(new Error("fila indisponível"));
    await expect(generateAllScenes(m.deps, p.id)).rejects.toThrow(/fila indisponível/);
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("script");
    expect(await db.select().from(sceneAttempts)).toHaveLength(0);
    expect(await db.select().from(jobs)).toHaveLength(0);
  });

  it("exige ao menos uma cena", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { stage: "script" });
    await expect(generateAllScenes(m.deps, p.id)).rejects.toThrow(/cena/);
  });

  it("totalSeconds soma a duração alvo das cenas", async () => {
    const { p } = await projectWithScript();
    expect(totalSeconds((await getSnapshot(db, p.id)).scenes)).toBe(11);
  });
});

describe("regenerateScene / regenerateAllScenes", () => {
  async function inReview() {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { stage: "review" });
    const s0 = await seedScene(db, p.id, 0);
    const s1 = await seedScene(db, p.id, 1);
    const a0 = await seedAttempt(db, s0.id, { status: "done" });
    const a1 = await seedAttempt(db, s1.id, { status: "done" });
    await db.update(scenes).set({ approvedAttemptId: a0.id }).where(eq(scenes.id, s0.id));
    return { m, p, s0, s1, a0, a1 };
  }

  it("cria nova tentativa, mantém a anterior e remove a aprovação", async () => {
    const { m, s0 } = await inReview();
    await regenerateScene(m.deps, s0.id);
    const attempts = await db.select().from(sceneAttempts).where(eq(sceneAttempts.sceneId, s0.id));
    expect(attempts).toHaveLength(2);
    const [scene] = await db.select().from(scenes).where(eq(scenes.id, s0.id));
    expect(scene!.approvedAttemptId).toBeNull();
  });

  it("aceita prompt ajustado", async () => {
    const { m, s0 } = await inReview();
    await regenerateScene(m.deps, s0.id, "Prompt totalmente novo");
    const attempts = await db.select().from(sceneAttempts).where(eq(sceneAttempts.sceneId, s0.id));
    expect(attempts.map((a) => a.prompt)).toContain("Prompt totalmente novo");
  });

  it("não duplica geração em andamento", async () => {
    const { m, s0 } = await inReview();
    await regenerateScene(m.deps, s0.id);
    await expect(regenerateScene(m.deps, s0.id)).rejects.toThrow(/andamento/);
  });

  it("chamadas concorrentes na mesma cena criam uma só tentativa e um só job", async () => {
    const { m, s0 } = await inReview();
    // Comportamento escolhido: a segunda chamada é rejeitada com "geração em andamento".
    const results = await Promise.allSettled([regenerateScene(m.deps, s0.id), regenerateScene(m.deps, s0.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason.message)).toMatch(/andamento/);
    const attempts = await db.select().from(sceneAttempts).where(eq(sceneAttempts.sceneId, s0.id));
    expect(attempts.filter((a) => a.status === "queued")).toHaveLength(1);
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("regenerar todas concorrente não duplica tentativas", async () => {
    const { m, p } = await inReview();
    await Promise.all([regenerateAllScenes(m.deps, p.id), regenerateAllScenes(m.deps, p.id)]);
    expect(await db.select().from(sceneAttempts).where(eq(sceneAttempts.status, "queued"))).toHaveLength(2);
    expect(await db.select().from(jobs)).toHaveLength(2);
  });

  it("se o enqueue falha, não sobra tentativa órfã nem se perde a aprovação", async () => {
    const { m, s0, a0 } = await inReview();
    vi.mocked(enqueue).mockRejectedValueOnce(new Error("fila indisponível"));
    await expect(regenerateScene(m.deps, s0.id)).rejects.toThrow(/fila indisponível/);
    const attempts = await db.select().from(sceneAttempts).where(eq(sceneAttempts.sceneId, s0.id));
    expect(attempts.map((a) => a.id)).toEqual([a0.id]);
    const [scene] = await db.select().from(scenes).where(eq(scenes.id, s0.id));
    expect(scene!.approvedAttemptId).toBe(a0.id);
    expect(await db.select().from(jobs)).toHaveLength(0);
    await regenerateScene(m.deps, s0.id); // a cena não ficou bloqueada
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("regenerar todas cria uma tentativa por cena", async () => {
    const { m, p } = await inReview();
    await regenerateAllScenes(m.deps, p.id);
    expect(await db.select().from(jobs)).toHaveLength(2);
  });

  it("só na etapa de revisão", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { stage: "script" });
    const s = await seedScene(db, p.id, 0);
    await expect(regenerateScene(m.deps, s.id)).rejects.toThrow(/revisão/);
  });
});

describe("approveAttempt", () => {
  it("aprova tentativa pronta da própria cena", async () => {
    const p = await seedProject(db, { stage: "review" });
    const s = await seedScene(db, p.id, 0);
    const a = await seedAttempt(db, s.id, { status: "done" });
    expect((await approveAttempt(db, s.id, a.id)).approvedAttemptId).toBe(a.id);
  });

  it("rejeita tentativa não pronta ou de outra cena", async () => {
    const p = await seedProject(db, { stage: "review" });
    const s0 = await seedScene(db, p.id, 0);
    const s1 = await seedScene(db, p.id, 1);
    const pending = await seedAttempt(db, s0.id, { status: "generating" });
    const other = await seedAttempt(db, s1.id, { status: "done" });
    await expect(approveAttempt(db, s0.id, pending.id)).rejects.toThrow(/pronta/);
    await expect(approveAttempt(db, s0.id, other.id)).rejects.toThrow(/não pertence/);
  });
});

describe("startAssembly", () => {
  it("exige todas as cenas aprovadas", async () => {
    const p = await seedProject(db, { stage: "review" });
    const s0 = await seedScene(db, p.id, 0);
    await seedScene(db, p.id, 1);
    const a = await seedAttempt(db, s0.id, { status: "done" });
    await db.update(scenes).set({ approvedAttemptId: a.id }).where(eq(scenes.id, s0.id));
    await expect(startAssembly(db, p.id)).rejects.toThrow(/aprove todas/i);
  });

  it("vai para assembling e enfileira o job", async () => {
    const p = await seedProject(db, { stage: "review" });
    const s = await seedScene(db, p.id, 0);
    const a = await seedAttempt(db, s.id, { status: "done" });
    await db.update(scenes).set({ approvedAttemptId: a.id }).where(eq(scenes.id, s.id));
    await startAssembly(db, p.id);
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("assembling");
    const queued = await db.select().from(jobs);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.type).toBe("assemble");
    expect(queued[0]!.payload).toEqual({ projectId: p.id });
  });

  it("se o enqueue falha, o projeto não fica preso em assembling", async () => {
    const p = await seedProject(db, { stage: "review" });
    const s = await seedScene(db, p.id, 0);
    const a = await seedAttempt(db, s.id, { status: "done" });
    await db.update(scenes).set({ approvedAttemptId: a.id }).where(eq(scenes.id, s.id));
    vi.mocked(enqueue).mockRejectedValueOnce(new Error("fila indisponível"));
    await expect(startAssembly(db, p.id)).rejects.toThrow(/fila indisponível/);
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("review");
    expect(await db.select().from(jobs)).toHaveLength(0);
  });

  it("chamadas concorrentes enfileiram uma única montagem", async () => {
    const p = await seedProject(db, { stage: "review" });
    const s = await seedScene(db, p.id, 0);
    const a = await seedAttempt(db, s.id, { status: "done" });
    await db.update(scenes).set({ approvedAttemptId: a.id }).where(eq(scenes.id, s.id));
    const results = await Promise.allSettled([startAssembly(db, p.id), startAssembly(db, p.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(jobs)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/services/scenes.test.ts`
Expected: FAIL — `@/services/scenes` não encontrado.

- [ ] **Step 3: Implementar `src/services/scenes.ts`**

Atomicidade e concorrência: cada operação pública roda em `db.transaction`, com `enqueue` e `setStage` na MESMA transação (aceitam `DbOrTx`, ver Plano 1 `src/db/client.ts`). `regenerateScene`/`regenerateAllScenes` travam a linha da cena (`SELECT ... FOR UPDATE`) e reconferem "tentativa pendente"; `setStage` é compare-and-set sobre a etapa lida. Uma segunda chamada concorrente de `regenerateScene`, `generateAllScenes` ou `startAssembly` é **rejeitada** com `DomainError` em pt-BR; `regenerateAllScenes` concorrente vira no-op (pula cenas já em geração). Os testes de falha de fila usam `vi.mock("@/queue/queue")` com `enqueue` delegando ao real e `mockRejectedValueOnce`.

```ts
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import { assets, characters, sceneAttempts, sceneReferences, scenes } from "@/db/schema";
import type { Deps } from "@/deps";
import { buildScenePrompt } from "@/modules/prompt";
import { draftScript } from "@/modules/script-planner";
import { enqueue } from "@/queue/queue";
import { DomainError } from "./errors";
import { getProject, setStage, type Scene } from "./projects";

export function totalSeconds(list: { targetSeconds: number }[]): number {
  return list.reduce((sum, s) => sum + s.targetSeconds, 0);
}

// Imagens que podem ser citadas no roteiro: referências com rótulo + personagens aprovados.
export async function labeledAssets(db: Db, projectId: string): Promise<{ label: string; assetId: string }[]> {
  const refs = await db
    .select({ label: assets.label, assetId: assets.id })
    .from(assets)
    .where(and(eq(assets.projectId, projectId), eq(assets.kind, "reference"), isNotNull(assets.label)));
  const chars = await db
    .select({ name: characters.name, assetId: characters.assetId })
    .from(characters)
    .where(and(eq(characters.projectId, projectId), eq(characters.approved, true), isNotNull(characters.assetId)));
  return [
    ...refs.map((r) => ({ label: r.label!, assetId: r.assetId })),
    ...chars.map((c) => ({ label: c.name, assetId: c.assetId! })),
  ];
}

export async function planProjectScript(deps: Deps, projectId: string, feedback?: string): Promise<void> {
  const { db, providers, config } = deps;
  const project = await getProject(db, projectId);
  if (project.stage !== "script") throw new DomainError("O roteiro só pode ser planejado na etapa de roteiro");

  const labeled = await labeledAssets(db, projectId);
  const current = await db.select().from(scenes).where(eq(scenes.projectId, projectId)).orderBy(asc(scenes.position));

  const drafted = await draftScript(providers.text, {
    mode: project.mode,
    copy: project.copy,
    availableLabels: labeled.map((l) => l.label),
    maxReferences: config.maxSceneReferences,
    maxSeconds: config.sceneMaxSeconds,
    current: current.length ? current : undefined,
    feedback,
  });
  const assetByLabel = new Map(labeled.map((l) => [l.label.toLowerCase(), l.assetId]));

  await db.transaction(async (tx) => {
    await tx.delete(scenes).where(eq(scenes.projectId, projectId));
    for (const [position, d] of drafted.entries()) {
      const [scene] = await tx
        .insert(scenes)
        .values({
          projectId,
          position,
          dialogue: d.dialogue,
          visualPrompt: d.visualPrompt,
          targetSeconds: d.targetSeconds,
          notice: d.notice,
        })
        .returning();
      const links = d.referenceLabels
        .map((l) => assetByLabel.get(l.toLowerCase()))
        .filter((id): id is string => Boolean(id))
        .map((assetId) => ({ sceneId: scene!.id, assetId }));
      if (links.length) await tx.insert(sceneReferences).values(links);
    }
  });
}

async function getScene(db: Db, sceneId: string): Promise<Scene> {
  const [row] = await db.select().from(scenes).where(eq(scenes.id, sceneId));
  if (!row) throw new DomainError("Cena não encontrada", 404);
  return row;
}

export async function updateScene(
  db: Db,
  sceneId: string,
  patch: { dialogue?: string; visualPrompt?: string; targetSeconds?: number },
  maxSeconds: number,
): Promise<Scene> {
  const scene = await getScene(db, sceneId);
  const project = await getProject(db, scene.projectId);
  if (project.stage !== "script" && project.stage !== "review") {
    throw new DomainError("Cenas só podem ser editadas nas etapas de roteiro e revisão");
  }
  const set: Partial<Scene> = { approvedAttemptId: null }; // editar invalida o clipe aprovado desta cena
  if (patch.dialogue !== undefined) set.dialogue = patch.dialogue.trim();
  if (patch.visualPrompt !== undefined) {
    if (!patch.visualPrompt.trim()) throw new DomainError("A descrição visual não pode ficar vazia");
    set.visualPrompt = patch.visualPrompt.trim();
  }
  if (patch.targetSeconds !== undefined) {
    if (!Number.isInteger(patch.targetSeconds) || patch.targetSeconds < 3 || patch.targetSeconds > maxSeconds) {
      throw new DomainError(`A duração deve ser entre 3 e ${maxSeconds} segundos`);
    }
    set.targetSeconds = patch.targetSeconds;
  }
  const [row] = await db.update(scenes).set(set).where(eq(scenes.id, sceneId)).returning();
  return row!;
}

// Roda dentro da transação do chamador: attempt, job e invalidação da aprovação vão juntos ou nenhum vai.
async function createAttempt(tx: DbOrTx, scene: Scene, mode: "ugc" | "novelinha", promptOverride?: string) {
  const links = await tx.select().from(sceneReferences).where(eq(sceneReferences.sceneId, scene.id));
  const prompt = promptOverride?.trim() || buildScenePrompt(mode, scene);
  const [attempt] = await tx
    .insert(sceneAttempts)
    .values({ sceneId: scene.id, prompt, referenceAssetIds: links.map((l) => l.assetId) })
    .returning();
  await enqueue(tx, "generate_scene", { attemptId: attempt!.id });
  // O clipe aprovado anterior deixa de valer: o usuário precisa aprovar a nova versão (ou restaurar a antiga).
  await tx.update(scenes).set({ approvedAttemptId: null }).where(eq(scenes.id, scene.id));
  return attempt!;
}

// Trava a linha da cena até o fim da transação: serializa chamadas concorrentes sobre a mesma cena.
async function lockScene(tx: DbOrTx, sceneId: string): Promise<Scene> {
  const [row] = await tx.select().from(scenes).where(eq(scenes.id, sceneId)).for("update");
  if (!row) throw new DomainError("Cena não encontrada", 404);
  return row;
}

export async function generateAllScenes(deps: Deps, projectId: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const project = await getProject(tx, projectId);
    if (project.stage !== "script") throw new DomainError("Aprove o roteiro na etapa de roteiro antes de gerar");
    const list = await tx.select().from(scenes).where(eq(scenes.projectId, projectId)).orderBy(asc(scenes.position));
    if (list.length === 0) throw new DomainError("Gere o roteiro: não há nenhuma cena");
    // Compare-and-set da etapa: a segunda chamada concorrente espera o commit e falha aqui.
    await setStage(tx, projectId, "generating");
    for (const scene of list) await createAttempt(tx, scene, project.mode);
  });
}

async function hasPendingAttempt(db: DbOrTx, sceneId: string): Promise<boolean> {
  const rows = await db
    .select({ id: sceneAttempts.id })
    .from(sceneAttempts)
    .where(and(eq(sceneAttempts.sceneId, sceneId), inArray(sceneAttempts.status, ["queued", "generating"])))
    .limit(1);
  return rows.length > 0;
}

// Chamada concorrente na mesma cena: a segunda espera o lock, vê a tentativa pendente e é rejeitada.
export async function regenerateScene(deps: Deps, sceneId: string, promptOverride?: string) {
  return deps.db.transaction(async (tx) => {
    const scene = await lockScene(tx, sceneId);
    const project = await getProject(tx, scene.projectId);
    if (project.stage !== "review") throw new DomainError("Só é possível regerar cenas na etapa de revisão");
    if (await hasPendingAttempt(tx, sceneId)) throw new DomainError("Já há uma geração em andamento nesta cena");
    return createAttempt(tx, scene, project.mode, promptOverride);
  });
}

// Locks em ordem de posição (sem deadlock); cenas já em geração são puladas, então a chamada concorrente vira no-op.
export async function regenerateAllScenes(deps: Deps, projectId: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const project = await getProject(tx, projectId);
    if (project.stage !== "review") throw new DomainError("Só é possível regerar cenas na etapa de revisão");
    const list = await tx
      .select()
      .from(scenes)
      .where(eq(scenes.projectId, projectId))
      .orderBy(asc(scenes.position))
      .for("update");
    for (const scene of list) {
      if (!(await hasPendingAttempt(tx, scene.id))) await createAttempt(tx, scene, project.mode);
    }
  });
}

export async function approveAttempt(db: Db, sceneId: string, attemptId: string): Promise<Scene> {
  const scene = await getScene(db, sceneId);
  const project = await getProject(db, scene.projectId);
  if (project.stage !== "review") throw new DomainError("Só é possível aprovar cenas na etapa de revisão");
  const [attempt] = await db.select().from(sceneAttempts).where(eq(sceneAttempts.id, attemptId));
  if (!attempt) throw new DomainError("Tentativa não encontrada", 404);
  if (attempt.sceneId !== sceneId) throw new DomainError("Esta tentativa não pertence à cena");
  if (attempt.status !== "done") throw new DomainError("Só é possível aprovar uma geração pronta");
  const [row] = await db.update(scenes).set({ approvedAttemptId: attemptId }).where(eq(scenes.id, sceneId)).returning();
  return row!;
}

export async function startAssembly(db: Db, projectId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const project = await getProject(tx, projectId);
    if (project.stage !== "review") throw new DomainError("A montagem só começa na etapa de revisão");
    const list = await tx.select().from(scenes).where(eq(scenes.projectId, projectId));
    if (list.length === 0 || list.some((s) => !s.approvedAttemptId)) {
      throw new DomainError("Aprove todas as cenas antes de montar o vídeo");
    }
    // Etapa e job na mesma transação: se o enqueue falha, o projeto volta para review.
    await setStage(tx, projectId, "assembling");
    await enqueue(tx, "assemble", { projectId });
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run tests/services/scenes.test.ts && pnpm typecheck`
Expected: todos PASS; typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add src/services/scenes.ts tests/services/scenes.test.ts
git commit -m "feat(services): script planning, scene attempts, approval and assembly start"
```

---

### Task 7: Handler de geração de cena

**Files:**
- Create: `src/modules/scene-generator.ts`
- Test: `tests/modules/scene-generator.test.ts`

- [ ] **Step 1: Escrever os testes**

`tests/modules/scene-generator.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { assets, projects, sceneAttempts } from "@/db/schema";
import { handleGenerateScene, onGenerateSceneDead } from "@/modules/scene-generator";
import { PermanentError, RetryLater } from "@/queue/errors";
import { ProviderError } from "@/providers/types";
import { makeDeps } from "../helpers/deps";
import { resetDb, testDb as db } from "../helpers/db";
import { seedAsset, seedAttempt, seedProject, seedScene } from "../helpers/seed";

beforeEach(resetDb);
let cleanup: () => Promise<void>;
afterEach(async () => cleanup?.());

const attemptOf = async (id: string) => (await db.select().from(sceneAttempts).where(eq(sceneAttempts.id, id)))[0]!;

async function setup(opts: Parameters<typeof makeDeps>[0] = {}) {
  const m = await makeDeps(opts);
  cleanup = m.cleanup;
  const p = await seedProject(db, { stage: "generating" });
  const ref = await seedAsset(db, p.id, { kind: "reference", label: "produto", storageKey: "ref/produto.png" });
  await m.deps.storage.put("ref/produto.png", Buffer.from("img"), "image/png");
  const scene = await seedScene(db, p.id, 0, { assetIds: [ref.id] });
  const attempt = await seedAttempt(db, scene.id, { referenceAssetIds: [ref.id], prompt: "prompt da cena" });
  return { m, p, scene, attempt, ref };
}

describe("handleGenerateScene", () => {
  it("inicia a geração com prompt e referências e pede para voltar enquanto pendente", async () => {
    const { m, attempt } = await setup({ video: { pendingPolls: 1 } });
    await expect(handleGenerateScene(m.deps, { attemptId: attempt.id })).rejects.toBeInstanceOf(RetryLater);
    expect(m.video.starts).toHaveLength(1);
    expect(m.video.starts[0]!.prompt).toBe("prompt da cena");
    expect(m.video.starts[0]!.references[0]).toMatchObject({ label: "produto", mimeType: "image/png" });
    const a = await attemptOf(attempt.id);
    expect(a.status).toBe("generating");
    expect(a.providerRef).toBe("fake-1");
  });

  it("retoma pelo providerRef salvo, sem chamar start de novo (não paga duas vezes)", async () => {
    const { m, attempt } = await setup({ video: { pendingPolls: 1 } });
    await expect(handleGenerateScene(m.deps, { attemptId: attempt.id })).rejects.toBeInstanceOf(RetryLater);
    await handleGenerateScene(m.deps, { attemptId: attempt.id });
    expect(m.video.starts).toHaveLength(1);
    expect((await attemptOf(attempt.id)).status).toBe("done");
  });

  it("ao concluir: salva o clipe, cria asset com duração medida e avança o projeto para revisão", async () => {
    const { m, p, attempt } = await setup();
    await handleGenerateScene(m.deps, { attemptId: attempt.id });
    const a = await attemptOf(attempt.id);
    expect(a.status).toBe("done");
    const [clip] = await db.select().from(assets).where(eq(assets.id, a.clipAssetId!));
    expect(clip!.kind).toBe("clip");
    expect(clip!.durationSeconds).toBeGreaterThan(0.8);
    expect((await m.deps.storage.get(clip!.storageKey)).length).toBeGreaterThan(1000);
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("review");
  });

  it("bloqueio do provider (não retryable) marca blocked com o motivo, sem retry", async () => {
    const { m, p, attempt } = await setup({ video: { failure: { reason: "Bloqueado pelo filtro de segurança", retryable: false } } });
    await handleGenerateScene(m.deps, { attemptId: attempt.id });
    const a = await attemptOf(attempt.id);
    expect(a.status).toBe("blocked");
    expect(a.error).toContain("filtro de segurança");
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("review");
  });

  it("falha retryable limpa o providerRef e relança para o runner reagendar", async () => {
    const { m, attempt } = await setup({ video: { failure: { reason: "instável", retryable: true } } });
    await expect(handleGenerateScene(m.deps, { attemptId: attempt.id })).rejects.toMatchObject({ retryable: true });
    expect((await attemptOf(attempt.id)).providerRef).toBeNull();
  });

  it("erro não-retryable no start também vira blocked", async () => {
    const { m, attempt } = await setup();
    m.video.start = async () => {
      throw new ProviderError("conteúdo recusado", false);
    };
    await handleGenerateScene(m.deps, { attemptId: attempt.id });
    expect((await attemptOf(attempt.id)).status).toBe("blocked");
  });

  it("é idempotente para tentativas já finalizadas", async () => {
    const { m, attempt } = await setup();
    await handleGenerateScene(m.deps, { attemptId: attempt.id });
    await handleGenerateScene(m.deps, { attemptId: attempt.id });
    expect(m.video.starts).toHaveLength(1);
  });

  it("tentativa inexistente é erro permanente", async () => {
    const { m } = await setup();
    await expect(
      handleGenerateScene(m.deps, { attemptId: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toBeInstanceOf(PermanentError);
  });
});

describe("onGenerateSceneDead", () => {
  it("marca a tentativa como failed e avança o projeto", async () => {
    const { m, p, attempt } = await setup();
    await onGenerateSceneDead(m.deps, { attemptId: attempt.id }, "rede caiu");
    const a = await attemptOf(attempt.id);
    expect(a.status).toBe("failed");
    expect(a.error).toBe("rede caiu");
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("review");
  });
});

describe("referência removida (carry-forward A)", () => {
  it("falha com mensagem clara em pt-BR, sem chamar o provider, e avança o projeto", async () => {
    const { m, p, attempt, ref } = await setup();
    await db.delete(assets).where(eq(assets.id, ref.id));
    await handleGenerateScene(m.deps, { attemptId: attempt.id });
    expect(m.video.starts).toHaveLength(0);
    const a = await attemptOf(attempt.id);
    expect(a.status).toBe("failed");
    expect(a.error).toContain("referência");
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("review");
  });
});

describe("persistência do providerRef (carry-forward C)", () => {
  it("salva o providerRef logo após start(), antes do primeiro poll", async () => {
    const { m, attempt } = await setup();
    let seen: string | null = "não lido";
    const poll = m.video.poll.bind(m.video);
    m.video.poll = async (h) => {
      seen = (await attemptOf(attempt.id)).providerRef;
      return poll(h);
    };
    await handleGenerateScene(m.deps, { attemptId: attempt.id });
    expect(seen).toBe("fake-1");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/modules/scene-generator.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `src/modules/scene-generator.ts`**

```ts
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { assets, sceneAttempts, scenes, type AttemptStatus } from "@/db/schema";
import type { Deps } from "@/deps";
import { PermanentError, RetryLater } from "@/queue/errors";
import { ProviderError, type ReferenceImage } from "@/providers/types";
import { advanceToReviewIfIdle } from "@/services/projects";
import { probe, withTempDir } from "./ffmpeg";

const POLL_DELAY_MS = 10_000;
const TERMINAL: AttemptStatus[] = ["done", "failed", "blocked"];

type AttemptPatch = Partial<typeof sceneAttempts.$inferInsert>;

async function patchAttempt(db: DbOrTx, id: string, patch: AttemptPatch) {
  await db.update(sceneAttempts).set({ ...patch, updatedAt: new Date() }).where(eq(sceneAttempts.id, id));
}

class MissingReferenceError extends Error {}

async function loadReferences(deps: Deps, assetIds: string[]): Promise<ReferenceImage[]> {
  if (assetIds.length === 0) return [];
  const rows = await deps.db.select().from(assets).where(inArray(assets.id, assetIds));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: ReferenceImage[] = [];
  for (const id of assetIds) {
    const asset = byId.get(id);
    // scene_attempts.reference_asset_ids não tem FK: o usuário pode ter removido a imagem no briefing.
    if (!asset) throw new MissingReferenceError("Uma imagem de referência desta cena foi removida. Gere a cena novamente.");
    out.push({
      bytes: await deps.storage.get(asset.storageKey),
      mimeType: asset.mimeType,
      label: asset.label ?? "referência",
    });
  }
  return out;
}

// Marca a tentativa como finalizada e, se não sobrou nada em andamento, avança o projeto — tudo atômico.
async function finish(deps: Deps, projectId: string, attemptId: string, patch: AttemptPatch) {
  await deps.db.transaction(async (tx) => {
    await patchAttempt(tx, attemptId, patch);
    await advanceToReviewIfIdle(tx, projectId);
  });
}

export async function handleGenerateScene(deps: Deps, payload: { attemptId: string }): Promise<void> {
  const { db, storage, providers } = deps;
  const [attempt] = await db.select().from(sceneAttempts).where(eq(sceneAttempts.id, payload.attemptId));
  if (!attempt) throw new PermanentError("Tentativa não encontrada");
  if (TERMINAL.includes(attempt.status)) return;
  const [scene] = await db.select().from(scenes).where(eq(scenes.id, attempt.sceneId));
  if (!scene) throw new PermanentError("Cena não encontrada");

  try {
    let providerRef = attempt.providerRef;
    if (!providerRef) {
      const references = await loadReferences(deps, attempt.referenceAssetIds);
      const started = await providers.video.start({
        prompt: attempt.prompt,
        references,
        targetSeconds: scene.targetSeconds,
      });
      providerRef = started.providerRef;
      // Persistir imediatamente, antes de qualquer espera: se o worker reiniciar, o polling continua daqui.
      await patchAttempt(db, attempt.id, { providerRef, status: "generating" });
    }

    const result = await providers.video.poll({ providerRef });
    if (result.state === "pending") throw new RetryLater(POLL_DELAY_MS);

    if (result.state === "failed") {
      if (result.retryable) {
        await patchAttempt(db, attempt.id, { providerRef: null });
        throw new ProviderError(result.reason, true);
      }
      await finish(deps, scene.projectId, attempt.id, { status: "blocked", error: result.reason });
      return;
    }

    const measured = await withTempDir(async (dir) => {
      const file = path.join(dir, "clip.mp4");
      await writeFile(file, result.bytes);
      return probe(file);
    });
    const key = `projects/${scene.projectId}/clips/${attempt.id}.mp4`;
    await storage.put(key, result.bytes, "video/mp4");
    // Asset + status + avanço de etapa numa transação: reexecutar não duplica clipe.
    await db.transaction(async (tx) => {
      const [clip] = await tx
        .insert(assets)
        .values({
          projectId: scene.projectId,
          kind: "clip",
          storageKey: key,
          mimeType: "video/mp4",
          durationSeconds: measured.durationSeconds,
        })
        .returning();
      await patchAttempt(tx, attempt.id, { status: "done", clipAssetId: clip!.id, error: null });
      await advanceToReviewIfIdle(tx, scene.projectId);
    });
  } catch (e) {
    if (e instanceof MissingReferenceError) {
      await finish(deps, scene.projectId, attempt.id, { status: "failed", error: e.message });
      return;
    }
    if (e instanceof ProviderError && !e.retryable) {
      await finish(deps, scene.projectId, attempt.id, { status: "blocked", error: e.message });
      return;
    }
    throw e;
  }
}

// Chamado pelo runner quando o job esgotou as tentativas (ou foi recuperado já morto).
export async function onGenerateSceneDead(deps: Deps, payload: { attemptId: string }, message: string): Promise<void> {
  const { db } = deps;
  const [attempt] = await db.select().from(sceneAttempts).where(eq(sceneAttempts.id, payload.attemptId));
  if (!attempt || TERMINAL.includes(attempt.status)) return;
  const [scene] = await db.select().from(scenes).where(eq(scenes.id, attempt.sceneId));
  if (!scene) {
    await patchAttempt(db, attempt.id, { status: "failed", error: message });
    return;
  }
  await finish(deps, scene.projectId, attempt.id, { status: "failed", error: message });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run tests/modules/scene-generator.test.ts && pnpm typecheck`
Expected: 11 testes PASS; typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add src/modules/scene-generator.ts src/services/projects.ts tests/modules/scene-generator.test.ts
git commit -m "feat(modules): resumable scene generation handler"
```

---

### Task 8: Serviço e handler de personagens

**Files:**
- Modify: `src/modules/character-designer.ts` (acrescentar handler)
- Create: `src/services/characters.ts`
- Test: `tests/services/characters.test.ts`

- [ ] **Step 1: Escrever os testes**

`tests/services/characters.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { assets, characters, jobs } from "@/db/schema";
import { handleGenerateCharacter, onGenerateCharacterDead } from "@/modules/character-designer";
import {
  addCharacter, approveCharacter, proposeProjectCharacters, regenerateCharacterImage, removeCharacter, updateCharacter,
} from "@/services/characters";
import { makeDeps } from "../helpers/deps";
import { resetDb, testDb as db } from "../helpers/db";
import { seedAsset, seedCharacter, seedProject } from "../helpers/seed";

beforeEach(resetDb);
let cleanup: () => Promise<void>;
afterEach(async () => cleanup?.());

const charOf = async (id: string) => (await db.select().from(characters).where(eq(characters.id, id)))[0]!;

describe("proposeProjectCharacters", () => {
  it("cria personagens pendentes e enfileira uma imagem por personagem", async () => {
    const m = await makeDeps({
      text: [{ characters: [{ name: "Maria", description: "35 anos" }, { name: "Carlos", description: "40 anos" }] }],
    });
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    await proposeProjectCharacters(m.deps, p.id);
    const list = await db.select().from(characters).where(eq(characters.projectId, p.id));
    expect(list.map((c) => c.name).sort()).toEqual(["Carlos", "Maria"]);
    expect(list.every((c) => c.imageStatus === "pending" && !c.approved)).toBe(true);
    const queued = await db.select().from(jobs);
    expect(queued.map((j) => j.type)).toEqual(["generate_character", "generate_character"]);
  });

  it("só na etapa de personagens e só em novelinha", async () => {
    const m = await makeDeps({ text: [] });
    cleanup = m.cleanup;
    const a = await seedProject(db, { mode: "ugc", stage: "briefing" });
    await expect(proposeProjectCharacters(m.deps, a.id)).rejects.toThrow(/personagens/);
  });
});

describe("CRUD", () => {
  it("addCharacter valida rótulo único e enfileira imagem", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    await addCharacter(m.deps, p.id, { name: "Helena", description: "vizinha, 30 anos" });
    await expect(addCharacter(m.deps, p.id, { name: "helena", description: "outra" })).rejects.toThrow(/Já existe/);
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("updateCharacter desaprova e regera a imagem quando a descrição muda", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const c = await seedCharacter(db, p.id, { approved: true, imageStatus: "ready" });
    await updateCharacter(m.deps, c.id, { description: "cabelo loiro curto" });
    const after = await charOf(c.id);
    expect(after.approved).toBe(false);
    expect(after.imageStatus).toBe("pending");
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("updateCharacter só do nome não regera a imagem, mas desaprova", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const c = await seedCharacter(db, p.id, { approved: true, imageStatus: "ready" });
    await updateCharacter(m.deps, c.id, { name: "Mariana" });
    expect((await charOf(c.id)).name).toBe("Mariana");
    expect(await db.select().from(jobs)).toHaveLength(0);
  });

  it("approveCharacter exige imagem pronta", async () => {
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const pending = await seedCharacter(db, p.id, { name: "A", imageStatus: "pending" });
    await expect(approveCharacter(db, pending.id)).rejects.toThrow(/imagem/);
    const img = await seedAsset(db, p.id, { kind: "character", label: "B" });
    const ready = await seedCharacter(db, p.id, { name: "B", imageStatus: "ready", assetId: img.id });
    expect((await approveCharacter(db, ready.id)).approved).toBe(true);
  });

  it("removeCharacter apaga personagem e a imagem", async () => {
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const img = await seedAsset(db, p.id, { kind: "character", label: "A" });
    const c = await seedCharacter(db, p.id, { name: "A", imageStatus: "ready", assetId: img.id });
    await removeCharacter(db, c.id);
    expect(await db.select().from(characters)).toHaveLength(0);
    expect(await db.select().from(assets).where(eq(assets.id, img.id))).toHaveLength(0);
  });

  it("regenerateCharacterImage volta para pending e enfileira", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const c = await seedCharacter(db, p.id, { approved: true, imageStatus: "ready" });
    await regenerateCharacterImage(m.deps, c.id);
    expect((await charOf(c.id)).imageStatus).toBe("pending");
    expect(await db.select().from(jobs)).toHaveLength(1);
  });
});

describe("handleGenerateCharacter", () => {
  it("gera a imagem, salva no storage e marca ready", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const c = await seedCharacter(db, p.id, { name: "Maria" });
    await handleGenerateCharacter(m.deps, { characterId: c.id });
    const after = await charOf(c.id);
    expect(after.imageStatus).toBe("ready");
    const [asset] = await db.select().from(assets).where(eq(assets.id, after.assetId!));
    expect(asset).toMatchObject({ kind: "character", label: "Maria", mimeType: "image/png" });
    expect((await m.deps.storage.get(asset!.storageKey)).length).toBeGreaterThan(0);
    expect(m.image.calls[0]!.prompt).toContain("Maria");
  });

  it("substitui a imagem anterior ao regerar", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const old = await seedAsset(db, p.id, { kind: "character", label: "Maria" });
    const c = await seedCharacter(db, p.id, { name: "Maria", imageStatus: "pending", assetId: old.id });
    await handleGenerateCharacter(m.deps, { characterId: c.id });
    expect(await db.select().from(assets).where(eq(assets.id, old.id))).toHaveLength(0);
    expect((await charOf(c.id)).assetId).not.toBe(old.id);
  });

  it("onGenerateCharacterDead marca failed com o motivo", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const c = await seedCharacter(db, p.id);
    await onGenerateCharacterDead(m.deps, { characterId: c.id }, "cota esgotada");
    expect(await charOf(c.id)).toMatchObject({ imageStatus: "failed", imageError: "cota esgotada" });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/services/characters.test.ts`
Expected: FAIL — módulos não encontrados.

- [ ] **Step 3: Acrescentar o handler em `src/modules/character-designer.ts`**

Substituir os imports no topo do arquivo por:
```ts
import { eq } from "drizzle-orm";
import { z } from "zod";
import { assets, characters } from "@/db/schema";
import type { Deps } from "@/deps";
import { PermanentError } from "@/queue/errors";
import { ProviderError, type TextModel } from "@/providers/types";
import { buildCharacterImagePrompt } from "./prompt";
```
E acrescentar ao final do arquivo:
```ts
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function handleGenerateCharacter(deps: Deps, payload: { characterId: string }): Promise<void> {
  const { db, storage, providers } = deps;
  const [character] = await db.select().from(characters).where(eq(characters.id, payload.characterId));
  if (!character) throw new PermanentError("Personagem não encontrado");

  let image;
  try {
    image = await providers.image.generateImage({
      prompt: buildCharacterImagePrompt(character),
    });
  } catch (e) {
    if (e instanceof ProviderError && !e.retryable) {
      await db
        .update(characters)
        .set({ imageStatus: "failed", imageError: e.message })
        .where(eq(characters.id, character.id));
      return;
    }
    throw e;
  }

  const key = `projects/${character.projectId}/characters/${character.id}-${Date.now()}.${EXT[image.mimeType] ?? "png"}`;
  await storage.put(key, image.bytes, image.mimeType);
  const [asset] = await db
    .insert(assets)
    .values({
      projectId: character.projectId,
      kind: "character",
      label: character.name,
      storageKey: key,
      mimeType: image.mimeType,
    })
    .returning();
  await db
    .update(characters)
    .set({ assetId: asset!.id, imageStatus: "ready", imageError: null })
    .where(eq(characters.id, character.id));
  if (character.assetId) await db.delete(assets).where(eq(assets.id, character.assetId));
}

export async function onGenerateCharacterDead(deps: Deps, payload: { characterId: string }, message: string) {
  await deps.db
    .update(characters)
    .set({ imageStatus: "failed", imageError: message })
    .where(eq(characters.id, payload.characterId));
}
```

- [ ] **Step 4: Implementar `src/services/characters.ts`**

```ts
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { assets, characters } from "@/db/schema";
import type { Deps } from "@/deps";
import { proposeCharacters } from "@/modules/character-designer";
import { enqueue } from "@/queue/queue";
import { DomainError } from "./errors";
import { assertLabelFree } from "./labels";
import { getProject, type Character } from "./projects";

async function assertCharactersStage(db: Db, projectId: string) {
  const project = await getProject(db, projectId);
  if (project.mode !== "novelinha" || project.stage !== "characters") {
    throw new DomainError("Personagens só existem na etapa de personagens de uma novelinha");
  }
  return project;
}

async function getCharacter(db: Db, id: string): Promise<Character> {
  const [row] = await db.select().from(characters).where(eq(characters.id, id));
  if (!row) throw new DomainError("Personagem não encontrado", 404);
  return row;
}

async function queueImage(db: Db, characterId: string) {
  await db
    .update(characters)
    .set({ imageStatus: "pending", imageError: null, approved: false })
    .where(eq(characters.id, characterId));
  await enqueue(db, "generate_character", { characterId });
}

export async function proposeProjectCharacters(deps: Deps, projectId: string): Promise<void> {
  const { db, providers } = deps;
  const project = await assertCharactersStage(db, projectId);
  const proposals = await proposeCharacters(providers.text, project.copy);

  const old = await db.select().from(characters).where(eq(characters.projectId, projectId));
  await db.delete(characters).where(eq(characters.projectId, projectId));
  for (const c of old) if (c.assetId) await db.delete(assets).where(eq(assets.id, c.assetId));

  for (const [position, p] of proposals.entries()) {
    const [row] = await db
      .insert(characters)
      .values({ projectId, name: p.name, description: p.description, position })
      .returning();
    await enqueue(db, "generate_character", { characterId: row!.id });
  }
}

export async function addCharacter(
  deps: Deps,
  projectId: string,
  input: { name: string; description: string },
): Promise<Character> {
  const { db } = deps;
  await assertCharactersStage(db, projectId);
  const name = input.name.trim();
  if (!name || !input.description.trim()) throw new DomainError("Informe nome e descrição do personagem");
  await assertLabelFree(db, projectId, name);
  const existing = await db.select().from(characters).where(eq(characters.projectId, projectId)).orderBy(asc(characters.position));
  const [row] = await db
    .insert(characters)
    .values({ projectId, name, description: input.description.trim(), position: existing.length })
    .returning();
  await enqueue(db, "generate_character", { characterId: row!.id });
  return row!;
}

export async function updateCharacter(
  deps: Deps,
  id: string,
  patch: { name?: string; description?: string },
): Promise<Character> {
  const { db } = deps;
  const current = await getCharacter(db, id);
  await assertCharactersStage(db, current.projectId);
  const set: Partial<Character> = { approved: false };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new DomainError("O nome não pode ficar vazio");
    await assertLabelFree(db, current.projectId, name, id);
    set.name = name;
  }
  const descriptionChanged = patch.description !== undefined && patch.description.trim() !== current.description;
  if (patch.description !== undefined) {
    if (!patch.description.trim()) throw new DomainError("A descrição não pode ficar vazia");
    set.description = patch.description.trim();
  }
  const [row] = await db.update(characters).set(set).where(eq(characters.id, id)).returning();
  if (descriptionChanged) await queueImage(db, id);
  return row!;
}

export async function regenerateCharacterImage(deps: Deps, id: string): Promise<void> {
  const current = await getCharacter(deps.db, id);
  await assertCharactersStage(deps.db, current.projectId);
  await queueImage(deps.db, id);
}

export async function approveCharacter(db: Db, id: string): Promise<Character> {
  const current = await getCharacter(db, id);
  await assertCharactersStage(db, current.projectId);
  if (current.imageStatus !== "ready" || !current.assetId) {
    throw new DomainError("Espere a imagem do personagem ficar pronta para aprovar");
  }
  const [row] = await db.update(characters).set({ approved: true }).where(eq(characters.id, id)).returning();
  return row!;
}

export async function removeCharacter(db: Db, id: string): Promise<void> {
  const current = await getCharacter(db, id);
  await assertCharactersStage(db, current.projectId);
  await db.delete(characters).where(and(eq(characters.id, id)));
  if (current.assetId) await db.delete(assets).where(eq(assets.id, current.assetId));
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm vitest run tests/services/characters.test.ts tests/modules/character-designer.test.ts && pnpm typecheck`
Expected: todos PASS; typecheck limpo.

- [ ] **Step 6: Commit**

```bash
git add src/modules/character-designer.ts src/services/characters.ts tests/services/characters.test.ts
git commit -m "feat: character service and image generation handler"
```

---

### Task 9: Montador de vídeo

**Files:**
- Create: `src/modules/assembler.ts`
- Test: `tests/modules/assembler.test.ts`

- [ ] **Step 1: Escrever os testes**

`tests/modules/assembler.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { assets, projects, scenes } from "@/db/schema";
import { concatClips, handleAssemble, onAssembleDead } from "@/modules/assembler";
import { makeTestClip, probe, withTempDir } from "@/modules/ffmpeg";
import { PermanentError } from "@/queue/errors";
import { makeClipBytes, makeDeps } from "../helpers/deps";
import { resetDb, testDb as db } from "../helpers/db";
import { seedAsset, seedAttempt, seedProject, seedScene } from "../helpers/seed";

beforeEach(resetDb);
let cleanup: () => Promise<void>;
afterEach(async () => cleanup?.());

describe("concatClips", () => {
  it("junta clipes de tamanhos diferentes em 720x1280 e soma as durações", async () => {
    await withTempDir(async (dir) => {
      const a = path.join(dir, "a.mp4");
      const b = path.join(dir, "b.mp4");
      const c = path.join(dir, "c.mp4");
      await makeTestClip(a, 1);
      await makeTestClip(b, 1, { width: 480, height: 854 });
      await makeTestClip(c, 1, { audio: false });
      const out = path.join(dir, "out.mp4");
      await concatClips(
        [
          { file: a, hasAudio: true, durationSeconds: 1 },
          { file: b, hasAudio: true, durationSeconds: 1 },
          { file: c, hasAudio: false, durationSeconds: 1 },
        ],
        out,
      );
      const p = await probe(out);
      expect(p.width).toBe(720);
      expect(p.height).toBe(1280);
      expect(p.hasAudio).toBe(true);
      expect(p.durationSeconds).toBeGreaterThan(2.7);
      expect(p.durationSeconds).toBeLessThan(3.5);
    });
  });
});

async function projectReadyToAssemble(n: number) {
  const m = await makeDeps();
  cleanup = m.cleanup;
  const p = await seedProject(db, { stage: "assembling" });
  const bytes = await makeClipBytes(1);
  for (let i = 0; i < n; i++) {
    const key = `projects/${p.id}/clips/${i}.mp4`;
    await m.deps.storage.put(key, bytes, "video/mp4");
    const clip = await seedAsset(db, p.id, { kind: "clip", storageKey: key, durationSeconds: 1 });
    const scene = await seedScene(db, p.id, i);
    const attempt = await seedAttempt(db, scene.id, { status: "done", clipAssetId: clip.id });
    await db.update(scenes).set({ approvedAttemptId: attempt.id }).where(eq(scenes.id, scene.id));
  }
  return { m, p };
}

describe("handleAssemble", () => {
  it("monta o MP4 final, salva como asset final e conclui o projeto", async () => {
    const { m, p } = await projectReadyToAssemble(2);
    await handleAssemble(m.deps, { projectId: p.id });
    const [final] = await db.select().from(assets).where(eq(assets.kind, "final"));
    expect(final!.projectId).toBe(p.id);
    expect(final!.durationSeconds).toBeGreaterThan(1.7);
    await withTempDir(async (dir) => {
      const f = path.join(dir, "final.mp4");
      await writeFile(f, await m.deps.storage.get(final!.storageKey));
      expect((await probe(f)).height).toBe(1280);
    });
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("done");
  });

  it("falha de forma permanente se uma cena não tem clipe aprovado", async () => {
    const { m, p } = await projectReadyToAssemble(1);
    await seedScene(db, p.id, 1);
    await expect(handleAssemble(m.deps, { projectId: p.id })).rejects.toBeInstanceOf(PermanentError);
  });
});

describe("onAssembleDead", () => {
  it("devolve o projeto para a revisão", async () => {
    const { m, p } = await projectReadyToAssemble(1);
    await onAssembleDead(m.deps, { projectId: p.id }, "ffmpeg quebrou");
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("review");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/modules/assembler.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `src/modules/assembler.ts`**

```ts
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import { assets, projects, sceneAttempts, scenes } from "@/db/schema";
import type { Deps } from "@/deps";
import { PermanentError } from "@/queue/errors";
import { probe, runFfmpeg, withTempDir } from "./ffmpeg";

const W = 720;
const H = 1280;

export type ClipInput = { file: string; hasAudio: boolean; durationSeconds: number };

// Normaliza resolução/fps/áudio de cada clipe e concatena. Clipe sem áudio ganha silêncio.
export async function concatClips(inputs: ClipInput[], out: string): Promise<void> {
  const args: string[] = [];
  for (const c of inputs) args.push("-i", c.file);
  let next = inputs.length;
  const silentIndex = inputs.map((c) => {
    if (c.hasAudio) return null;
    args.push("-f", "lavfi", "-t", c.durationSeconds.toFixed(3), "-i", "anullsrc=r=44100:cl=stereo");
    return next++;
  });

  const parts: string[] = [];
  inputs.forEach((_, i) => {
    parts.push(
      `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`,
    );
    const audioSource = silentIndex[i] ?? i;
    parts.push(`[${audioSource}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
  });
  parts.push(`${inputs.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${inputs.length}:v=1:a=1[v][a]`);

  args.push(
    "-filter_complex", parts.join(";"),
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "160k",
    "-movflags", "+faststart",
    out,
  );
  await runFfmpeg(args);
}

export async function handleAssemble(deps: Deps, payload: { projectId: string }): Promise<void> {
  const { db, storage } = deps;
  const [project] = await db.select().from(projects).where(eq(projects.id, payload.projectId));
  if (!project) throw new PermanentError("Projeto não encontrado");

  const sceneRows = await db
    .select()
    .from(scenes)
    .where(eq(scenes.projectId, project.id))
    .orderBy(asc(scenes.position));
  if (sceneRows.length === 0) throw new PermanentError("Projeto sem cenas");

  const finalBytes = await withTempDir(async (dir) => {
    const inputs: ClipInput[] = [];
    for (const [i, scene] of sceneRows.entries()) {
      if (!scene.approvedAttemptId) throw new PermanentError(`A cena ${i + 1} não tem clipe aprovado`);
      const [attempt] = await db.select().from(sceneAttempts).where(eq(sceneAttempts.id, scene.approvedAttemptId));
      if (!attempt?.clipAssetId) throw new PermanentError(`A cena ${i + 1} não tem clipe pronto`);
      const [clip] = await db.select().from(assets).where(eq(assets.id, attempt.clipAssetId));
      if (!clip) throw new PermanentError(`Clipe da cena ${i + 1} não encontrado`);
      const file = path.join(dir, `${i}.mp4`);
      await writeFile(file, await storage.get(clip.storageKey));
      const p = await probe(file);
      inputs.push({ file, hasAudio: p.hasAudio, durationSeconds: p.durationSeconds });
    }
    const out = path.join(dir, "final.mp4");
    await concatClips(inputs, out);
    const measured = await probe(out);
    return { bytes: await readFile(out), durationSeconds: measured.durationSeconds };
  });

  const key = `projects/${project.id}/final/${Date.now()}.mp4`;
  await storage.put(key, finalBytes.bytes, "video/mp4");
  await db.insert(assets).values({
    projectId: project.id,
    kind: "final",
    storageKey: key,
    mimeType: "video/mp4",
    durationSeconds: finalBytes.durationSeconds,
  });
  await db.update(projects).set({ stage: "done", updatedAt: new Date() }).where(eq(projects.id, project.id));
}

// Se a montagem esgotar as tentativas, o usuário volta à revisão para tentar de novo.
export async function onAssembleDead(deps: Deps, payload: { projectId: string }, message: string): Promise<void> {
  console.error(`montagem falhou para o projeto ${payload.projectId}: ${message}`);
  await deps.db
    .update(projects)
    .set({ stage: "review", updatedAt: new Date() })
    .where(eq(projects.id, payload.projectId));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run tests/modules/assembler.test.ts && pnpm typecheck`
Expected: 4 testes PASS; typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add src/modules/assembler.ts tests/modules/assembler.test.ts
git commit -m "feat(modules): ffmpeg assembler normalizing and concatenating approved clips"
```

---

### Task 10: Runner, handlers e entrypoint do worker

**Files:**
- Create: `src/worker/runner.ts`, `src/worker/handlers.ts`, `src/worker/main.ts`
- Test: `tests/worker/runner.test.ts`

- [ ] **Step 1: Escrever os testes do runner**

`tests/worker/runner.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { jobs } from "@/db/schema";
import { PermanentError, RetryLater } from "@/queue/errors";
import { claim, enqueue } from "@/queue/queue";
import { ProviderError } from "@/providers/types";
import { recoverStaleJobs, runOnce, type Handlers } from "@/worker/runner";
import { resetDb, testDb as db } from "../helpers/db";

beforeEach(resetDb);

const jobOf = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0]!;

describe("runOnce", () => {
  it("devolve false quando não há jobs", async () => {
    expect(await runOnce(db, {})).toBe(false);
  });

  it("executa o handler com o payload e completa o job", async () => {
    const run = vi.fn(async () => {});
    const j = await enqueue(db, "assemble", { projectId: "p1" });
    expect(await runOnce(db, { assemble: { run } })).toBe(true);
    expect(run).toHaveBeenCalledWith({ projectId: "p1" });
    expect((await jobOf(j.id)).status).toBe("done");
  });

  it("RetryLater devolve à fila sem consumir tentativa", async () => {
    const j = await enqueue(db, "generate_scene", {});
    await runOnce(db, {
      generate_scene: {
        run: async () => {
          throw new RetryLater(30_000);
        },
      },
    });
    const after = await jobOf(j.id);
    expect(after.status).toBe("queued");
    expect(after.attempts).toBe(0);
  });

  it("erro comum é retryable: volta à fila com a mensagem", async () => {
    const j = await enqueue(db, "assemble", {});
    await runOnce(db, {
      assemble: {
        run: async () => {
          throw new Error("rede caiu");
        },
      },
    });
    const after = await jobOf(j.id);
    expect(after.status).toBe("queued");
    expect(after.error).toBe("rede caiu");
  });

  it("PermanentError e ProviderError não-retryable vão direto para failed e chamam onDead", async () => {
    const onDead = vi.fn(async () => {});
    const handlers: Handlers = {
      assemble: {
        run: async () => {
          throw new PermanentError("sem cenas");
        },
        onDead,
      },
      generate_scene: {
        run: async () => {
          throw new ProviderError("recusado", false);
        },
        onDead,
      },
    };
    const a = await enqueue(db, "assemble", { n: 1 });
    await runOnce(db, handlers);
    expect((await jobOf(a.id)).status).toBe("failed");
    expect(onDead).toHaveBeenCalledWith({ n: 1 }, "sem cenas");

    const b = await enqueue(db, "generate_scene", { n: 2 });
    await runOnce(db, handlers);
    expect((await jobOf(b.id)).status).toBe("failed");
    expect(onDead).toHaveBeenCalledWith({ n: 2 }, "recusado");
  });

  it("esgotar tentativas chama onDead", async () => {
    const onDead = vi.fn(async () => {});
    const j = await enqueue(db, "assemble", {}, { maxAttempts: 1 });
    await runOnce(db, {
      assemble: {
        run: async () => {
          throw new Error("instável");
        },
        onDead,
      },
    });
    expect((await jobOf(j.id)).status).toBe("failed");
    expect(onDead).toHaveBeenCalledOnce();
  });

  it("tipo desconhecido falha sem derrubar o worker", async () => {
    const j = await enqueue(db, "assemble", {});
    await runOnce(db, {});
    expect((await jobOf(j.id)).status).toBe("failed");
  });

  it("recoverStaleJobs devolve à fila os travados e chama onDead nos que esgotaram as tentativas", async () => {
    const onDead = vi.fn(async () => {});
    const stuck = await enqueue(db, "assemble", { projectId: "p1" }, { maxAttempts: 1 });
    await enqueue(db, "generate_scene", {});
    await claim(db);
    await claim(db);
    await db.update(jobs).set({ lockedAt: new Date(Date.now() - 20 * 60_000) });
    const r = await recoverStaleJobs(db, { assemble: { run: async () => {}, onDead } }, 10 * 60_000);
    expect(r).toEqual({ requeued: 1, dead: 1 });
    expect(onDead).toHaveBeenCalledWith({ projectId: "p1" }, "Job travado: tentativas esgotadas");
    expect((await jobOf(stuck.id)).status).toBe("failed");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/worker/runner.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `src/worker/runner.ts`**

```ts
import type { Db } from "@/db/client";
import { PermanentError, RetryLater } from "@/queue/errors";
import { claim, complete, fail, reclaimStale, release } from "@/queue/queue";
import { ProviderError } from "@/providers/types";

export type Handler = {
  run(payload: Record<string, unknown>): Promise<void>;
  onDead?(payload: Record<string, unknown>, message: string): Promise<void>;
};
export type Handlers = Record<string, Handler>;

// Executa no máximo um job. Devolve true se havia job (para o loop não dormir à toa).
export async function runOnce(db: Db, handlers: Handlers): Promise<boolean> {
  const job = await claim(db);
  if (!job) return false;

  const handler = handlers[job.type];
  if (!handler) {
    await fail(db, job, `tipo de job desconhecido: ${job.type}`, false);
    return true;
  }

  try {
    await handler.run(job.payload);
    await complete(db, job.id);
  } catch (e) {
    if (e instanceof RetryLater) {
      await release(db, job, e.delayMs);
      return true;
    }
    const message = e instanceof Error ? e.message : String(e);
    const retryable = !(e instanceof PermanentError) && !(e instanceof ProviderError && !e.retryable);
    const outcome = await fail(db, job, message, retryable);
    if (outcome === "dead" && handler.onDead) {
      try {
        await handler.onDead(job.payload, message);
      } catch (err) {
        console.error(`onDead falhou para o job ${job.id}:`, err);
      }
    }
  }
  return true;
}

// Jobs `running` travados (worker caiu): os que esgotaram as tentativas viram `failed` e
// recebem o mesmo `onDead` do caminho normal, para limpar as linhas de domínio.
export async function recoverStaleJobs(db: Db, handlers: Handlers, olderThanMs: number) {
  const { requeued, dead } = await reclaimStale(db, olderThanMs);
  for (const job of dead) {
    try {
      await handlers[job.type]?.onDead?.(job.payload, job.error ?? "Job travado: tentativas esgotadas");
    } catch (err) {
      console.error(`onDead falhou para o job ${job.id}:`, err);
    }
  }
  return { requeued, dead: dead.length };
}
```

- [ ] **Step 4: Implementar `src/worker/handlers.ts`**

```ts
import type { Deps } from "@/deps";
import { onAssembleDead, handleAssemble } from "@/modules/assembler";
import { handleGenerateCharacter, onGenerateCharacterDead } from "@/modules/character-designer";
import { handleGenerateScene, onGenerateSceneDead } from "@/modules/scene-generator";
import type { Handlers } from "./runner";

export function buildHandlers(deps: Deps): Handlers {
  return {
    generate_scene: {
      run: (p) => handleGenerateScene(deps, p as { attemptId: string }),
      onDead: (p, m) => onGenerateSceneDead(deps, p as { attemptId: string }, m),
    },
    generate_character: {
      run: (p) => handleGenerateCharacter(deps, p as { characterId: string }),
      onDead: (p, m) => onGenerateCharacterDead(deps, p as { characterId: string }, m),
    },
    assemble: {
      run: (p) => handleAssemble(deps, p as { projectId: string }),
      onDead: (p, m) => onAssembleDead(deps, p as { projectId: string }, m),
    },
  };
}
```

- [ ] **Step 5: Implementar `src/worker/main.ts`**

(Depende de `createProviders`, criado na Task 11; o typecheck desta etapa só fecha depois dela.)

```ts
import { loadEnv } from "@/config/env";
import { createDb } from "@/db/client";
import type { Deps } from "@/deps";
import { createProviders } from "@/providers";
import { createStorage } from "@/storage";
import { buildHandlers } from "./handlers";
import { recoverStaleJobs, runOnce } from "./runner";

const env = loadEnv();
const { db } = createDb(env.DATABASE_URL, env.WORKER_CONCURRENCY + 2);
const deps: Deps = {
  db,
  storage: createStorage(env),
  providers: await createProviders(env),
  config: { maxSceneReferences: env.MAX_SCENE_REFERENCES, sceneMaxSeconds: env.SCENE_MAX_SECONDS },
};
const handlers = buildHandlers(deps);

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`${sig} recebido, encerrando após os jobs em andamento`);
    stopping = true;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loop(n: number) {
  while (!stopping) {
    const worked = await runOnce(db, handlers).catch((e) => {
      console.error(`loop ${n}:`, e);
      return false;
    });
    if (!worked) await sleep(2_000);
  }
}

// Jobs presos em "running" por um worker que morreu voltam para a fila, ou falham com onDead se esgotaram as tentativas (rodar uma única réplica do worker).
const reclaimTimer = setInterval(() => {
  recoverStaleJobs(db, handlers, 10 * 60_000)
    .then(({ requeued, dead }) => {
      if (requeued) console.log(`${requeued} job(s) travado(s) devolvido(s) à fila`);
      if (dead) console.log(`${dead} job(s) travado(s) marcado(s) como failed (onDead executado)`);
    })
    .catch((e) => console.error("recoverStaleJobs:", e));
}, 60_000);

console.log(`worker iniciado (provider=${env.PROVIDER}, concorrência=${env.WORKER_CONCURRENCY})`);
await Promise.all(Array.from({ length: env.WORKER_CONCURRENCY }, (_, i) => loop(i)));
clearInterval(reclaimTimer);
process.exit(0);
```

- [ ] **Step 6: Rodar os testes do runner**

Run: `pnpm vitest run tests/worker/runner.test.ts`
Expected: 8 testes PASS.

- [ ] **Step 7: Commit**

```bash
git add src/worker tests/worker
git commit -m "feat(worker): job runner, handler registry and entrypoint"
```

---

### Task 11: Providers reais, de desenvolvimento e fábrica

> **Gate:** só iniciar depois de `docs/provider-spike.md` registrar Gates 1–4 aprovados. Se o Gate 2 (fala em pt-BR numa única geração) falhou, **parar e avisar o dono do projeto**: o provider de vídeo precisa de outra abordagem (extensão multi-turn ou Veo 3.1 GA na Vertex) e esta task muda; as demais não.
> O `OmniVideoModel` abaixo segue o formato de chamada documentado em `https://aistudio.google.com/docs/omni`. Se o spike registrou um formato diferente de `input` ou `response_format`, usar o do spike (o teste unitário com cliente falso trava o formato escolhido).

**Files:**
- Create: `src/providers/errors.ts`, `gemini.ts`, `omni.ts`, `dev.ts`, `index.ts`
- Test: `tests/providers/errors.test.ts`, `gemini.test.ts`, `omni.test.ts`, `dev.test.ts`, `tests/live/gemini.live.test.ts`

- [ ] **Step 1: Escrever os testes de mapeamento de erro**

`tests/providers/errors.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mapProviderError } from "@/providers/errors";
import { ProviderError } from "@/providers/types";

describe("mapProviderError", () => {
  it("mantém ProviderError, ZodError e SyntaxError como estão", () => {
    const p = new ProviderError("x", false);
    expect(mapProviderError(p)).toBe(p);
    const z1 = new z.ZodError([]);
    expect(mapProviderError(z1)).toBe(z1);
    const s = new SyntaxError("json");
    expect(mapProviderError(s)).toBe(s);
  });
  it("429 e 5xx são retryable", () => {
    expect(mapProviderError(Object.assign(new Error("limite"), { status: 429 }))).toMatchObject({ retryable: true });
    expect(mapProviderError(Object.assign(new Error("interno"), { status: 503 }))).toMatchObject({ retryable: true });
  });
  it("4xx (exceto 429) não é retryable", () => {
    expect(mapProviderError(Object.assign(new Error("inválido"), { status: 400 }))).toMatchObject({ retryable: false });
    expect(mapProviderError(Object.assign(new Error("proibido"), { status: 403 }))).toMatchObject({ retryable: false });
  });
  it("erro sem status (rede) é retryable", () => {
    expect(mapProviderError(new Error("ECONNRESET"))).toMatchObject({ retryable: true });
  });
});
```

- [ ] **Step 2: Implementar `src/providers/errors.ts`**

```ts
import { z } from "zod";
import { ProviderError } from "./types";

// Erros de validação passam direto (o planejador de roteiro sabe tentar de novo);
// o resto vira ProviderError com a política de retry decidida pelo status HTTP.
export function mapProviderError(e: unknown): Error {
  if (e instanceof ProviderError || e instanceof z.ZodError || e instanceof SyntaxError) return e;
  const message = e instanceof Error ? e.message : String(e);
  const status = (e as { status?: number }).status;
  if (status === undefined) return new ProviderError(message, true);
  return new ProviderError(message, status === 429 || status >= 500);
}
```

Run: `pnpm vitest run tests/providers/errors.test.ts` — Expected: PASS.

- [ ] **Step 3: Escrever os testes do Gemini texto/imagem (cliente falso)**

`tests/providers/gemini.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GeminiImageModel, GeminiTextModel, type GeminiClient } from "@/providers/gemini";
import { ProviderError } from "@/providers/types";

function client(handler: (req: any) => any): GeminiClient & { requests: any[] } {
  const requests: any[] = [];
  return {
    requests,
    models: {
      async generateContent(req: any) {
        requests.push(req);
        return handler(req);
      },
    },
  };
}

describe("GeminiTextModel", () => {
  const schema = z.object({ n: z.number() });

  it("envia system, prompt e JSON schema e valida a resposta", async () => {
    const c = client(() => ({ text: '{"n": 3}' }));
    const out = await new GeminiTextModel(c, "modelo-x").generateJson({ task: "script", system: "sys", prompt: "oi", schema });
    expect(out).toEqual({ n: 3 });
    const req = c.requests[0];
    expect(req.model).toBe("modelo-x");
    expect(req.contents).toBe("oi");
    expect(req.config.systemInstruction).toBe("sys");
    expect(req.config.responseMimeType).toBe("application/json");
    expect(req.config.responseJsonSchema.properties.n.type).toBe("number");
    expect(req.config.responseJsonSchema.$schema).toBeUndefined();
  });

  it("JSON malformado vira SyntaxError; schema errado vira ZodError", async () => {
    const bad = new GeminiTextModel(client(() => ({ text: "não é json" })), "m");
    await expect(bad.generateJson({ task: "script", system: "", prompt: "", schema })).rejects.toBeInstanceOf(SyntaxError);
    const wrong = new GeminiTextModel(client(() => ({ text: '{"n":"x"}' })), "m");
    await expect(wrong.generateJson({ task: "script", system: "", prompt: "", schema })).rejects.toBeInstanceOf(z.ZodError);
  });

  it("erro HTTP vira ProviderError com política de retry", async () => {
    const c = client(() => {
      throw Object.assign(new Error("cota"), { status: 429 });
    });
    await expect(new GeminiTextModel(c, "m").generateJson({ task: "script", system: "", prompt: "", schema })).rejects.toMatchObject({
      name: "ProviderError",
      retryable: true,
    });
  });
});

describe("GeminiImageModel", () => {
  it("manda prompt e referências inline e devolve a imagem", async () => {
    const c = client(() => ({
      candidates: [{ content: { parts: [{ text: "ok" }, { inlineData: { data: Buffer.from("img").toString("base64"), mimeType: "image/png" } }] } }],
    }));
    const out = await new GeminiImageModel(c, "img-model").generateImage({
      prompt: "um gato",
      references: [{ bytes: Buffer.from("ref"), mimeType: "image/jpeg", label: "gato" }],
    });
    expect(out.bytes.toString()).toBe("img");
    expect(out.mimeType).toBe("image/png");
    const parts = c.requests[0].contents[0].parts;
    expect(parts[0]).toEqual({ text: "um gato" });
    expect(parts[1].inlineData.mimeType).toBe("image/jpeg");
    expect(c.requests[0].config.responseModalities).toEqual(["IMAGE"]);
  });

  it("sem imagem na resposta (ex.: filtro de segurança) é erro não retryable", async () => {
    const c = client(() => ({ candidates: [{ content: { parts: [{ text: "não posso" }] } }] }));
    const p = new GeminiImageModel(c, "m").generateImage({ prompt: "x" });
    await expect(p).rejects.toBeInstanceOf(ProviderError);
    await expect(p).rejects.toMatchObject({ retryable: false });
  });
});
```

- [ ] **Step 4: Implementar `src/providers/gemini.ts`**

```ts
import { z, type ZodType } from "zod";
import { mapProviderError } from "./errors";
import {
  ProviderError, type ImageData, type ImageModel, type ReferenceImage, type TextModel, type TextTask,
} from "./types";

// Subconjunto de `GoogleGenAI` que usamos; permite testar com um cliente falso.
export interface GeminiClient {
  models: { generateContent(req: any): Promise<any> };
}

export class GeminiTextModel implements TextModel {
  constructor(
    private ai: GeminiClient,
    private model: string,
  ) {}

  async generateJson<T>(args: { task: TextTask; system: string; prompt: string; schema: ZodType<T> }): Promise<T> {
    const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(args.schema) as Record<string, unknown>;
    try {
      const res = await this.ai.models.generateContent({
        model: this.model,
        contents: args.prompt,
        config: {
          systemInstruction: args.system,
          responseMimeType: "application/json",
          responseJsonSchema: jsonSchema,
        },
      });
      return args.schema.parse(JSON.parse(res.text ?? ""));
    } catch (e) {
      throw mapProviderError(e);
    }
  }
}

export class GeminiImageModel implements ImageModel {
  constructor(
    private ai: GeminiClient,
    private model: string,
  ) {}

  async generateImage(args: { prompt: string; references?: ReferenceImage[] }): Promise<ImageData> {
    const parts = [
      { text: args.prompt },
      ...(args.references ?? []).map((r) => ({
        inlineData: { data: r.bytes.toString("base64"), mimeType: r.mimeType },
      })),
    ];
    let res: any;
    try {
      res = await this.ai.models.generateContent({
        model: this.model,
        contents: [{ role: "user", parts }],
        config: { responseModalities: ["IMAGE"] },
      });
    } catch (e) {
      throw mapProviderError(e);
    }
    const part = res.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data);
    if (!part) throw new ProviderError("O modelo não devolveu imagem (possível bloqueio de segurança)", false);
    return { bytes: Buffer.from(part.inlineData.data, "base64"), mimeType: part.inlineData.mimeType ?? "image/png" };
  }
}
```

Run: `pnpm vitest run tests/providers/gemini.test.ts` — Expected: PASS.

- [ ] **Step 5: Escrever os testes do `OmniVideoModel` (cliente falso)**

`tests/providers/omni.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { OmniVideoModel, type OmniClient } from "@/providers/omni";

function fakeClient(over: Partial<{ uri: string | undefined; state: string; createError: unknown }> = {}) {
  const calls = { create: [] as any[], get: [] as string[], download: [] as any[] };
  const client: OmniClient = {
    interactions: {
      async create(req) {
        calls.create.push(req);
        if (over.createError) throw over.createError;
        const uri = "uri" in over ? over.uri : "https://x/v1beta/files/abc123XYZ:download";
        return { output_video: uri ? { uri } : undefined };
      },
    },
    files: {
      async get({ name }) {
        calls.get.push(name);
        return { state: over.state ?? "ACTIVE" };
      },
      async download({ file, downloadPath }) {
        calls.download.push({ file, downloadPath });
        const { writeFile } = await import("node:fs/promises");
        await writeFile(downloadPath, Buffer.from("MP4DATA"));
      },
    },
  };
  return { client, calls };
}

describe("OmniVideoModel", () => {
  it("sem referências: input é só o prompt, 9:16, entrega por URI", async () => {
    const { client, calls } = fakeClient();
    const h = await new OmniVideoModel(client, "gemini-omni-1.1-flash").start({ prompt: "cena", references: [], targetSeconds: 5 });
    expect(h.providerRef).toBe("files/abc123XYZ");
    expect(calls.create[0]).toMatchObject({
      model: "gemini-omni-1.1-flash",
      response_format: { type: "video", aspect_ratio: "9:16", delivery: "uri" },
    });
    expect(calls.create[0].input).toEqual([{ type: "text", text: "cena" }]);
  });

  it("com referências: anexa imagens e mapeia <IMAGE_REF_N> aos rótulos", async () => {
    const { client, calls } = fakeClient();
    await new OmniVideoModel(client, "m").start({
      prompt: "cena",
      targetSeconds: 5,
      references: [
        { bytes: Buffer.from("a"), mimeType: "image/png", label: "Maria" },
        { bytes: Buffer.from("b"), mimeType: "image/jpeg", label: "produto" },
      ],
    });
    const input = calls.create[0].input as any[];
    expect(input[0].text).toContain("cena");
    expect(input[0].text).toContain("<IMAGE_REF_1> é Maria");
    expect(input[0].text).toContain("<IMAGE_REF_2> é produto");
    expect(input[1]).toEqual({ type: "image", data: Buffer.from("a").toString("base64"), mime_type: "image/png" });
    expect(input[2].mime_type).toBe("image/jpeg");
  });

  it("resposta sem arquivo de vídeo é erro não retryable (provável bloqueio)", async () => {
    const { client } = fakeClient({ uri: undefined });
    await expect(new OmniVideoModel(client, "m").start({ prompt: "x", references: [], targetSeconds: 5 })).rejects.toMatchObject({
      name: "ProviderError",
      retryable: false,
    });
  });

  it("erro HTTP da API é mapeado", async () => {
    const { client } = fakeClient({ createError: Object.assign(new Error("limite"), { status: 429 }) });
    await expect(new OmniVideoModel(client, "m").start({ prompt: "x", references: [], targetSeconds: 5 })).rejects.toMatchObject({ retryable: true });
  });

  it("poll: PROCESSING é pending; ACTIVE baixa os bytes; FAILED é falha definitiva", async () => {
    const pending = fakeClient({ state: "PROCESSING" });
    expect(await new OmniVideoModel(pending.client, "m").poll({ providerRef: "files/abc" })).toEqual({ state: "pending" });

    const ok = fakeClient({ state: "ACTIVE" });
    const done = await new OmniVideoModel(ok.client, "m").poll({ providerRef: "files/abc" });
    expect(done.state).toBe("done");
    expect(done.state === "done" && done.bytes.toString()).toBe("MP4DATA");
    expect(ok.calls.download[0].file).toBe("files/abc");

    const failed = fakeClient({ state: "FAILED" });
    expect(await new OmniVideoModel(failed.client, "m").poll({ providerRef: "files/abc" })).toMatchObject({
      state: "failed",
      retryable: false,
    });
  });
});
```

- [ ] **Step 6: Implementar `src/providers/omni.ts`**

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { withTempDir } from "@/modules/ffmpeg";
import { mapProviderError } from "./errors";
import { ProviderError, type VideoModel, type VideoPoll, type VideoRequest } from "./types";

// Superfície mínima da Interactions API do Gemini Omni (ver docs/provider-spike.md e
// https://aistudio.google.com/docs/omni). Um cast isola diferenças de tipagem entre versões do SDK.
export interface OmniClient {
  interactions: {
    create(req: Record<string, unknown>): Promise<{ output_video?: { uri?: string } }>;
  };
  files: {
    get(args: { name: string }): Promise<{ state?: string }>;
    download(args: { file: string; downloadPath: string }): Promise<void>;
  };
}

export class OmniVideoModel implements VideoModel {
  constructor(
    private client: OmniClient,
    private model: string,
  ) {}

  async start(req: VideoRequest): Promise<{ providerRef: string }> {
    const tags = req.references.map((r, i) => `<IMAGE_REF_${i + 1}> é ${r.label}`).join("; ");
    const text = req.references.length
      ? `${req.prompt}\n\nImagens de referência: ${tags}. Mantenha exatamente a aparência de cada uma.`
      : req.prompt;
    const input = [
      { type: "text", text },
      ...req.references.map((r) => ({
        type: "image",
        data: r.bytes.toString("base64"),
        mime_type: r.mimeType,
      })),
    ];

    let interaction;
    try {
      interaction = await this.client.interactions.create({
        model: this.model,
        input,
        response_format: { type: "video", aspect_ratio: "9:16", resolution: "720p", delivery: "uri" },
      });
    } catch (e) {
      throw mapProviderError(e);
    }
    const id = interaction.output_video?.uri?.match(/files\/([a-zA-Z0-9]+)/)?.[1];
    if (!id) {
      throw new ProviderError("O modelo não devolveu um vídeo (possível bloqueio de segurança)", false);
    }
    return { providerRef: `files/${id}` };
  }

  async poll({ providerRef }: { providerRef: string }): Promise<VideoPoll> {
    try {
      const info = await this.client.files.get({ name: providerRef });
      if (info.state === "FAILED") {
        return { state: "failed", reason: "A geração do vídeo falhou no provedor", retryable: false };
      }
      if (info.state !== "ACTIVE") return { state: "pending" };
      const bytes = await withTempDir(async (dir) => {
        const downloadPath = path.join(dir, "video.mp4");
        await this.client.files.download({ file: providerRef, downloadPath });
        return readFile(downloadPath);
      });
      return { state: "done", bytes };
    } catch (e) {
      throw mapProviderError(e);
    }
  }
}
```

Run: `pnpm vitest run tests/providers/omni.test.ts` — Expected: 5 testes PASS.

- [ ] **Step 7: Testes e implementação do provider de desenvolvimento**

`tests/providers/dev.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { scriptDraftSchema } from "@/domain/script";
import { createDevProviders } from "@/providers/dev";
import { z } from "zod";

describe("createDevProviders", () => {
  it("devolve roteiro válido para task=script e personagens para task=characters", async () => {
    const { text } = await createDevProviders();
    const script = await text.generateJson({ task: "script", system: "", prompt: "", schema: scriptDraftSchema(8) });
    expect(script.scenes.length).toBeGreaterThanOrEqual(2);
    const chars = await text.generateJson({
      task: "characters", system: "", prompt: "",
      schema: z.object({ characters: z.array(z.object({ name: z.string(), description: z.string() })) }),
    });
    expect(chars.characters.length).toBeGreaterThanOrEqual(2);
  });

  it("gera um clipe de verdade depois de alguns polls", async () => {
    const { video } = await createDevProviders();
    const h = await video.start({ prompt: "x", references: [], targetSeconds: 3 });
    expect((await video.poll(h)).state).toBe("pending");
    expect((await video.poll(h)).state).toBe("pending");
    const done = await video.poll(h);
    expect(done.state).toBe("done");
    expect(done.state === "done" && done.bytes.length).toBeGreaterThan(1000);
  });
});
```

`src/providers/dev.ts`:
```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeTestClip } from "@/modules/ffmpeg";
import { FakeImageModel, FakeTextModel, FakeVideoModel } from "./fake";
import type { Providers } from "./types";

// Providers sem custo para desenvolver UI e fluxo (PROVIDER=fake).
export async function createDevProviders(): Promise<Providers> {
  const dir = await mkdtemp(path.join(tmpdir(), "dev-clip-"));
  let clip: Buffer;
  try {
    const file = path.join(dir, "clip.mp4");
    await makeTestClip(file, 3);
    clip = await readFile(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const text = new FakeTextModel(({ task }) =>
    task === "characters"
      ? {
          characters: [
            { name: "Marina", description: "Mulher de 35 anos, cabelo cacheado castanho, jaqueta jeans" },
            { name: "Rafael", description: "Homem de 40 anos, barba curta, camisa social azul" },
          ],
        }
      : {
          scenes: [
            { dialogue: "Você não vai acreditar no que eu descobri.", visualPrompt: "Close no rosto, tom de segredo", targetSeconds: 3, referenceLabels: [] },
            { dialogue: "Eu testei por uma semana inteira.", visualPrompt: "Plano médio, mostrando o produto", targetSeconds: 3, referenceLabels: [] },
            { dialogue: "Corre no link da bio.", visualPrompt: "Close, apontando para baixo", targetSeconds: 3, referenceLabels: [] },
          ],
        },
  );
  return { text, image: new FakeImageModel(), video: new FakeVideoModel({ clip, pendingPolls: 2 }) };
}
```

Run: `pnpm vitest run tests/providers/dev.test.ts` — Expected: PASS.

- [ ] **Step 8: Fábrica `src/providers/index.ts`**

```ts
import { GoogleGenAI } from "@google/genai";
import type { Env } from "@/config/env";
import { createDevProviders } from "./dev";
import { GeminiImageModel, GeminiTextModel, type GeminiClient } from "./gemini";
import { OmniVideoModel, type OmniClient } from "./omni";
import type { Providers } from "./types";

export async function createProviders(env: Env): Promise<Providers> {
  if (env.PROVIDER === "fake") return createDevProviders();
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return {
    text: new GeminiTextModel(ai as unknown as GeminiClient, env.GEMINI_TEXT_MODEL!),
    image: new GeminiImageModel(ai as unknown as GeminiClient, env.GEMINI_IMAGE_MODEL!),
    video: new OmniVideoModel(ai as unknown as OmniClient, env.GEMINI_VIDEO_MODEL),
  };
}
```

- [ ] **Step 9: Teste ao vivo (opcional, consome crédito; fora do `pnpm test` padrão)**

`tests/live/gemini.live.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadEnv } from "@/config/env";
import { createProviders } from "@/providers";

// Rodar com: LIVE=1 PROVIDER=gemini ... pnpm vitest run tests/live
describe.skipIf(!process.env.LIVE)("providers reais (Gemini)", () => {
  it("texto: devolve JSON no schema pedido", async () => {
    const { text } = await createProviders(loadEnv());
    const out = await text.generateJson({
      task: "script",
      system: "Responda em JSON.",
      prompt: "Dê um número entre 1 e 10.",
      schema: z.object({ n: z.number() }),
    });
    expect(typeof out.n).toBe("number");
  }, 60_000);

  it("imagem: devolve bytes de imagem", async () => {
    const { image } = await createProviders(loadEnv());
    const img = await image.generateImage({ prompt: "Retrato de uma mulher sorrindo, fundo neutro, vertical 9:16" });
    expect(img.bytes.length).toBeGreaterThan(1000);
    expect(img.mimeType).toMatch(/^image\//);
  }, 120_000);
});
```

Run (com as variáveis `.env` de Gemini preenchidas): `LIVE=1 PROVIDER=gemini pnpm vitest run tests/live`
Expected: 2 testes PASS. Se `GEMINI_TEXT_MODEL`/`GEMINI_IMAGE_MODEL` forem IDs inválidos, a API devolve 404: conferir os IDs vigentes em `https://ai.google.dev/gemini-api/docs/models` e ajustar o `.env`.

- [ ] **Step 10: Rodar tudo (sem live) e typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: todos os testes PASS (os `live` ficam como `skipped`); typecheck limpo (agora `src/worker/main.ts` compila).

- [ ] **Step 11: Smoke do worker com providers de desenvolvimento**

Run:
```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5433/gerador PROVIDER=fake STORAGE=fs ACCESS_PASSWORD=x SESSION_SECRET=$(printf 'a%.0s' {1..40}) pnpm db:migrate && \
DATABASE_URL=postgres://postgres:postgres@localhost:5433/gerador PROVIDER=fake STORAGE=fs ACCESS_PASSWORD=x SESSION_SECRET=$(printf 'a%.0s' {1..40}) timeout 5 pnpm worker
```
Expected: `migrações aplicadas` e depois `worker iniciado (provider=fake, concorrência=4)`; o `timeout` encerra o processo após 5 s sem erros.

- [ ] **Step 12: Commit**

```bash
git add src/providers tests/providers tests/live
git commit -m "feat(providers): gemini text/image, omni video, dev providers and factory"
```

---

## Auto-revisão do Plano 2 contra o spec

- §4 módulos: `script-planner` (T3), `character-designer` (T4, T8), `scene-generator` (T7), `assembler` (T9), `job-queue` (Plano 1) + runner (T10), providers reais (T11).
- §5 fluxo: briefing/referências e guardas de etapa (T5); roteiro com feedback e edição manual (T3, T6); geração com estimativa de segundos via `totalSeconds` (T6); revisão: aprovar, regerar uma ou todas, restaurar tentativa antiga via `approveAttempt` (T6); montagem (T6, T9).
- §5 regras: editar cena invalida só o clipe dela (T6 `updateScene`); falha de uma cena não trava as demais (T7 + `advanceToReviewIfIdle`); tentativa guarda prompt, referências e clipe (T6, T7).
- §7 erros: retomada pelo `providerRef` persistido (T7); retry com backoff (Plano 1 + T10); bloqueio de segurança sem retry (T7, T11); idempotência de handler (T7); schema do roteiro validado com retry limitado (T3).
- Decisão de implementação não prevista no spec: o planejamento de roteiro e a proposta de personagens (texto) rodam na web via serviços (chamada de poucos segundos); só imagem, vídeo e montagem passam pela fila. O spec afirma que a web "nunca chama Veo diretamente", o que continua verdadeiro.
- Consistência de nomes entre tasks: `Deps`, `DomainError`, `planProjectScript`, `generateAllScenes`, `regenerateScene`, `approveAttempt`, `startAssembly`, `handleGenerateScene`/`onGenerateSceneDead`, `handleGenerateCharacter`/`onGenerateCharacterDead`, `handleAssemble`/`onAssembleDead`, `runOnce`/`Handlers`, `createProviders`.
