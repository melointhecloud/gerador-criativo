// O servidor guarda nome, aparência, fala e descrição visual SEM espaços nas pontas.
// Comparar o texto cru deixaria o formulário "sujo" para sempre depois de salvar com espaço sobrando.
export function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

// Diferença real entre o rascunho e o valor salvo: espaços só nas pontas não contam.
export function isTextDirty(draft: string | null | undefined, saved: string | null | undefined): boolean {
  return normalizeText(draft) !== normalizeText(saved);
}
