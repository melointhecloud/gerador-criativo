"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Stage } from "@/domain/stages";
import { api } from "@/lib/api";
import { progressMessage } from "@/lib/flow";
import { STAGE_LABELS } from "@/lib/labels";
import { buildStepper } from "@/lib/stepper";
import { useProject } from "@/lib/useProject";
import { BriefingPanel } from "./BriefingPanel";
import { CharactersPanel } from "./CharactersPanel";
import { ConfirmProvider } from "./ConfirmDialog";
import { DonePanel } from "./DonePanel";
import { AlertIcon } from "./icons";
import { ScenesPanel } from "./ScenesPanel";
import { ScriptPanel } from "./ScriptPanel";
import { StageTimeline } from "./StageTimeline";

// Uma frase por etapa, logo abaixo do título da etapa: o que fazer aqui.
const BRIEFING_INTRO = {
  ugc: "Escreva a copy e envie as imagens do produto ou da pessoa que devem aparecer no vídeo.",
  novelinha: "Escreva a copy ou a história. Os personagens vêm na próxima etapa.",
};
const STAGE_INTRO: Record<Exclude<Stage, "briefing">, string> = {
  characters: "Revise a aparência de cada personagem e aprove as imagens. Cada cena usa as imagens dos personagens que aparecem nela.",
  script: "Revise cada cena: fala, descrição visual e duração. Depois aprove o roteiro para gerar as cenas.",
  generating: "As cenas estão sendo geradas. Você pode sair desta página: a geração continua.",
  review: "Assista a cada cena e aprove uma versão. Com todas aprovadas, monte o vídeo final.",
  assembling: "Juntando as cenas aprovadas em um MP4.",
  done: "O vídeo está pronto para baixar.",
};

// O ConfirmProvider fica acima de tudo para os painéis (e a própria barra de etapas) usarem useConfirm().
export function ProjectView({ id }: { id: string }) {
  return (
    <ConfirmProvider>
      <ProjectScreen id={id} />
    </ConfirmProvider>
  );
}

function ProjectScreen({ id }: { id: string }) {
  const { snap, loadError, reload } = useProject(id);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStage = useRef<Stage | null>(null);
  const stage = snap?.project.stage;

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

  // Mudou de etapa (não no primeiro carregamento): foco no título da etapa, para leitores de tela,
  // sem salto de rolagem; se o título ficou fora da tela, rola até ele (suave só sem movimento reduzido).
  useEffect(() => {
    if (!stage) return;
    const previous = shownStage.current;
    shownStage.current = stage;
    if (previous === null || previous === stage) return;
    const h = headingRef.current;
    if (!h) return;
    h.focus({ preventScroll: true });
    if (h.getBoundingClientRect().top < 0) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      h.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    }
  }, [stage]);

  if (!snap) {
    return loadError ? (
      <div className="alert" role="alert">
        <AlertIcon />
        {loadError}
      </div>
    ) : (
      <div className="stack stack-sm" role="status">
        <p className="muted">Carregando o projeto…</p>
        <div className="progress-bar" aria-hidden="true" />
      </div>
    );
  }

  const { project } = snap;
  // As regras de navegação (voltar só para etapas editáveis e nunca com geração na fila ou rodando) estão em
  // src/lib/stepper.ts, com testes; avançar só pelas ações de cada painel.
  const stepper = buildStepper(project.mode, project.stage, snap.hasPendingGenerations);
  const goTo = (to: Stage) => run(() => api(`/api/projects/${id}/stage`, { body: { stage: to } }));
  const modeLabel = project.mode === "ugc" ? "UGC" : "Novelinha";
  const intro = project.stage === "briefing" ? BRIEFING_INTRO[project.mode] : STAGE_INTRO[project.stage];
  const shownError = error ?? loadError;

  return (
    <>
      <nav className="breadcrumb" aria-label="Trilha">
        <ol>
          <li>
            <Link href="/">Projetos</Link>
          </li>
          <li>
            <span aria-current="page">{project.name}</span>
          </li>
        </ol>
      </nav>
      <div className="project-head">
        <h1>{project.name}</h1>
        <span className="badge">{modeLabel}</span>
      </div>

      <StageTimeline model={stepper} working={working} onGoTo={(s) => void goTo(s)} />

      <section className="stage-section" aria-labelledby="etapa-titulo">
        <div className="stage-head">
          <h2 id="etapa-titulo" ref={headingRef} tabIndex={-1}>
            {STAGE_LABELS[project.stage]}
          </h2>
          <p className="hint">{intro}</p>
        </div>

        {shownError && (
          <div className="alert" role="alert">
            <AlertIcon />
            {shownError}
          </div>
        )}

        {project.stage === "briefing" && <BriefingPanel snap={snap} run={run} working={working} />}
        {project.stage === "characters" && <CharactersPanel snap={snap} run={run} working={working} />}
        {project.stage === "script" && <ScriptPanel snap={snap} run={run} working={working} />}
        {(project.stage === "generating" || project.stage === "review") && (
          <ScenesPanel snap={snap} run={run} working={working} />
        )}
        {project.stage === "assembling" && (
          <div className="panel work-panel stack stack-sm">
            <p>Montando o vídeo final… isso leva alguns segundos.</p>
            <div className="progress-bar" aria-hidden="true" />
          </div>
        )}
        {project.stage === "done" && <DonePanel snap={snap} run={run} working={working} />}
      </section>

      <p className="sr-only" role="status" aria-live="polite">
        {progressMessage({ stage: project.stage, characters: snap.characters, scenes: snap.scenes })}
      </p>
    </>
  );
}
