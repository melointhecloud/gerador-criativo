import { describe, expect, it } from "vitest";
import { draftScript } from "@/modules/script-planner";
import { FakeTextModel } from "@/providers/fake";
import { ProviderError } from "@/providers/types";

const base = {
  mode: "novelinha" as const,
  copy: "Maria descobre que o marido a traiu e decide se vingar.",
  availableLabels: ["Maria", "Carlos", "produto"],
  maxReferences: 2,
  maxSeconds: 8,
};

const scene = (over: Record<string, unknown> = {}) => ({
  dialogue: "Eu sei de tudo.",
  visualPrompt: "Maria encara Carlos na sala",
  targetSeconds: 6,
  referenceLabels: ["Maria", "Carlos"],
  ...over,
});

describe("draftScript", () => {
  it("devolve as cenas com referências resolvidas e cortadas pelo limite", async () => {
    const text = new FakeTextModel([
      { scenes: [scene({ referenceLabels: ["maria", "Carlos", "produto", "Fantasma"] })] },
    ]);
    const out = await draftScript(text, base);
    expect(out).toHaveLength(1);
    expect(out[0]!.referenceLabels).toEqual(["Maria", "Carlos"]);
    expect(out[0]!.notice).toContain("Fantasma");
    expect(out[0]!.notice).toContain("produto");
  });

  it("inclui copy, rótulos, limites e modo no prompt", async () => {
    const text = new FakeTextModel([{ scenes: [scene()] }]);
    await draftScript(text, base);
    const call = text.calls[0]!;
    expect(call.task).toBe("script");
    expect(call.prompt).toContain("Maria descobre que o marido");
    expect(call.prompt).toContain("Maria, Carlos, produto");
    expect(call.system).toContain("novela");
    expect(call.system).toContain("8 segundos");
    expect(call.system).toContain("2 referências");
  });

  it("modo ugc usa instruções de UGC", async () => {
    const text = new FakeTextModel([{ scenes: [scene({ referenceLabels: [] })] }]);
    await draftScript(text, { ...base, mode: "ugc" });
    expect(text.calls[0]!.system).toContain("UGC");
  });

  it("inclui roteiro atual e feedback quando há revisão", async () => {
    const text = new FakeTextModel([{ scenes: [scene()] }]);
    await draftScript(text, {
      ...base,
      current: [{ dialogue: "Antes", visualPrompt: "Cena antiga", targetSeconds: 5 }],
      feedback: "Corte a cena 2 e deixe mais curto",
    });
    const p = text.calls[0]!.prompt;
    expect(p).toContain("Cena antiga");
    expect(p).toContain("Corte a cena 2 e deixe mais curto");
  });

  it("tenta de novo quando o modelo devolve JSON inválido", async () => {
    const text = new FakeTextModel([{ scenes: [] }, { scenes: [scene()] }]);
    const out = await draftScript(text, base);
    expect(out).toHaveLength(1);
    expect(text.calls).toHaveLength(2);
  });

  it("desiste após 3 respostas inválidas", async () => {
    const text = new FakeTextModel([{ scenes: [] }, { scenes: [] }, { scenes: [] }]);
    await expect(draftScript(text, base)).rejects.toThrow(/roteiro válido/);
    expect(text.calls).toHaveLength(3);
  });

  it("não tenta de novo em erro do provider", async () => {
    const text = new FakeTextModel(() => {
      throw new ProviderError("cota esgotada", true);
    });
    await expect(draftScript(text, base)).rejects.toBeInstanceOf(ProviderError);
    expect(text.calls).toHaveLength(1);
  });
});
