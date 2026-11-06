import { startAssembly } from "@/services/scenes";
import { api } from "@/web/http";

export const POST = api(async ({ params, deps }) => {
  await startAssembly(deps.db, params.id);
  return { ok: true };
});
