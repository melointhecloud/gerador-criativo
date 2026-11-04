import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeImageModel, FakeTextModel, FakeVideoModel } from "@/providers/fake";

describe("FakeTextModel", () => {
  const schema = z.object({ n: z.number() });

  it("devolve as respostas em ordem, validadas pelo schema", async () => {
    const m = new FakeTextModel([{ n: 1 }, { n: 2 }]);
    expect(await m.generateJson({ task: "script", system: "s", prompt: "p", schema })).toEqual({ n: 1 });
    expect(await m.generateJson({ task: "script", system: "s", prompt: "p", schema })).toEqual({ n: 2 });
    expect(m.calls).toHaveLength(2);
  });
  it("lança ZodError quando a resposta não bate com o schema", async () => {
    const m = new FakeTextModel([{ n: "x" }]);
    await expect(m.generateJson({ task: "script", system: "s", prompt: "p", schema })).rejects.toBeInstanceOf(z.ZodError);
  });
  it("falha de forma clara quando acabam as respostas", async () => {
    const m = new FakeTextModel([]);
    await expect(m.generateJson({ task: "script", system: "s", prompt: "p", schema })).rejects.toThrow(/sem respostas/);
  });
});

describe("FakeImageModel", () => {
  it("devolve um PNG válido", async () => {
    const img = await new FakeImageModel().generateImage({ prompt: "x" });
    expect(img.mimeType).toBe("image/png");
    expect(img.bytes.subarray(1, 4).toString()).toBe("PNG");
  });
});

describe("FakeVideoModel", () => {
  const clip = Buffer.from("mp4");
  const req = { prompt: "p", references: [], targetSeconds: 5 };

  it("fica pendente N polls e depois entrega o clipe", async () => {
    const v = new FakeVideoModel({ clip, pendingPolls: 2 });
    const h = await v.start(req);
    expect((await v.poll(h)).state).toBe("pending");
    expect((await v.poll(h)).state).toBe("pending");
    expect(await v.poll(h)).toEqual({ state: "done", bytes: clip });
  });
  it("pode simular falha", async () => {
    const v = new FakeVideoModel({ clip, failure: { reason: "bloqueado", retryable: false } });
    const h = await v.start(req);
    expect(await v.poll(h)).toEqual({ state: "failed", reason: "bloqueado", retryable: false });
  });
  it("gera referências distintas por start", async () => {
    const v = new FakeVideoModel({ clip });
    const a = await v.start(req);
    const b = await v.start(req);
    expect(a.providerRef).not.toBe(b.providerRef);
  });
});
