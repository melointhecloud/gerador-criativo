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
