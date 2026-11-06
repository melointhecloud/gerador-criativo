import type { Db } from "@/db/client";
import {
  assets, characters, sceneAttempts, sceneReferences, scenes, projects,
  type AssetKind, type AttemptStatus,
} from "@/db/schema";
import type { Mode, Stage } from "@/domain/stages";

export async function seedProject(
  db: Db,
  o: Partial<{ name: string; mode: Mode; copy: string; stage: Stage }> = {},
) {
  const [row] = await db
    .insert(projects)
    .values({ name: o.name ?? "Projeto", mode: o.mode ?? "ugc", copy: o.copy ?? "Copy de teste", stage: o.stage ?? "briefing" })
    .returning();
  return row!;
}

export async function seedAsset(
  db: Db,
  projectId: string,
  o: Partial<{ kind: AssetKind; label: string | null; storageKey: string; durationSeconds: number }> = {},
) {
  const [row] = await db
    .insert(assets)
    .values({
      projectId,
      kind: o.kind ?? "reference",
      label: o.label === undefined ? null : o.label,
      storageKey: o.storageKey ?? `projects/${projectId}/x-${Math.random().toString(36).slice(2)}.png`,
      mimeType: o.kind === "clip" || o.kind === "final" ? "video/mp4" : "image/png",
      durationSeconds: o.durationSeconds ?? null,
    })
    .returning();
  return row!;
}

export async function seedCharacter(
  db: Db,
  projectId: string,
  o: Partial<{ name: string; approved: boolean; imageStatus: "pending" | "ready" | "failed"; assetId: string | null }> = {},
) {
  const [row] = await db
    .insert(characters)
    .values({
      projectId,
      name: o.name ?? "Maria",
      description: "Mulher de 35 anos",
      approved: o.approved ?? false,
      imageStatus: o.imageStatus ?? "pending",
      assetId: o.assetId ?? null,
    })
    .returning();
  return row!;
}

export async function seedScene(
  db: Db,
  projectId: string,
  position: number,
  o: Partial<{ dialogue: string; visualPrompt: string; targetSeconds: number; assetIds: string[] }> = {},
) {
  const [row] = await db
    .insert(scenes)
    .values({
      projectId,
      position,
      dialogue: o.dialogue ?? `Fala ${position + 1}`,
      visualPrompt: o.visualPrompt ?? `Visual ${position + 1}`,
      targetSeconds: o.targetSeconds ?? 5,
    })
    .returning();
  for (const assetId of o.assetIds ?? []) {
    await db.insert(sceneReferences).values({ sceneId: row!.id, assetId });
  }
  return row!;
}

export async function seedAttempt(
  db: Db,
  sceneId: string,
  o: Partial<{ status: AttemptStatus; providerRef: string | null; clipAssetId: string | null; referenceAssetIds: string[]; prompt: string }> = {},
) {
  const [row] = await db
    .insert(sceneAttempts)
    .values({
      sceneId,
      prompt: o.prompt ?? "prompt",
      status: o.status ?? "queued",
      providerRef: o.providerRef ?? null,
      clipAssetId: o.clipAssetId ?? null,
      referenceAssetIds: o.referenceAssetIds ?? [],
    })
    .returning();
  return row!;
}
