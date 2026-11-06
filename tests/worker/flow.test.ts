import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { assets, jobs, sceneAttempts } from "@/db/schema";
import { probe, withTempDir } from "@/modules/ffmpeg";
import { addReference, createProject, getSnapshot, setStage, updateBriefing } from "@/services/projects";
import { approveAttempt, generateAllScenes, planProjectScript, startAssembly } from "@/services/scenes";
import { buildHandlers } from "@/worker/handlers";
import { runOnce } from "@/worker/runner";
import { makeClipBytes, makeDeps } from "../helpers/deps";
import { resetDb, testDb as db } from "../helpers/db";

// Spec §8: o fluxo inteiro (briefing -> roteiro -> geração -> revisão -> montagem) roda sem gastar crédito.
beforeEach(resetDb);
let cleanup: () => Promise<void>;
afterEach(async () => cleanup?.());

const script = {
  scenes: [
    { dialogue: "Olha o que eu achei", visualPrompt: "Close no produto", targetSeconds: 3, referenceLabels: ["produto"] },
    { dialogue: "Funciona de verdade", visualPrompt: "Plano médio sorrindo", targetSeconds: 3, referenceLabels: [] },
  ],
};

// Roda o worker até a fila esvaziar. Jobs adiados (RetryLater) têm o run_at trazido para o passado,
// em vez de esperar os 10 s reais do polling.
async function drain(handlers: ReturnType<typeof buildHandlers>) {
  for (let i = 0; i < 100; i++) {
    await db.update(jobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(jobs.status, "queued"));
    if (!(await runOnce(db, handlers))) return;
  }
  throw new Error("a fila não esvaziou em 100 iterações");
}

async function ugcUntilGenerated(m: Awaited<ReturnType<typeof makeDeps>>) {
  const handlers = buildHandlers(m.deps);
  const p = await createProject(db, { name: "Flow", mode: "ugc" });
  await updateBriefing(db, p.id, { copy: "Copy do produto milagroso" });
  await addReference(m.deps, { projectId: p.id, label: "produto", bytes: Buffer.from("png"), mimeType: "image/png" });
  await setStage(db, p.id, "script");
  await planProjectScript(m.deps, p.id);
  await generateAllScenes(m.deps, p.id);
  await drain(handlers);
  return { p, handlers };
}

describe("fluxo UGC ponta a ponta com providers falsos", () => {
  it("briefing -> roteiro -> geração -> revisão -> aprovação -> montagem -> done", async () => {
    const m = await makeDeps({ text: [script], video: { clip: await makeClipBytes(1), pendingPolls: 1 } });
    cleanup = m.cleanup;
    const { p, handlers } = await ugcUntilGenerated(m);

    let snap = await getSnapshot(db, p.id);
    expect(snap.project.stage).toBe("review");
    expect(snap.scenes).toHaveLength(2);
    expect(snap.scenes.every((s) => s.attempts.length === 1 && s.attempts[0]!.status === "done")).toBe(true);
    expect(m.video.starts).toHaveLength(2); // uma geração paga por cena, mesmo com polls pendentes
    expect(m.video.starts[0]!.references.map((r) => r.label)).toEqual(["produto"]);

    for (const s of snap.scenes) await approveAttempt(db, s.id, s.attempts[0]!.id);
    await startAssembly(db, p.id);
    expect((await getSnapshot(db, p.id)).project.stage).toBe("assembling");
    await drain(handlers);

    snap = await getSnapshot(db, p.id);
    expect(snap.project.stage).toBe("done");
    expect(snap.finalAsset).not.toBeNull();
    const bytes = await m.deps.storage.get(snap.finalAsset!.storageKey);
    await withTempDir(async (dir) => {
      const file = path.join(dir, "final.mp4");
      await writeFile(file, bytes);
      const out = await probe(file);
      expect(out.height).toBeGreaterThan(out.width);
      expect(out.hasAudio).toBe(true);
      expect(out.durationSeconds).toBeGreaterThan(1.5);
      expect(out.durationSeconds).toBeLessThan(2.6);
    });
    expect(await db.select().from(jobs).where(and(eq(jobs.status, "failed")))).toHaveLength(0);
  });

  it("uma cena bloqueada pelo provider não trava as outras: projeto chega em revisão", async () => {
    const m = await makeDeps({ text: [script], video: { clip: await makeClipBytes(1) } });
    cleanup = m.cleanup;
    const ok = m.video.poll.bind(m.video);
    m.video.poll = async (h) =>
      h.providerRef === "fake-1" ? { state: "failed", reason: "Conteúdo bloqueado", retryable: false } : ok(h);
    const { p } = await ugcUntilGenerated(m);

    const snap = await getSnapshot(db, p.id);
    expect(snap.project.stage).toBe("review");
    const statuses = snap.scenes.map((s) => s.attempts[0]!.status).sort();
    expect(statuses).toEqual(["blocked", "done"]);
    const blocked = (await db.select().from(sceneAttempts)).find((a) => a.status === "blocked")!;
    expect(blocked.error).toBe("Conteúdo bloqueado");
    // A cena bloqueada não tem clipe aprovável.
    const blockedScene = snap.scenes.find((s) => s.attempts[0]!.status === "blocked")!;
    await expect(approveAttempt(db, blockedScene.id, blocked.id)).rejects.toThrow(/geração pronta/);
    expect(await db.select().from(assets).where(eq(assets.kind, "clip"))).toHaveLength(1);
  });
});
