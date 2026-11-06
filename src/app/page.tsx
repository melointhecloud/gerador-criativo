import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NewProjectForm } from "@/components/NewProjectForm";
import { stagesFor, type Stage } from "@/domain/stages";
import { STAGE_LABELS } from "@/lib/labels";
import { listProjects } from "@/services/projects";
import { getContext } from "@/web/context";
import { isAuthedCookie } from "@/web/http";

export const dynamic = "force-dynamic";

// Duas temperaturas (docs/design/direction.md): tungstênio = etapa em que a pessoa trabalha; luz do dia = a máquina está trabalhando.
const MACHINE_STAGES: Stage[] = ["generating", "assembling"];

const updatedFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function stageTone(stage: Stage): "done" | "work" | "you" {
  if (stage === "done") return "done";
  return MACHINE_STAGES.includes(stage) ? "work" : "you";
}

// Medidor 9:16: uma faixa por etapa, de baixo para cima. Decorativo; a etapa está escrita ao lado.
function StageMeter({ stages, current, tone }: { stages: Stage[]; current: number; tone: "done" | "work" | "you" }) {
  return (
    <span className={`meter meter-${tone}`} aria-hidden="true">
      {stages.map((s, i) => (
        <span key={s} className={i < current ? "is-past" : i === current ? "is-current" : undefined} />
      ))}
    </span>
  );
}

export default async function HomePage() {
  if (!(await isAuthedCookie((await headers()).get("cookie")))) redirect("/login");
  const { deps } = await getContext();
  const list = await listProjects(deps.db);

  if (list.length === 0) {
    return (
      <div className="page page-narrow">
        <div className="page-head">
          <h1>Projetos</h1>
        </div>
        <section className="panel framed stack stack-lg" aria-labelledby="novo-criativo-titulo">
          <div className="stack stack-sm">
            <h2 id="novo-criativo-titulo">Nenhum criativo ainda</h2>
            <p className="hint">
              Dê um nome, escolha o formato e siga as etapas: briefing, roteiro, geração das cenas, revisão e o MP4 final.
            </p>
          </div>
          <NewProjectForm labelledBy="novo-criativo-titulo" />
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Projetos</h1>
        <p>
          {list.length === 1 ? "1 criativo" : `${list.length} criativos`}, do mais recente ao mais antigo.
        </p>
        <div>
          <a className="button secondary jump-to-new" href="#novo-criativo">
            Novo criativo
          </a>
        </div>
      </div>

      <div className="projects-layout">
        <section aria-labelledby="lista-titulo">
          <h2 id="lista-titulo" className="sr-only">
            Lista de projetos
          </h2>
          <div className="panel project-list-panel">
            <ul className="project-list">
              {list.map((p) => {
                const stages = stagesFor(p.mode);
                const index = stages.indexOf(p.stage);
                const tone = stageTone(p.stage);
                return (
                  <li key={p.id}>
                    <Link className="project-row" href={`/projects/${p.id}`}>
                      <StageMeter stages={stages} current={index} tone={tone} />
                      <span className="project-text">
                        <span className="project-name">{p.name}</span>
                        <span className="project-meta">
                          <span>{p.mode === "ugc" ? "UGC" : "Novelinha"}</span>
                          <span className="tabular">
                            Etapa {index + 1} de {stages.length}
                          </span>
                          <span>
                            Atualizado{" "}
                            <time dateTime={p.updatedAt.toISOString()}>{updatedFormat.format(p.updatedAt)}</time>
                          </span>
                        </span>
                      </span>
                      <span className={`badge badge-${tone}`}>{STAGE_LABELS[p.stage]}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <aside className="panel projects-aside stack stack-lg" id="novo-criativo" aria-labelledby="novo-criativo-titulo">
          <h2 id="novo-criativo-titulo">Novo criativo</h2>
          <NewProjectForm labelledBy="novo-criativo-titulo" />
        </aside>
      </div>
    </div>
  );
}
