"use client";
import { useId, useState } from "react";
import { api } from "@/lib/api";
import { confirmTexts, generateScenesLabel } from "@/lib/confirmTexts";
import { isTextDirty } from "@/lib/dirty";
import type { PanelProps, ProjectView } from "@/lib/types";
import { useConfirm } from "./ConfirmDialog";
import { UnsavedBadge } from "./UnsavedBadge";

type Scene = ProjectView["scenes"][number];

function SceneEditor({ scene, index, run, working }: Pick<PanelProps, "run" | "working"> & { scene: Scene; index: number }) {
  const uid = useId();
  const [dialogue, setDialogue] = useState(scene.dialogue);
  const [visualPrompt, setVisualPrompt] = useState(scene.visualPrompt);
  const [seconds, setSeconds] = useState(String(scene.targetSeconds));
  // O servidor tira os espaços das pontas da fala e da descrição visual.
  const dirty = isTextDirty(dialogue, scene.dialogue) || isTextDirty(visualPrompt, scene.visualPrompt) || Number(seconds) !== scene.targetSeconds;
  const n = index + 1;

  return (
    <li className="panel scene-editor" aria-labelledby={`${uid}-titulo`}>
      <div className="scene-editor-head">
        <h3 id={`${uid}-titulo`}>Cena {n}</h3>
        <span className="muted">
          {scene.references.length ? `Usa: ${scene.references.map((r) => r.label).join(", ")}` : "Sem imagens de referência"}
        </span>
      </div>
      {scene.notice && <p className="notice">{scene.notice}</p>}
      <div className="field">
        <label htmlFor={`${uid}-fala`}>Fala</label>
        <textarea id={`${uid}-fala`} aria-label={`Fala da cena ${n}`} value={dialogue} onChange={(e) => setDialogue(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${uid}-visual`}>Descrição visual</label>
        <textarea
          id={`${uid}-visual`}
          aria-label={`Descrição visual da cena ${n}`}
          value={visualPrompt}
          onChange={(e) => setVisualPrompt(e.target.value)}
        />
      </div>
      <div className="scene-editor-foot">
        <div className="field field-seconds">
          <label htmlFor={`${uid}-duracao`}>Duração (s)</label>
          <input
            id={`${uid}-duracao`}
            aria-label={`Duração da cena ${n} (s)`}
            type="number"
            inputMode="numeric"
            min={3}
            step={1}
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
          />
        </div>
        <div className="save-row">
          <UnsavedBadge dirty={dirty} />
          {dirty && (
            <button
              type="button"
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
      </div>
    </li>
  );
}

export function ScriptPanel({ snap, run, working }: PanelProps) {
  const { project, scenes, estimatedSeconds, scenesToGenerate } = snap;
  const uid = useId();
  const [feedback, setFeedback] = useState("");
  const hasScenes = scenes.length > 0;
  const confirm = useConfirm();

  async function plan() {
    if (hasScenes && !(await confirm(confirmTexts.rewriteScript()))) return;
    void run(async () => {
      await api(`/api/projects/${project.id}/script/plan`, { body: { feedback: feedback.trim() || undefined } });
      setFeedback("");
    });
  }

  if (!hasScenes) {
    return (
      <section className="panel framed empty-state stack" aria-labelledby={`${uid}-vazio`}>
        <h3 id={`${uid}-vazio`}>Gerar roteiro a partir da copy</h3>
        <p className="hint">
          O roteiro vem dividido em cenas, cada uma com fala, descrição visual e duração. Você revisa e ajusta antes de
          gerar qualquer vídeo.
        </p>
        <div>
          <button type="button" disabled={working} onClick={() => void plan()}>
            {working ? "Gerando roteiro…" : "Gerar roteiro"}
          </button>
        </div>
        {working && <div className="progress-bar" aria-hidden="true" />}
      </section>
    );
  }

  const feedbackReasonId = `${uid}-ajuste-motivo`;
  const missingFeedback = !feedback.trim();

  return (
    <div className="stack stack-lg">
      <div className="script-layout">
        <aside className="panel script-aside stack" aria-labelledby={`${uid}-ajustes`}>
          <h3 id={`${uid}-ajustes`}>Pedir ajustes ao roteiro</h3>
          <div className="field">
            <label htmlFor={`${uid}-ajuste`} className="sr-only">
              Ajustes ao roteiro
            </label>
            <textarea
              id={`${uid}-ajuste`}
              aria-label="Ajustes ao roteiro"
              aria-describedby={`${uid}-ajuste-ajuda`}
              placeholder="Ex.: tire a cena 3, deixe a abertura mais curta, mais emoção no final…"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </div>
          <p id={`${uid}-ajuste-ajuda`} className="hint">
            Reescrever descarta as edições manuais e as cenas já geradas.
          </p>
          <div>
            <button
              type="button"
              className="secondary"
              disabled={working || missingFeedback}
              aria-describedby={missingFeedback ? feedbackReasonId : undefined}
              onClick={() => void plan()}
            >
              {working ? "Trabalhando…" : "Reescrever com estes ajustes"}
            </button>
          </div>
          {missingFeedback && (
            <p id={feedbackReasonId} className="hint">
              Escreva o que mudar para reescrever.
            </p>
          )}
        </aside>

        <ol className="scene-list" aria-label="Cenas do roteiro">
          {scenes.map((s, i) => (
            <SceneEditor key={`${s.id}:${s.dialogue}:${s.visualPrompt}:${s.targetSeconds}`} scene={s} index={i} run={run} working={working} />
          ))}
        </ol>
      </div>

      <div className="action-bar">
        <p className="action-bar-status tabular">
          {scenesToGenerate === 0 ? (
            <span>{scenes.length} cenas, todas já aprovadas</span>
          ) : (
            <>
              <span>
                {scenesToGenerate} de {scenes.length} cenas a gerar
              </span>
              <span className="muted">{estimatedSeconds} s de vídeo</span>
            </>
          )}
        </p>
        <button
          type="button"
          disabled={working}
          onClick={async () => {
            // Sem cenas a gerar não há custo: vai direto para a revisão.
            if (scenesToGenerate > 0 && !(await confirm(confirmTexts.generateScenes(scenesToGenerate, scenes.length, estimatedSeconds)))) return;
            void run(() => api(`/api/projects/${project.id}/generate`, { method: "POST", body: {} }));
          }}
        >
          {generateScenesLabel(scenesToGenerate, estimatedSeconds)}
        </button>
      </div>
    </div>
  );
}
