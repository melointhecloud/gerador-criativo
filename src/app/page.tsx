import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/LogoutButton";
import { NewProjectForm } from "@/components/NewProjectForm";
import { STAGE_LABELS } from "@/lib/labels";
import { listProjects } from "@/services/projects";
import { getContext } from "@/web/context";
import { isAuthedCookie } from "@/web/http";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!(await isAuthedCookie((await headers()).get("cookie")))) redirect("/login");
  const { deps } = await getContext();
  const list = await listProjects(deps.db);

  return (
    <main>
      <LogoutButton />
      <h1>Gerador de Criativos</h1>
      <NewProjectForm />
      <h2>Projetos</h2>
      {list.length === 0 && <p className="muted">Nenhum projeto ainda.</p>}
      {list.map((p) => (
        <Link key={p.id} href={`/projects/${p.id}`} style={{ textDecoration: "none" }}>
          <div className="card row" style={{ justifyContent: "space-between" }}>
            <strong>{p.name}</strong>
            <span className="row">
              <span className="badge">{p.mode === "ugc" ? "UGC" : "Novelinha"}</span>
              <span className="badge">{STAGE_LABELS[p.stage]}</span>
            </span>
          </div>
        </Link>
      ))}
    </main>
  );
}
