"use client";

// "Alterações não salvas" junto do botão de salvar (tungstênio: depende de você).
export function UnsavedBadge({ dirty }: { dirty: boolean }) {
  // Região sempre presente (vazia quando não há alterações), para o aviso ser anunciado ao aparecer.
  return (
    <span className="unsaved" role="status">
      {dirty ? "Alterações não salvas" : ""}
    </span>
  );
}
