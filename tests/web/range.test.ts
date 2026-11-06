import { describe, expect, it } from "vitest";
import { parseRange } from "@/web/range";

describe("parseRange", () => {
  it("sem header devolve null (corpo inteiro)", () => {
    expect(parseRange(null, 100)).toBeNull();
  });
  it("intervalo fechado e aberto", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=0-0", 100)).toEqual({ start: 0, end: 0 });
  });
  it("sufixo: últimos N bytes", () => {
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 });
  });
  it("limita o fim ao tamanho", () => {
    expect(parseRange("bytes=50-500", 100)).toEqual({ start: 50, end: 99 });
  });
  it("inválido: início além do fim, formato errado, vazio", () => {
    expect(parseRange("bytes=100-120", 100)).toBe("invalid");
    expect(parseRange("bytes=9-5", 100)).toBe("invalid");
    expect(parseRange("items=0-1", 100)).toBe("invalid");
    expect(parseRange("bytes=-", 100)).toBe("invalid");
    expect(parseRange("bytes=-0", 100)).toBe("invalid");
  });
  it("múltiplos intervalos, lixo e números gigantes são inválidos (nunca NaN/negativo)", () => {
    expect(parseRange("bytes=0-1,5-6", 100)).toBe("invalid");
    expect(parseRange("bytes=a-b", 100)).toBe("invalid");
    expect(parseRange("bytes=-5-9", 100)).toBe("invalid");
    expect(parseRange("bytes=99999999999999999999999-", 100)).toBe("invalid");
    expect(parseRange("bytes=0-99999999999999999999999", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=-99999999999999999999999", 100)).toEqual({ start: 0, end: 99 });
  });
  it("arquivo vazio: qualquer Range é inválido", () => {
    expect(parseRange("bytes=0-", 0)).toBe("invalid");
    expect(parseRange("bytes=-5", 0)).toBe("invalid");
  });
});
