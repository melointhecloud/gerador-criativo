import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { assets, characters, sceneAttempts, sceneReferences, scenes } from "@/db/schema";
import type { Deps } from "@/deps";
import { buildScenePrompt } from "@/modules/prompt";
import { draftScript } from "@/modules/script-planner";
import { enqueue } from "@/queue/queue";
import { DomainError } from "./errors";
import { getProject, setStage, type Scene } from "./projects";

export function totalSeconds(list: { targetSeconds: number }[]): number {
  return list.reduce((sum, s) => sum + s.targetSeconds, 0);
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

async function createAttempt(deps: Deps, scene: Scene, mode: "ugc" | "novelinha", promptOverride?: string) {
  const { db } = deps;
  const links = await db.select().from(sceneReferences).where(eq(sceneReferences.sceneId, scene.id));
  const prompt = promptOverride?.trim() || buildScenePrompt(mode, scene);
  const [attempt] = await db
    .insert(sceneAttempts)
    .values({ sceneId: scene.id, prompt, referenceAssetIds: links.map((l) => l.assetId) })
    .returning();
  await enqueue(db, "generate_scene", { attemptId: attempt!.id });
  // O clipe aprovado anterior deixa de valer: o usuário precisa aprovar a nova versão (ou restaurar a antiga).
  await db.update(scenes).set({ approvedAttemptId: null }).where(eq(scenes.id, scene.id));
  return attempt!;
}

export async function generateAllScenes(deps: Deps, projectId: string): Promise<void> {
  const { db } = deps;
  const project = await getProject(db, projectId);
  if (project.stage !== "script") throw new DomainError("Aprove o roteiro na etapa de roteiro antes de gerar");
  const list = await db.select().from(scenes).where(eq(scenes.projectId, projectId)).orderBy(asc(scenes.position));
  if (list.length === 0) throw new DomainError("Gere o roteiro: não há nenhuma cena");
  await setStage(db, projectId, "generating");
  for (const scene of list) await createAttempt(deps, scene, project.mode);
}

async function hasPendingAttempt(db: Db, sceneId: string): Promise<boolean> {
  const rows = await db
    .select({ id: sceneAttempts.id })
    .from(sceneAttempts)
    .where(and(eq(sceneAttempts.sceneId, sceneId), inArray(sceneAttempts.status, ["queued", "generating"])))
    .limit(1);
  return rows.length > 0;
}

export async function regenerateScene(deps: Deps, sceneId: string, promptOverride?: string) {
  const { db } = deps;
  const scene = await getScene(db, sceneId);
  const project = await getProject(db, scene.projectId);
  if (project.stage !== "review") throw new DomainError("Só é possível regerar cenas na etapa de revisão");
  if (await hasPendingAttempt(db, sceneId)) throw new DomainError("Já há uma geração em andamento nesta cena");
  return createAttempt(deps, scene, project.mode, promptOverride);
}

export async function regenerateAllScenes(deps: Deps, projectId: string): Promise<void> {
  const { db } = deps;
  const project = await getProject(db, projectId);
  if (project.stage !== "review") throw new DomainError("Só é possível regerar cenas na etapa de revisão");
  const list = await db.select().from(scenes).where(eq(scenes.projectId, projectId)).orderBy(asc(scenes.position));
  for (const scene of list) {
    if (!(await hasPendingAttempt(db, scene.id))) await createAttempt(deps, scene, project.mode);
  }
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
  const project = await getProject(db, projectId);
  if (project.stage !== "review") throw new DomainError("A montagem só começa na etapa de revisão");
  const list = await db.select().from(scenes).where(eq(scenes.projectId, projectId));
  if (list.length === 0 || list.some((s) => !s.approvedAttemptId)) {
    throw new DomainError("Aprove todas as cenas antes de montar o vídeo");
  }
  await setStage(db, projectId, "assembling");
  await enqueue(db, "assemble", { projectId });
}
