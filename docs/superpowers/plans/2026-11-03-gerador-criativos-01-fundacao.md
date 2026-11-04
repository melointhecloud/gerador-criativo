# Gerador de Criativos TikTok — Plano 1: Fundação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar pronta a base do projeto: tooling, config, validação do provider de vídeo, banco, máquina de estados, domínio do roteiro, interfaces de providers (com fakes), storage e fila de jobs.

**Architecture:** Um pacote TypeScript. Código de domínio puro em `src/domain`, acesso a dados em `src/db`, fronteiras externas (Gemini, storage) atrás de interfaces em `src/providers` e `src/storage`, fila de jobs no Postgres em `src/queue`. Testes com Vitest contra um Postgres real em Docker.

**Tech Stack:** Node 22, TypeScript, pnpm, Vitest, Drizzle ORM + `postgres`, Zod v4, `@google/genai`, `@aws-sdk/client-s3`, Docker Compose (Postgres de teste/dev).

**Spec:** `docs/superpowers/specs/2026-11-03-gerador-criativos-tiktok-design.md`

**Planos seguintes:** `...-02-pipeline.md` (módulos, serviços, worker, providers reais), `...-03-web-e-deploy.md` (auth, API, UI, Railway).

**Convenções:** identificadores em inglês, textos para o usuário em português do Brasil. Imports com alias `@/` (= `src/`), exceto em `src/db/*` e `tests/helpers/global-setup.ts`, que usam caminhos relativos (drizzle-kit e globalSetup não resolvem o alias).

---

## Mapa de arquivos deste plano

| Arquivo | Responsabilidade |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example` | Tooling |
| `docker-compose.yml`, `docker/init.sql` | Postgres local (dev em `gerador`, testes em `gerador_test`) |
| `src/config/env.ts` | Parse e validação das variáveis de ambiente |
| `scripts/spike-video.ts`, `docs/provider-spike.md` | Validação manual do provider de vídeo |
| `src/domain/stages.ts` | Etapas do projeto e transições permitidas (puro) |
| `src/domain/script.ts` | Schema do roteiro e regra de limite de referências (puro) |
| `src/db/schema.ts`, `client.ts`, `migrate.ts`, `drizzle.config.ts` | Tabelas, conexão, migrações |
| `tests/helpers/global-setup.ts`, `tests/helpers/db.ts` | Migra o banco de teste e limpa entre testes |
| `src/providers/types.ts`, `src/providers/fake.ts` | Interfaces `TextModel`/`ImageModel`/`VideoModel` e fakes |
| `src/storage/types.ts`, `fs.ts`, `s3.ts`, `index.ts` | Storage de arquivos |
| `src/queue/errors.ts`, `src/queue/queue.ts` | Fila de jobs no Postgres |

---

### Task 1: Scaffold do projeto

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `docker-compose.yml`, `docker/init.sql`

- [ ] **Step 1: Verificar pré-requisitos**

Run: `node --version && pnpm --version && docker --version && ffmpeg -version | head -1 && ffprobe -version | head -1`
Expected: Node `v22.x` ou maior, pnpm, Docker, ffmpeg e ffprobe presentes. Se algo faltar, instalar antes de continuar (ffmpeg é usado nos testes do assembler).

- [ ] **Step 2: Criar `package.json`**

```json
{
  "name": "gerador-criativos",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "worker": "tsx --env-file-if-exists=.env src/worker/main.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx --env-file-if-exists=.env src/db/migrate.ts",
    "spike:video": "tsx --env-file-if-exists=.env scripts/spike-video.ts"
  }
}
```

- [ ] **Step 3: Instalar dependências**

Run:
```bash
pnpm add next react react-dom drizzle-orm postgres zod @google/genai @aws-sdk/client-s3
pnpm add -D typescript vitest tsx drizzle-kit @types/node @types/react @types/react-dom
```
Expected: instalação sem erro; `package.json` ganha `dependencies` e `devDependencies`. Confirmar `zod` major 4: `pnpm list zod` (o plano usa `z.toJSONSchema`, que só existe no v4).

- [ ] **Step 4: Criar `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "types": ["node"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "noEmit": true,
    "paths": { "@/*": ["./src/*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "scripts/**/*.ts", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Criar `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20000,
  },
});
```

- [ ] **Step 6: Criar `.gitignore`**

```
node_modules/
.next/
.env
.env.local
storage-data/
spike-out/
*.tsbuildinfo
next-env.d.ts
```

- [ ] **Step 7: Criar `.env.example`**

```
# Banco (dev). Testes usam TEST_DATABASE_URL (default no código).
DATABASE_URL=postgres://postgres:postgres@localhost:5433/gerador

# gemini | fake (fake = sem custo, para desenvolver UI e fluxo)
PROVIDER=fake
GEMINI_API_KEY=
GEMINI_TEXT_MODEL=
GEMINI_IMAGE_MODEL=
GEMINI_VIDEO_MODEL=gemini-omni-1.1-flash

# Limites do provider de vídeo (confirmar no spike, ver docs/provider-spike.md)
MAX_SCENE_REFERENCES=3
SCENE_MAX_SECONDS=8

# fs (dev) | s3 (produção)
STORAGE=fs
LOCAL_STORAGE_DIR=./storage-data
S3_ENDPOINT=
S3_REGION=auto
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=

# Acesso do time
ACCESS_PASSWORD=troque-esta-senha
SESSION_SECRET=troque-por-uma-string-aleatoria-com-32-ou-mais-caracteres

WORKER_CONCURRENCY=4
```

- [ ] **Step 8: Criar `docker-compose.yml` e `docker/init.sql`**

`docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: gerador_test
    ports:
      - "${POSTGRES_PORT:-5433}:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/init.sql:/docker-entrypoint-initdb.d/init.sql
volumes:
  pgdata:
```

Se a porta 5433 do host já estiver ocupada, defina `POSTGRES_PORT` (ex.: `POSTGRES_PORT=5434 docker compose up -d`) e ajuste `DATABASE_URL`/`TEST_DATABASE_URL` para a mesma porta.

`docker/init.sql`:
```sql
CREATE DATABASE gerador;
```

- [ ] **Step 9: Subir o Postgres e verificar**

Run: `docker compose up -d && sleep 4 && docker compose exec postgres psql -U postgres -c '\l' | grep gerador`
Expected: linhas com `gerador` e `gerador_test`.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts .gitignore .env.example docker-compose.yml docker/init.sql
git commit -m "chore: scaffold project tooling and local postgres"
```

---

### Task 2: Config de ambiente

**Files:**
- Create: `src/config/env.ts`
- Test: `tests/config/env.test.ts`

- [ ] **Step 1: Escrever os testes**

`tests/config/env.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { loadEnv } from "@/config/env";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  ACCESS_PASSWORD: "segredo",
  SESSION_SECRET: "x".repeat(32),
  PROVIDER: "fake",
  STORAGE: "fs",
};

describe("loadEnv", () => {
  it("aceita config mínima com provider fake e storage fs, aplicando defaults", () => {
    const env = loadEnv(base);
    expect(env.GEMINI_VIDEO_MODEL).toBe("gemini-omni-1.1-flash");
    expect(env.MAX_SCENE_REFERENCES).toBe(3);
    expect(env.SCENE_MAX_SECONDS).toBe(8);
    expect(env.WORKER_CONCURRENCY).toBe(4);
    expect(env.LOCAL_STORAGE_DIR).toBe("./storage-data");
  });

  it("converte números vindos como string", () => {
    const env = loadEnv({ ...base, MAX_SCENE_REFERENCES: "2", SCENE_MAX_SECONDS: "6" });
    expect(env.MAX_SCENE_REFERENCES).toBe(2);
    expect(env.SCENE_MAX_SECONDS).toBe(6);
  });

  it("exige chave e modelos quando PROVIDER=gemini", () => {
    expect(() => loadEnv({ ...base, PROVIDER: "gemini" })).toThrow(/GEMINI_API_KEY/);
    expect(() =>
      loadEnv({ ...base, PROVIDER: "gemini", GEMINI_API_KEY: "k" }),
    ).toThrow(/GEMINI_TEXT_MODEL/);
    const ok = loadEnv({
      ...base,
      PROVIDER: "gemini",
      GEMINI_API_KEY: "k",
      GEMINI_TEXT_MODEL: "t",
      GEMINI_IMAGE_MODEL: "i",
    });
    expect(ok.PROVIDER).toBe("gemini");
  });

  it("exige variáveis S3 quando STORAGE=s3", () => {
    expect(() => loadEnv({ ...base, STORAGE: "s3" })).toThrow(/S3_BUCKET/);
  });

  it("rejeita SESSION_SECRET curto", () => {
    expect(() => loadEnv({ ...base, SESSION_SECRET: "curto" })).toThrow(/SESSION_SECRET/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/config/env.test.ts`
Expected: FAIL — `Cannot find module '@/config/env'`.

- [ ] **Step 3: Implementar `src/config/env.ts`**

```ts
import { z } from "zod";

const baseSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PROVIDER: z.enum(["gemini", "fake"]).default("gemini"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_TEXT_MODEL: z.string().optional(),
  GEMINI_IMAGE_MODEL: z.string().optional(),
  GEMINI_VIDEO_MODEL: z.string().default("gemini-omni-1.1-flash"),
  MAX_SCENE_REFERENCES: z.coerce.number().int().min(1).default(3),
  SCENE_MAX_SECONDS: z.coerce.number().int().min(3).default(8),
  STORAGE: z.enum(["fs", "s3"]).default("fs"),
  LOCAL_STORAGE_DIR: z.string().default("./storage-data"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  ACCESS_PASSWORD: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(4),
});

export const envSchema = baseSchema.superRefine((v, ctx) => {
  const need = (keys: (keyof typeof v)[]) => {
    for (const k of keys) {
      if (!v[k]) ctx.addIssue({ code: "custom", path: [k], message: `${String(k)} é obrigatório` });
    }
  };
  if (v.PROVIDER === "gemini") need(["GEMINI_API_KEY", "GEMINI_TEXT_MODEL", "GEMINI_IMAGE_MODEL"]);
  if (v.STORAGE === "s3") need(["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]);
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return envSchema.parse(source);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run tests/config/env.test.ts`
Expected: 5 testes PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config tests/config
git commit -m "feat(config): validate environment with zod"
```

---

### Task 3: Spike do provider de vídeo (manual, consome crédito)

> **Por que existe:** a doc oficial do Gemini (`https://aistudio.google.com/docs/deprecations`, consultada em 2026-11-03) lista `veo-3.1-generate-preview` e variantes como **desligados em 22/10/2026**, com substituto `gemini-omni-1.1-flash` (Interactions API, 9:16 suportado, áudio gerado). A mesma doc diz que fala "é suportada ao estender vídeos gerados anteriormente (multi-turn)", o que pode inviabilizar UGC falando em uma única geração. Nada além desta task depende de resposta, pois o resto usa a interface `VideoModel` com fake. Mas o **provider real** (Plano 2, Task 11) só pode ser escrito depois dos resultados daqui.

**Files:**
- Create: `scripts/spike-video.ts`, `docs/provider-spike.md`

- [ ] **Step 1: Criar `scripts/spike-video.ts`**

```ts
import { GoogleGenAI } from "@google/genai";
import { execFile } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_VIDEO_MODEL ?? "gemini-omni-1.1-flash";
if (!apiKey) throw new Error("Defina GEMINI_API_KEY");

const ai = new GoogleGenAI({ apiKey });
// A superfície de Interactions é tipada de forma diferente entre versões do SDK; este cast isola isso.
const client = ai as unknown as {
  interactions: { create(req: unknown): Promise<{ output_video?: { uri?: string; data?: string } }> };
  files: {
    get(a: { name: string }): Promise<{ state?: string }>;
    download(a: { file: string; downloadPath: string }): Promise<void>;
  };
};

const outDir = path.resolve("spike-out");

async function generate(label: string, input: unknown) {
  const t0 = Date.now();
  const interaction = await client.interactions.create({
    model,
    input,
    response_format: { type: "video", aspect_ratio: "9:16", resolution: "720p", delivery: "uri" },
  });
  const uri = interaction.output_video?.uri;
  const id = uri?.match(/files\/([a-zA-Z0-9]+)/)?.[1];
  if (!id) throw new Error(`[${label}] sem arquivo de vídeo na resposta: ${JSON.stringify(interaction)}`);
  const name = `files/${id}`;
  for (;;) {
    const info = await client.files.get({ name });
    if (info.state === "ACTIVE") break;
    if (info.state === "FAILED") throw new Error(`[${label}] geração falhou`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  const file = path.join(outDir, `${label}.mp4`);
  await client.files.download({ file: name, downloadPath: file });
  const { stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  const probe = JSON.parse(stdout) as {
    format: { duration: string };
    streams: { codec_type: string; width?: number; height?: number }[];
  };
  const v = probe.streams.find((s) => s.codec_type === "video");
  console.log(
    `[${label}] ${((Date.now() - t0) / 1000).toFixed(0)}s de espera | duração ${Number(probe.format.duration).toFixed(2)}s | ` +
      `${v?.width}x${v?.height} | áudio: ${probe.streams.some((s) => s.codec_type === "audio")} | ${file}`,
  );
}

async function main() {
  await mkdir(outDir, { recursive: true });

  // A: texto puro, fala em pt-BR numa única geração (Gate 1 e 2)
  await generate(
    "A-texto-fala",
    "Vídeo vertical estilo UGC, filmado com celular. Uma mulher de 30 anos, em uma cozinha clara, olha para a câmera e diz em português do Brasil, com voz natural: \"Eu testei esse produto por uma semana e não acredito no resultado.\"",
  );

  // B: duas imagens de referência (Gate 3). Passe os caminhos em REF_PERSON e REF_PRODUCT.
  const personPath = process.env.REF_PERSON;
  const productPath = process.env.REF_PRODUCT;
  if (personPath && productPath) {
    const img = async (p: string) => ({
      type: "image",
      data: (await readFile(p)).toString("base64"),
      mime_type: p.endsWith(".png") ? "image/png" : "image/jpeg",
    });
    await generate("B-referencias", [
      {
        type: "text",
        text:
          "Vídeo vertical estilo UGC. A pessoa de <IMAGE_REF_1> segura o produto de <IMAGE_REF_2>, olha para a câmera e diz em português do Brasil: \"Olha só o que chegou hoje.\" Mantenha exatamente a aparência da pessoa e do produto.",
      },
      await img(personPath),
      await img(productPath),
    ]);
  } else {
    console.log("[B] pulado: defina REF_PERSON e REF_PRODUCT (caminhos de imagem)");
  }
  await writeFile(path.join(outDir, "done.txt"), new Date().toISOString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Rodar o spike (consome crédito; 2 gerações)**

Run:
```bash
GEMINI_API_KEY=<sua-chave> REF_PERSON=<foto-pessoa.jpg> REF_PRODUCT=<foto-produto.jpg> pnpm spike:video
```
Expected: duas linhas `[A-texto-fala] ...` e `[B-referencias] ...` com duração, resolução e `áudio: true`. Os MP4 ficam em `spike-out/` (ignorado pelo git). Se o SDK rejeitar o formato de `input` ou `response_format`, consultar `https://aistudio.google.com/docs/omni`, corrigir o script e registrar a forma correta em `docs/provider-spike.md`: o Plano 2 reaproveita exatamente essa forma.

- [ ] **Step 3: Assistir os dois vídeos e registrar em `docs/provider-spike.md`**

Criar o arquivo com este conteúdo, preenchendo cada campo com o que foi observado:

```markdown
# Spike do provider de vídeo

Data: <data da execução>
Modelo: <GEMINI_VIDEO_MODEL usado>
Chamada que funcionou: <formato de input/response_format que o SDK aceitou>

## Resultados
- Duração de um clipe gerado (A): <s>   (B): <s>
- Tempo de espera até ACTIVE (A): <s>   (B): <s>
- Resolução recebida: <WxH>
- Tem faixa de áudio: <sim/não>

## Gates
- [ ] Gate 1: saída vertical 9:16 com áudio
- [ ] Gate 2: a mulher **fala a frase em pt-BR** numa única geração (sem extensão)
- [ ] Gate 3: com 2 imagens de referência, pessoa e produto reconhecíveis no vídeo
- [ ] Gate 4: duração do clipe definida (usar como `SCENE_MAX_SECONDS`)

## Decisão
<Gates 1-4 passaram → seguir com Omni como definido no Plano 2, Task 11.>
<Gate 2 falhou → PARAR. Avisar o dono do projeto. Alternativas: (a) fluxo de extensão multi-turn do Omni para dar fala, (b) Veo 3.1 GA na Gemini Enterprise Agent Platform (Vertex). Só o provider de vídeo muda; o resto do plano segue igual.>
<Gate 3 falhou parcialmente → registrar quantas referências funcionam bem e ajustar `MAX_SCENE_REFERENCES`.>

## Valores para o .env
MAX_SCENE_REFERENCES=<n>
SCENE_MAX_SECONDS=<n>
```

- [ ] **Step 4: Commit**

```bash
git add scripts docs/provider-spike.md
git commit -m "docs: record video provider spike results"
```

---

### Task 4: Etapas e transições do projeto

**Files:**
- Create: `src/domain/stages.ts`
- Test: `tests/domain/stages.test.ts`

- [ ] **Step 1: Escrever os testes**

`tests/domain/stages.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { canTransition, nextStage, stagesFor } from "@/domain/stages";

describe("stagesFor", () => {
  it("ugc não tem etapa de personagens", () => {
    expect(stagesFor("ugc")).toEqual(["briefing", "script", "generating", "review", "assembling", "done"]);
  });
  it("novelinha tem todas as etapas", () => {
    expect(stagesFor("novelinha")).toEqual([
      "briefing", "characters", "script", "generating", "review", "assembling", "done",
    ]);
  });
});

describe("nextStage", () => {
  it("avança na ordem do modo", () => {
    expect(nextStage("ugc", "briefing")).toBe("script");
    expect(nextStage("novelinha", "briefing")).toBe("characters");
    expect(nextStage("novelinha", "characters")).toBe("script");
  });
  it("done não tem próxima", () => {
    expect(nextStage("ugc", "done")).toBeNull();
  });
});

describe("canTransition", () => {
  it("permite avançar só um passo", () => {
    expect(canTransition("ugc", "briefing", "script")).toBe(true);
    expect(canTransition("ugc", "briefing", "generating")).toBe(false);
  });
  it("permite voltar para etapas editáveis", () => {
    expect(canTransition("novelinha", "review", "script")).toBe(true);
    expect(canTransition("novelinha", "script", "characters")).toBe(true);
    expect(canTransition("ugc", "done", "review")).toBe(true);
  });
  it("não permite voltar para generating nem assembling", () => {
    expect(canTransition("ugc", "review", "generating")).toBe(false);
    expect(canTransition("ugc", "done", "assembling")).toBe(false);
  });
  it("assembling é travado", () => {
    expect(canTransition("ugc", "assembling", "review")).toBe(false);
  });
  it("etapa fora do modo é inválida", () => {
    expect(canTransition("ugc", "briefing", "characters")).toBe(false);
    expect(canTransition("ugc", "characters", "script")).toBe(false);
  });
  it("mesma etapa não é transição", () => {
    expect(canTransition("ugc", "script", "script")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/domain/stages.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `src/domain/stages.ts`**

```ts
export const MODES = ["ugc", "novelinha"] as const;
export type Mode = (typeof MODES)[number];

export const STAGES = [
  "briefing",
  "characters",
  "script",
  "generating",
  "review",
  "assembling",
  "done",
] as const;
export type Stage = (typeof STAGES)[number];

export function stagesFor(mode: Mode): Stage[] {
  return mode === "ugc" ? STAGES.filter((s) => s !== "characters") : [...STAGES];
}

export function nextStage(mode: Mode, stage: Stage): Stage | null {
  const list = stagesFor(mode);
  const i = list.indexOf(stage);
  return i >= 0 && i < list.length - 1 ? list[i + 1]! : null;
}

// Só se volta para etapas onde o usuário edita algo.
const NOT_REENTERABLE: Stage[] = ["generating", "assembling"];

export function canTransition(mode: Mode, from: Stage, to: Stage): boolean {
  const list = stagesFor(mode);
  const i = list.indexOf(from);
  const j = list.indexOf(to);
  if (i < 0 || j < 0 || i === j) return false;
  if (from === "assembling") return false;
  if (j === i + 1) return true;
  return j < i && !NOT_REENTERABLE.includes(to);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run tests/domain/stages.test.ts`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/stages.ts tests/domain
git commit -m "feat(domain): project stages and transition rules"
```

---

### Task 5: Banco de dados (schema, migrações, helpers de teste)

**Files:**
- Create: `src/db/schema.ts`, `src/db/client.ts`, `src/db/migrate.ts`, `drizzle.config.ts`, `tests/helpers/global-setup.ts`, `tests/helpers/db.ts`
- Modify: `vitest.config.ts`
- Test: `tests/db/schema.test.ts`

- [ ] **Step 1: Criar `src/db/schema.ts`**

```ts
import {
  boolean, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uuid,
} from "drizzle-orm/pg-core";
import type { Mode, Stage } from "../domain/stages";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const projects = pgTable("projects", {
  id: id(),
  name: text("name").notNull(),
  mode: text("mode").$type<Mode>().notNull(),
  copy: text("copy").notNull().default(""),
  stage: text("stage").$type<Stage>().notNull().default("briefing"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AssetKind = "reference" | "character" | "clip" | "final";

export const assets = pgTable("assets", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").$type<AssetKind>().notNull(),
  label: text("label"),
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type").notNull(),
  durationSeconds: real("duration_seconds"),
  createdAt: createdAt(),
});

export const characters = pgTable("characters", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  position: integer("position").notNull().default(0),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
  approved: boolean("approved").notNull().default(false),
  imageStatus: text("image_status").$type<"pending" | "ready" | "failed">().notNull().default("pending"),
  imageError: text("image_error"),
  createdAt: createdAt(),
});

export const scenes = pgTable("scenes", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  dialogue: text("dialogue").notNull().default(""),
  visualPrompt: text("visual_prompt").notNull(),
  targetSeconds: integer("target_seconds").notNull(),
  notice: text("notice"),
  approvedAttemptId: uuid("approved_attempt_id"),
  createdAt: createdAt(),
});

export const sceneReferences = pgTable(
  "scene_references",
  {
    sceneId: uuid("scene_id").notNull().references(() => scenes.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.sceneId, t.assetId] })],
);

export type AttemptStatus = "queued" | "generating" | "done" | "failed" | "blocked";

export const sceneAttempts = pgTable("scene_attempts", {
  id: id(),
  sceneId: uuid("scene_id").notNull().references(() => scenes.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  status: text("status").$type<AttemptStatus>().notNull().default("queued"),
  providerRef: text("provider_ref"),
  referenceAssetIds: jsonb("reference_asset_ids").$type<string[]>().notNull().default([]),
  clipAssetId: uuid("clip_asset_id"),
  error: text("error"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type JobStatus = "queued" | "running" | "done" | "failed";

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("jobs_queue_idx").on(t.status, t.runAt)],
);
```

- [ ] **Step 2: Criar `src/db/client.ts`, `src/db/migrate.ts`, `drizzle.config.ts`**

`src/db/client.ts`:
```ts
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export function createDb(url: string, max = 10) {
  const sql = postgres(url, { max });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

export type Db = ReturnType<typeof createDb>["db"];
```

`src/db/migrate.ts`:
```ts
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido");

const sql = postgres(url, { max: 1 });
await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
await sql.end();
console.log("migrações aplicadas");
```

`drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/gerador" },
});
```

- [ ] **Step 3: Gerar a migração inicial e inspecionar**

Run: `pnpm db:generate && ls drizzle/*.sql && grep -c "CREATE TABLE" drizzle/*.sql`
Expected: um arquivo `drizzle/0000_*.sql` e contagem `7` (projects, assets, characters, scenes, scene_references, scene_attempts, jobs).

- [ ] **Step 4: Criar helpers de teste**

`tests/helpers/global-setup.ts`:
```ts
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/gerador_test";

export default async function setup() {
  const sql = postgres(TEST_DATABASE_URL, { max: 1 });
  await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
  await sql.end();
}
```

`tests/helpers/db.ts`:
```ts
import { createDb } from "@/db/client";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/gerador_test";

const { db, sql } = createDb(TEST_DATABASE_URL, 5);

export const testDb = db;

export async function resetDb() {
  await sql.unsafe(
    "TRUNCATE projects, assets, characters, scenes, scene_references, scene_attempts, jobs RESTART IDENTITY CASCADE",
  );
}
```

Modificar `vitest.config.ts`: adicionar `globalSetup: ["tests/helpers/global-setup.ts"],` dentro de `test`.

- [ ] **Step 5: Escrever o teste de schema**

`tests/db/schema.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { assets, projects, sceneAttempts, scenes } from "@/db/schema";
import { resetDb, testDb as db } from "../helpers/db";

beforeEach(resetDb);

describe("schema", () => {
  it("cria projeto com defaults e apaga filhos em cascata", async () => {
    const [p] = await db.insert(projects).values({ name: "Teste", mode: "ugc" }).returning();
    expect(p!.stage).toBe("briefing");
    expect(p!.copy).toBe("");

    const [s] = await db
      .insert(scenes)
      .values({ projectId: p!.id, position: 0, visualPrompt: "v", targetSeconds: 5 })
      .returning();
    await db.insert(sceneAttempts).values({ sceneId: s!.id, prompt: "p" });
    await db.insert(assets).values({
      projectId: p!.id, kind: "reference", storageKey: "k", mimeType: "image/png",
    });

    await db.delete(projects).where(eq(projects.id, p!.id));

    expect(await db.select().from(scenes)).toHaveLength(0);
    expect(await db.select().from(sceneAttempts)).toHaveLength(0);
    expect(await db.select().from(assets)).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Rodar tudo**

Run: `pnpm test`
Expected: testes de env, stages e schema PASS (global setup aplica a migração em `gerador_test`).

- [ ] **Step 7: Commit**

```bash
git add src/db drizzle drizzle.config.ts tests vitest.config.ts
git commit -m "feat(db): schema, migrations and test database helpers"
```

---

### Task 6: Domínio do roteiro

**Files:**
- Create: `src/domain/script.ts`
- Test: `tests/domain/script.test.ts`

- [ ] **Step 1: Escrever os testes**

`tests/domain/script.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { resolveReferences, scriptDraftSchema } from "@/domain/script";

describe("scriptDraftSchema", () => {
  const schema = scriptDraftSchema(8);
  const scene = { dialogue: "Oi", visualPrompt: "Close no rosto", targetSeconds: 6, referenceLabels: ["produto"] };

  it("aceita um roteiro válido", () => {
    expect(schema.parse({ scenes: [scene] }).scenes).toHaveLength(1);
  });
  it("rejeita roteiro sem cenas", () => {
    expect(() => schema.parse({ scenes: [] })).toThrow();
  });
  it("rejeita duração acima do máximo do provider", () => {
    expect(() => schema.parse({ scenes: [{ ...scene, targetSeconds: 9 }] })).toThrow();
  });
  it("rejeita prompt visual vazio", () => {
    expect(() => schema.parse({ scenes: [{ ...scene, visualPrompt: "" }] })).toThrow();
  });
});

describe("resolveReferences", () => {
  const available = ["produto", "Maria", "João", "Ana"];

  it("mantém labels válidos, ignorando caixa e repetição", () => {
    const r = resolveReferences(["Produto", "maria", "MARIA"], available, 3);
    expect(r.used).toEqual(["produto", "Maria"]);
    expect(r.notice).toBeNull();
  });
  it("descarta labels desconhecidos e avisa", () => {
    const r = resolveReferences(["Maria", "Fantasma"], available, 3);
    expect(r.used).toEqual(["Maria"]);
    expect(r.notice).toContain("Fantasma");
  });
  it("corta acima do limite mantendo os primeiros e avisa", () => {
    const r = resolveReferences(["produto", "Maria", "João", "Ana"], available, 3);
    expect(r.used).toEqual(["produto", "Maria", "João"]);
    expect(r.notice).toContain("Ana");
    expect(r.notice).toContain("3");
  });
  it("lista vazia é válida", () => {
    expect(resolveReferences([], available, 3)).toEqual({ used: [], notice: null });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/domain/script.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `src/domain/script.ts`**

```ts
import { z } from "zod";

export function scriptDraftSchema(maxSeconds: number) {
  return z.object({
    scenes: z
      .array(
        z.object({
          dialogue: z.string(),
          visualPrompt: z.string().min(1),
          targetSeconds: z.number().int().min(3).max(maxSeconds),
          referenceLabels: z.array(z.string()),
        }),
      )
      .min(1)
      .max(40),
  });
}

export type ScriptDraft = z.infer<ReturnType<typeof scriptDraftSchema>>;

export function resolveReferences(
  labels: string[],
  available: string[],
  max: number,
): { used: string[]; notice: string | null } {
  const byKey = new Map(available.map((a) => [a.trim().toLowerCase(), a]));
  const seen = new Set<string>();
  const known: string[] = [];
  const unknown: string[] = [];

  for (const raw of labels) {
    const key = raw.trim().toLowerCase();
    const match = byKey.get(key);
    if (!match) {
      unknown.push(raw);
    } else if (!seen.has(key)) {
      seen.add(key);
      known.push(match);
    }
  }

  const used = known.slice(0, max);
  const cut = known.slice(max);
  const parts: string[] = [];
  if (unknown.length) parts.push(`Referências desconhecidas ignoradas: ${unknown.join(", ")}.`);
  if (cut.length) parts.push(`Limite de ${max} referências por cena; cortadas: ${cut.join(", ")}.`);
  return { used, notice: parts.length ? parts.join(" ") : null };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run tests/domain/script.test.ts`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/script.ts tests/domain/script.test.ts
git commit -m "feat(domain): script schema and reference limit rule"
```

---

### Task 7: Interfaces de providers e fakes

**Files:**
- Create: `src/providers/types.ts`, `src/providers/fake.ts`
- Test: `tests/providers/fake.test.ts`

- [ ] **Step 1: Criar `src/providers/types.ts`**

```ts
import type { ZodType } from "zod";

export type ImageData = { bytes: Buffer; mimeType: string };
export type ReferenceImage = ImageData & { label: string };

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export type TextTask = "script" | "characters";

export interface TextModel {
  generateJson<T>(args: { task: TextTask; system: string; prompt: string; schema: ZodType<T> }): Promise<T>;
}

export interface ImageModel {
  generateImage(args: { prompt: string; references?: ReferenceImage[] }): Promise<ImageData>;
}

export type VideoRequest = {
  prompt: string;
  references: ReferenceImage[];
  targetSeconds: number;
};

export type VideoPoll =
  | { state: "pending" }
  | { state: "done"; bytes: Buffer }
  | { state: "failed"; reason: string; retryable: boolean };

// start() inicia a geração e devolve uma referência durável (persistida no banco);
// poll() pode ser chamado de qualquer processo, inclusive após reinício do worker.
export interface VideoModel {
  start(req: VideoRequest): Promise<{ providerRef: string }>;
  poll(handle: { providerRef: string }): Promise<VideoPoll>;
}

export type Providers = { text: TextModel; image: ImageModel; video: VideoModel };
```

- [ ] **Step 2: Escrever os testes dos fakes**

`tests/providers/fake.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeImageModel, FakeTextModel, FakeVideoModel } from "@/providers/fake";

describe("FakeTextModel", () => {
  const schema = z.object({ n: z.number() });

  it("devolve as respostas em ordem, validadas pelo schema", async () => {
    const m = new FakeTextModel([{ n: 1 }, { n: 2 }]);
    expect(await m.generateJson({ task: "script", system: "s", prompt: "p", schema })).toEqual({ n: 1 });
    expect(await m.generateJson({ task: "script", system: "s", prompt: "p", schema })).toEqual({ n: 2 });
    expect(m.calls).toHaveLength(2);
  });
  it("lança ZodError quando a resposta não bate com o schema", async () => {
    const m = new FakeTextModel([{ n: "x" }]);
    await expect(m.generateJson({ task: "script", system: "s", prompt: "p", schema })).rejects.toBeInstanceOf(z.ZodError);
  });
  it("falha de forma clara quando acabam as respostas", async () => {
    const m = new FakeTextModel([]);
    await expect(m.generateJson({ task: "script", system: "s", prompt: "p", schema })).rejects.toThrow(/sem respostas/);
  });
});

describe("FakeImageModel", () => {
  it("devolve um PNG válido", async () => {
    const img = await new FakeImageModel().generateImage({ prompt: "x" });
    expect(img.mimeType).toBe("image/png");
    expect(img.bytes.subarray(1, 4).toString()).toBe("PNG");
  });
});

describe("FakeVideoModel", () => {
  const clip = Buffer.from("mp4");
  const req = { prompt: "p", references: [], targetSeconds: 5 };

  it("fica pendente N polls e depois entrega o clipe", async () => {
    const v = new FakeVideoModel({ clip, pendingPolls: 2 });
    const h = await v.start(req);
    expect((await v.poll(h)).state).toBe("pending");
    expect((await v.poll(h)).state).toBe("pending");
    expect(await v.poll(h)).toEqual({ state: "done", bytes: clip });
  });
  it("pode simular falha", async () => {
    const v = new FakeVideoModel({ clip, failure: { reason: "bloqueado", retryable: false } });
    const h = await v.start(req);
    expect(await v.poll(h)).toEqual({ state: "failed", reason: "bloqueado", retryable: false });
  });
  it("gera referências distintas por start", async () => {
    const v = new FakeVideoModel({ clip });
    const a = await v.start(req);
    const b = await v.start(req);
    expect(a.providerRef).not.toBe(b.providerRef);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm vitest run tests/providers/fake.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 4: Implementar `src/providers/fake.ts`**

```ts
import type { ZodType } from "zod";
import {
  ProviderError,
  type ImageData,
  type ImageModel,
  type ReferenceImage,
  type TextModel,
  type TextTask,
  type VideoModel,
  type VideoPoll,
  type VideoRequest,
} from "./types";

export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

type TextCall = { task: TextTask; system: string; prompt: string };

export class FakeTextModel implements TextModel {
  readonly calls: TextCall[] = [];

  // `responses`: fila de objetos devolvidos em ordem; ou função que decide pela chamada.
  constructor(private responses: unknown[] | ((call: TextCall) => unknown)) {}

  async generateJson<T>(args: { task: TextTask; system: string; prompt: string; schema: ZodType<T> }): Promise<T> {
    const call = { task: args.task, system: args.system, prompt: args.prompt };
    this.calls.push(call);
    const next = typeof this.responses === "function" ? this.responses(call) : this.responses.shift();
    if (next === undefined) throw new ProviderError("FakeTextModel: sem respostas na fila", false);
    return args.schema.parse(next);
  }
}

export class FakeImageModel implements ImageModel {
  readonly calls: { prompt: string; references?: ReferenceImage[] }[] = [];

  async generateImage(args: { prompt: string; references?: ReferenceImage[] }): Promise<ImageData> {
    this.calls.push(args);
    return { bytes: PNG_1X1, mimeType: "image/png" };
  }
}

export class FakeVideoModel implements VideoModel {
  readonly starts: VideoRequest[] = [];
  private polls = new Map<string, number>();

  constructor(
    private opts: {
      clip: Buffer;
      pendingPolls?: number;
      failure?: { reason: string; retryable: boolean };
    },
  ) {}

  async start(req: VideoRequest) {
    this.starts.push(req);
    return { providerRef: `fake-${this.starts.length}` };
  }

  async poll({ providerRef }: { providerRef: string }): Promise<VideoPoll> {
    const n = (this.polls.get(providerRef) ?? 0) + 1;
    this.polls.set(providerRef, n);
    if (n <= (this.opts.pendingPolls ?? 0)) return { state: "pending" };
    if (this.opts.failure) return { state: "failed", ...this.opts.failure };
    return { state: "done", bytes: this.opts.clip };
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm vitest run tests/providers/fake.test.ts`
Expected: todos PASS.

- [ ] **Step 6: Commit**

```bash
git add src/providers tests/providers
git commit -m "feat(providers): model interfaces and fake implementations"
```

---

### Task 8: Storage de arquivos

**Files:**
- Create: `src/storage/types.ts`, `src/storage/fs.ts`, `src/storage/s3.ts`, `src/storage/index.ts`
- Test: `tests/storage/fs.test.ts`

- [ ] **Step 1: Criar `src/storage/types.ts`**

```ts
export interface Storage {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}
```

- [ ] **Step 2: Escrever os testes do `FsStorage`**

`tests/storage/fs.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FsStorage } from "@/storage/fs";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fs-storage-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FsStorage", () => {
  it("grava e lê bytes, criando subpastas", async () => {
    const s = new FsStorage(dir);
    await s.put("projects/abc/clips/1.mp4", Buffer.from("conteudo"), "video/mp4");
    expect((await s.get("projects/abc/clips/1.mp4")).toString()).toBe("conteudo");
  });
  it("rejeita chaves que escapam do diretório", async () => {
    const s = new FsStorage(dir);
    await expect(s.put("../fora.txt", Buffer.from("x"), "text/plain")).rejects.toThrow(/chave inválida/);
    await expect(s.get("/etc/passwd")).rejects.toThrow(/chave inválida/);
  });
  it("get de chave inexistente falha", async () => {
    await expect(new FsStorage(dir).get("nao/existe")).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm vitest run tests/storage/fs.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 4: Implementar `src/storage/fs.ts`**

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Storage } from "./types";

export class FsStorage implements Storage {
  private root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (path.isAbsolute(key) || !full.startsWith(this.root + path.sep)) {
      throw new Error(`chave inválida: ${key}`);
    }
    return full;
  }

  async put(key: string, bytes: Buffer, _contentType: string): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }
}
```

- [ ] **Step 5: Implementar `src/storage/s3.ts` e `src/storage/index.ts`**

`src/storage/s3.ts`:
```ts
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Storage } from "./types";

export class S3Storage implements Storage {
  private client: S3Client;

  constructor(
    private bucket: string,
    opts: { endpoint: string; region: string; accessKeyId: string; secretAccessKey: string },
  ) {
    this.client = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      forcePathStyle: true,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`objeto vazio: ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }
}
```

`src/storage/index.ts`:
```ts
import type { Env } from "@/config/env";
import { FsStorage } from "./fs";
import { S3Storage } from "./s3";
import type { Storage } from "./types";

export type { Storage } from "./types";

export function createStorage(env: Env): Storage {
  if (env.STORAGE === "fs") return new FsStorage(env.LOCAL_STORAGE_DIR);
  return new S3Storage(env.S3_BUCKET!, {
    endpoint: env.S3_ENDPOINT!,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
  });
}
```

- [ ] **Step 6: Rodar testes e typecheck**

Run: `pnpm vitest run tests/storage && pnpm typecheck`
Expected: testes PASS; typecheck sem erros. (`S3Storage` não tem teste unitário: é coberto pelo smoke test do Plano 3.)

- [ ] **Step 7: Commit**

```bash
git add src/storage tests/storage
git commit -m "feat(storage): fs and s3 storage behind a common interface"
```

---

### Task 9: Fila de jobs

**Files:**
- Create: `src/queue/errors.ts`, `src/queue/queue.ts`
- Test: `tests/queue/queue.test.ts`

- [ ] **Step 1: Criar `src/queue/errors.ts`**

```ts
// Handler pede para ser reexecutado depois, sem gastar tentativa (ex.: geração ainda em andamento).
export class RetryLater extends Error {
  constructor(public readonly delayMs: number) {
    super(`retry in ${delayMs}ms`);
    this.name = "RetryLater";
  }
}

// Erro definitivo: não adianta tentar de novo.
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}
```

- [ ] **Step 2: Escrever os testes da fila**

`tests/queue/queue.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { jobs } from "@/db/schema";
import { backoffMs, claim, complete, enqueue, fail, reclaimStale, release } from "@/queue/queue";
import { resetDb, testDb as db } from "../helpers/db";

beforeEach(resetDb);

const get = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0]!;

describe("queue", () => {
  it("claim pega o job mais antigo pronto e o marca como running", async () => {
    const a = await enqueue(db, "assemble", { n: 1 });
    await enqueue(db, "assemble", { n: 2 });
    const job = await claim(db);
    expect(job!.id).toBe(a.id);
    expect(job!.status).toBe("running");
    expect(job!.attempts).toBe(1);
  });

  it("claim ignora jobs agendados para o futuro", async () => {
    await enqueue(db, "assemble", {}, { runAt: new Date(Date.now() + 60_000) });
    expect(await claim(db)).toBeNull();
  });

  it("dois claims concorrentes não pegam o mesmo job", async () => {
    await enqueue(db, "assemble", {});
    const [x, y] = await Promise.all([claim(db), claim(db)]);
    expect([x, y].filter(Boolean)).toHaveLength(1);
  });

  it("complete marca done", async () => {
    await enqueue(db, "assemble", {});
    const job = (await claim(db))!;
    await complete(db, job.id);
    expect((await get(job.id)).status).toBe("done");
  });

  it("release devolve à fila sem consumir tentativa", async () => {
    await enqueue(db, "generate_scene", {});
    const job = (await claim(db))!;
    await release(db, job, 5_000);
    const after = await get(job.id);
    expect(after.status).toBe("queued");
    expect(after.attempts).toBe(0);
    expect(after.runAt.getTime()).toBeGreaterThan(Date.now() + 3_000);
  });

  it("fail retryable reagenda com backoff até esgotar tentativas", async () => {
    await enqueue(db, "assemble", {}, { maxAttempts: 2 });
    const first = (await claim(db))!;
    expect(await fail(db, first, "erro 1", true)).toBe("retry");
    const queued = await get(first.id);
    expect(queued.status).toBe("queued");
    expect(queued.error).toBe("erro 1");
    expect(queued.runAt.getTime()).toBeGreaterThan(Date.now() + backoffMs(1) - 1_000);

    await db.update(jobs).set({ runAt: new Date() }).where(eq(jobs.id, first.id));
    const second = (await claim(db))!;
    expect(await fail(db, second, "erro 2", true)).toBe("dead");
    expect((await get(first.id)).status).toBe("failed");
  });

  it("fail não-retryable vai direto para failed", async () => {
    await enqueue(db, "assemble", {});
    const job = (await claim(db))!;
    expect(await fail(db, job, "definitivo", false)).toBe("dead");
    expect((await get(job.id)).status).toBe("failed");
  });

  it("reclaimStale devolve à fila jobs running travados", async () => {
    await enqueue(db, "assemble", {});
    const job = (await claim(db))!;
    await db.update(jobs).set({ lockedAt: new Date(Date.now() - 20 * 60_000) }).where(eq(jobs.id, job.id));
    expect(await reclaimStale(db, 10 * 60_000)).toBe(1);
    expect((await get(job.id)).status).toBe("queued");
  });

  it("backoff cresce e tem teto", () => {
    expect(backoffMs(1)).toBe(5_000);
    expect(backoffMs(2)).toBe(10_000);
    expect(backoffMs(20)).toBe(5 * 60_000);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm vitest run tests/queue/queue.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 4: Implementar `src/queue/queue.ts`**

```ts
import { and, eq, lt, lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { jobs } from "@/db/schema";

export type JobType = "generate_character" | "generate_scene" | "assemble";
export type Job = typeof jobs.$inferSelect;

export async function enqueue(
  db: Db,
  type: JobType,
  payload: Record<string, unknown>,
  opts: { runAt?: Date; maxAttempts?: number } = {},
): Promise<Job> {
  const [row] = await db
    .insert(jobs)
    .values({ type, payload, runAt: opts.runAt ?? new Date(), maxAttempts: opts.maxAttempts ?? 5 })
    .returning();
  return row!;
}

export async function claim(db: Db): Promise<Job | null> {
  return db.transaction(async (tx) => {
    const [next] = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "queued"), lte(jobs.runAt, new Date())))
      .orderBy(jobs.runAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!next) return null;
    const [row] = await tx
      .update(jobs)
      .set({ status: "running", lockedAt: new Date(), attempts: next.attempts + 1 })
      .where(eq(jobs.id, next.id))
      .returning();
    return row!;
  });
}

export async function complete(db: Db, id: string): Promise<void> {
  await db.update(jobs).set({ status: "done", lockedAt: null, error: null }).where(eq(jobs.id, id));
}

export async function release(db: Db, job: Job, delayMs: number): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: "queued",
      lockedAt: null,
      runAt: new Date(Date.now() + delayMs),
      attempts: Math.max(0, job.attempts - 1),
    })
    .where(eq(jobs.id, job.id));
}

export function backoffMs(attempts: number): number {
  return Math.min(5_000 * 2 ** (attempts - 1), 5 * 60_000);
}

export async function fail(db: Db, job: Job, message: string, retryable: boolean): Promise<"retry" | "dead"> {
  if (retryable && job.attempts < job.maxAttempts) {
    await db
      .update(jobs)
      .set({
        status: "queued",
        lockedAt: null,
        runAt: new Date(Date.now() + backoffMs(job.attempts)),
        error: message,
      })
      .where(eq(jobs.id, job.id));
    return "retry";
  }
  await db.update(jobs).set({ status: "failed", lockedAt: null, error: message }).where(eq(jobs.id, job.id));
  return "dead";
}

export async function reclaimStale(db: Db, olderThanMs: number): Promise<number> {
  const rows = await db
    .update(jobs)
    .set({ status: "queued", lockedAt: null })
    .where(and(eq(jobs.status, "running"), lt(jobs.lockedAt, new Date(Date.now() - olderThanMs))))
    .returning({ id: jobs.id });
  return rows.length;
}
```

- [ ] **Step 5: Rodar tudo**

Run: `pnpm test && pnpm typecheck`
Expected: todos os testes PASS; typecheck limpo.

- [ ] **Step 6: Commit**

```bash
git add src/queue tests/queue
git commit -m "feat(queue): postgres-backed job queue with retry and stale reclaim"
```

---

## Auto-revisão do Plano 1 contra o spec

- §4 Arquitetura: tooling, fila (`job-queue`), `storage`, interfaces de providers → Tasks 1, 8, 9, 7.
- §6 Modelo de dados: todas as 7 tabelas → Task 5. (`scene_attempts` ganhou `reference_asset_ids` para guardar as referências usadas em cada tentativa, conforme §5 "cada tentativa guarda prompt, referências e clipe".)
- §5 Estados: Task 4. §4 limite de referências: Task 6.
- §7 Erros: backoff, retry, jobs travados → Task 9; `ProviderError.retryable` → Task 7.
- §8 Testes: provider falso → Task 7; fila e estados → Tasks 4 e 9.
- Mudança desde o spec aprovado: risco do provider de vídeo → Task 3 (spike com gates). `SCENE_MAX_SECONDS` e `MAX_SCENE_REFERENCES` vêm do `.env` em vez de constantes fixas (4/6/8s e 3), porque dependem do modelo.
