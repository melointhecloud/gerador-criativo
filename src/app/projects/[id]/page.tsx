import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ProjectView } from "@/components/ProjectView";
import { isAuthedCookie } from "@/web/http";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthedCookie((await headers()).get("cookie")))) redirect("/login");
  const { id } = await params;
  return (
    <main>
      <ProjectView id={id} />
    </main>
  );
}
