import { generateAllScenes } from "@/services/scenes";
import { api } from "@/web/http";

export const POST = api(async ({ params, deps }) => {
  await generateAllScenes(deps, params.id);
  return { ok: true };
});
