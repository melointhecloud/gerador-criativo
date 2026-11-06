"use client";
import Link from "next/link";
import { useState } from "react";
import { stagesFor, type Stage } from "@/domain/stages";
import { api } from "@/lib/api";
import { STAGE_LABELS } from "@/lib/labels";
import { useProject } from "@/lib/useProject";
import { BriefingPanel } from "./BriefingPanel";
import { CharactersPanel } from "./CharactersPanel";
import { DonePanel } from "./DonePanel";
import { ScenesPanel } from "./ScenesPanel";
import { ScriptPanel } from "./ScriptPanel";

export function ProjectView({ id }: { id: string }) {
  const { snap, loadError, reload } = useProject(id);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  // Toda ação do usuário passa por aqui: um pedido por vez (evita clique duplo em ações pagas) e o erro vai para a tela.
  async function run(fn: () => Promise<unknown>) {
    setWorking(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await reload();
    } finally {
      setWorking(false);
    }
  }

  if (!snap) return <p className={loadError ? "error" : "muted"}>{loadError ?? "Carregando…"}</p>;

  const { project } = snap;
  const stages = stagesFor(project.mode);
  const currentIndex = stages.indexOf(project.stage);
  // A API só aceita voltar para etapas navegáveis, e só o worker tira o projeto de `generating`.
  // Em revisão, também não dá para voltar enquanto uma regeração está na fila ou rodando.
  const hasPending = snap.hasPendingGenerations;
  const canGoBack = project.stage !== "generating" && project.stage !== "assembling" && !(project.stage === "review" && hasPending);
  const goTo = (stage: Stage) => run(() => api(`/api/projects/${id}/stage`, { body: { stage } }));

  return (
    <>
      <p className="muted">
        <Link href="/">← Projetos</Link>
      </p>
      <h1>
        {project.name} <span className="badge">{project.mode === "ugc" ? "UGC" : "Novelinha"}</span>
      </h1>

      <div className="steps">
        {stages.map((s, i) => {
          const past = i < currentIndex;
          const clickable = past && canGoBack && s !== "generating" && s !== "assembling";
          return (
            <button
              key={s}
              className={`step ${i === currentIndex ? "current" : past ? "past" : ""}`}
              style={{ cursor: clickable ? "pointer" : "default" }}
              disabled={!clickable || working}
              title={past && !canGoBack && hasPending ? "Aguarde as gerações em andamento" : undefined}
              aria-current={i === currentIndex ? "step" : undefined}
              onClick={() => void goTo(s)}
            >
              {STAGE_LABELS[s]}
            </button>
          );
        })}
      </div>

      {(error || loadError) && <div className="error" role="alert">{error ?? loadError}</div>}

      {project.stage === "briefing" && <BriefingPanel snap={snap} run={run} working={working} />}
      {project.stage === "characters" && <CharactersPanel snap={snap} run={run} working={working} />}
      {project.stage === "script" && <ScriptPanel snap={snap} run={run} working={working} />}
      {(project.stage === "generating" || project.stage === "review") && (
        <ScenesPanel snap={snap} run={run} working={working} />
      )}
      {project.stage === "assembling" && (
        <div className="card">Montando o vídeo final… isso leva alguns segundos.</div>
      )}
      {project.stage === "done" && <DonePanel snap={snap} run={run} working={working} />}
    </>
  );
}
