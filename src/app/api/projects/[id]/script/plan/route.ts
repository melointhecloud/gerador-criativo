import { z } from "zod";
import { planProjectScript } from "@/services/scenes";
import { api } from "@/web/http";

export const POST = api(async ({ req, params, deps }) => {
  const body = z.object({ feedback: z.string().max(5000).optional() }).parse(await req.json().catch(() => ({})));
  await planProjectScript(deps, params.id, body.feedback);
  return { ok: true };
});
