"use client";
import { useEffect, useId, useRef } from "react";
import type { Stage } from "@/domain/stages";
import { isMachineStage, type StepperModel } from "@/lib/stepper";
import { CheckIcon, LockIcon } from "./icons";

// Linha do tempo das etapas (docs/design/direction.md, seção 5): uma régua de segmentos, como clipes numa
// trilha de edição, com o cabeçote sobre a etapa atual. Só as etapas concluídas e editáveis são botões;
// travadas mostram o motivo escrito logo abaixo da régua.
export function StageTimeline({
  model,
  working,
  onGoTo,
}: {
  model: StepperModel;
  working: boolean;
  onGoTo: (stage: Stage) => void;
}) {
  const uid = useId();
  const trackRef = useRef<HTMLOListElement>(null);
  const current = model.steps.find((s) => s.state === "current");

  // No celular a régua rola na horizontal: mostra a etapa atual sem rolar a página.
  useEffect(() => {
    const track = trackRef.current;
    const el = track?.querySelector<HTMLElement>("[data-current]");
    if (!track || !el || track.scrollWidth <= track.clientWidth) return;
    track.scrollLeft = Math.max(0, el.offsetLeft - 16);
  }, [current?.stage]);

  const backId = `${uid}-voltar`;
  const nextId = `${uid}-proxima`;
  const tone = current?.stage === "done" ? " is-finished" : current && isMachineStage(current.stage) ? " is-machine" : "";

  return (
    <nav className="timeline" aria-label="Etapas do projeto">
      <ol ref={trackRef} className={`timeline-track${tone}`}>
        {model.steps.map((s) => {
          const text = (
            <>
              {s.state === "available" || s.state === "completed" ? <CheckIcon className="icon timeline-icon is-check" /> : null}
              {s.state === "locked" ? <LockIcon className="icon timeline-icon" /> : null}
              <span className="timeline-number tabular">{s.number}</span>
              <span className="timeline-label">{s.label}</span>
            </>
          );
          return (
            <li key={s.stage} className={`timeline-step is-${s.state}`} data-current={s.state === "current" ? "" : undefined}>
              {s.state === "available" ? (
                <button type="button" className="timeline-item" disabled={working} onClick={() => onGoTo(s.stage)}>
                  {text}
                  <span className="sr-only">, concluída. Voltar para esta etapa</span>
                </button>
              ) : s.state === "locked" && s.number < (current?.number ?? 0) ? (
                // Etapa concluída, mas voltar está travado agora: segue um botão desabilitado com o motivo.
                <button type="button" className="timeline-item" disabled aria-describedby={backId}>
                  {text}
                  <span className="sr-only">, concluída</span>
                </button>
              ) : (
                <span
                  className="timeline-item"
                  aria-current={s.state === "current" ? "step" : undefined}
                  aria-describedby={s.state === "locked" ? nextId : undefined}
                >
                  {text}
                  {s.state === "completed" && <span className="sr-only">, concluída</span>}
                  {s.state === "locked" && <span className="sr-only">, travada</span>}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {(model.backReason || model.nextReason) && (
        <ul className="timeline-notes">
          {model.backReason && (
            <li id={backId}>{model.backReason}
            </li>
          )}
          {model.nextReason && (
            <li id={nextId}>{model.nextReason}
            </li>
          )}
        </ul>
      )}
    </nav>
  );
}
