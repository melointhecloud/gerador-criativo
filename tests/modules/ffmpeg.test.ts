import { describe, expect, it } from "vitest";
import path from "node:path";
import { makeTestClip, probe, runFfmpeg, withTempDir } from "@/modules/ffmpeg";

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

  it("runFfmpeg interrompe o processo e falha em pt-BR ao estourar o tempo limite", async () => {
    await withTempDir(async (dir) => {
      const t0 = Date.now();
      await expect(
        runFfmpeg(["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=600", "-f", "null", "-"], {
          timeoutMs: 50,
        }),
      ).rejects.toThrow(/excedeu o tempo limite/);
      expect(Date.now() - t0).toBeLessThan(5000);
      void dir;
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
