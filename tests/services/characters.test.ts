import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { assets, characters, jobs } from "@/db/schema";
import { handleGenerateCharacter, onGenerateCharacterDead } from "@/modules/character-designer";
import {
  addCharacter, approveCharacter, proposeProjectCharacters, regenerateCharacterImage, removeCharacter, updateCharacter,
} from "@/services/characters";
import { makeDeps } from "../helpers/deps";
import { resetDb, testDb as db } from "../helpers/db";
import { ProviderError } from "@/providers/types";
import { seedAsset, seedCharacter, seedProject } from "../helpers/seed";

beforeEach(resetDb);
let cleanup: () => Promise<void>;
afterEach(async () => cleanup?.());

const charOf = async (id: string) => (await db.select().from(characters).where(eq(characters.id, id)))[0]!;

describe("proposeProjectCharacters", () => {
  it("cria personagens pendentes e enfileira uma imagem por personagem", async () => {
    const m = await makeDeps({
      text: [{ characters: [{ name: "Maria", description: "35 anos" }, { name: "Carlos", description: "40 anos" }] }],
    });
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    await proposeProjectCharacters(m.deps, p.id);
    const list = await db.select().from(characters).where(eq(characters.projectId, p.id));
    expect(list.map((c) => c.name).sort()).toEqual(["Carlos", "Maria"]);
    expect(list.every((c) => c.imageStatus === "pending" && !c.approved)).toBe(true);
    const queued = await db.select().from(jobs);
    expect(queued.map((j) => j.type)).toEqual(["generate_character", "generate_character"]);
  });

  it("só na etapa de personagens e só em novelinha", async () => {
    const m = await makeDeps({ text: [] });
    cleanup = m.cleanup;
    const a = await seedProject(db, { mode: "ugc", stage: "briefing" });
    await expect(proposeProjectCharacters(m.deps, a.id)).rejects.toThrow(/personagens/);
  });
});

describe("CRUD", () => {
  it("addCharacter valida rótulo único e enfileira imagem", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    await addCharacter(m.deps, p.id, { name: "Helena", description: "vizinha, 30 anos" });
    await expect(addCharacter(m.deps, p.id, { name: "helena", description: "outra" })).rejects.toThrow(/Já existe/);
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("updateCharacter desaprova e regera a imagem quando a descrição muda", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const c = await seedCharacter(db, p.id, { approved: true, imageStatus: "ready" });
    await updateCharacter(m.deps, c.id, { description: "cabelo loiro curto" });
    const after = await charOf(c.id);
    expect(after.approved).toBe(false);
    expect(after.imageStatus).toBe("pending");
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("updateCharacter só do nome não regera a imagem, mas desaprova", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const c = await seedCharacter(db, p.id, { approved: true, imageStatus: "ready" });
    await updateCharacter(m.deps, c.id, { name: "Mariana" });
    expect((await charOf(c.id)).name).toBe("Mariana");
    expect(await db.select().from(jobs)).toHaveLength(0);
  });

  it("approveCharacter exige imagem pronta", async () => {
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const pending = await seedCharacter(db, p.id, { name: "A", imageStatus: "pending" });
    await expect(approveCharacter(db, pending.id)).rejects.toThrow(/imagem/);
    const img = await seedAsset(db, p.id, { kind: "character", label: "B" });
    const ready = await seedCharacter(db, p.id, { name: "B", imageStatus: "ready", assetId: img.id });
    expect((await approveCharacter(db, ready.id)).approved).toBe(true);
  });

  it("removeCharacter apaga personagem e a imagem", async () => {
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const img = await seedAsset(db, p.id, { kind: "character", label: "A" });
    const c = await seedCharacter(db, p.id, { name: "A", imageStatus: "ready", assetId: img.id });
    await removeCharacter(db, c.id);
    expect(await db.select().from(characters)).toHaveLength(0);
    expect(await db.select().from(assets).where(eq(assets.id, img.id))).toHaveLength(0);
  });

  it("regenerateCharacterImage volta para pending e enfileira", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const c = await seedCharacter(db, p.id, { approved: true, imageStatus: "ready" });
    await regenerateCharacterImage(m.deps, c.id);
    expect((await charOf(c.id)).imageStatus).toBe("pending");
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("regenerateCharacterImage não enfileira de novo enquanto está pending (clique duplo)", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const c = await seedCharacter(db, p.id, { imageStatus: "ready" });
    const results = await Promise.allSettled([
      regenerateCharacterImage(m.deps, c.id),
      regenerateCharacterImage(m.deps, c.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("regenerateCharacterImage recupera um personagem failed", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const c = await seedCharacter(db, p.id, { imageStatus: "failed" });
    await regenerateCharacterImage(m.deps, c.id);
    expect((await charOf(c.id)).imageStatus).toBe("pending");
  });

  it("renomear acompanha o rótulo da imagem e respeita rótulo único", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const img = await seedAsset(db, p.id, { kind: "character", label: "Maria" });
    const c = await seedCharacter(db, p.id, { name: "Maria", imageStatus: "ready", assetId: img.id });
    await seedCharacter(db, p.id, { name: "Carlos" });
    await expect(updateCharacter(m.deps, c.id, { name: " carlos " })).rejects.toThrow(/Já existe/);
    await updateCharacter(m.deps, c.id, { name: "Mariana" });
    const [a] = await db.select().from(assets).where(eq(assets.id, img.id));
    expect(a!.label).toBe("Mariana");
  });

  it("fora da etapa de personagens nada é alterado", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "script" });
    const img = await seedAsset(db, p.id, { kind: "character", label: "A" });
    const c = await seedCharacter(db, p.id, { name: "A", imageStatus: "ready", assetId: img.id, approved: true });
    await expect(updateCharacter(m.deps, c.id, { description: "x" })).rejects.toThrow(/personagens/);
    await expect(regenerateCharacterImage(m.deps, c.id)).rejects.toThrow(/personagens/);
    await expect(approveCharacter(db, c.id)).rejects.toThrow(/personagens/);
    await expect(removeCharacter(db, c.id)).rejects.toThrow(/personagens/);
    await expect(addCharacter(m.deps, p.id, { name: "B", description: "d" })).rejects.toThrow(/personagens/);
    expect(await db.select().from(jobs)).toHaveLength(0);
    expect((await charOf(c.id)).assetId).toBe(img.id);
  });
});

describe("handleGenerateCharacter", () => {
  it("gera a imagem, salva no storage e marca ready", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const c = await seedCharacter(db, p.id, { name: "Maria" });
    await handleGenerateCharacter(m.deps, { characterId: c.id });
    const after = await charOf(c.id);
    expect(after.imageStatus).toBe("ready");
    const [asset] = await db.select().from(assets).where(eq(assets.id, after.assetId!));
    expect(asset).toMatchObject({ kind: "character", label: "Maria", mimeType: "image/png" });
    expect((await m.deps.storage.get(asset!.storageKey)).length).toBeGreaterThan(0);
    expect(m.image.calls[0]!.prompt).toContain("Maria");
  });

  it("substitui a imagem anterior ao regerar", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const old = await seedAsset(db, p.id, { kind: "character", label: "Maria" });
    const c = await seedCharacter(db, p.id, { name: "Maria", imageStatus: "pending", assetId: old.id });
    await handleGenerateCharacter(m.deps, { characterId: c.id });
    expect(await db.select().from(assets).where(eq(assets.id, old.id))).toHaveLength(0);
    expect((await charOf(c.id)).assetId).not.toBe(old.id);
  });

  it("é idempotente: reentrega depois de pronto não gera nem duplica assets", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const c = await seedCharacter(db, p.id, { name: "Maria" });
    await handleGenerateCharacter(m.deps, { characterId: c.id });
    await handleGenerateCharacter(m.deps, { characterId: c.id });
    expect(m.image.calls).toHaveLength(1);
    expect(await db.select().from(assets)).toHaveLength(1);
  });

  it("não grava a imagem se a descrição mudou durante a geração", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const c = await seedCharacter(db, p.id, { name: "Maria" });
    const orig = m.image.generateImage.bind(m.image);
    m.image.generateImage = async (args) => {
      await db.update(characters).set({ description: "outra descrição" }).where(eq(characters.id, c.id));
      return orig(args);
    };
    await handleGenerateCharacter(m.deps, { characterId: c.id });
    expect((await charOf(c.id)).imageStatus).toBe("pending");
    expect(await db.select().from(assets)).toHaveLength(0);
  });

  it("erro não retentável do provedor marca failed com o motivo; retentável propaga", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const c = await seedCharacter(db, p.id);
    m.image.generateImage = async () => {
      throw new ProviderError("Conteúdo bloqueado", false);
    };
    await handleGenerateCharacter(m.deps, { characterId: c.id });
    expect(await charOf(c.id)).toMatchObject({ imageStatus: "failed", imageError: "Conteúdo bloqueado" });

    const c2 = await seedCharacter(db, p.id, { name: "Outro" });
    m.image.generateImage = async () => {
      throw new ProviderError("limite", true);
    };
    await expect(handleGenerateCharacter(m.deps, { characterId: c2.id })).rejects.toThrow("limite");
    expect((await charOf(c2.id)).imageStatus).toBe("pending");
  });

  it("onGenerateCharacterDead não mexe em personagem pronto nem em personagem removido", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const img = await seedAsset(db, p.id, { kind: "character", label: "A" });
    const c = await seedCharacter(db, p.id, { name: "A", imageStatus: "ready", assetId: img.id });
    await onGenerateCharacterDead(m.deps, { characterId: c.id }, "x");
    expect((await charOf(c.id)).imageStatus).toBe("ready");
    await onGenerateCharacterDead(m.deps, { characterId: "00000000-0000-0000-0000-000000000000" }, "x");
  });

  it("onGenerateCharacterDead marca failed com o motivo", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db, { mode: "novelinha", stage: "characters" });
    const c = await seedCharacter(db, p.id);
    await onGenerateCharacterDead(m.deps, { characterId: c.id }, "cota esgotada");
    expect(await charOf(c.id)).toMatchObject({ imageStatus: "failed", imageError: "cota esgotada" });
  });
});
