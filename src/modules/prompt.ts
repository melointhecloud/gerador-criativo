import type { Mode } from "@/domain/stages";

export function buildScenePrompt(
  mode: Mode,
  scene: { dialogue: string; visualPrompt: string; targetSeconds: number },
): string {
  const style =
    mode === "ugc"
      ? "Vídeo vertical 9:16 em estilo UGC, filmado com celular, luz natural, câmera na mão, aparência real e sem retoque."
      : "Vídeo vertical 9:16 em estilo cinematográfico de novela dramática, iluminação de cena, interpretação expressiva.";
  const speech = scene.dialogue.trim()
    ? `Fala em português do Brasil, dita em voz alta, com a boca sincronizada: "${scene.dialogue.trim()}"`
    : "Sem fala nesta cena.";
  return `${style} Duração aproximada: ${scene.targetSeconds} segundos.\n${scene.visualPrompt.trim()}\n${speech}`;
}

export function buildCharacterImagePrompt(c: { name: string; description: string }): string {
  return (
    "Retrato de corpo inteiro de um personagem, fundo neutro liso, luz suave de estúdio, " +
    "enquadramento vertical 9:16, imagem de referência para manter o mesmo personagem em várias cenas. " +
    `Personagem: ${c.name}. ${c.description.trim()}`
  );
}
