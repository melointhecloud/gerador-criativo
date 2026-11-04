import { describe, expect, it } from "vitest";
import { resolveReferences, scriptDraftSchema } from "@/domain/script";

describe("scriptDraftSchema", () => {
  const schema = scriptDraftSchema(8);
  const scene = { dialogue: "Oi", visualPrompt: "Close no rosto", targetSeconds: 6, referenceLabels: ["produto"] };

  it("aceita um roteiro válido", () => {
    expect(schema.parse({ scenes: [scene] }).scenes).toHaveLength(1);
  });
  it("rejeita roteiro sem cenas", () => {
    expect(() => schema.parse({ scenes: [] })).toThrow();
  });
  it("rejeita duração acima do máximo do provider", () => {
    expect(() => schema.parse({ scenes: [{ ...scene, targetSeconds: 9 }] })).toThrow();
  });
  it("rejeita prompt visual vazio", () => {
    expect(() => schema.parse({ scenes: [{ ...scene, visualPrompt: "" }] })).toThrow();
  });
});

describe("resolveReferences", () => {
  const available = ["produto", "Maria", "João", "Ana"];

  it("mantém labels válidos, ignorando caixa e repetição", () => {
    const r = resolveReferences(["Produto", "maria", "MARIA"], available, 3);
    expect(r.used).toEqual(["produto", "Maria"]);
    expect(r.notice).toBeNull();
  });
  it("descarta labels desconhecidos e avisa", () => {
    const r = resolveReferences(["Maria", "Fantasma"], available, 3);
    expect(r.used).toEqual(["Maria"]);
    expect(r.notice).toContain("Fantasma");
  });
  it("corta acima do limite mantendo os primeiros e avisa", () => {
    const r = resolveReferences(["produto", "Maria", "João", "Ana"], available, 3);
    expect(r.used).toEqual(["produto", "Maria", "João"]);
    expect(r.notice).toContain("Ana");
    expect(r.notice).toContain("3");
  });
  it("lista vazia é válida", () => {
    expect(resolveReferences([], available, 3)).toEqual({ used: [], notice: null });
  });
});
