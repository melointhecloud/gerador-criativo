import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { jobs } from "@/db/schema";
import { PermanentError, RetryLater } from "@/queue/errors";
import { claim, enqueue } from "@/queue/queue";
import { ProviderError } from "@/providers/types";
import { recoverStaleJobs, runOnce, type Handlers } from "@/worker/runner";
import { resetDb, testDb as db } from "../helpers/db";

beforeEach(resetDb);

const jobOf = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0]!;

describe("runOnce", () => {
  it("devolve false quando não há jobs", async () => {
    expect(await runOnce(db, {})).toBe(false);
  });

  it("executa o handler com o payload e completa o job", async () => {
    const run = vi.fn(async () => {});
    const j = await enqueue(db, "assemble", { projectId: "p1" });
    expect(await runOnce(db, { assemble: { run } })).toBe(true);
    expect(run).toHaveBeenCalledWith({ projectId: "p1" });
    expect((await jobOf(j.id)).status).toBe("done");
  });

  it("RetryLater devolve à fila sem consumir tentativa", async () => {
    const j = await enqueue(db, "generate_scene", {});
    await runOnce(db, {
      generate_scene: {
        run: async () => {
          throw new RetryLater(30_000);
        },
      },
    });
    const after = await jobOf(j.id);
    expect(after.status).toBe("queued");
    expect(after.attempts).toBe(0);
  });

  it("erro comum é retryable: volta à fila com a mensagem", async () => {
    const j = await enqueue(db, "assemble", {});
    await runOnce(db, {
      assemble: {
        run: async () => {
          throw new Error("rede caiu");
        },
      },
    });
    const after = await jobOf(j.id);
    expect(after.status).toBe("queued");
    expect(after.error).toBe("rede caiu");
  });

  it("PermanentError e ProviderError não-retryable vão direto para failed e chamam onDead", async () => {
    const onDead = vi.fn(async () => {});
    const handlers: Handlers = {
      assemble: {
        run: async () => {
          throw new PermanentError("sem cenas");
        },
        onDead,
      },
      generate_scene: {
        run: async () => {
          throw new ProviderError("recusado", false);
        },
        onDead,
      },
    };
    const a = await enqueue(db, "assemble", { n: 1 });
    await runOnce(db, handlers);
    expect((await jobOf(a.id)).status).toBe("failed");
    expect(onDead).toHaveBeenCalledWith({ n: 1 }, "sem cenas");

    const b = await enqueue(db, "generate_scene", { n: 2 });
    await runOnce(db, handlers);
    expect((await jobOf(b.id)).status).toBe("failed");
    expect(onDead).toHaveBeenCalledWith({ n: 2 }, "recusado");
  });

  it("esgotar tentativas chama onDead", async () => {
    const onDead = vi.fn(async () => {});
    const j = await enqueue(db, "assemble", {}, { maxAttempts: 1 });
    await runOnce(db, {
      assemble: {
        run: async () => {
          throw new Error("instável");
        },
        onDead,
      },
    });
    expect((await jobOf(j.id)).status).toBe("failed");
    expect(onDead).toHaveBeenCalledOnce();
  });

  it("tipo desconhecido falha sem derrubar o worker", async () => {
    const j = await enqueue(db, "assemble", {});
    await runOnce(db, {});
    expect((await jobOf(j.id)).status).toBe("failed");
  });

  it("recoverStaleJobs devolve à fila os travados e chama onDead nos que esgotaram as tentativas", async () => {
    const onDead = vi.fn(async () => {});
    const stuck = await enqueue(db, "assemble", { projectId: "p1" }, { maxAttempts: 1 });
    await enqueue(db, "generate_scene", {});
    await claim(db);
    await claim(db);
    await db.update(jobs).set({ lockedAt: new Date(Date.now() - 20 * 60_000) });
    const r = await recoverStaleJobs(db, { assemble: { run: async () => {}, onDead } }, 10 * 60_000);
    expect(r).toEqual({ requeued: 1, dead: 1 });
    expect(onDead).toHaveBeenCalledWith({ projectId: "p1" }, "Job travado: tentativas esgotadas");
    expect((await jobOf(stuck.id)).status).toBe("failed");
  });

  it("onDead que lança não derruba o runner", async () => {
    const j = await enqueue(db, "assemble", {});
    await expect(
      runOnce(db, {
        assemble: {
          run: async () => {
            throw new PermanentError("sem cenas");
          },
          onDead: async () => {
            throw new Error("boom");
          },
        },
      }),
    ).resolves.toBe(true);
    const after = await jobOf(j.id);
    expect(after.status).toBe("failed");
    expect(after.error).toBe("sem cenas");
  });
});
