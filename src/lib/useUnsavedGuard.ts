"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { guardedDestination } from "./flow";

// Aviso de alterações não salvas (sem salvamento automático, sem chamadas novas à API):
// - fechar/recarregar a aba: o aviso nativo do navegador (beforeunload);
// - links internos (trilha "Projetos", cabeçalho): intercepta o clique e pergunta com `ask()` (o diálogo de
//   confirmação); só navega se a pessoa confirmar.
export function useUnsavedGuard(dirty: boolean, ask: () => Promise<boolean>) {
  const router = useRouter();
  const askRef = useRef(ask);
  useEffect(() => {
    askRef.current = ask;
  });

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // navegadores que ainda exigem o campo legado
    };
    // Fase de captura no document: roda antes do onClick do <Link> do Next (que fica na raiz do React).
    const onClick = (e: MouseEvent) => {
      const link = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      const dest = guardedDestination(
        e,
        { href: link.href, target: link.target, download: link.hasAttribute("download") },
        window.location.href,
      );
      if (!dest) return;
      e.preventDefault();
      e.stopPropagation();
      void askRef.current().then((ok) => {
        if (ok) router.push(dest);
      });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, router]);
}
