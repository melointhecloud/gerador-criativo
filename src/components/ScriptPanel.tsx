"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { confirmTexts } from "@/lib/confirmTexts";
import type { PanelProps, ProjectView } from "@/lib/types";
import { useConfirm } from "./ConfirmDialog";

type Scene = ProjectView["scenes"][number];

function SceneEditor({ scene, index, run, working }: Pick<PanelProps, "run" | "working"> & { scene: Scene; index: number }) {
  const [dialogue, setDialogue] = useState(scene.dialogue);
  const [visualPrompt, setVisualPrompt] = useState(scene.visualPrompt);
  const [seconds, setSeconds] = useState(String(scene.targetSeconds));
  const dirty =
    dialogue !== scene.dialogue || visualPrompt !== scene.visualPrompt || Number(seconds) !== scene.targetSeconds;

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>Cena {index + 1}</strong>
        <span className="muted">
          {scene.references.length ? `Usa: ${scene.references.map((r) => r.label).join(", ")}` : "Sem imagens de referência"}
        </span>
      </div>
      <label>
        Fala
        <textarea aria-label={`Fala da cena ${index + 1}`} value={dialogue} onChange={(e) => setDialogue(e.target.value)} />
      </label>
      <label>
        Descrição visual
        <textarea aria-label={`Descrição visual da cena ${index + 1}`} value={visualPrompt} onChange={(e) => setVisualPrompt(e.target.value)} />
      </label>
      <label style={{ maxWidth: 140 }}>
        Duração (s)
        <input aria-label={`Duração da cena ${index + 1} (s)`} type="number" min={3} step={1} value={seconds} onChange={(e) => setSeconds(e.target.value)} />
      </label>
      {scene.notice && <div className="notice">{scene.notice}</div>}
      {dirty && (
        <button
          disabled={working}
          onClick={() =>
            void run(() =>
              api(`/api/scenes/${scene.id}`, {
                method: "PATCH",
                body: { dialogue, visualPrompt, targetSeconds: Number(seconds) },
              }),
            )
          }
        >
          Salvar cena
        </button>
      )}
    </div>
  );
}

export function ScriptPanel({ snap, run, working }: PanelProps) {
  const { project, scenes, estimatedSeconds, scenesToGenerate } = snap;
  const [feedback, setFeedback] = useState("");
  const hasScenes = scenes.length > 0;
  const confirm = useConfirm();

  return (
    <div className="stack">
      <div className="card stack">
        <strong>{hasScenes ? "Pedir ajustes ao roteiro" : "Gerar roteiro a partir da copy"}</strong>
        {hasScenes && (
          <textarea
            aria-label="Ajustes ao roteiro"
            placeholder="Ex.: tire a cena 3, deixe a abertura mais curta, mais emoção no final…"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
        )}
        <button
          className={hasScenes ? "secondary" : ""}
          disabled={working || (hasScenes && !feedback.trim())}
          onClick={async () => {
            if (hasScenes && !(await confirm(confirmTexts.rewriteScript()))) return;
            void run(async () => {
              await api(`/api/projects/${project.id}/script/plan`, { body: { feedback: feedback.trim() || undefined } });
              setFeedback("");
            });
          }}
        >
          {working ? "Trabalhando…" : hasScenes ? "Reescrever com estes ajustes" : "Gerar roteiro"}
        </button>
      </div>

      {scenes.map((s, i) => (
        <SceneEditor key={`${s.id}:${s.dialogue}:${s.visualPrompt}:${s.targetSeconds}`} scene={s} index={i} run={run} working={working} />
      ))}

      {hasScenes && (
        <div className="card row" style={{ justifyContent: "space-between" }}>
          <span>
            {scenesToGenerate === 0
              ? `${scenes.length} cenas · todas já aprovadas`
              : `${scenesToGenerate} de ${scenes.length} cenas a gerar · ${estimatedSeconds} s de vídeo`}
          </span>
          <button
            disabled={working}
            onClick={async () => {
              // Sem cenas a gerar não há custo: vai direto para a revisão.
              if (scenesToGenerate > 0 && !(await confirm(confirmTexts.generateScenes(scenesToGenerate, scenes.length, estimatedSeconds)))) return;
              void run(() => api(`/api/projects/${project.id}/generate`, { method: "POST", body: {} }));
            }}
          >
            {scenesToGenerate === 0 ? "Ir para a revisão" : "Aprovar roteiro e gerar cenas"}
          </button>
        </div>
      )}
    </div>
  );
}
