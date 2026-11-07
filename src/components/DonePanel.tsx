"use client";
import { useId } from "react";
import { api } from "@/lib/api";
import { finalVideoFacts } from "@/lib/scenes";
import type { PanelProps } from "@/lib/types";
import { ArrowLeftIcon, DownloadIcon, FrameIcon } from "./icons";

// Etapa "Montando": a máquina trabalha (luz do dia). A barra indeterminada vira faixa estática com movimento
// reduzido; o texto fica numa região de status (a etapa muda sozinha para "Pronto" pelo polling).
export function AssemblingPanel({ snap }: Pick<PanelProps, "snap">) {
  const n = snap.scenes.length;
  return (
    <div className="final-layout">
      {/* O palco reservado (sem salto quando o vídeo chegar) com a barra da máquina; o texto fica ao lado. */}
      <div className="final-stage" aria-hidden="true">
        <div className="media-state is-work">
          <FrameIcon />
          <div className="progress-bar" />
        </div>
      </div>
      <div className="final-info">
        <p className="final-lead">
          Juntando {n === 1 ? "1 cena aprovada" : `${n} cenas aprovadas`} em um MP4. Isso leva alguns segundos.
        </p>
        <p className="hint">Você pode sair desta página: a montagem continua.</p>
      </div>
    </div>
  );
}

export function DonePanel({ snap, run, working }: PanelProps) {
  const { project, finalAsset } = snap;
  const uid = useId();
  const back = (
    <button
      type="button"
      className="secondary"
      disabled={working}
      onClick={() => void run(() => api(`/api/projects/${project.id}/stage`, { body: { stage: "review" } }))}
    >
      <ArrowLeftIcon />
      Voltar para a revisão
    </button>
  );

  if (!finalAsset) {
    return (
      <section className="panel framed empty-state stack" aria-labelledby={`${uid}-vazio`}>
        <h3 id={`${uid}-vazio`}>Vídeo final não encontrado</h3>
        <p className="hint">Volte para a revisão e monte o vídeo de novo.</p>
        <div>{back}</div>
      </section>
    );
  }

  const facts = finalVideoFacts(finalAsset.durationSeconds, snap.scenes.length);
  return (
    <div className="final-layout">
      <div className="final-stage framed">
        <video src={`/api/assets/${finalAsset.id}`} controls playsInline preload="metadata" />
      </div>
      <div className="final-info">
        <h3 id={`${uid}-titulo`}>Vídeo final</h3>
        <dl className="facts" aria-labelledby={`${uid}-titulo`}>
          {facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd className="tabular">{f.value}</dd>
            </div>
          ))}
        </dl>
        <div className="final-actions">
          <a className="button" href={`/api/assets/${finalAsset.id}?download=1`} download>
            <DownloadIcon />
            Baixar MP4
          </a>
          {back}
        </div>
        <p className="hint">Voltar para a revisão mantém as aprovações; montar de novo gera outro MP4.</p>
      </div>
    </div>
  );
}
