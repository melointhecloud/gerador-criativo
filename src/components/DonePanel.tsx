"use client";
import { api } from "@/lib/api";
import type { PanelProps } from "@/lib/types";

export function DonePanel({ snap, run, working }: PanelProps) {
  const { project, finalAsset } = snap;
  return (
    <div className="card stack">
      <strong>Vídeo final</strong>
      {finalAsset ? (
        <>
          <video className="clip" style={{ maxWidth: 320 }} src={`/api/assets/${finalAsset.id}`} controls playsInline />
          <div className="muted">
            {finalAsset.durationSeconds ? `${finalAsset.durationSeconds.toFixed(1)} s · ` : ""}720×1280 · MP4
          </div>
          <div className="row">
            <a className="button" href={`/api/assets/${finalAsset.id}?download=1`} download>
              Baixar MP4
            </a>
            <button
              className="secondary"
              disabled={working}
              onClick={() => void run(() => api(`/api/projects/${project.id}/stage`, { body: { stage: "review" } }))}
            >
              Voltar para a revisão
            </button>
          </div>
        </>
      ) : (
        <span className="muted">Vídeo final não encontrado.</span>
      )}
    </div>
  );
}
