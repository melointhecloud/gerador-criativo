import { describe, expect, it } from "vitest";
import { isTextDirty, normalizeText } from "@/lib/dirty";

describe("isTextDirty", () => {
  it("espaço só nas pontas não é alteração", () => {
    expect(isTextDirty("Marina ", "Marina")).toBe(false);
    expect(isTextDirty("\n  Marina\t", "Marina")).toBe(false);
    expect(isTextDirty("Marina", " Marina ")).toBe(false);
  });
  it("mudança real é alteração", () => {
    expect(isTextDirty("Marina", "Marta")).toBe(true);
    expect(isTextDirty("", "Marina")).toBe(true);
  });
  it("espaço no meio do texto é alteração", () => {
    expect(isTextDirty("Ana  Maria", "Ana Maria")).toBe(true);
  });
  it("trata null e undefined como vazio", () => {
    expect(isTextDirty(undefined, "")).toBe(false);
    expect(isTextDirty(null, "  ")).toBe(false);
    expect(isTextDirty(null, "a")).toBe(true);
    expect(normalizeText(undefined)).toBe("");
  });
});
