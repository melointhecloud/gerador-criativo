import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import { assets, characters, projects, sceneAttempts, sceneReferences, scenes } from "@/db/schema";
import type { Deps } from "@/deps";
import { buildScenePrompt } from "@/modules/prompt";
import { draftScript } from "@/modules/script-planner";
import { enqueue } from "@/queue/queue";
import { DomainError } from "./errors";
import { getProject, setStage, type Scene } from "./projects";

export function totalSeconds(list: { targetSeconds: number }[]): number {
  return list.reduce((sum, s) => sum + s.targetSeconds, 0);
}

// Fonte única da regra: a cena precisa de geração se não tem clipe aprovado E não tem tentativa em andamento
// (queued/generating). Uma tentativa em andamento já é a geração paga dessa cena: não se cria outra.
export function needsGeneration(scene: { approvedAttemptId: string | null }, hasPendingAttempt: boolean): boolean {
  return !scene.approvedAttemptId && !hasPendingAttempt;
}

export function sceneIdsWithPendingAttempt(list: { id: string; attempts: { status: string }[] }[]): Set<string> {
  return new Set(
    list.filter((s) => s.attempts.some((a) => a.status === "queued" || a.status === "generating")).map((s) => s.id),
  );
}

// O que o próximo "gerar cenas" vai custar: só as cenas que passam em needsGeneration são geradas.
export function generationPlan(
  list: { id: string; targetSeconds: number; approvedAttemptId: string | null }[],
  pendingSceneIds: ReadonlySet<string>,
): {
  scenesToGenerate: number;
  estimatedSeconds: number;
} {
  const pending = list.filter((s) => needsGeneration(s, pendingSceneIds.has(s.id)));
  return { scenesToGenerate: pending.length, estimatedSeconds: totalSeconds(pending) };
}

// Imagens que podem ser citadas no roteiro: referências com rótulo + personagens aprovados.
export async function labeledAssets(db: Db, projectId: string): Promise<{ label: string; assetId: string }[]> {
  const refs = await db
    .select({ label: assets.label, assetId: assets.id })
    .from(assets)
    .where(and(eq(assets.projectId, projectId), eq(assets.kind, "reference"), isNotNull(assets.label)));
  const chars = await db
    .select({ name: characters.name, assetId: characters.assetId })
    .from(characters)
    .where(and(eq(characters.projectId, projectId), eq(characters.approved, true), isNotNull(characters.assetId)));
  return [
    ...refs.map((r) => ({ label: r.label!, assetId: r.assetId })),
    ...chars.map((c) => ({ label: c.name, assetId: c.assetId! })),
  ];
}

export async function planProjectScript(deps: Deps, projectId: string, feedback?: string): Promise<void> {
  const { db, providers, config } = deps;
  const project = await getProject(db, projectId);
  if (project.stage !== "script") throw new DomainError("O roteiro só pode ser planejado na etapa de roteiro");

  const labeled = await labeledAssets(db, projectId);
  const current = await db.select().from(scenes).where(eq(scenes.projectId, projectId)).orderBy(asc(scenes.position));

  const drafted = await draftScript(providers.text, {
    mode: project.mode,
    copy: project.copy,
    availableLabels: labeled.map((l) => l.label),
    maxReferences: config.maxSceneReferences,
    maxSeconds: config.sceneMaxSeconds,
    current: current.length ? current : undefined,
    feedback,
  });
  const assetByLabel = new Map(labeled.map((l) => [l.label.toLowerCase(), l.assetId]));

  await db.transaction(async (tx) => {
    // A chamada ao modelo ficou fora da transação: trava o projeto (primeiro, como nos demais serviços) e confere
    // a etapa de novo. Sem isso, um generateAllScenes concluído nesse intervalo teria as cenas apagadas pelo replano.
    const [locked] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
    if (!locked || locked.stage !== "script") throw new DomainError("O roteiro só pode ser planejado na etapa de roteiro");
    await tx.delete(scenes).where(eq(scenes.projectId, projectId));
    for (const [position, d] of drafted.entries()) {
      const [scene] = await tx
        .insert(scenes)
        .values({
          projectId,
          position,
          dialogue: d.dialogue,
          visualPrompt: d.visualPrompt,
          targetSeconds: d.targetSeconds,
          notice: d.notice,
        })
        .returning();
      const links = d.referenceLabels
        .map((l) => assetByLabel.get(l.toLowerCase()))
        .filter((id): id is string => Boolean(id))
        .map((assetId) => ({ sceneId: scene!.id, assetId }));
      if (links.length) await tx.insert(sceneReferences).values(links);
    }
  });
}

async function getScene(db: Db, sceneId: string): Promise<Scene> {
  const [row] = await db.select().from(scenes).where(eq(scenes.id, sceneId));
  if (!row) throw new DomainError("Cena não encontrada", 404);
  return row;
}

export async function updateScene(
  db: Db,
  sceneId: string,
  patch: { dialogue?: string; visualPrompt?: string; targetSeconds?: number },
  maxSeconds: number,
): Promise<Scene> {
  const scene = await getScene(db, sceneId);
  const project = await getProject(db, scene.projectId);
  if (project.stage !== "script" && project.stage !== "review") {
    throw new DomainError("Cenas só podem ser editadas nas etapas de roteiro e revisão");
  }
  const set: Partial<Scene> = { approvedAttemptId: null }; // editar invalida o clipe aprovado desta cena
  if (patch.dialogue !== undefined) set.dialogue = patch.dialogue.trim();
  if (patch.visualPrompt !== undefined) {
    if (!patch.visualPrompt.trim()) throw new DomainError("A descrição visual não pode ficar vazia");
    set.visualPrompt = patch.visualPrompt.trim();
  }
  if (patch.targetSeconds !== undefined) {
    if (!Number.isInteger(patch.targetSeconds) || patch.targetSeconds < 3 || patch.targetSeconds > maxSeconds) {
      throw new DomainError(`A duração deve ser entre 3 e ${maxSeconds} segundos`);
    }
    set.targetSeconds = patch.targetSeconds;
  }
  const [row] = await db.update(scenes).set(set).where(eq(scenes.id, sceneId)).returning();
  return row!;
}

// Roda dentro da transação do chamador: attempt, job e invalidação da aprovação vão juntos ou nenhum vai.
async function createAttempt(tx: DbOrTx, scene: Scene, mode: "ugc" | "novelinha", promptOverride?: string) {
  const links = await tx.select().from(sceneReferences).where(eq(sceneReferences.sceneId, scene.id));
  const prompt = promptOverride?.trim() || buildScenePrompt(mode, scene);
  const [attempt] = await tx
    .insert(sceneAttempts)
    .values({ sceneId: scene.id, prompt, referenceAssetIds: links.map((l) => l.assetId) })
    .returning();
  await enqueue(tx, "generate_scene", { attemptId: attempt!.id });
  // O clipe aprovado anterior deixa de valer: o usuário precisa aprovar a nova versão (ou restaurar a antiga).
  await tx.update(scenes).set({ approvedAttemptId: null }).where(eq(scenes.id, scene.id));
  return attempt!;
}

// Trava a linha da cena até o fim da transação: serializa chamadas concorrentes sobre a mesma cena.
async function lockScene(tx: DbOrTx, sceneId: string): Promise<Scene> {
  const [row] = await tx.select().from(scenes).where(eq(scenes.id, sceneId)).for("update");
  if (!row) throw new DomainError("Cena não encontrada", 404);
  return row;
}

async function pendingSceneIdsOf(db: DbOrTx, projectId: string): Promise<Set<string>> {
  const rows = await db
    .select({ sceneId: sceneAttempts.sceneId })
    .from(sceneAttempts)
    .innerJoin(scenes, eq(sceneAttempts.sceneId, scenes.id))
    .where(and(eq(scenes.projectId, projectId), inArray(sceneAttempts.status, ["queued", "generating"])));
  return new Set(rows.map((r) => r.sceneId));
}

export async function generateAllScenes(deps: Deps, projectId: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const project = await getProject(tx, projectId);
    if (project.stage !== "script") throw new DomainError("Aprove o roteiro na etapa de roteiro antes de gerar");
    const list = await tx.select().from(scenes).where(eq(scenes.projectId, projectId)).orderBy(asc(scenes.position));
    if (list.length === 0) throw new DomainError("Gere o roteiro: não há nenhuma cena");
    // Só as cenas sem clipe aprovado e sem tentativa em andamento são geradas (needsGeneration).
    const pendingIds = await pendingSceneIdsOf(tx, projectId);
    const toGenerate = list.filter((s) => needsGeneration(s, pendingIds.has(s.id)));
    if (toGenerate.length === 0) {
      if (pendingIds.size > 0) {
        // Só restam gerações já em andamento (pagas): não enfileira nada; o worker leva o projeto à revisão ao terminar.
        await setStage(tx, projectId, "generating");
        return;
      }
      // Tudo aprovado: nada a gerar, vai direto para a revisão (sem custo). Compare-and-set direto, pois
      // setStage não permite o salto script -> review.
      const [row] = await tx
        .update(projects)
        .set({ stage: "review", updatedAt: new Date() })
        .where(and(eq(projects.id, projectId), eq(projects.stage, "script")))
        .returning();
      if (!row) throw new DomainError("O projeto mudou de etapa; atualize a página e tente de novo");
      return;
    }
    // Compare-and-set da etapa: a segunda chamada concorrente espera o commit e falha aqui.
    await setStage(tx, projectId, "generating");
    for (const scene of toGenerate) await createAttempt(tx, scene, project.mode);
  });
}

async function hasPendingAttempt(db: DbOrTx, sceneId: string): Promise<boolean> {
  const rows = await db
    .select({ id: sceneAttempts.id })
    .from(sceneAttempts)
    .where(and(eq(sceneAttempts.sceneId, sceneId), inArray(sceneAttempts.status, ["queued", "generating"])))
    .limit(1);
  return rows.length > 0;
}

// Chamada concorrente na mesma cena: a segunda espera o lock, vê a tentativa pendente e é rejeitada.
export async function regenerateScene(deps: Deps, sceneId: string, promptOverride?: string) {
  return deps.db.transaction(async (tx) => {
    const scene = await lockScene(tx, sceneId);
    const project = await getProject(tx, scene.projectId);
    if (project.stage !== "review") throw new DomainError("Só é possível regerar cenas na etapa de revisão");
    if (await hasPendingAttempt(tx, sceneId)) throw new DomainError("Já há uma geração em andamento nesta cena");
    return createAttempt(tx, scene, project.mode, promptOverride);
  });
}

// Locks em ordem de posição (sem deadlock); cenas já em geração são puladas, então a chamada concorrente vira no-op.
export async function regenerateAllScenes(deps: Deps, projectId: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const project = await getProject(tx, projectId);
    if (project.stage !== "review") throw new DomainError("Só é possível regerar cenas na etapa de revisão");
    const list = await tx
      .select()
      .from(scenes)
      .where(eq(scenes.projectId, projectId))
      .orderBy(asc(scenes.position))
      .for("update");
    for (const scene of list) {
      if (!(await hasPendingAttempt(tx, scene.id))) await createAttempt(tx, scene, project.mode);
    }
  });
}

export async function approveAttempt(db: Db, sceneId: string, attemptId: string): Promise<Scene> {
  const scene = await getScene(db, sceneId);
  const project = await getProject(db, scene.projectId);
  if (project.stage !== "review") throw new DomainError("Só é possível aprovar cenas na etapa de revisão");
  const [attempt] = await db.select().from(sceneAttempts).where(eq(sceneAttempts.id, attemptId));
  if (!attempt) throw new DomainError("Tentativa não encontrada", 404);
  if (attempt.sceneId !== sceneId) throw new DomainError("Esta tentativa não pertence à cena");
  if (attempt.status !== "done") throw new DomainError("Só é possível aprovar uma geração pronta");
  const [row] = await db.update(scenes).set({ approvedAttemptId: attemptId }).where(eq(scenes.id, sceneId)).returning();
  return row!;
}

export async function startAssembly(db: Db, projectId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const project = await getProject(tx, projectId);
    if (project.stage !== "review") throw new DomainError("A montagem só começa na etapa de revisão");
    const list = await tx.select().from(scenes).where(eq(scenes.projectId, projectId));
    if (list.length === 0 || list.some((s) => !s.approvedAttemptId)) {
      throw new DomainError("Aprove todas as cenas antes de montar o vídeo");
    }
    // Etapa e job na mesma transação: se o enqueue falha, o projeto volta para review.
    await setStage(tx, projectId, "assembling");
    await enqueue(tx, "assemble", { projectId });
  });
}
