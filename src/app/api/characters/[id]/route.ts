import { z } from "zod";
import { removeCharacter, updateCharacter } from "@/services/characters";
import { api } from "@/web/http";

export const PATCH = api(async ({ req, params, deps }) => {
  const body = z
    .object({ name: z.string().max(200).optional(), description: z.string().max(5000).optional() })
    .parse(await req.json());
  return updateCharacter(deps, params.id, body);
});

export const DELETE = api(async ({ params, deps }) => {
  await removeCharacter(deps.db, params.id);
  return { ok: true };
});
