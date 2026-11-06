import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import {
  assets, characters, jobs, projects, sceneAttempts, sceneReferences, scenes,
} from "@/db/schema";
import { canTransition, stagesFor, type Mode, type Stage } from "@/domain/stages";
import type { Deps } from "@/deps";
import { DomainError } from "./errors";
import { assertLabelFree } from "./labels";

export type Project = typeof projects.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Character = typeof characters.$inferSelect;
export type Scene = typeof scenes.$inferSelect;
export type SceneAttempt = typeof sceneAttempts.$inferSelect;
export type SceneView = Scene & { references: Asset[]; attempts: SceneAttempt[] };
export type Snapshot = {
  project: Project;
  references: Asset[];
  characters: Character[];
  scenes: SceneView[];
  finalAsset: Asset | null;
  assembleError: string | null;
};

const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// O tipo declarado pelo cliente não é confiável: o formato real vem da assinatura do arquivo.
function detectImageMime(b: Buffer): string | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

// Avisa as cenas que usavam a imagem removida (o roteiro é preservado; a edição do usuário não se perde).
export async function noteRemovedReference(tx: DbOrTx, assetId: string, label: string | null): Promise<void> {
  const links = await tx.select({ sceneId: sceneReferences.sceneId }).from(sceneReferences).where(eq(sceneReferences.assetId, assetId));
  if (links.length === 0) return;
  const sentence = `A referência “${label ?? "sem rótulo"}” foi removida; replaneje o roteiro ou revise esta cena antes de gerar.`;
  const rows = await tx.select().from(scenes).where(inArray(scenes.id, links.map((l) => l.sceneId)));
  for (const scene of rows) {
    if (scene.notice?.includes(sentence)) continue;
    await tx.update(scenes).set({ notice: scene.notice ? `${scene.notice} ${sentence}` : sentence }).where(eq(scenes.id, scene.id));
  }
}

export async function createProject(db: Db, input: { name: string; mode: Mode; copy?: string }): Promise<Project> {
  const name = input.name.trim();
  if (!name) throw new DomainError("Dê um nome ao projeto");
  const [row] = await db.insert(projects).values({ name, mode: input.mode, copy: input.copy ?? "" }).returning();
  return row!;
}

export async function listProjects(db: Db): Promise<Project[]> {
  return db.select().from(projects).orderBy(desc(projects.updatedAt));
}

export async function getProject(db: DbOrTx, id: string): Promise<Project> {
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  if (!row) throw new DomainError("Projeto não encontrado", 404);
  return row;
}

export async function getAsset(db: Db, id: string): Promise<Asset> {
  const [row] = await db.select().from(assets).where(eq(assets.id, id));
  if (!row) throw new DomainError("Arquivo não encontrado", 404);
  return row;
}

export async function updateBriefing(db: Db, id: string, patch: { name?: string; copy?: string }): Promise<Project> {
  const project = await getProject(db, id);
  if (project.stage !== "briefing") throw new DomainError("A copy só pode ser editada na etapa de briefing");
  const set: Partial<Project> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new DomainError("Dê um nome ao projeto");
    set.name = patch.name.trim();
  }
  if (patch.copy !== undefined) set.copy = patch.copy;
  const [row] = await db.update(projects).set(set).where(eq(projects.id, id)).returning();
  return row!;
}

export async function addReference(
  deps: Pick<Deps, "db" | "storage">,
  input: { projectId: string; label: string; bytes: Buffer; mimeType: string },
): Promise<Asset> {
  const { db, storage } = deps;
  const project = await getProject(db, input.projectId);
  if (project.stage !== "briefing") throw new DomainError("Referências só podem ser alteradas no briefing");
  const ext = IMAGE_TYPES[input.mimeType];
  if (!ext) throw new DomainError("Formato de imagem não suportado (use PNG, JPEG ou WebP)");
  if (input.bytes.length > MAX_IMAGE_BYTES) throw new DomainError("Imagem maior que 10 MB");
  const mimeType = detectImageMime(input.bytes);
  if (!mimeType) throw new DomainError("O arquivo não parece ser uma imagem PNG, JPEG ou WebP.");
  const label = input.label.trim();
  if (!label) throw new DomainError("Dê um rótulo à imagem (ex.: produto, pessoa)");
  await assertLabelFree(db, project.id, label);

  const key = `projects/${project.id}/references/${randomUUID()}.${IMAGE_TYPES[mimeType]}`;
  await storage.put(key, input.bytes, mimeType);
  const [row] = await db
    .insert(assets)
    .values({ projectId: project.id, kind: "reference", label, storageKey: key, mimeType })
    .returning();
  return row!;
}

export async function removeReference(db: Db, assetId: string): Promise<void> {
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));
  if (!asset || asset.kind !== "reference") throw new DomainError("Referência não encontrada", 404);
  const project = await getProject(db, asset.projectId);
  if (project.stage !== "briefing") throw new DomainError("Referências só podem ser alteradas no briefing");
  await db.transaction(async (tx) => {
    await noteRemovedReference(tx, assetId, asset.label);
    await tx.delete(assets).where(eq(assets.id, assetId));
  });
}

async function assertCanEnter(db: DbOrTx, project: Project, target: Stage): Promise<void> {
  const order = stagesFor(project.mode);
  if (order.indexOf(target) <= order.indexOf(project.stage)) return; // voltar não tem pré-condição

  if (project.stage === "briefing") {
    if (!project.copy.trim()) throw new DomainError("Escreva a copy antes de continuar");
    if (project.mode === "ugc") {
      const refs = await db
        .select({ id: assets.id })
        .from(assets)
        .where(and(eq(assets.projectId, project.id), eq(assets.kind, "reference")));
      if (refs.length === 0) throw new DomainError("Envie ao menos uma imagem de referência (produto ou pessoa)");
    }
  }
  if (project.stage === "characters") {
    const chars = await db.select().from(characters).where(eq(characters.projectId, project.id));
    if (chars.length === 0 || chars.some((c) => !c.approved)) {
      throw new DomainError("Aprove todos os personagens antes de continuar");
    }
  }
}

// A troca é condicional à etapa lida (compare-and-set): duas chamadas concorrentes não passam juntas.
// Dentro de uma transação, o UPDATE também segura o lock da linha do projeto até o commit.
export async function setStage(db: DbOrTx, projectId: string, target: Stage): Promise<Project> {
  const project = await getProject(db, projectId);
  // Só o worker tira o projeto de `generating` (advanceToReviewIfIdle). Sair daqui permitiria um novo
  // generateAllScenes e, com ele, um segundo conjunto de tentativas pagas.
  if (project.stage === "generating") throw new DomainError("Aguarde a geração das cenas terminar antes de mudar de etapa.");
  if (!canTransition(project.mode, project.stage, target)) {
    throw new DomainError(`Não é possível ir de "${project.stage}" para "${target}"`);
  }
  await assertCanEnter(db, project, target);
  const [row] = await db
    .update(projects)
    .set({ stage: target, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.stage, project.stage)))
    .returning();
  if (!row) throw new DomainError("O projeto mudou de etapa; atualize a página e tente de novo");
  return row;
}

// Chamado pelo worker ao terminar cada tentativa: quando nada mais está pendente, o projeto vai para revisão.
export async function advanceToReviewIfIdle(db: DbOrTx, projectId: string): Promise<void> {
  const project = await getProject(db, projectId);
  if (project.stage !== "generating") return;
  const pending = await db
    .select({ id: sceneAttempts.id })
    .from(sceneAttempts)
    .innerJoin(scenes, eq(sceneAttempts.sceneId, scenes.id))
    .where(and(eq(scenes.projectId, projectId), inArray(sceneAttempts.status, ["queued", "generating"])))
    .limit(1);
  if (pending.length === 0) {
    await db.update(projects).set({ stage: "review", updatedAt: new Date() }).where(eq(projects.id, projectId));
  }
}

export async function getSnapshot(db: Db, projectId: string): Promise<Snapshot> {
  const project = await getProject(db, projectId);
  const [allAssets, chars, sceneRows] = await Promise.all([
    db.select().from(assets).where(eq(assets.projectId, projectId)).orderBy(asc(assets.createdAt)),
    db.select().from(characters).where(eq(characters.projectId, projectId)).orderBy(asc(characters.position), asc(characters.createdAt)),
    db.select().from(scenes).where(eq(scenes.projectId, projectId)).orderBy(asc(scenes.position)),
  ]);
  const sceneIds = sceneRows.map((s) => s.id);
  const [attempts, links] = sceneIds.length
    ? await Promise.all([
        db.select().from(sceneAttempts).where(inArray(sceneAttempts.sceneId, sceneIds)).orderBy(asc(sceneAttempts.createdAt)),
        db.select().from(sceneReferences).where(inArray(sceneReferences.sceneId, sceneIds)),
      ])
    : [[], []];

  // Só o job de montagem mais recente conta: se ele falhou, o motivo (jobs.error, gravado por fail()) vai para a UI;
  // um job novo (na fila, rodando ou concluído) limpa o aviso sem lógica de timestamp.
  const [lastAssemble] = await db
    .select({ status: jobs.status, error: jobs.error })
    .from(jobs)
    .where(and(eq(jobs.type, "assemble"), sql`${jobs.payload}->>'projectId' = ${projectId}`))
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  const assembleError =
    lastAssemble?.status === "failed" ? (lastAssemble.error ?? "A montagem falhou. Tente montar novamente.") : null;

  const assetById = new Map(allAssets.map((a) => [a.id, a]));
  const finals = allAssets.filter((a) => a.kind === "final");
  return {
    project,
    references: allAssets.filter((a) => a.kind === "reference"),
    characters: chars,
    scenes: sceneRows.map((s) => ({
      ...s,
      attempts: attempts.filter((a) => a.sceneId === s.id),
      references: links.filter((l) => l.sceneId === s.id).map((l) => assetById.get(l.assetId)!).filter(Boolean),
    })),
    finalAsset: finals.length ? finals[finals.length - 1]! : null,
    assembleError,
  };
}
