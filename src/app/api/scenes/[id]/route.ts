import { z } from "zod";
import { updateScene } from "@/services/scenes";
import { api } from "@/web/http";

export const PATCH = api(async ({ req, params, deps }) => {
  const body = z
    .object({
      dialogue: z.string().max(5000).optional(),
      visualPrompt: z.string().max(5000).optional(),
      targetSeconds: z.number().int().optional(),
    })
    .parse(await req.json());
  return updateScene(deps.db, params.id, body, deps.config.sceneMaxSeconds);
});
