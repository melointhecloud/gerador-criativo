import { z } from "zod";
import { regenerateScene } from "@/services/scenes";
import { api } from "@/web/http";

export const POST = api(async ({ req, params, deps }) => {
  const body = z.object({ prompt: z.string().max(5000).optional() }).parse(await req.json().catch(() => ({})));
  return regenerateScene(deps, params.id, body.prompt);
});
