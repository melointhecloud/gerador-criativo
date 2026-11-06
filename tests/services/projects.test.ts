import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { assets, characters, projects, sceneAttempts, scenes } from "@/db/schema";
import { DomainError } from "@/services/errors";
import {
  addReference, advanceToReviewIfIdle, createProject, getSnapshot, removeReference, setStage, updateBriefing,
} from "@/services/projects";
import { enqueue, fail } from "@/queue/queue";
import { JPEG_BYTES, PNG_BYTES, WEBP_BYTES } from "../helpers/images";
import { makeDeps } from "../helpers/deps";
import { resetDb, testDb as db } from "../helpers/db";
import { seedAsset, seedAttempt, seedCharacter, seedProject, seedScene } from "../helpers/seed";

beforeEach(resetDb);
let cleanup: () => Promise<void>;
afterEach(async () => cleanup?.());

const png = PNG_BYTES;

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
    expect((await m.deps.storage.get(a.storageKey)).equals(png)).toBe(true);
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

  it("aceita PNG, JPEG e WebP e grava o tipo detectado", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db);
    const cases: [Buffer, string, string][] = [
      [png, "image/png", "png"], [JPEG_BYTES, "image/jpeg", "jpg"], [WEBP_BYTES, "image/webp", "webp"],
    ];
    for (const [i, [bytes, mime, ext]] of cases.entries()) {
      const a = await addReference(m.deps, { projectId: p.id, label: `r${i}`, bytes, mimeType: mime });
      expect(a.mimeType).toBe(mime);
      expect(a.storageKey.endsWith(`.${ext}`)).toBe(true);
    }
  });

  it("grava o tipo detectado quando o declarado difere (JPEG declarado como PNG)", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db);
    const a = await addReference(m.deps, { projectId: p.id, label: "foto", bytes: JPEG_BYTES, mimeType: "image/png" });
    expect(a.mimeType).toBe("image/jpeg");
    expect(a.storageKey.endsWith(".jpg")).toBe(true);
  });

  it("rejeita arquivo que não é imagem mesmo declarado como PNG, e buffers vazios/truncados", async () => {
    const m = await makeDeps();
    cleanup = m.cleanup;
    const p = await seedProject(db);
    for (const bytes of [Buffer.from("isto não é imagem"), Buffer.alloc(0), PNG_BYTES.subarray(0, 5), Buffer.from("RIFF1234WEB")]) {
      const err = await addReference(m.deps, { projectId: p.id, label: "x", bytes, mimeType: "image/png" }).catch((e) => e);
      expect(err).toBeInstanceOf(DomainError);
      expect(err.status).toBe(400);
      expect(err.message).toBe("O arquivo não parece ser uma imagem PNG, JPEG ou WebP.");
    }
    expect(await db.select().from(assets)).toHaveLength(0);
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

describe("removeReference com cenas já planejadas", () => {
  const sentence = (l: string) => `A referência “${l}” foi removida; replaneje o roteiro ou revise esta cena antes de gerar.`;
  const noticeOf = async (id: string) => (await db.select().from(scenes).where(eq(scenes.id, id)))[0]!.notice;

  it("avisa só as cenas que usavam a imagem, preserva avisos e não repete frase", async () => {
    const p = await seedProject(db);
    const a = await seedAsset(db, p.id, { label: "produto" });
    const b = await seedAsset(db, p.id, { label: "pessoa" });
    const s1 = await seedScene(db, p.id, 0, { assetIds: [a.id, b.id] });
    const s2 = await seedScene(db, p.id, 1, { assetIds: [b.id] });
    const s3 = await seedScene(db, p.id, 2, { assetIds: [] });
    await db.update(scenes).set({ notice: "Cena cortada." }).where(eq(scenes.id, s1.id));

    await removeReference(db, a.id);
    expect(await noticeOf(s1.id)).toBe(`Cena cortada. ${sentence("produto")}`);
    expect(await noticeOf(s2.id)).toBeNull();
    expect(await noticeOf(s3.id)).toBeNull();

    await removeReference(db, b.id);
    expect(await noticeOf(s1.id)).toBe(`Cena cortada. ${sentence("produto")} ${sentence("pessoa")}`);
    expect(await noticeOf(s2.id)).toBe(sentence("pessoa"));
    expect(await noticeOf(s3.id)).toBeNull();
  });

  it("sem cenas nada muda", async () => {
    const p = await seedProject(db);
    const a = await seedAsset(db, p.id, { label: "produto" });
    await removeReference(db, a.id);
    expect(await db.select().from(scenes)).toHaveLength(0);
    expect(await db.select().from(assets)).toHaveLength(0);
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
    await expect(setStage(db, p.id, "review")).rejects.toThrow(/Não é possível ir de "[^"]+" para "Revisão"/);
  });

  it("não deixa sair de generating (evita um segundo conjunto de tentativas pagas)", async () => {
    const p = await seedProject(db, { stage: "generating" });
    for (const target of ["script", "review"] as const) {
      await expect(setStage(db, p.id, target)).rejects.toThrow(/Aguarde a geração das cenas terminar/);
    }
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("generating");
  });

  it("não deixa sair de review com geração em andamento; libera quando todas terminaram", async () => {
    const p = await seedProject(db, { stage: "review" });
    const s = await seedScene(db, p.id, 0);
    const a = await seedAttempt(db, s.id, { status: "done" });
    const b = await seedAttempt(db, s.id, { status: "queued" });
    await expect(setStage(db, p.id, "script")).rejects.toThrow(/Aguarde as gerações em andamento/);
    await db.update(sceneAttempts).set({ status: "generating" }).where(eq(sceneAttempts.id, b.id));
    await expect(setStage(db, p.id, "script")).rejects.toThrow(/Aguarde as gerações em andamento/);
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("review");
    await db.update(sceneAttempts).set({ status: "failed" }).where(eq(sceneAttempts.id, b.id));
    expect(a.status).toBe("done");
    expect((await setStage(db, p.id, "script")).stage).toBe("script");
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

  it("assembleError é null quando não há job de montagem", async () => {
    const p = await seedProject(db, { stage: "review" });
    expect((await getSnapshot(db, p.id)).assembleError).toBeNull();
  });

  it("expõe a mensagem do job de montagem mais recente quando ele falhou", async () => {
    const p = await seedProject(db, { stage: "review" });
    const job = await enqueue(db, "assemble", { projectId: p.id });
    await fail(db, job, "Falta o clipe da cena 2", false);
    expect((await getSnapshot(db, p.id)).assembleError).toBe("Falta o clipe da cena 2");
  });

  it("um job de montagem mais novo (na fila) limpa o assembleError", async () => {
    const p = await seedProject(db, { stage: "review" });
    const job = await enqueue(db, "assemble", { projectId: p.id });
    await fail(db, job, "Falta o clipe da cena 2", false);
    await enqueue(db, "assemble", { projectId: p.id });
    expect((await getSnapshot(db, p.id)).assembleError).toBeNull();
  });

  it("não expõe a falha de montagem de outro projeto", async () => {
    const p = await seedProject(db, { stage: "review" });
    const other = await seedProject(db, { stage: "review" });
    const job = await enqueue(db, "assemble", { projectId: other.id });
    await fail(db, job, "erro do outro", false);
    expect((await getSnapshot(db, p.id)).assembleError).toBeNull();
    expect((await getSnapshot(db, other.id)).assembleError).toBe("erro do outro");
  });

  it("404 para projeto inexistente", async () => {
    await expect(getSnapshot(db, "00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ status: 404 });
  });
});
