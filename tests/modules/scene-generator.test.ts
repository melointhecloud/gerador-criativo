import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { assets, projects, sceneAttempts } from "@/db/schema";
import { handleGenerateScene, MAX_GENERATION_WAIT_MS, onGenerateSceneDead } from "@/modules/scene-generator";
import { PermanentError, RetryLater } from "@/queue/errors";
import { ProviderError } from "@/providers/types";
import { makeDeps } from "../helpers/deps";
import { resetDb, testDb as db } from "../helpers/db";
import { seedAsset, seedAttempt, seedProject, seedScene } from "../helpers/seed";

beforeEach(resetDb);
let cleanup: () => Promise<void>;
afterEach(async () => cleanup?.());

const attemptOf = async (id: string) => (await db.select().from(sceneAttempts).where(eq(sceneAttempts.id, id)))[0]!;

async function setup(opts: Parameters<typeof makeDeps>[0] = {}) {
  const m = await makeDeps(opts);
  cleanup = m.cleanup;
  const p = await seedProject(db, { stage: "generating" });
  const ref = await seedAsset(db, p.id, { kind: "reference", label: "produto", storageKey: "ref/produto.png" });
  await m.deps.storage.put("ref/produto.png", Buffer.from("img"), "image/png");
  const scene = await seedScene(db, p.id, 0, { assetIds: [ref.id] });
  const attempt = await seedAttempt(db, scene.id, { referenceAssetIds: [ref.id], prompt: "prompt da cena" });
  return { m, p, scene, attempt, ref };
}

describe("handleGenerateScene", () => {
  it("inicia a geração com prompt e referências e pede para voltar enquanto pendente", async () => {
    const { m, attempt } = await setup({ video: { pendingPolls: 1 } });
    await expect(handleGenerateScene(m.deps, { attemptId: attempt.id })).rejects.toBeInstanceOf(RetryLater);
    expect(m.video.starts).toHaveLength(1);
    expect(m.video.starts[0]!.prompt).toBe("prompt da cena");
    expect(m.video.starts[0]!.references[0]).toMatchObject({ label: "produto", mimeType: "image/png" });
    const a = await attemptOf(attempt.id);
    expect(a.status).toBe("generating");
    expect(a.providerRef).toBe("fake-1");
  });

  it("retoma pelo providerRef salvo, sem chamar start de novo (não paga duas vezes)", async () => {
    const { m, attempt } = await setup({ video: { pendingPolls: 1 } });
    await expect(handleGenerateScene(m.deps, { attemptId: attempt.id })).rejects.toBeInstanceOf(RetryLater);
    await handleGenerateScene(m.deps, { attemptId: attempt.id });
    expect(m.video.starts).toHaveLength(1);
    expect((await attemptOf(attempt.id)).status).toBe("done");
  });

  it("ao concluir: salva o clipe, cria asset com duração medida e avança o projeto para revisão", async () => {
    const { m, p, attempt } = await setup();
    await handleGenerateScene(m.deps, { attemptId: attempt.id });
    const a = await attemptOf(attempt.id);
    expect(a.status).toBe("done");
    const [clip] = await db.select().from(assets).where(eq(assets.id, a.clipAssetId!));
    expect(clip!.kind).toBe("clip");
    expect(clip!.durationSeconds).toBeGreaterThan(0.8);
    expect((await m.deps.storage.get(clip!.storageKey)).length).toBeGreaterThan(1000);
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("review");
  });

  it("bloqueio do provider (não retryable) marca blocked com o motivo, sem retry", async () => {
    const { m, p, attempt } = await setup({ video: { failure: { reason: "Bloqueado pelo filtro de segurança", retryable: false } } });
    await handleGenerateScene(m.deps, { attemptId: attempt.id });
    const a = await attemptOf(attempt.id);
    expect(a.status).toBe("blocked");
    expect(a.error).toContain("filtro de segurança");
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("review");
  });

  it("falha retryable limpa o providerRef e relança para o runner reagendar", async () => {
    const { m, attempt } = await setup({ video: { failure: { reason: "instável", retryable: true } } });
    await expect(handleGenerateScene(m.deps, { attemptId: attempt.id })).rejects.toMatchObject({ retryable: true });
    expect((await attemptOf(attempt.id)).providerRef).toBeNull();
  });

  it("erro não-retryable no start também vira blocked", async () => {
    const { m, attempt } = await setup();
    m.video.start = async () => {
      throw new ProviderError("conteúdo recusado", false);
    };
    await handleGenerateScene(m.deps, { attemptId: attempt.id });
    expect((await attemptOf(attempt.id)).status).toBe("blocked");
  });

  it("é idempotente para tentativas já finalizadas", async () => {
    const { m, attempt } = await setup();
    await handleGenerateScene(m.deps, { attemptId: attempt.id });
    await handleGenerateScene(m.deps, { attemptId: attempt.id });
    expect(m.video.starts).toHaveLength(1);
  });

  it("tentativa inexistente é erro permanente", async () => {
    const { m } = await setup();
    await expect(
      handleGenerateScene(m.deps, { attemptId: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toBeInstanceOf(PermanentError);
  });
});

describe("teto de espera por geração pendente", () => {
  // Simula uma geração já iniciada (providerRef salvo) há `ms`: o teto conta a partir de updatedAt.
  const ageAttempt = (id: string, ms: number) =>
    db
      .update(sceneAttempts)
      .set({ providerRef: "fake-1", status: "generating", updatedAt: new Date(Date.now() - ms) })
      .where(eq(sceneAttempts.id, id));

  it("passou do teto: falha com mensagem de tempo esgotado, sem retry, e avança o projeto", async () => {
    const { m, p, attempt } = await setup({ video: { pendingPolls: 1000 } });
    await ageAttempt(attempt.id, MAX_GENERATION_WAIT_MS + 60_000);
    await expect(handleGenerateScene(m.deps, { attemptId: attempt.id })).resolves.toBeUndefined();
    const a = await attemptOf(attempt.id);
    expect(a.status).toBe("failed");
    expect(a.error).toContain("tempo esgotado");
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("review");
  });

  it("dentro do teto: continua pedindo para voltar", async () => {
    const { m, attempt } = await setup({ video: { pendingPolls: 1000 } });
    await ageAttempt(attempt.id, MAX_GENERATION_WAIT_MS - 5 * 60_000);
    await expect(handleGenerateScene(m.deps, { attemptId: attempt.id })).rejects.toBeInstanceOf(RetryLater);
    expect((await attemptOf(attempt.id)).status).toBe("generating");
  });
});

describe("teto de espera: relógio do providerRef", () => {
  const old = (id: string, patch: Partial<typeof sceneAttempts.$inferInsert>) =>
    db.update(sceneAttempts).set(patch).where(eq(sceneAttempts.id, id));

  it("tentativa criada há 2h mas iniciada agora: não falha, pede para voltar", async () => {
    const { m, attempt } = await setup({ video: { pendingPolls: 1000 } });
    const longAgo = new Date(Date.now() - 2 * 3600_000);
    await old(attempt.id, { createdAt: longAgo, updatedAt: longAgo }); // ficou na fila; providerRef ainda nulo
    await expect(handleGenerateScene(m.deps, { attemptId: attempt.id })).rejects.toBeInstanceOf(RetryLater);
    expect(m.video.starts).toHaveLength(1);
    const a = await attemptOf(attempt.id);
    expect(a.status).toBe("generating");
    expect(a.providerRef).toBe("fake-1");
    // Próxima execução (providerRef recém-salvo): continua dentro do teto.
    await expect(handleGenerateScene(m.deps, { attemptId: attempt.id })).rejects.toBeInstanceOf(RetryLater);
  });

  it("createdAt antigo com providerRef recente: não falha", async () => {
    const { m, attempt } = await setup({ video: { pendingPolls: 1000 } });
    await old(attempt.id, { createdAt: new Date(Date.now() - 2 * 3600_000), providerRef: "fake-1", status: "generating" });
    await expect(handleGenerateScene(m.deps, { attemptId: attempt.id })).rejects.toBeInstanceOf(RetryLater);
    expect((await attemptOf(attempt.id)).status).toBe("generating");
  });
});

describe("conclusões simultâneas no mesmo projeto", () => {
  it("duas tentativas terminando ao mesmo tempo: o projeto vai para revisão", async () => {
    const { m } = await setup();
    // A corrida depende de timing: repete com projetos novos para o teste falhar de forma confiável sem o lock.
    for (let round = 0; round < 8; round++) {
      const p = await seedProject(db, { stage: "generating" });
      const s1 = await seedScene(db, p.id, 0, {});
      const s2 = await seedScene(db, p.id, 1, {});
      const a1 = await seedAttempt(db, s1.id, { prompt: "cena 1" });
      const a2 = await seedAttempt(db, s2.id, { prompt: "cena 2" });
      await Promise.all([
        handleGenerateScene(m.deps, { attemptId: a1.id }),
        handleGenerateScene(m.deps, { attemptId: a2.id }),
      ]);
      expect((await attemptOf(a1.id)).status).toBe("done");
      expect((await attemptOf(a2.id)).status).toBe("done");
      expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("review");
    }
  });
});

describe("onGenerateSceneDead", () => {
  it("marca a tentativa como failed e avança o projeto", async () => {
    const { m, p, attempt } = await setup();
    await onGenerateSceneDead(m.deps, { attemptId: attempt.id }, "rede caiu");
    const a = await attemptOf(attempt.id);
    expect(a.status).toBe("failed");
    expect(a.error).toBe("rede caiu");
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("review");
  });
});

describe("referência removida (carry-forward A)", () => {
  it("falha com mensagem clara em pt-BR, sem chamar o provider, e avança o projeto", async () => {
    const { m, p, attempt, ref } = await setup();
    await db.delete(assets).where(eq(assets.id, ref.id));
    await handleGenerateScene(m.deps, { attemptId: attempt.id });
    expect(m.video.starts).toHaveLength(0);
    const a = await attemptOf(attempt.id);
    expect(a.status).toBe("failed");
    expect(a.error).toContain("referência");
    expect((await db.select().from(projects).where(eq(projects.id, p.id)))[0]!.stage).toBe("review");
  });
});

describe("persistência do providerRef (carry-forward C)", () => {
  it("salva o providerRef logo após start(), antes do primeiro poll", async () => {
    const { m, attempt } = await setup();
    let seen: string | null = "não lido";
    const poll = m.video.poll.bind(m.video);
    m.video.poll = async (h) => {
      seen = (await attemptOf(attempt.id)).providerRef;
      return poll(h);
    };
    await handleGenerateScene(m.deps, { attemptId: attempt.id });
    expect(seen).toBe("fake-1");
  });
});
