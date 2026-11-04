import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FsStorage } from "@/storage/fs";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fs-storage-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FsStorage", () => {
  it("grava e lê bytes, criando subpastas", async () => {
    const s = new FsStorage(dir);
    await s.put("projects/abc/clips/1.mp4", Buffer.from("conteudo"), "video/mp4");
    expect((await s.get("projects/abc/clips/1.mp4")).toString()).toBe("conteudo");
  });
  it("rejeita chaves que escapam do diretório", async () => {
    const s = new FsStorage(dir);
    await expect(s.put("../fora.txt", Buffer.from("x"), "text/plain")).rejects.toThrow(/chave inválida/);
    await expect(s.get("/etc/passwd")).rejects.toThrow(/chave inválida/);
  });
  it("get de chave inexistente falha", async () => {
    await expect(new FsStorage(dir).get("nao/existe")).rejects.toThrow();
  });
});
