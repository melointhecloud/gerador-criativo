import { z } from "zod";
import { approveAttempt } from "@/services/scenes";
import { api } from "@/web/http";

export const POST = api(async ({ req, params, deps }) => {
  const { attemptId } = z.object({ attemptId: z.guid() }).parse(await req.json());
  return approveAttempt(deps.db, params.id, attemptId);
});
