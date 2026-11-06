import { regenerateAllScenes } from "@/services/scenes";
import { api } from "@/web/http";

export const POST = api(async ({ params, deps }) => {
  await regenerateAllScenes(deps, params.id);
  return { ok: true };
});
