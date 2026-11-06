import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadEnv } from "@/config/env";
import { scriptDraftSchema } from "@/domain/script";
import { probe, withTempDir } from "@/modules/ffmpeg";
import { createProviders } from "@/providers";
import { createDevProviders } from "@/providers/dev";

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

  it("gera um clipe de verdade depois de alguns polls, que o probe aceita (vertical, com áudio)", async () => {
    const { video } = await createDevProviders();
    const h = await video.start({ prompt: "x", references: [], targetSeconds: 3 });
    expect((await video.poll(h)).state).toBe("pending");
    expect((await video.poll(h)).state).toBe("pending");
    const done = await video.poll(h);
    expect(done.state).toBe("done");
    if (done.state !== "done") return;
    expect(done.bytes.length).toBeGreaterThan(1000);
    await withTempDir(async (dir) => {
      const file = path.join(dir, "c.mp4");
      await writeFile(file, done.bytes);
      const p = await probe(file);
      expect(p.height).toBeGreaterThan(p.width);
      expect(p.hasAudio).toBe(true);
      expect(p.durationSeconds).toBeGreaterThan(2);
    });
  });
});

describe("createProviders", () => {
  const env = (provider: string) =>
    loadEnv({
      DATABASE_URL: "postgres://x",
      PROVIDER: provider,
      GEMINI_API_KEY: "k",
      GEMINI_TEXT_MODEL: "t",
      GEMINI_IMAGE_MODEL: "i",
      ACCESS_PASSWORD: "x",
      SESSION_SECRET: "a".repeat(32),
    });

  it("PROVIDER=fake devolve os providers de desenvolvimento", async () => {
    const providers = await createProviders(env("fake"));
    expect(Object.keys(providers).sort()).toEqual(["image", "text", "video"]);
  });

  it("PROVIDER=gemini ainda não implementado: erro claro em português", async () => {
    await expect(createProviders(env("gemini"))).rejects.toThrow(/Provider Gemini ainda não implementado/);
  });
});
