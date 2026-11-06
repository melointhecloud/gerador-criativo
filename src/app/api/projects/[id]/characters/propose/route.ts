import { proposeProjectCharacters } from "@/services/characters";
import { api } from "@/web/http";

export const POST = api(async ({ params, deps }) => {
  await proposeProjectCharacters(deps, params.id);
  return { ok: true };
});
