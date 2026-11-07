"use client";
import { useEffect, useId, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { api } from "@/lib/api";
import { confirmTexts } from "@/lib/confirmTexts";
import {
  approvedText,
  assembleState,
  countScenes,
  nextUpIndex,
  readyText,
  sceneCardModel,
  type BadgeKey,
  type SceneBadge,
  type SceneCardModel,
} from "@/lib/scenes";
import type { PanelProps, ProjectView } from "@/lib/types";
import { useConfirm } from "./ConfirmDialog";
import { AlertIcon, BlockIcon, CheckIcon, ClockIcon, EyeIcon, FrameIcon } from "./icons";

type Scene = ProjectView["scenes"][number];
type Attempt = Scene["attempts"][number];

const BADGE_ICON: Record<BadgeKey, ComponentType<{ className?: string }>> = {
  approved: CheckIcon,
  queued: ClockIcon,
  generating: FrameIcon,
  done: CheckIcon,
  failed: AlertIcon,
  blocked: BlockIcon,
};

function Badge({ b }: { b: SceneBadge }) {
  // "Pronta" na revisão é a sua vez de assistir: olho, não o visto de "Aprovada".
  const Icon = b.key === "done" && b.tone === "you" ? EyeIcon : BADGE_ICON[b.key];
  return (
    <span className={`badge badge-${b.tone}`}>
      <Icon />
      {b.label}
    </span>
  );
}

// Palco 9:16 da cena: o clipe da versão escolhida ou o estado escrito (nunca só cor).
function TakeStage({ m, framed }: { m: SceneCardModel<Attempt>; framed: boolean }) {
  const cls = `take-stage${framed ? " framed" : ""}`;
  if (m.shown?.clipAssetId) {
    return (
      <div className={cls}>
        <video src={`/api/assets/${m.shown.clipAssetId}`} controls playsInline preload="metadata" />
      </div>
    );
  }
  return (
    <div className={cls}>
      {m.pending ? (
        <div className="media-state is-work">
          {m.latest?.status === "queued" ? <ClockIcon /> : <FrameIcon />}
          <span>{m.latest?.status === "queued" ? "Aguardando o provedor de vídeo" : "O provedor está gerando este clipe"}</span>
        </div>
      ) : m.failed ? (
        <div className="media-state is-bad">
          {m.latest?.status === "blocked" ? <BlockIcon /> : <AlertIcon />}
          <span>Sem clipe</span>
        </div>
      ) : (
        <div className="media-state">
          <span>Sem vídeo</span>
        </div>
      )}
    </div>
  );
}

// Controle segmentado das versões: botões com aria-pressed; setas movem o foco entre as versões com vídeo.
function VersionPicker({ m, sceneNumber, onPick }: { m: SceneCardModel<Attempt>; sceneNumber: number; onPick: (id: string) => void }) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0 || buttons.length === 0) return;
    e.preventDefault();
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (at + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]!.focus();
  }
  return (
    <div className="versions">
      <span className="versions-label" id={`versoes-${sceneNumber}`}>
        Versões
      </span>
      <div className="segmented" role="group" aria-labelledby={`versoes-${sceneNumber}`} onKeyDown={onKeyDown}>
        {m.versions.map((v) => (
          <button
            key={v.id}
            type="button"
            className="segment"
            aria-pressed={v.selected}
            aria-label={`Ver versão ${v.number}`}
            aria-describedby={`versao-${v.id}`}
            disabled={!v.selectable}
            onClick={() => onPick(v.id)}
          >
            <span className="segment-label">
              {v.label}
              {v.approved && <CheckIcon className="icon segment-check" />}
            </span>
            <span className="segment-time" id={`versao-${v.id}`}>
              {v.selectable ? v.time : v.status === "failed" ? "Falhou" : v.status === "blocked" ? "Bloqueada" : "Gerando…"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SceneCard({
  scene,
  index,
  run,
  working,
  reviewing,
  framed,
}: Pick<PanelProps, "run" | "working"> & { scene: Scene; index: number; reviewing: boolean; framed: boolean }) {
  const uid = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(scene.attempts[scene.attempts.length - 1]?.prompt ?? scene.visualPrompt);
  const confirm = useConfirm();
  const m = sceneCardModel(scene, selectedId, working, reviewing);
  const n = index + 1;
  const promptId = `${uid}-prompt`;
  // Durante o pedido (`working`) os botões ficam desabilitados e o foco cairia no <body>. Quem agiu pelo teclado
  // (ou clicou) volta para um alvo estável do mesmo cartão quando o pedido termina; nunca no primeiro
  // carregamento, em consultas periódicas ou com o foco em outro lugar (só se o foco estava no botão ao clicar).
  const approveRef = useRef<HTMLButtonElement>(null);
  const regenerateRef = useRef<HTMLButtonElement>(null);
  const approvedBadgeRef = useRef<HTMLSpanElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const restoreFocus = useRef<"approve" | "regenerate" | null>(null);
  useEffect(() => {
    const what = restoreFocus.current;
    if (!what || working) return;
    restoreFocus.current = null;
    const target =
      what === "approve"
        ? (approvedBadgeRef.current ?? approveRef.current)
        : (regenerateRef.current && !regenerateRef.current.disabled ? regenerateRef.current : headingRef.current);
    target?.focus({ preventScroll: true });
  }, [working]);
  const regeneratePrimary = m.failed && !m.shown; // sem versão para aprovar: "Regerar" é a ação principal

  return (
    <li className={`panel take${m.approved ? " is-approved" : ""}`} aria-labelledby={`${uid}-titulo`}>
      <TakeStage m={m} framed={framed} />
      <div className="take-body">
        <div className="take-head">
          <h3 id={`${uid}-titulo`} ref={headingRef} tabIndex={-1}>
            Cena {n}
          </h3>
          <span className="take-badges">
            {m.badges.map((b) => (
              <Badge key={b.key} b={b} />
            ))}
          </span>
        </div>
        <p className={scene.dialogue ? "take-dialogue" : "take-dialogue muted"}>
          {scene.dialogue ? `“${scene.dialogue}”` : "Sem fala"}
        </p>
        <p className="take-meta tabular">
          <span>{scene.targetSeconds} s</span>
          {m.shownNumber !== null && m.versions.length > 0 && (
            <span>
              No palco: versão {m.shownNumber} ({m.shownTime})
            </span>
          )}
          {m.since && <span className="take-since">{m.since}</span>}
        </p>
        {m.pending && <div className={`progress-bar${m.latest?.status === "queued" ? " is-static" : ""}`} aria-hidden="true" />}
        {scene.notice && <p className="notice">{scene.notice}</p>}
        {m.pendingNote && <p className="notice">{m.pendingNote}</p>}
        {m.failure && (
          <div className="take-failure">
            {m.latest?.status === "blocked" ? <BlockIcon /> : <AlertIcon />}
            <p>
              {m.failure}
              {reviewing && " Use “Regerar” para tentar de novo."}
            </p>
          </div>
        )}

        {m.versions.length > 0 && <VersionPicker m={m} sceneNumber={n} onPick={setSelectedId} />}

        {reviewing && (
          <>
            <div className="take-actions">
              {m.approved ? (
                <span className="badge badge-done badge-lg" ref={approvedBadgeRef} tabIndex={-1}>
                  <CheckIcon />
                  Versão aprovada
                </span>
              ) : !m.shown ? null : (
                <button
                  type="button"
                  ref={approveRef}
                  disabled={!m.canApprove}
                  onClick={() => {
                    if (document.activeElement === approveRef.current) restoreFocus.current = "approve";
                    void run(() => api(`/api/scenes/${scene.id}/approve`, { body: { attemptId: m.shown!.id } }));
                  }}
                >
                  Aprovar esta versão
                </button>
              )}
              <button
                type="button"
                className="secondary"
                disabled={!m.canRegenerate}
                aria-expanded={editing}
                aria-controls={editing ? promptId : undefined}
                onClick={() => {
                  if (!editing) setPrompt(m.promptSeed);
                  setEditing((v) => !v);
                }}
              >
                Ajustar prompt
              </button>
              <button
                type="button"
                ref={regenerateRef}
                className={regeneratePrimary ? undefined : "secondary"}
                disabled={!m.canRegenerate}
                onClick={async () => {
                  if (!(await confirm(confirmTexts.regenerateScene(n, editing)))) return;
                  if (document.activeElement === regenerateRef.current) restoreFocus.current = "regenerate";
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
            {m.pending && <p className="hint">Aguarde a nova versão ficar pronta para regerar ou ajustar o prompt.</p>}
            {editing && (
              <div className="field take-prompt" id={promptId}>
                <label htmlFor={`${uid}-prompt-campo`}>Prompt da cena {n}</label>
                <textarea id={`${uid}-prompt-campo`} aria-label="Prompt da cena" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
                <p className="hint">A nova versão usa este texto. As versões anteriores continuam disponíveis.</p>
              </div>
            )}
          </>
        )}
      </div>
    </li>
  );
}

export function ScenesPanel({ snap, run, working }: PanelProps) {
  const { project, scenes } = snap;
  const uid = useId();
  const reviewing = project.stage === "review";
  // "Prontas" conta a tentativa ATUAL (a mais recente) de cada cena; versões antigas prontas não contam.
  const counts = countScenes(scenes);
  const assemble = assembleState(counts, working);
  const nextUp = reviewing ? nextUpIndex(scenes) : -1;
  const confirm = useConfirm();
  const reasonId = `${uid}-montar-motivo`;

  return (
    <div className={`stack stack-lg takes-panel${reviewing ? " is-review" : " is-generating"}`}>
      {!reviewing && (
        <div className="panel gen-status">
          <p className="gen-count tabular">
            {readyText(counts)}
          </p>
          <progress className="meter-bar" max={counts.total} value={counts.ready} aria-label="Cenas prontas" />
          <p className="hint">A tela muda sozinha para a revisão quando todas terminarem.</p>
        </div>
      )}

      {reviewing && snap.assembleError && (
        <div className="alert" role="alert">
          <AlertIcon />
          <span>A montagem falhou: {snap.assembleError}</span>
        </div>
      )}

      <ol className="takes" aria-label="Cenas">
        {scenes.map((s, i) => (
          <SceneCard key={s.id} scene={s} index={i} run={run} working={working} reviewing={reviewing} framed={i === nextUp} />
        ))}
      </ol>

      {reviewing && (
        <div className="action-bar review-bar">
          <div className="action-bar-status">
            <p className="tabular review-count">
              {approvedText(counts)}
            </p>
            {assemble.reason && (
              <p id={reasonId} className="hint">
                {assemble.reason}
              </p>
            )}
          </div>
          <div className="action-bar-actions">
            <button
              type="button"
              className="secondary"
              disabled={working}
              onClick={async () => {
                if (!(await confirm(confirmTexts.regenerateAll()))) return;
                void run(() => api(`/api/projects/${project.id}/regenerate-all`, { method: "POST", body: {} }));
              }}
            >
              Regerar todas
            </button>
            <button
              type="button"
              disabled={!assemble.canAssemble}
              aria-describedby={assemble.reason ? reasonId : undefined}
              onClick={() => void run(() => api(`/api/projects/${project.id}/assemble`, { method: "POST", body: {} }))}
            >
              Montar vídeo final
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
