import type { Stage } from "@/domain/stages";

export const STAGE_LABELS: Record<Stage, string> = {
  briefing: "Briefing",
  characters: "Personagens",
  script: "Roteiro",
  generating: "Gerando cenas",
  review: "Revisão",
  assembling: "Montando",
  done: "Pronto",
};
