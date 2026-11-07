import { stagesFor, type Mode, type Stage } from "@/domain/stages";
import { STAGE_LABELS } from "./labels";

// Linha do tempo das etapas (docs/design/direction.md, seção 5). Só descreve o que a tela mostra:
// as regras de navegação são as mesmas de antes (voltar só para etapas editáveis e nunca com trabalho
// em andamento; avançar só pelas ações de cada painel).

export type StepState =
  | "current" // etapa atual
  | "available" // concluída e dá para voltar (botão)
  | "completed" // concluída, mas é uma etapa da máquina (não se volta para ela)
  | "locked" // travada, com o motivo escrito
  | "upcoming"; // futura

export type Step = { stage: Stage; number: number; label: string; state: StepState; reason: string | null };
export type StepperModel = {
  steps: Step[];
  canGoBack: boolean;
  backReason: string | null; // por que não dá para voltar agora
  nextReason: string | null; // o que libera a próxima etapa
};

const MACHINE_STAGES: Stage[] = ["generating", "assembling"];

export function isMachineStage(stage: Stage): boolean {
  return MACHINE_STAGES.includes(stage);
}

// Mesma regra que o ProjectView já usava: só o worker tira o projeto de `generating`/`assembling`, e na
// revisão não dá para voltar enquanto uma regeração está na fila ou rodando (`hasPendingGenerations`).
export function backLockReason(stage: Stage, hasPendingGenerations: boolean): string | null {
  if (stage === "generating") return "Aguarde a geração das cenas terminar para voltar a uma etapa anterior.";
  if (stage === "assembling") return "Aguarde a montagem do vídeo terminar para voltar a uma etapa anterior.";
  if (stage === "review" && hasPendingGenerations) return "Aguarde as gerações terminarem para voltar a uma etapa anterior.";
  return null;
}

// O que libera a etapa seguinte (as mesmas condições dos botões de cada painel).
const NEXT_CONDITION: Record<Stage, string | null> = {
  briefing: "disponível depois de escrever a copy e continuar.",
  characters: "disponível depois de aprovar todos os personagens.",
  script: "disponível depois de aprovar o roteiro e gerar as cenas.",
  generating: "disponível quando todas as cenas terminarem de gerar.",
  review: "disponível depois de aprovar todas as cenas e montar o vídeo.",
  assembling: "disponível quando a montagem terminar.",
  done: null,
};

export function buildStepper(mode: Mode, stage: Stage, hasPendingGenerations: boolean): StepperModel {
  const stages = stagesFor(mode);
  const current = stages.indexOf(stage);
  const backReason = backLockReason(stage, hasPendingGenerations);
  const canGoBack = backReason === null;
  const next = stages[current + 1];
  const nextCondition = NEXT_CONDITION[stage];
  const nextReason = next && nextCondition ? `${STAGE_LABELS[next]}: ${nextCondition}` : null;

  const steps = stages.map((s, i): Step => {
    const base = { stage: s, number: i + 1, label: STAGE_LABELS[s] };
    if (i === current) return { ...base, state: "current", reason: null };
    if (i < current) {
      if (isMachineStage(s)) return { ...base, state: "completed", reason: null };
      return canGoBack ? { ...base, state: "available", reason: null } : { ...base, state: "locked", reason: backReason };
    }
    if (i === current + 1) return { ...base, state: "locked", reason: nextReason };
    return { ...base, state: "upcoming", reason: null };
  });

  return { steps, canGoBack, backReason, nextReason };
}
