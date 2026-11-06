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


describe("handleAssemble (robustez)", () => {
  it("é idempotente: reexecutar com o projeto concluído não gera um segundo asset final", async () => {
    const { m, p } = await projectReadyToAssemble(1);
    await handleAssemble(m.deps, { projectId: p.id });
    await handleAssemble(m.deps, { projectId: p.id });
    const finals = await db.select().from(assets).where(eq(assets.kind, "final"));
    expect(finals).toHaveLength(1);
  });

  it("ignora o job se o projeto não está em montagem", async () => {
    const { m, p } = await projectReadyToAssemble(1);
    await db.update(projects).set({ stage: "review" }).where(eq(projects.id, p.id));
    await handleAssemble(m.deps, { projectId: p.id });
    expect(await db.select().from(assets).where(eq(assets.kind, "final"))).toHaveLength(0);
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("review");
  });

  it("remontar depois de voltar à revisão substitui o asset final (mesma chave)", async () => {
    const { m, p } = await projectReadyToAssemble(1);
    await handleAssemble(m.deps, { projectId: p.id });
    await db.update(projects).set({ stage: "assembling" }).where(eq(projects.id, p.id));
    await handleAssemble(m.deps, { projectId: p.id });
    const finals = await db.select().from(assets).where(eq(assets.kind, "final"));
    expect(finals).toHaveLength(1);
    expect(finals[0]!.storageKey).toBe(`projects/${p.id}/final/final.mp4`);
  });

  it("falha de forma permanente, em português, se o arquivo do clipe sumiu do storage", async () => {
    const { m, p } = await projectReadyToAssemble(1);
    await db.update(assets).set({ storageKey: `projects/${p.id}/clips/sumiu.mp4` }).where(eq(assets.kind, "clip"));
    await expect(handleAssemble(m.deps, { projectId: p.id })).rejects.toThrow(/arquivo do clipe da cena 1/);
  });

  it("falha de forma permanente se o asset do clipe aprovado não existe mais", async () => {
    const { m, p } = await projectReadyToAssemble(1);
    await db.delete(assets).where(eq(assets.kind, "clip"));
    await expect(handleAssemble(m.deps, { projectId: p.id })).rejects.toBeInstanceOf(PermanentError);
  });
});

describe("onAssembleDead", () => {
  it("devolve o projeto para a revisão", async () => {
    const { m, p } = await projectReadyToAssemble(1);
    await onAssembleDead(m.deps, { projectId: p.id }, "ffmpeg quebrou");
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("review");
  });

  it("não mexe em projeto que não está em montagem", async () => {
    const { m, p } = await projectReadyToAssemble(1);
    await db.update(projects).set({ stage: "done" }).where(eq(projects.id, p.id));
    await onAssembleDead(m.deps, { projectId: p.id }, "x");
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("done");
  });
});
