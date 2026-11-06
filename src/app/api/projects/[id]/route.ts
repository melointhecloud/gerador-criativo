import { z } from "zod";
import { getSnapshot, updateBriefing } from "@/services/projects";
import { generationPlan, sceneIdsWithPendingAttempt } from "@/services/scenes";
import { api } from "@/web/http";

export const GET = api(async ({ params, deps }) => {
  const snap = await getSnapshot(deps.db, params.id);
  const pending = sceneIdsWithPendingAttempt(snap.scenes);
  return { ...snap, ...generationPlan(snap.scenes, pending), hasPendingGenerations: pending.size > 0 };
});

export const PATCH = api(async ({ req, params, deps }) => {
  const body = z.object({ name: z.string().max(200).optional(), copy: z.string().max(20000).optional() }).parse(await req.json());
  return updateBriefing(deps.db, params.id, body);
});
