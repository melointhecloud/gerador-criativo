"use client";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ConfirmRequest } from "@/lib/confirmTexts";
import { AlertIcon } from "./icons";

// Diálogo de confirmação acessível no lugar do window.confirm. Bloqueante: `confirm()` devolve uma
// promessa que só resolve `true` quando a pessoa clica no botão de confirmar; Esc, "Cancelar" e clique
// fora resolvem `false`. Usa o <dialog> nativo com showModal(): o foco fica preso no diálogo e o resto
// da página fica inerte. Ao fechar, o foco volta para o botão que abriu o diálogo.

type Confirm = (request: ConfirmRequest) => Promise<boolean>;
type Pending = ConfirmRequest & { resolve: (ok: boolean) => void };

const ConfirmContext = createContext<Confirm | null>(null);

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm precisa de um <ConfirmProvider> acima na árvore");
  return confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const uid = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef<Pending | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const pressedOnBackdrop = useRef(false);
  const [pending, setPending] = useState<Pending | null>(null);

  const settle = useCallback((ok: boolean) => {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    if (dialogRef.current?.open) dialogRef.current.close();
    setPending(null);
    const back = returnFocusRef.current;
    returnFocusRef.current = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
    p.resolve(ok);
  }, []);

  const confirm = useCallback<Confirm>(
    (request) =>
      new Promise<boolean>((resolve) => {
        pendingRef.current?.resolve(false); // um diálogo por vez: o anterior conta como cancelado
        const active = document.activeElement;
        returnFocusRef.current = active instanceof HTMLElement ? active : null;
        const next = { ...request, resolve };
        pendingRef.current = next;
        setPending(next);
      }),
    [],
  );

  useEffect(() => {
    const d = dialogRef.current;
    if (!pending || !d) return;
    if (!d.open) d.showModal();
    cancelRef.current?.focus(); // foco inicial na opção segura
  }, [pending]);

  // Desmontou com um diálogo aberto: a ação não acontece.
  useEffect(() => () => pendingRef.current?.resolve(false), []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog
        ref={dialogRef}
        className={`dialog${pending?.tone === "danger" ? " dialog-danger" : ""}`}
        aria-labelledby={`${uid}-titulo`}
        aria-describedby={`${uid}-texto`}
        onCancel={(e) => {
          e.preventDefault(); // Esc: cancela pelo mesmo caminho dos botões
          settle(false);
        }}
        onClose={() => settle(false)}
        onPointerDown={(e) => {
          pressedOnBackdrop.current = e.target === e.currentTarget;
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget && pressedOnBackdrop.current) settle(false);
        }}
      >
        {pending && (
          <div className="dialog-body">
            <div className="dialog-text">
              <h2 id={`${uid}-titulo`} className="dialog-title">
                {pending.tone === "danger" && <AlertIcon />}
                {pending.title}
              </h2>
              <p id={`${uid}-texto`}>{pending.body}</p>
            </div>
            <div className="dialog-actions">
              <button ref={cancelRef} type="button" className="secondary" onClick={() => settle(false)}>
                {pending.cancelLabel ?? "Cancelar"}
              </button>
              <button type="button" className={pending.tone === "danger" ? "danger" : undefined} onClick={() => settle(true)}>
                {pending.confirmLabel}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}
