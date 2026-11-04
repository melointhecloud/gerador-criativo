import { defineConfig } from "vitest/config";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import path from "node:path";

// O vitest não carrega o .env em process.env; lê só TEST_DATABASE_URL de lá (o ambiente real tem prioridade).
// (Usa util.parseEnv do Node em vez de loadEnv do Vite, que o pnpm não expõe sem o `vite` como dependência direta.)
const dotenv = existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")) : {};
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? dotenv.TEST_DATABASE_URL;

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    globalSetup: ["tests/helpers/global-setup.ts"],
    env: TEST_DATABASE_URL ? { TEST_DATABASE_URL } : {},
  },
});
