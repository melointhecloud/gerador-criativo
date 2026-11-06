import { writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { assets, projects, sceneAttempts, scenes, type AttemptStatus } from "@/db/schema";
import type { Deps } from "@/deps";
import { PermanentError, RetryLater } from "@/queue/errors";
import { ProviderError, type ReferenceImage } from "@/providers/types";
import { advanceToReviewIfIdle } from "@/services/projects";
import { probe, withTempDir } from "./ffmpeg";

const POLL_DELAY_MS = 10_000;
// Teto de espera por uma geração que continua "pending" (contado desde que o providerRef foi salvo): passou disso, a tentativa falha e a cena pode ser regerada.
export const MAX_GENERATION_WAIT_MS = 30 * 60_000;
const TERMINAL: AttemptStatus[] = ["done", "failed", "blocked"];

type AttemptPatch = Partial<typeof sceneAttempts.$inferInsert>;

async function patchAttempt(db: DbOrTx, id: string, patch: AttemptPatch) {
  await db.update(sceneAttempts).set({ ...patch, updatedAt: new Date() }).where(eq(sceneAttempts.id, id));
}

class MissingReferenceError extends Error {}

async function loadReferences(deps: Deps, assetIds: string[]): Promise<ReferenceImage[]> {
  if (assetIds.length === 0) return [];
  const rows = await deps.db.select().from(assets).where(inArray(assets.id, assetIds));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: ReferenceImage[] = [];
  for (const id of assetIds) {
    const asset = byId.get(id);
    // scene_attempts.reference_asset_ids não tem FK: o usuário pode ter removido a imagem no briefing.
    if (!asset) throw new MissingReferenceError("Uma imagem de referência desta cena foi removida. Gere a cena novamente.");
    out.push({
      bytes: await deps.storage.get(asset.storageKey),
      mimeType: asset.mimeType,
      label: asset.label ?? "referência",
    });
  }
  return out;
}

// Serializa, por projeto, as transações que encerram uma tentativa e checam ociosidade. Sem isso, em READ COMMITTED
// duas tentativas terminando juntas veem uma à outra ainda "generating" e ninguém avança o projeto para revisão.
// Ordem de locks: linha do projeto primeiro, depois a da tentativa.
async function lockProject(tx: DbOrTx, projectId: string) {
  await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for("update");
}

// Marca a tentativa como finalizada e, se não sobrou nada em andamento, avança o projeto — tudo atômico.
async function finish(deps: Deps, projectId: string, attemptId: string, patch: AttemptPatch) {
  await deps.db.transaction(async (tx) => {
    await lockProject(tx, projectId);
    await patchAttempt(tx, attemptId, patch);
    await advanceToReviewIfIdle(tx, projectId);
  });
}

export async function handleGenerateScene(deps: Deps, payload: { attemptId: string }): Promise<void> {
  const { db, storage, providers } = deps;
  const [attempt] = await db.select().from(sceneAttempts).where(eq(sceneAttempts.id, payload.attemptId));
  if (!attempt) throw new PermanentError("Tentativa não encontrada");
  if (TERMINAL.includes(attempt.status)) return;
  const [scene] = await db.select().from(scenes).where(eq(scenes.id, attempt.sceneId));
  if (!scene) throw new PermanentError("Cena não encontrada");

  try {
    let providerRef = attempt.providerRef;
    let justStarted = false;
    if (!providerRef) {
      const references = await loadReferences(deps, attempt.referenceAssetIds);
      const started = await providers.video.start({
        prompt: attempt.prompt,
        references,
        targetSeconds: scene.targetSeconds,
      });
      providerRef = started.providerRef;
      justStarted = true;
      // Persistir imediatamente, antes de qualquer espera: se o worker reiniciar, o polling continua daqui.
      await patchAttempt(db, attempt.id, { providerRef, status: "generating" });
    }

    const result = await providers.video.poll({ providerRef });
    if (result.state === "pending") {
      // O relógio do teto é o do último `providerRef` salvo (patchAttempt atualiza updatedAt; nada mais escreve em
      // scene_attempts enquanto a geração está pendente). Medir de createdAt descartaria uma geração recém-paga
      // de uma tentativa que ficou muito tempo na fila ou foi reiniciada. Na execução que acabou de chamar start()
      // o teto não se aplica.
      if (!justStarted && Date.now() - attempt.updatedAt.getTime() > MAX_GENERATION_WAIT_MS) {
        await finish(deps, scene.projectId, attempt.id, {
          status: "failed",
          error: "A geração demorou mais de 30 minutos e foi interrompida (tempo esgotado). Regere a cena.",
        });
        return;
      }
      throw new RetryLater(POLL_DELAY_MS);
    }

    if (result.state === "failed") {
      if (result.retryable) {
        await patchAttempt(db, attempt.id, { providerRef: null });
        throw new ProviderError(result.reason, true);
      }
      await finish(deps, scene.projectId, attempt.id, { status: "blocked", error: result.reason });
      return;
    }

    const measured = await withTempDir(async (dir) => {
      const file = path.join(dir, "clip.mp4");
      await writeFile(file, result.bytes);
      return probe(file);
    });
    const key = `projects/${scene.projectId}/clips/${attempt.id}.mp4`;
    await storage.put(key, result.bytes, "video/mp4");
    // Asset + status + avanço de etapa numa transação: reexecutar não duplica clipe.
    await db.transaction(async (tx) => {
      await lockProject(tx, scene.projectId);
      const [clip] = await tx
        .insert(assets)
        .values({
          projectId: scene.projectId,
          kind: "clip",
          storageKey: key,
          mimeType: "video/mp4",
          durationSeconds: measured.durationSeconds,
        })
        .returning();
      await patchAttempt(tx, attempt.id, { status: "done", clipAssetId: clip!.id, error: null });
      await advanceToReviewIfIdle(tx, scene.projectId);
    });
  } catch (e) {
    if (e instanceof MissingReferenceError) {
      await finish(deps, scene.projectId, attempt.id, { status: "failed", error: e.message });
      return;
    }
    if (e instanceof ProviderError && !e.retryable) {
      await finish(deps, scene.projectId, attempt.id, { status: "blocked", error: e.message });
      return;
    }
    throw e;
  }
}

// Chamado pelo runner quando o job esgotou as tentativas (ou foi recuperado já morto).
export async function onGenerateSceneDead(deps: Deps, payload: { attemptId: string }, message: string): Promise<void> {
  const { db } = deps;
  const [attempt] = await db.select().from(sceneAttempts).where(eq(sceneAttempts.id, payload.attemptId));
  if (!attempt || TERMINAL.includes(attempt.status)) return;
  const [scene] = await db.select().from(scenes).where(eq(scenes.id, attempt.sceneId));
  if (!scene) {
    await patchAttempt(db, attempt.id, { status: "failed", error: message });
    return;
  }
  await finish(deps, scene.projectId, attempt.id, { status: "failed", error: message });
}
