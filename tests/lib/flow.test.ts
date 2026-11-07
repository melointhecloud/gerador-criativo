import { describe, expect, it } from "vitest";
import { characterActions, formatCharCount, guardedDestination, isDirty, progressMessage } from "@/lib/flow";

describe("isDirty", () => {
  it("compara campo a campo com o valor salvo", () => {
    expect(isDirty({ name: "A", copy: "x" }, { name: "A", copy: "x" })).toBe(false);
    expect(isDirty({ name: "A", copy: "x" }, { name: "A", copy: "x " })).toBe(true);
    expect(isDirty({ seconds: 6 }, { seconds: Number("6") })).toBe(false);
    expect(isDirty({ seconds: 6 }, { seconds: Number("") })).toBe(true);
  });
});

describe("formatCharCount", () => {
  it("usa separador de milhar e singular/plural", () => {
    expect(formatCharCount("")).toBe("0 caracteres");
    expect(formatCharCount("a")).toBe("1 caractere");
    expect(formatCharCount("a".repeat(1240))).toBe("1.240 caracteres");
  });
});

describe("characterActions", () => {
  const ready = { approved: false, imageStatus: "ready" as const };
  it("com a imagem pronta e sem edição, aprova e regera", () => {
    expect(characterActions(ready, false, false)).toEqual({ canApprove: true, canRegenerate: true, reason: null });
  });
  it("com edição não salva, não aprova nem regera (a imagem usa a aparência salva)", () => {
    const a = characterActions(ready, true, false);
    expect(a.canApprove).toBe(false);
    expect(a.canRegenerate).toBe(false);
    expect(a.reason).toMatch(/^Salve as alterações/);
  });
  it("imagem gerando: espera; imagem falhou: só regera", () => {
    expect(characterActions({ approved: false, imageStatus: "pending" }, false, false)).toMatchObject({
      canApprove: false,
      canRegenerate: false,
      reason: "Aguarde a imagem ficar pronta para aprovar.",
    });
    expect(characterActions({ approved: false, imageStatus: "failed" }, false, false)).toMatchObject({
      canApprove: false,
      canRegenerate: true,
    });
  });
  it("aprovado não aprova de novo; com pedido em andamento, nada", () => {
    expect(characterActions({ approved: true, imageStatus: "ready" }, false, false).canApprove).toBe(false);
    expect(characterActions(ready, false, true)).toMatchObject({ canApprove: false, canRegenerate: false });
  });
});

describe("progressMessage", () => {
  const scene = (status: string, approved = false) => ({ approvedAttemptId: approved ? "a" : null, attempts: [{ status }] });
  it("conta cenas prontas na geração e aprovadas na revisão", () => {
    expect(progressMessage({ stage: "generating", characters: [], scenes: [scene("done"), scene("generating")] })).toBe(
      "Etapa atual: Gerando cenas. 1 de 2 cenas prontas.",
    );
    expect(progressMessage({ stage: "review", characters: [], scenes: [scene("done", true), scene("queued")] })).toBe(
      "Etapa atual: Revisão. 1 de 2 cenas aprovadas. Gerando 1 cena.",
    );
  });
  it("conta personagens aprovados e imagens gerando", () => {
    expect(
      progressMessage({
        stage: "characters",
        characters: [
          { approved: true, imageStatus: "ready" },
          { approved: false, imageStatus: "pending" },
        ],
        scenes: [],
      }),
    ).toBe("Etapa atual: Personagens. 1 de 2 personagens aprovados. Gerando 1 imagem.");
  });
});

describe("guardedDestination", () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  const link = (href: string, extra: Partial<{ target: string; download: boolean }> = {}) => ({ href, target: "", download: false, ...extra });
  const here = "http://localhost:3000/projects/abc";
  it("intercepta links internos para outra página", () => {
    expect(guardedDestination(click, link("http://localhost:3000/"), here)).toBe("/");
    expect(guardedDestination(click, link("/?x=1#novo"), here)).toBe("/?x=1#novo");
  });
  it("deixa passar âncoras na mesma página, outra origem, nova aba e download", () => {
    expect(guardedDestination(click, link("#conteudo"), here)).toBeNull();
    expect(guardedDestination(click, link("https://example.com/"), here)).toBeNull();
    expect(guardedDestination({ ...click, ctrlKey: true }, link("/"), here)).toBeNull();
    expect(guardedDestination(click, link("/", { target: "_blank" }), here)).toBeNull();
    expect(guardedDestination(click, link("/api/assets/1?download=1", { download: true }), here)).toBeNull();
  });
});
