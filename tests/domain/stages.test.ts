import { describe, expect, it } from "vitest";
import { canTransition, nextStage, stagesFor } from "@/domain/stages";

describe("stagesFor", () => {
  it("ugc não tem etapa de personagens", () => {
    expect(stagesFor("ugc")).toEqual(["briefing", "script", "generating", "review", "assembling", "done"]);
  });
  it("novelinha tem todas as etapas", () => {
    expect(stagesFor("novelinha")).toEqual([
      "briefing", "characters", "script", "generating", "review", "assembling", "done",
    ]);
  });
});

describe("nextStage", () => {
  it("avança na ordem do modo", () => {
    expect(nextStage("ugc", "briefing")).toBe("script");
    expect(nextStage("novelinha", "briefing")).toBe("characters");
    expect(nextStage("novelinha", "characters")).toBe("script");
  });
  it("done não tem próxima", () => {
    expect(nextStage("ugc", "done")).toBeNull();
  });
});

describe("canTransition", () => {
  it("permite avançar só um passo", () => {
    expect(canTransition("ugc", "briefing", "script")).toBe(true);
    expect(canTransition("ugc", "briefing", "generating")).toBe(false);
  });
  it("permite voltar para etapas editáveis", () => {
    expect(canTransition("novelinha", "review", "script")).toBe(true);
    expect(canTransition("novelinha", "script", "characters")).toBe(true);
    expect(canTransition("ugc", "done", "review")).toBe(true);
  });
  it("não permite voltar para generating nem assembling", () => {
    expect(canTransition("ugc", "review", "generating")).toBe(false);
    expect(canTransition("ugc", "done", "assembling")).toBe(false);
  });
  it("assembling é travado", () => {
    expect(canTransition("ugc", "assembling", "review")).toBe(false);
  });
  it("etapa fora do modo é inválida", () => {
    expect(canTransition("ugc", "briefing", "characters")).toBe(false);
    expect(canTransition("ugc", "characters", "script")).toBe(false);
  });
  it("mesma etapa não é transição", () => {
    expect(canTransition("ugc", "script", "script")).toBe(false);
  });
});
