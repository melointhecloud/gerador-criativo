import { z } from "zod";
import { getSnapshot, updateBriefing } from "@/services/projects";
import { generationPlan, sceneIdsWithPendingAttempt } from "@/services/scenes";
import { api } from "@/web/http";

export const GET = api(async ({ params, deps }) => {
  const snap = await getSnapshot(deps.db, params.id);
  return { ...snap, ...generationPlan(snap.scenes, sceneIdsWithPendingAttempt(snap.scenes)) };
});

export const PATCH = api(async ({ req, params, deps }) => {
  const body = z.object({ name: z.string().max(200).optional(), copy: z.string().max(20000).optional() }).parse(await req.json());
  return updateBriefing(deps.db, params.id, body);
});
