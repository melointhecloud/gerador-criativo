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

  it("se a geração começa durante a chamada ao modelo, o replanejamento é rejeitado e as cenas geradas sobrevivem", async () => {
    const { m, p } = await projectWithScript();
    const inner = m.deps.providers.text;
    // Simula o intercalamento: enquanto o LLM "pensa", outra requisição aprova o roteiro e gera as cenas.
    m.deps.providers.text = {
      async generateJson(args) {
        await generateAllScenes(m.deps, p.id);
        return inner.generateJson(args);
      },
    };
    (m.text as unknown as { responses: unknown[] }).responses.push(draft());
    await expect(planProjectScript(m.deps, p.id)).rejects.toThrow(/etapa de roteiro/);
    const snap = await getSnapshot(db, p.id);
    expect(snap.project.stage).toBe("generating");
    expect(snap.scenes).toHaveLength(2);
    expect(await db.select().from(sceneAttempts)).toHaveLength(2);
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
