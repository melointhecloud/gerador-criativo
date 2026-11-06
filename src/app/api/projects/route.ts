import { z } from "zod";
import { MODES } from "@/domain/stages";
import { createProject, listProjects } from "@/services/projects";
import { api } from "@/web/http";

export const GET = api(async ({ deps }) => ({ projects: await listProjects(deps.db) }));

export const POST = api(async ({ req, deps }) => {
  const body = z.object({ name: z.string().max(200), mode: z.enum(MODES) }).parse(await req.json());
  return createProject(deps.db, body);
});
