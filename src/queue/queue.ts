import { and, eq, gte, lt, lte } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import { jobs } from "@/db/schema";

export type JobType = "generate_character" | "generate_scene" | "assemble";
export type Job = typeof jobs.$inferSelect;

export async function enqueue(
  db: DbOrTx,
  type: JobType,
  payload: Record<string, unknown>,
  opts: { runAt?: Date; maxAttempts?: number } = {},
): Promise<Job> {
  const [row] = await db
    .insert(jobs)
    .values({ type, payload, runAt: opts.runAt ?? new Date(), maxAttempts: opts.maxAttempts ?? 5 })
    .returning();
  return row!;
}

export async function claim(db: Db): Promise<Job | null> {
  return db.transaction(async (tx) => {
    const [next] = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "queued"), lte(jobs.runAt, new Date())))
      .orderBy(jobs.runAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!next) return null;
    const [row] = await tx
      .update(jobs)
      .set({ status: "running", lockedAt: new Date(), attempts: next.attempts + 1 })
      .where(eq(jobs.id, next.id))
      .returning();
    return row!;
  });
}

export async function complete(db: Db, id: string): Promise<void> {
  await db.update(jobs).set({ status: "done", lockedAt: null, error: null }).where(eq(jobs.id, id));
}

export async function release(db: Db, job: Job, delayMs: number): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: "queued",
      lockedAt: null,
      runAt: new Date(Date.now() + delayMs),
      attempts: Math.max(0, job.attempts - 1),
    })
    .where(eq(jobs.id, job.id));
}

export function backoffMs(attempts: number): number {
  return Math.min(5_000 * 2 ** (attempts - 1), 5 * 60_000);
}

export async function fail(db: Db, job: Job, message: string, retryable: boolean): Promise<"retry" | "dead"> {
  if (retryable && job.attempts < job.maxAttempts) {
    await db
      .update(jobs)
      .set({
        status: "queued",
        lockedAt: null,
        runAt: new Date(Date.now() + backoffMs(job.attempts)),
        error: message,
      })
      .where(eq(jobs.id, job.id));
    return "retry";
  }
  await db.update(jobs).set({ status: "failed", lockedAt: null, error: message }).where(eq(jobs.id, job.id));
  return "dead";
}

/**
 * Trata jobs `running` travados (worker caiu ou travou). Os que já esgotaram as
 * tentativas viram `failed` e são devolvidos em `dead` (para o chamador limpar as linhas
 * de domínio via `onDead`); os demais voltam para a fila (`requeued` conta quantos).
 */
export async function reclaimStale(db: Db, olderThanMs: number): Promise<{ requeued: number; dead: Job[] }> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const stale = and(eq(jobs.status, "running"), lt(jobs.lockedAt, cutoff));
  return db.transaction(async (tx) => {
    // Primeiro os esgotados, para os dois conjuntos serem disjuntos.
    const dead = await tx
      .update(jobs)
      .set({ status: "failed", lockedAt: null, error: "Job travado: tentativas esgotadas" })
      .where(and(stale, gte(jobs.attempts, jobs.maxAttempts)))
      .returning();
    const rows = await tx
      .update(jobs)
      .set({ status: "queued", lockedAt: null })
      .where(stale)
      .returning({ id: jobs.id });
    return { requeued: rows.length, dead };
  });
}
