import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { assets, projects, sceneAttempts, scenes } from "@/db/schema";
import type { Deps } from "@/deps";
import { PermanentError } from "@/queue/errors";
import { probe, runFfmpeg, withTempDir } from "./ffmpeg";

const W = 720;
const H = 1280;

export type ClipInput = { file: string; hasAudio: boolean; durationSeconds: number };

// Normaliza resolução/fps/áudio de cada clipe e concatena. Clipe sem áudio ganha silêncio.
export async function concatClips(inputs: ClipInput[], out: string): Promise<void> {
  const args: string[] = [];
  for (const c of inputs) args.push("-i", c.file);
  let next = inputs.length;
  const silentIndex = inputs.map((c) => {
    if (c.hasAudio) return null;
    args.push("-f", "lavfi", "-t", c.durationSeconds.toFixed(3), "-i", "anullsrc=r=44100:cl=stereo");
    return next++;
  });

  const parts: string[] = [];
  inputs.forEach((_, i) => {
    parts.push(
      `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`,
    );
    const audioSource = silentIndex[i] ?? i;
    parts.push(`[${audioSource}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
  });
  parts.push(`${inputs.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${inputs.length}:v=1:a=1[v][a]`);

  args.push(
    "-filter_complex", parts.join(";"),
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "160k",
    "-movflags", "+faststart",
    out,
  );
  await runFfmpeg(args);
}

// Mesma ordem de locks das outras transações do pipeline: linha do projeto primeiro.
async function lockProject(tx: DbOrTx, projectId: string) {
  const [row] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
  return row;
}

export async function handleAssemble(deps: Deps, payload: { projectId: string }): Promise<void> {
  const { db, storage } = deps;
  const [project] = await db.select().from(projects).where(eq(projects.id, payload.projectId));
  if (!project) throw new PermanentError("Projeto não encontrado");
  // Job reentregue (já concluído) ou projeto que voltou para a revisão: nada a fazer, sem rodar ffmpeg.
  if (project.stage !== "assembling") return;

  const sceneRows = await db
    .select()
    .from(scenes)
    .where(eq(scenes.projectId, project.id))
    .orderBy(asc(scenes.position));
  if (sceneRows.length === 0) throw new PermanentError("Projeto sem cenas");

  const finalBytes = await withTempDir(async (dir) => {
    const inputs: ClipInput[] = [];
    for (const [i, scene] of sceneRows.entries()) {
      const n = i + 1;
      if (!scene.approvedAttemptId) throw new PermanentError(`A cena ${n} não tem clipe aprovado`);
      const [attempt] = await db
        .select()
        .from(sceneAttempts)
        .where(and(eq(sceneAttempts.id, scene.approvedAttemptId), eq(sceneAttempts.sceneId, scene.id)));
      if (!attempt?.clipAssetId) throw new PermanentError(`A cena ${n} não tem clipe pronto`);
      const [clip] = await db.select().from(assets).where(eq(assets.id, attempt.clipAssetId));
      if (!clip) throw new PermanentError(`Clipe da cena ${n} não encontrado`);
      let bytes: Buffer;
      try {
        bytes = await storage.get(clip.storageKey);
      } catch {
        throw new PermanentError(`O arquivo do clipe da cena ${n} não foi encontrado no armazenamento. Gere a cena novamente.`);
      }
      const file = path.join(dir, `${i}.mp4`);
      await writeFile(file, bytes);
      let p;
      try {
        p = await probe(file);
      } catch {
        throw new PermanentError(`O clipe da cena ${n} está corrompido. Gere a cena novamente.`);
      }
      inputs.push({ file, hasAudio: p.hasAudio, durationSeconds: p.durationSeconds });
    }
    const out = path.join(dir, "final.mp4");
    await concatClips(inputs, out);
    const measured = await probe(out);
    return { bytes: await readFile(out), durationSeconds: measured.durationSeconds };
  });

  // Chave determinística: reexecutar sobrescreve o mesmo arquivo em vez de vazar um novo.
  const key = `projects/${project.id}/final/final.mp4`;
  await storage.put(key, finalBytes.bytes, "video/mp4");
  // Asset final + etapa "done" numa transação, sob o lock do projeto: reexecuções concorrentes não duplicam.
  await db.transaction(async (tx) => {
    const locked = await lockProject(tx, project.id);
    if (!locked || locked.stage !== "assembling") return;
    await tx.delete(assets).where(and(eq(assets.projectId, project.id), eq(assets.kind, "final")));
    await tx.insert(assets).values({
      projectId: project.id,
      kind: "final",
      storageKey: key,
      mimeType: "video/mp4",
      durationSeconds: finalBytes.durationSeconds,
    });
    // "assembling" é terminal para canTransition; o CAS abaixo é a transição legítima para "done".
    await tx
      .update(projects)
      .set({ stage: "done", updatedAt: new Date() })
      .where(and(eq(projects.id, project.id), eq(projects.stage, "assembling")));
  });
}

// Montagem morta (erro permanente, tentativas esgotadas ou job reaproveitado): "assembling" não tem saída por
// setStage, então devolvemos o projeto à revisão aqui, com compare-and-set. A mensagem fica em jobs.error (pelo runner).
export async function onAssembleDead(deps: Deps, payload: { projectId: string }, message: string): Promise<void> {
  console.error(`montagem falhou para o projeto ${payload.projectId}: ${message}`);
  await deps.db.transaction(async (tx) => {
    await lockProject(tx, payload.projectId);
    await tx
      .update(projects)
      .set({ stage: "review", updatedAt: new Date() })
      .where(and(eq(projects.id, payload.projectId), eq(projects.stage, "assembling")));
  });
}
