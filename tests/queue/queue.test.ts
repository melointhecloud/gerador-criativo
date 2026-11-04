import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { jobs } from "@/db/schema";
import { backoffMs, claim, complete, enqueue, fail, reclaimStale, release } from "@/queue/queue";
import { resetDb, testDb as db } from "../helpers/db";

beforeEach(resetDb);

const get = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0]!;

describe("queue", () => {
  it("claim pega o job mais antigo pronto e o marca como running", async () => {
    const a = await enqueue(db, "assemble", { n: 1 });
    await enqueue(db, "assemble", { n: 2 });
    const job = await claim(db);
    expect(job!.id).toBe(a.id);
    expect(job!.status).toBe("running");
    expect(job!.attempts).toBe(1);
  });

  it("claim ignora jobs agendados para o futuro", async () => {
    await enqueue(db, "assemble", {}, { runAt: new Date(Date.now() + 60_000) });
    expect(await claim(db)).toBeNull();
  });

  it("dois claims concorrentes não pegam o mesmo job", async () => {
    await enqueue(db, "assemble", {});
    const [x, y] = await Promise.all([claim(db), claim(db)]);
    expect([x, y].filter(Boolean)).toHaveLength(1);
  });

  it("complete marca done", async () => {
    await enqueue(db, "assemble", {});
    const job = (await claim(db))!;
    await complete(db, job.id);
    expect((await get(job.id)).status).toBe("done");
  });

  it("release devolve à fila sem consumir tentativa", async () => {
    await enqueue(db, "generate_scene", {});
    const job = (await claim(db))!;
    await release(db, job, 5_000);
    const after = await get(job.id);
    expect(after.status).toBe("queued");
    expect(after.attempts).toBe(0);
    expect(after.runAt.getTime()).toBeGreaterThan(Date.now() + 3_000);
  });

  it("fail retryable reagenda com backoff até esgotar tentativas", async () => {
    await enqueue(db, "assemble", {}, { maxAttempts: 2 });
    const first = (await claim(db))!;
    expect(await fail(db, first, "erro 1", true)).toBe("retry");
    const queued = await get(first.id);
    expect(queued.status).toBe("queued");
    expect(queued.error).toBe("erro 1");
    expect(queued.runAt.getTime()).toBeGreaterThan(Date.now() + backoffMs(1) - 1_000);

    await db.update(jobs).set({ runAt: new Date() }).where(eq(jobs.id, first.id));
    const second = (await claim(db))!;
    expect(await fail(db, second, "erro 2", true)).toBe("dead");
    expect((await get(first.id)).status).toBe("failed");
  });

  it("fail não-retryable vai direto para failed", async () => {
    await enqueue(db, "assemble", {});
    const job = (await claim(db))!;
    expect(await fail(db, job, "definitivo", false)).toBe("dead");
    expect((await get(job.id)).status).toBe("failed");
  });

  it("reclaimStale devolve à fila jobs running travados", async () => {
    await enqueue(db, "assemble", {});
    const job = (await claim(db))!;
    await db.update(jobs).set({ lockedAt: new Date(Date.now() - 20 * 60_000) }).where(eq(jobs.id, job.id));
    const r = await reclaimStale(db, 10 * 60_000);
    expect(r.requeued).toBe(1);
    expect(r.dead).toEqual([]);
    expect((await get(job.id)).status).toBe("queued");
  });

  it("reclaimStale marca como failed o job travado que esgotou as tentativas", async () => {
    await enqueue(db, "assemble", {}, { maxAttempts: 1 });
    const job = (await claim(db))!;
    await db.update(jobs).set({ lockedAt: new Date(Date.now() - 20 * 60_000) }).where(eq(jobs.id, job.id));
    const r = await reclaimStale(db, 10 * 60_000);
    expect(r.requeued).toBe(0);
    expect(r.dead).toHaveLength(1);
    expect(r.dead[0]!.id).toBe(job.id);
    expect(r.dead[0]!.status).toBe("failed");
    expect(r.dead[0]!.error).toBe("Job travado: tentativas esgotadas");
    const after = await get(job.id);
    expect(after.status).toBe("failed");
    expect(after.lockedAt).toBeNull();
    expect(after.error).toBeTruthy();
  });

  it("backoff cresce e tem teto", () => {
    expect(backoffMs(1)).toBe(5_000);
    expect(backoffMs(2)).toBe(10_000);
    expect(backoffMs(20)).toBe(5 * 60_000);
  });
});
