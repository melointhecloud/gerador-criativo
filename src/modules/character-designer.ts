import { z } from "zod";
import type { TextModel } from "@/providers/types";

const proposalSchema = z.object({
  characters: z
    .array(z.object({ name: z.string().min(1), description: z.string().min(1) }))
    .min(1)
    .max(6),
});

export type CharacterProposal = { name: string; description: string };

export async function proposeCharacters(text: TextModel, copy: string): Promise<CharacterProposal[]> {
  const system = [
    "Você é diretor de elenco de novelinhas curtas para TikTok Ads, escrevendo em português do Brasil.",
    "Liste os personagens que aparecem na história da copy (no máximo 6, só os que importam).",
    "Para cada um: name (nome curto, único) e description (aparência física detalhada: idade aproximada, rosto, cabelo, pele, roupa, expressão marcante).",
    "A descrição será usada para gerar uma foto de referência: seja concreto e visual, sem contar a história.",
  ].join("\n");
  const prompt = `COPY:\n${copy.trim()}`;
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { characters } = await text.generateJson({ task: "characters", system, prompt, schema: proposalSchema });
      const seen = new Set<string>();
      return characters
        .map((c) => ({ name: c.name.trim(), description: c.description.trim() }))
        .filter((c) => {
          const key = c.name.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    } catch (e) {
      if (e instanceof z.ZodError || e instanceof SyntaxError) {
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`O modelo não devolveu personagens válidos após 3 tentativas: ${reason}`);
}
