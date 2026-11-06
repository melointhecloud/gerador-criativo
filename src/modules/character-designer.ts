import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { assets, characters, projects, sceneReferences } from "@/db/schema";
import type { Deps } from "@/deps";
import { PermanentError } from "@/queue/errors";
import { ProviderError, type TextModel } from "@/providers/types";
import { buildCharacterImagePrompt } from "./prompt";

const proposalSchema = z.object({
  characters: z
    .array(z.object({ name: z.string().min(1), description: z.string().min(1) }))
    .min(1)
    .max(6),
});

export type CharacterProposal = { name: string; description: string };

export async function proposeCharacters(text: TextModel, copy: string): Promise<CharacterProposal[]> {
  const system = [
    "Você é diretor de elenco de novelinhas curtas para TikTok Ads, escrevendo em português do Brasil.",
    "Liste os personagens que aparecem na história da copy (no máximo 6, só os que importam).",
    "Para cada um: name (nome curto, único) e description (aparência física detalhada: idade aproximada, rosto, cabelo, pele, roupa, expressão marcante).",
    "A descrição será usada para gerar uma foto de referência: seja concreto e visual, sem contar a história.",
  ].join("\n");
  const prompt = `COPY:\n${copy.trim()}`;
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { characters } = await text.generateJson({ task: "characters", system, prompt, schema: proposalSchema });
      const seen = new Set<string>();
      return characters
        .map((c) => ({ name: c.name.trim(), description: c.description.trim() }))
        .filter((c) => {
          const key = c.name.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    } catch (e) {
      if (e instanceof z.ZodError || e instanceof SyntaxError) {
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`O modelo não devolveu personagens válidos após 3 tentativas: ${reason}`);
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

// Idempotente: só gera quando o personagem ainda está "pending" (reentrega depois de queda vira no-op) e só grava
// se a descrição não mudou durante a geração (nesse caso, o job enfileirado pela edição cuida da imagem nova).
export async function handleGenerateCharacter(deps: Deps, payload: { characterId: string }): Promise<void> {
  const { db, storage, providers } = deps;
  const [character] = await db.select().from(characters).where(eq(characters.id, payload.characterId));
  if (!character) throw new PermanentError("Personagem não encontrado");
  if (character.imageStatus !== "pending") return;

  let image;
  try {
    image = await providers.image.generateImage({ prompt: buildCharacterImagePrompt(character) });
  } catch (e) {
    if (e instanceof ProviderError && !e.retryable) {
      await db
        .update(characters)
        .set({ imageStatus: "failed", imageError: e.message })
        .where(eq(characters.id, character.id));
      return;
    }
    throw e;
  }

  const key = `projects/${character.projectId}/characters/${character.id}-${Date.now()}.${EXT[image.mimeType] ?? "png"}`;
  await storage.put(key, image.bytes, image.mimeType);
  await db.transaction(async (tx) => {
    // Ordem de locks igual à dos serviços (projeto primeiro, depois personagem): inserir o asset toma um lock
    // compartilhado na linha do projeto (FK), e travar o personagem antes disso fecharia um ciclo com
    // updateCharacter/regenerateCharacterImage (deadlock 40P01).
    await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, character.projectId)).for("update");
    const [current] = await tx.select().from(characters).where(eq(characters.id, character.id)).for("update");
    if (!current || current.imageStatus !== "pending" || current.description !== character.description) return;
    const [asset] = await tx
      .insert(assets)
      .values({
        projectId: current.projectId,
        kind: "character",
        label: current.name,
        storageKey: key,
        mimeType: image.mimeType,
      })
      .returning();
    await tx
      .update(characters)
      .set({ assetId: asset!.id, imageStatus: "ready", imageError: null })
      .where(eq(characters.id, current.id));
    if (current.assetId) {
      // scene_references.asset_id tem ON DELETE CASCADE: sem repontar, apagar a imagem antiga desvincularia o
      // personagem das cenas já planejadas (e a próxima geração paga perderia a referência de identidade).
      await tx.update(sceneReferences).set({ assetId: asset!.id }).where(eq(sceneReferences.assetId, current.assetId));
      await tx.delete(assets).where(eq(assets.id, current.assetId));
    }
  });
}

// Chamado pelo worker quando o job morre; deixa o personagem em "failed" (recuperável por regerar). No-op se já está pronto.
export async function onGenerateCharacterDead(deps: Deps, payload: { characterId: string }, message: string) {
  await deps.db
    .update(characters)
    .set({ imageStatus: "failed", imageError: message })
    .where(and(eq(characters.id, payload.characterId), eq(characters.imageStatus, "pending")));
}
