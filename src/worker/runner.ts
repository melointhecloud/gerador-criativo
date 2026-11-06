import type { Db } from "@/db/client";
import { PermanentError, RetryLater } from "@/queue/errors";
import { claim, complete, fail, reclaimStale, release, type Job } from "@/queue/queue";
import { ProviderError } from "@/providers/types";

export type Handler = {
  run(payload: Record<string, unknown>): Promise<void>;
  onDead?(payload: Record<string, unknown>, message: string): Promise<void>;
};
export type Handlers = Record<string, Handler>;

// Um onDead que falha nunca pode derrubar o loop: loga e segue.
async function runOnDead(handlers: Handlers, job: Job, message: string): Promise<void> {
  try {
    await handlers[job.type]?.onDead?.(job.payload, message);
  } catch (err) {
    console.error(`onDead falhou para o job ${job.id}:`, err);
  }
}

// Executa no máximo um job. Devolve true se havia job (para o loop não dormir à toa).
export async function runOnce(db: Db, handlers: Handlers): Promise<boolean> {
  const job = await claim(db);
  if (!job) return false;

  const handler = handlers[job.type];
  if (!handler) {
    await fail(db, job, `tipo de job desconhecido: ${job.type}`, false);
    return true;
  }

  try {
    await handler.run(job.payload);
  } catch (e) {
    if (e instanceof RetryLater) {
      await release(db, job, e.delayMs);
      return true;
    }
    const message = e instanceof Error ? e.message : String(e);
    const retryable = !(e instanceof PermanentError) && !(e instanceof ProviderError && !e.retryable);
    const outcome = await fail(db, job, message, retryable); // grava a mensagem em jobs.error; getSnapshot a lê (assembleError)
    if (outcome === "dead") await runOnDead(handlers, job, message);
    return true;
  }
  // Fora do try: se o complete falhar (queda do banco), o job NÃO é tratado como falha do handler
  // (não reexecuta por engano); fica `running` e o recoverStaleJobs o devolve à fila.
  await complete(db, job.id);
  return true;
}

// Jobs `running` travados (worker caiu): os que esgotaram as tentativas viram `failed` e
// recebem o mesmo `onDead` do caminho normal, para limpar as linhas de domínio.
export async function recoverStaleJobs(db: Db, handlers: Handlers, olderThanMs: number) {
  const { requeued, dead } = await reclaimStale(db, olderThanMs);
  for (const job of dead) await runOnDead(handlers, job, job.error ?? "Job travado: tentativas esgotadas");
  return { requeued, dead: dead.length };
}
