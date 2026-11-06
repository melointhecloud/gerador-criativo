export type ByteRange = { start: number; end: number };

// null = sem Range (corpo inteiro); "invalid" = 416.
// Multi-range ("bytes=0-1,5-6"), formato desconhecido, início fora do arquivo e arquivo vazio são "invalid".
// Nunca devolve NaN, valor negativo ou fim além de size-1.
export function parseRange(header: string | null, size: number): ByteRange | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return "invalid";
  const [, s, e] = m as unknown as [string, string, string];
  if (s === "" && e === "") return "invalid";
  if (size <= 0) return "invalid";

  let start: number;
  let end: number;
  if (s === "") {
    const n = Number(e);
    if (n === 0) return "invalid";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(s);
    end = e === "" ? size - 1 : Math.min(Number(e), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return "invalid";
  return { start, end };
}
