import { describe, expect, it } from "vitest";
import { proposeCharacters } from "@/modules/character-designer";
import { FakeTextModel } from "@/providers/fake";

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

  it("rejeita resposta sem personagens", async () => {
    const text = new FakeTextModel([{ characters: [] }]);
    await expect(proposeCharacters(text, copy)).rejects.toThrow();
  });
});
