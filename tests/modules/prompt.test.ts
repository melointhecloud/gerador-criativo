import { describe, expect, it } from "vitest";
import { buildCharacterImagePrompt, buildScenePrompt } from "@/modules/prompt";

const scene = { dialogue: "Funciona mesmo!", visualPrompt: "Close no rosto sorrindo", targetSeconds: 5 };

describe("buildScenePrompt", () => {
  it("ugc: estilo celular, 9:16 e fala em pt-BR", () => {
    const p = buildScenePrompt("ugc", scene);
    expect(p).toContain("9:16");
    expect(p).toContain("UGC");
    expect(p).toContain("Close no rosto sorrindo");
    expect(p).toContain('"Funciona mesmo!"');
    expect(p).toContain("5 segundos");
  });
  it("novelinha: estilo dramático", () => {
    expect(buildScenePrompt("novelinha", scene)).toContain("novela");
  });
  it("sem fala: avisa que não há fala", () => {
    expect(buildScenePrompt("ugc", { ...scene, dialogue: "  " })).toContain("Sem fala");
  });
});

describe("buildCharacterImagePrompt", () => {
  it("inclui nome e descrição", () => {
    const p = buildCharacterImagePrompt({ name: "Marina", description: "Mulher de 35 anos, cabelo cacheado" });
    expect(p).toContain("Marina");
    expect(p).toContain("cabelo cacheado");
    expect(p).toContain("9:16");
  });
});
