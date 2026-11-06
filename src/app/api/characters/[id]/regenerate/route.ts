import { regenerateCharacterImage } from "@/services/characters";
import { api } from "@/web/http";

export const POST = api(async ({ params, deps }) => {
  await regenerateCharacterImage(deps, params.id);
  return { ok: true };
});
