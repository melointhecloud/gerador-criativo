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
