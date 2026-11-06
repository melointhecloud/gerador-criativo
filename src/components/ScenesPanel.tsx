"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import type { PanelProps, ProjectView } from "@/lib/types";

type Scene = ProjectView["scenes"][number];

const STATUS: Record<string, { text: string; cls: string }> = {
  queued: { text: "Na fila", cls: "work" },
  generating: { text: "Gerando…", cls: "work" },
  done: { text: "Pronta", cls: "done" },
  failed: { text: "Falhou", cls: "bad" },
  blocked: { text: "Bloqueada", cls: "bad" },
};

function SceneCard({ scene, index, run, working, reviewing }: Pick<PanelProps, "run" | "working"> & { scene: Scene; index: number; reviewing: boolean }) {
  const attempts = scene.attempts;
  const latest = attempts[attempts.length - 1];
  const latestDone = [...attempts].reverse().find((a) => a.status === "done");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(latest?.prompt ?? scene.visualPrompt);

  const shown = attempts.find((a) => a.id === (selectedId ?? scene.approvedAttemptId)) ?? latestDone;
  const pending = latest?.status === "queued" || latest?.status === "generating";
  const approved = shown && shown.id === scene.approvedAttemptId;
  const status = latest ? STATUS[latest.status] : undefined;
  const failed = latest?.status === "failed" || latest?.status === "blocked";

  return (
    <div className="card scene">
      <div>
        {shown?.clipAssetId ? (
          <video className="clip" src={`/api/assets/${shown.clipAssetId}`} controls playsInline preload="metadata" />
        ) : (
          <div className="clip row" style={{ justifyContent: "center", background: "#222", color: "#bbb" }}>
            {pending ? "Gerando…" : "Sem vídeo"}
          </div>
        )}
      </div>
      <div className="stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>Cena {index + 1}</strong>
          <span className="row">
            {approved && <span className="badge done">Aprovada ✓</span>}
            {status && <span className={`badge ${status.cls}`}>{status.text}</span>}
          </span>
        </div>
        <div className="muted">{scene.dialogue ? `“${scene.dialogue}”` : "(sem fala)"}</div>
        {scene.notice && <div className="notice">{scene.notice}</div>}
        {latest?.error && <div className="error">{latest.error}</div>}
        {failed && reviewing && <div className="muted">Use “Regerar” para tentar de novo.</div>}

        {attempts.length > 1 && (
          <div className="row">
            <span className="muted">Versões:</span>
            {attempts.map((a, i) => (
              <button
                key={a.id}
                className={shown?.id === a.id ? "" : "secondary"}
                style={{ padding: "2px 10px" }}
                disabled={a.status !== "done"}
                aria-label={`Ver versão ${i + 1}`}
                onClick={() => setSelectedId(a.id)}
              >
                v{i + 1}
              </button>
            ))}
          </div>
        )}

        {reviewing && (
          <>
            <div className="row">
              <button
                disabled={working || !shown || shown.status !== "done" || Boolean(approved)}
                onClick={() =>
                  void run(() => api(`/api/scenes/${scene.id}/approve`, { body: { attemptId: shown!.id } }))
                }
              >
                Aprovar esta versão
              </button>
              <button
                className="secondary"
                disabled={working || pending}
                onClick={() => {
                  if (!editing) setPrompt(latest?.prompt ?? scene.visualPrompt);
                  setEditing((v) => !v);
                }}
              >
                Ajustar prompt
              </button>
              <button
                className="secondary"
                disabled={working || pending}
                onClick={() => {
                  if (!confirm("Gerar esta cena de novo? Isso consome crédito do provedor.")) return;
                  void run(async () => {
                    await api(`/api/scenes/${scene.id}/regenerate`, { body: editing ? { prompt } : {} });
                    setSelectedId(null);
                    setEditing(false);
                  });
                }}
              >
                Regerar{editing ? " com este prompt" : ""}
              </button>
            </div>
            {editing && (
              <textarea aria-label="Prompt da cena" style={{ minHeight: 140 }} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function ScenesPanel({ snap, run, working }: PanelProps) {
  const { project, scenes } = snap;
  const reviewing = project.stage === "review";
  const approvedCount = scenes.filter((s) => s.approvedAttemptId).length;
  const doneCount = scenes.filter((s) => s.attempts.some((a) => a.status === "done")).length;

  return (
    <div className="stack">
      <div className="card row" style={{ justifyContent: "space-between" }}>
        <span>
          {reviewing
            ? `${approvedCount} de ${scenes.length} cenas aprovadas`
            : `Gerando cenas: ${doneCount} de ${scenes.length} prontas`}
        </span>
        {reviewing && (
          <span className="row">
            <button
              className="secondary"
              disabled={working}
              onClick={() => {
                if (!confirm("Regerar todas as cenas? Isso gera e cobra todos os clipes de novo.")) return;
                void run(() => api(`/api/projects/${project.id}/regenerate-all`, { method: "POST", body: {} }));
              }}
            >
              Regerar todas
            </button>
            <button
              disabled={working || approvedCount !== scenes.length}
              onClick={() => void run(() => api(`/api/projects/${project.id}/assemble`, { method: "POST", body: {} }))}
            >
              Montar vídeo final
            </button>
          </span>
        )}
      </div>
      {reviewing && snap.assembleError && <div className="error" role="alert">A montagem falhou: {snap.assembleError}</div>}
      {scenes.map((s, i) => (
        <SceneCard key={s.id} scene={s} index={i} run={run} working={working} reviewing={reviewing} />
      ))}
    </div>
  );
}
