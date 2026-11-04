import { z } from "zod";

export function scriptDraftSchema(maxSeconds: number) {
  return z.object({
    scenes: z
      .array(
        z.object({
          dialogue: z.string(),
          visualPrompt: z.string().min(1),
          targetSeconds: z.number().int().min(3).max(maxSeconds),
          referenceLabels: z.array(z.string()),
        }),
      )
      .min(1)
      .max(40),
  });
}

export type ScriptDraft = z.infer<ReturnType<typeof scriptDraftSchema>>;

export function resolveReferences(
  labels: string[],
  available: string[],
  max: number,
): { used: string[]; notice: string | null } {
  const byKey = new Map(available.map((a) => [a.trim().toLowerCase(), a]));
  const seen = new Set<string>();
  const known: string[] = [];
  const unknown: string[] = [];

  for (const raw of labels) {
    const key = raw.trim().toLowerCase();
    const match = byKey.get(key);
    if (!match) {
      unknown.push(raw);
    } else if (!seen.has(key)) {
      seen.add(key);
      known.push(match);
    }
  }

  const used = known.slice(0, max);
  const cut = known.slice(max);
  const parts: string[] = [];
  if (unknown.length) parts.push(`Referências desconhecidas ignoradas: ${unknown.join(", ")}.`);
  if (cut.length) parts.push(`Limite de ${max} referências por cena; cortadas: ${cut.join(", ")}.`);
  return { used, notice: parts.length ? parts.join(" ") : null };
}
