import { asc, eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import { assets, characters } from "@/db/schema";
import type { Deps } from "@/deps";
import { proposeCharacters } from "@/modules/character-designer";
import { enqueue } from "@/queue/queue";
import { DomainError } from "./errors";
import { assertLabelFree } from "./labels";
import { getProject, noteRemovedReference, type Character } from "./projects";

// Etapa válida para mexer em personagens (chamar depois de lockProjectRow dentro de transações).
async function assertCharactersStage(tx: DbOrTx, projectId: string) {
  const project = await getProject(tx, projectId);
  if (project.mode !== "novelinha" || project.stage !== "characters") {
    throw new DomainError("Personagens só existem na etapa de personagens de uma novelinha");
  }
  return project;
}

async function lockProjectRow(tx: DbOrTx, projectId: string) {
  await tx.execute(sql`select id from projects where id = ${projectId} for update`);
}

// Trava a linha do personagem (e devolve o estado atual) para serializar cliques repetidos.
async function lockCharacter(tx: DbOrTx, id: string): Promise<Character> {
  const [row] = await tx.select().from(characters).where(eq(characters.id, id)).for("update");
  if (!row) throw new DomainError("Personagem não encontrado", 404);
  return row;
}

// Volta o personagem para "pending" e enfileira a imagem; sempre chamado dentro de uma transação.
async function queueImage(tx: DbOrTx, characterId: string) {
  await tx
    .update(characters)
    .set({ imageStatus: "pending", imageError: null, approved: false })
    .where(eq(characters.id, characterId));
  await enqueue(tx, "generate_character", { characterId });
}

export async function proposeProjectCharacters(deps: Deps, projectId: string): Promise<void> {
  const { db, providers } = deps;
  const project = await assertCharactersStage(db, projectId);
  const proposals = await proposeCharacters(providers.text, project.copy);

  await db.transaction(async (tx) => {
    await lockProjectRow(tx, projectId);
    await assertCharactersStage(tx, projectId); // a etapa pode ter mudado durante a chamada ao modelo
    const old = await tx.select().from(characters).where(eq(characters.projectId, projectId));
    await tx.delete(characters).where(eq(characters.projectId, projectId));
    for (const c of old) {
      if (!c.assetId) continue;
      await noteRemovedReference(tx, c.assetId, c.name); // antes de apagar a imagem (a FK some com as referências)
      await tx.delete(assets).where(eq(assets.id, c.assetId));
    }

    for (const [position, p] of proposals.entries()) {
      const [row] = await tx
        .insert(characters)
        .values({ projectId, name: p.name, description: p.description, position })
        .returning();
      await enqueue(tx, "generate_character", { characterId: row!.id });
    }
  });
}

export async function addCharacter(
  deps: Deps,
  projectId: string,
  input: { name: string; description: string },
): Promise<Character> {
  const name = input.name.trim();
  const description = input.description.trim();
  if (!name || !description) throw new DomainError("Informe nome e descrição do personagem");
  return deps.db.transaction(async (tx) => {
    await lockProjectRow(tx, projectId);
    await assertCharactersStage(tx, projectId);
    await assertLabelFree(tx, projectId, name);
    const existing = await tx
      .select({ id: characters.id })
      .from(characters)
      .where(eq(characters.projectId, projectId))
      .orderBy(asc(characters.position));
    const [row] = await tx
      .insert(characters)
      .values({ projectId, name, description, position: existing.length })
      .returning();
    await enqueue(tx, "generate_character", { characterId: row!.id });
    return row!;
  });
}

export async function updateCharacter(
  deps: Deps,
  id: string,
  patch: { name?: string; description?: string },
): Promise<Character> {
  return deps.db.transaction(async (tx) => {
    const [found] = await tx.select({ projectId: characters.projectId }).from(characters).where(eq(characters.id, id));
    if (!found) throw new DomainError("Personagem não encontrado", 404);
    await lockProjectRow(tx, found.projectId);
    await assertCharactersStage(tx, found.projectId);
    const current = await lockCharacter(tx, id);

    const set: Partial<Character> = { approved: false };
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new DomainError("O nome não pode ficar vazio");
      await assertLabelFree(tx, current.projectId, name, id);
      set.name = name;
    }
    let descriptionChanged = false;
    if (patch.description !== undefined) {
      const description = patch.description.trim();
      if (!description) throw new DomainError("A descrição não pode ficar vazia");
      descriptionChanged = description !== current.description;
      set.description = description;
    }
    const [row] = await tx.update(characters).set(set).where(eq(characters.id, id)).returning();
    // O rótulo da imagem acompanha o nome (é por ele que o roteiro cita o personagem).
    if (set.name !== undefined && current.assetId) {
      await tx.update(assets).set({ label: set.name }).where(eq(assets.id, current.assetId));
    }
    if (descriptionChanged) await queueImage(tx, id);
    return descriptionChanged ? { ...row!, imageStatus: "pending", imageError: null } : row!;
  });
}

export async function regenerateCharacterImage(deps: Deps, id: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [found] = await tx.select({ projectId: characters.projectId }).from(characters).where(eq(characters.id, id));
    if (!found) throw new DomainError("Personagem não encontrado", 404);
    await lockProjectRow(tx, found.projectId);
    await assertCharactersStage(tx, found.projectId);
    const current = await lockCharacter(tx, id);
    // Geração custa crédito: clique duplo não pode enfileirar duas imagens.
    if (current.imageStatus === "pending") throw new DomainError("A imagem deste personagem já está sendo gerada");
    await queueImage(tx, id);
  });
}

export async function approveCharacter(db: Db, id: string): Promise<Character> {
  return db.transaction(async (tx) => {
    const [found] = await tx.select({ projectId: characters.projectId }).from(characters).where(eq(characters.id, id));
    if (!found) throw new DomainError("Personagem não encontrado", 404);
    await lockProjectRow(tx, found.projectId);
    await assertCharactersStage(tx, found.projectId);
    const current = await lockCharacter(tx, id);
    if (current.imageStatus !== "ready" || !current.assetId) {
      throw new DomainError("Espere a imagem do personagem ficar pronta para aprovar");
    }
    const [row] = await tx.update(characters).set({ approved: true }).where(eq(characters.id, id)).returning();
    return row!;
  });
}

export async function removeCharacter(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [found] = await tx.select({ projectId: characters.projectId }).from(characters).where(eq(characters.id, id));
    if (!found) throw new DomainError("Personagem não encontrado", 404);
    await lockProjectRow(tx, found.projectId);
    await assertCharactersStage(tx, found.projectId);
    const current = await lockCharacter(tx, id);
    if (current.assetId) await noteRemovedReference(tx, current.assetId, current.name);
    await tx.delete(characters).where(eq(characters.id, id));
    if (current.assetId) await tx.delete(assets).where(eq(assets.id, current.assetId));
  });
}
