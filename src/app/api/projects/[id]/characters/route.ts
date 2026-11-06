import { z } from "zod";
import { addCharacter } from "@/services/characters";
import { api } from "@/web/http";

export const POST = api(async ({ req, params, deps }) => {
  const body = z.object({ name: z.string().max(200), description: z.string().max(5000) }).parse(await req.json());
  return addCharacter(deps, params.id, body);
});
