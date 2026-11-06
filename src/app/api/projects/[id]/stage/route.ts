import { z } from "zod";
import { STAGES } from "@/domain/stages";
import { setStage } from "@/services/projects";
import { api } from "@/web/http";

// `generating` e `assembling` NÃO podem ser pedidas por aqui: só entram pelas ações que
// também enfileiram os jobs (`generateAllScenes` e `startAssembly`, Plano 2 Task 6).
// Sem isso, uma chamada direta deixaria o projeto preso nessas etapas sem nenhum job rodando.
// Além disso, `setStage` recusa sair de `generating` (DomainError em português): só o worker faz essa transição.
const NAVIGABLE_STAGES = STAGES.filter((s) => s !== "generating" && s !== "assembling");

export const POST = api(async ({ req, params, deps }) => {
  const { stage } = z.object({ stage: z.enum(NAVIGABLE_STAGES as [string, ...string[]]) }).parse(await req.json());
  return setStage(deps.db, params.id, stage as (typeof STAGES)[number]);
});
