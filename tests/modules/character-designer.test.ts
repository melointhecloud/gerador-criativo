import { describe, expect, it } from "vitest";
import { proposeCharacters } from "@/modules/character-designer";
import { FakeTextModel } from "@/providers/fake";
import { ProviderError } from "@/providers/types";

const copy = "Maria flagra Carlos com a vizinha Helena e decide se vingar.";

describe("proposeCharacters", () => {
  it("devolve personagens da copy", async () => {
    const text = new FakeTextModel([
      { characters: [{ name: "Maria", description: "Mulher de 35 anos, cabelo cacheado" }, { name: "Carlos", description: "Homem de 40 anos, barba" }] },
    ]);
    const out = await proposeCharacters(text, copy);
    expect(out.map((c) => c.name)).toEqual(["Maria", "Carlos"]);
    expect(text.calls[0]!.task).toBe("characters");
    expect(text.calls[0]!.prompt).toContain("Maria flagra Carlos");
  });

  it("remove nomes repetidos ignorando caixa", async () => {
    const text = new FakeTextModel([
      { characters: [{ name: "Maria", description: "a" }, { name: "maria", description: "b" }] },
    ]);
    const out = await proposeCharacters(text, copy);
    expect(out).toHaveLength(1);
  });

  it("rejeita resposta sem personagens após 3 tentativas", async () => {
    const text = new FakeTextModel([{ characters: [] }, { characters: [] }, { characters: [] }]);
    await expect(proposeCharacters(text, copy)).rejects.toThrow(/após 3 tentativas/);
    expect(text.calls).toHaveLength(3);
  });

  it("tenta de novo quando a primeira resposta é inválida", async () => {
    const text = new FakeTextModel([
      { characters: [] },
      { characters: [{ name: "Maria", description: "Mulher de 35 anos" }] },
    ]);
    const out = await proposeCharacters(text, copy);
    expect(out).toEqual([{ name: "Maria", description: "Mulher de 35 anos" }]);
    expect(text.calls).toHaveLength(2);
  });

  it("não tenta de novo em erro que não é de validação", async () => {
    const boom = new ProviderError("falha", false);
    const text = new FakeTextModel(() => {
      throw boom;
    });
    await expect(proposeCharacters(text, copy)).rejects.toBe(boom);
    expect(text.calls).toHaveLength(1);
  });
});
