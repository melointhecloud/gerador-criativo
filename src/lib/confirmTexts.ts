// Textos dos diálogos de confirmação (ConfirmDialog). As ações pagas dizem o custo antes;
// as frases dos antigos `confirm()` foram mantidas (ver docs/design/direction.md, seção 8).

export type ConfirmTone = "danger" | "primary";
export type ConfirmRequest = {
  title: string;
  body: string;
  confirmLabel: string; // nomeia a ação ("Gerar 3 cenas"), nunca "OK"
  cancelLabel?: string;
  tone: ConfirmTone; // danger = destrutiva; primary = paga
};

export const IMAGE_COST = "Gerar uma nova imagem usa o provedor de imagens e pode custar créditos.";
export const IMAGES_COST = "Gerar novas imagens usa o provedor de imagens e pode custar créditos.";

function scenesWord(n: number): string {
  return n === 1 ? "1 cena" : `${n} cenas`;
}

// Texto do botão que gera as cenas no roteiro (e do botão de confirmar no diálogo).
export function generateScenesLabel(scenesToGenerate: number, estimatedSeconds: number): string {
  if (scenesToGenerate === 0) return "Ir para a revisão";
  return `Gerar ${scenesWord(scenesToGenerate)} (${estimatedSeconds} s)`;
}

export const confirmTexts = {
  removeReference: (label: string | null): ConfirmRequest => ({
    title: `Remover a referência “${label ?? "sem rótulo"}”?`,
    body: "As cenas que a usam vão avisar que perderam a referência.",
    confirmLabel: "Remover referência",
    tone: "danger",
  }),
  removeCharacter: (name: string): ConfirmRequest => ({
    title: `Remover o personagem “${name}”?`,
    body: "As cenas que o usam vão avisar que perderam a referência.",
    confirmLabel: "Remover personagem",
    tone: "danger",
  }),
  proposeCharacters: (): ConfirmRequest => ({
    title: "Sugerir personagens a partir da copy?",
    body: `A ferramenta sugere os personagens e gera uma imagem para cada um. ${IMAGES_COST}`,
    confirmLabel: "Sugerir personagens",
    tone: "primary",
  }),
  reproposeCharacters: (): ConfirmRequest => ({
    title: "Sugerir os personagens de novo?",
    body: `Isso substitui todos os personagens atuais. ${IMAGES_COST}`,
    confirmLabel: "Substituir personagens",
    tone: "danger",
  }),
  regenerateImage: (name: string): ConfirmRequest => ({
    title: `Gerar uma nova imagem de “${name}”?`,
    body: `${IMAGE_COST} O personagem volta a precisar de aprovação.`,
    confirmLabel: "Regerar imagem",
    tone: "primary",
  }),
  addCharacter: (name: string): ConfirmRequest => ({
    title: `Adicionar o personagem “${name}”?`,
    body: `A ferramenta gera uma imagem para o novo personagem. ${IMAGE_COST}`,
    confirmLabel: "Adicionar personagem",
    tone: "primary",
  }),
  rewriteScript: (): ConfirmRequest => ({
    title: "Reescrever o roteiro com estes ajustes?",
    body: "Reescrever o roteiro descarta as edições manuais e as cenas já geradas.",
    confirmLabel: "Reescrever roteiro",
    tone: "danger",
  }),
  generateScenes: (scenesToGenerate: number, totalScenes: number, estimatedSeconds: number): ConfirmRequest => ({
    title: `Gerar ${scenesWord(scenesToGenerate)}?`,
    body: `Serão geradas ${scenesToGenerate} de ${totalScenes} cenas (${estimatedSeconds} s de vídeo), o que consome crédito do provedor. Cenas já aprovadas serão mantidas.`,
    confirmLabel: generateScenesLabel(scenesToGenerate, estimatedSeconds),
    tone: "primary",
  }),
  regenerateScene: (sceneNumber: number, withEditedPrompt: boolean): ConfirmRequest => ({
    title: `Gerar a cena ${sceneNumber} de novo?`,
    body: "Isso consome crédito do provedor.",
    confirmLabel: withEditedPrompt ? "Regerar com este prompt" : `Regerar cena ${sceneNumber}`,
    tone: "primary",
  }),
  regenerateAll: (): ConfirmRequest => ({
    title: "Regerar todas as cenas?",
    body: "Isso gera e cobra todos os clipes de novo.",
    confirmLabel: "Regerar todas as cenas",
    tone: "primary",
  }),
  discardBriefing: (continueLabel: string): ConfirmRequest => ({
    title: "Sair sem salvar o briefing?",
    body: `O nome e a copy que você editou ainda não foram salvos e vão se perder. Eles são salvos quando você usa “${continueLabel}”.`,
    confirmLabel: "Sair sem salvar",
    cancelLabel: "Continuar editando",
    tone: "danger",
  }),
};
