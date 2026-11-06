import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { jobs, projects, sceneAttempts, scenes } from "@/db/schema";
import {
  approveAttempt, generateAllScenes, planProjectScript, regenerateAllScenes, regenerateScene,
  startAssembly, totalSeconds, updateScene,
} from "@/services/scenes";
import { getSnapshot } from "@/services/projects";
import { makeDeps } from "../helpers/deps";
import { resetDb, testDb as db } from "../helpers/db";
import { seedAsset, seedAttempt, seedCharacter, seedProject, seedScene } from "../helpers/seed";

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
});
