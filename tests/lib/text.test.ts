import { describe, expect, it } from "vitest";
import { endSentence } from "@/lib/text";

describe("endSentence", () => {
  it("acrescenta o ponto quando falta", () => {
    expect(endSentence("Cota esgotada")).toBe("Cota esgotada.");
    expect(endSentence("  Cota esgotada  ")).toBe("Cota esgotada.");
  });
  it("mantém a pontuação final existente", () => {
    for (const t of ["Falhou.", "Falhou!", "Falhou?", "Falhou…", "Falhou:", "Falhou;", "Falhou.”", "Falhou.)", 'Falhou."']) {
      expect(endSentence(t)).toBe(t);
    }
  });
  it("vazio ou só espaços volta aparado", () => {
    expect(endSentence("")).toBe("");
    expect(endSentence("   ")).toBe("");
  });
});
