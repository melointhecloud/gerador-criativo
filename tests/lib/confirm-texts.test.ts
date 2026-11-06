import { describe, expect, it } from "vitest";
import { confirmTexts, generateScenesLabel } from "@/lib/confirmTexts";

describe("confirmTexts", () => {
  it("mantém o texto de custo da geração de cenas", () => {
    const t = confirmTexts.generateScenes(3, 4, 18);
    expect(t.body).toBe(
      "Serão geradas 3 de 4 cenas (18 s de vídeo), o que consome crédito do provedor. Cenas já aprovadas serão mantidas.",
    );
    expect(t.confirmLabel).toBe("Gerar 3 cenas (18 s)");
    expect(t.tone).toBe("primary");
  });
  it("o botão de gerar diz o número de cenas e os segundos; sem cenas a gerar, vai para a revisão", () => {
    expect(generateScenesLabel(1, 6)).toBe("Gerar 1 cena (6 s)");
    expect(generateScenesLabel(0, 0)).toBe("Ir para a revisão");
  });
  it("ações destrutivas usam o tom de perigo e nomeiam a ação", () => {
    for (const t of [confirmTexts.removeCharacter("Marina"), confirmTexts.removeReference(null), confirmTexts.rewriteScript()]) {
      expect(t.tone).toBe("danger");
      expect(t.confirmLabel).not.toMatch(/^ok$/i);
    }
    expect(confirmTexts.removeReference(null).title).toBe("Remover a referência “sem rótulo”?");
    expect(confirmTexts.removeCharacter("Marina").body).toBe("As cenas que o usam vão avisar que perderam a referência.");
  });
});
