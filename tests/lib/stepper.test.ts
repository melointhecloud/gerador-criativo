import { describe, expect, it } from "vitest";
import { canTransition, stagesFor, type Mode, type Stage } from "@/domain/stages";
import { backLockReason, buildStepper } from "@/lib/stepper";

const states = (mode: Mode, stage: Stage, pending = false) =>
  buildStepper(mode, stage, pending).steps.map((s) => [s.stage, s.state]);

describe("buildStepper", () => {
  it("no briefing, só a próxima etapa aparece travada, com o motivo", () => {
    const m = buildStepper("ugc", "briefing", false);
    expect(states("ugc", "briefing")).toEqual([
      ["briefing", "current"],
      ["script", "locked"],
      ["generating", "upcoming"],
      ["review", "upcoming"],
      ["assembling", "upcoming"],
      ["done", "upcoming"],
    ]);
    expect(m.steps[1]!.reason).toBe("Roteiro: disponível depois de escrever a copy e continuar.");
    expect(m.canGoBack).toBe(true);
    expect(m.backReason).toBeNull();
  });

  it("em personagens, o roteiro abre depois de aprovar todos os personagens", () => {
    const m = buildStepper("novelinha", "characters", false);
    expect(m.nextReason).toBe("Roteiro: disponível depois de aprovar todos os personagens.");
    expect(m.steps[0]!.state).toBe("available");
  });

  it("na revisão sem gerações pendentes, dá para voltar ao briefing e ao roteiro, mas não para `generating`", () => {
    expect(states("ugc", "review")).toEqual([
      ["briefing", "available"],
      ["script", "available"],
      ["generating", "completed"],
      ["review", "current"],
      ["assembling", "locked"],
      ["done", "upcoming"],
    ]);
  });

  it("na revisão com geração pendente, as etapas anteriores ficam travadas com o motivo", () => {
    const m = buildStepper("ugc", "review", true);
    expect(m.canGoBack).toBe(false);
    expect(m.steps[0]).toMatchObject({ state: "locked", reason: "Aguarde as gerações terminarem para voltar a uma etapa anterior." });
    expect(m.steps[2]!.state).toBe("completed");
  });

  it("gerando e montando travam a volta (só o worker tira o projeto dessas etapas)", () => {
    expect(buildStepper("novelinha", "generating", false).canGoBack).toBe(false);
    expect(buildStepper("novelinha", "assembling", false).canGoBack).toBe(false);
    expect(backLockReason("generating", false)).toMatch(/^Aguarde a geração das cenas terminar/);
    expect(backLockReason("assembling", false)).toMatch(/^Aguarde a montagem/);
    expect(backLockReason("script", true)).toBeNull();
  });

  it("pronto: tudo concluído, sem próxima etapa", () => {
    const m = buildStepper("ugc", "done", false);
    expect(m.nextReason).toBeNull();
    expect(m.steps.at(-1)!.state).toBe("current");
  });

  // Toda etapa "available" é uma volta que a API aceita (o stepper nunca oferece um botão que falharia).
  it("as etapas disponíveis são sempre transições válidas", () => {
    for (const mode of ["ugc", "novelinha"] as const) {
      for (const stage of stagesFor(mode)) {
        for (const pending of [false, true]) {
          for (const s of buildStepper(mode, stage, pending).steps) {
            if (s.state === "available") expect(canTransition(mode, stage, s.stage)).toBe(true);
          }
        }
      }
    }
  });
});
