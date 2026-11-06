import { z } from "zod";
import { resolveReferences, scriptDraftSchema } from "@/domain/script";
import type { Mode } from "@/domain/stages";
import type { TextModel } from "@/providers/types";

export type DraftedScene = {
  dialogue: string;
  visualPrompt: string;
  targetSeconds: number;
  referenceLabels: string[];
  notice: string | null;
};

export type DraftInput = {
  mode: Mode;
  copy: string;
  availableLabels: string[];
  maxReferences: number;
  maxSeconds: number;
  current?: { dialogue: string; visualPrompt: string; targetSeconds: number }[];
  feedback?: string;
};

function buildSystem(i: DraftInput): string {
  const mode =
    i.mode === "ugc"
      ? "O criativo é UGC: uma pessoa real falando para a câmera, filmada com celular na vertical. " +
        "Todas as cenas são trechos do mesmo vídeo, com a mesma pessoa e o mesmo cenário, em tom natural e direto."
      : "O criativo é uma novela curta (novelinha): uma história dramática, com diálogos entre personagens. " +
        "Cada cena avança a história. Liste em referenceLabels todos os personagens que aparecem na cena.";
  return [
    "Você é diretor de criativos de vídeo para TikTok Ads, escrevendo em português do Brasil.",
    mode,
    "Divida a copy recebida em cenas sequenciais que, juntas, contam a copy inteira, sem inventar ofertas, preços ou promessas que não estejam nela.",
    `Cada cena dura entre 3 e ${i.maxSeconds} segundos (${i.maxSeconds} segundos é o máximo). O campo dialogue é a fala exata, em português do Brasil, que será dita na cena (vazio se não houver fala). Cabem cerca de 2,5 palavras por segundo.`,
    "O campo visualPrompt descreve ação, enquadramento, cenário e luz. Não descreva a aparência física de pessoas ou do produto: imagens de referência definem isso.",
    `O campo referenceLabels só pode conter rótulos da lista de referências disponíveis, e no máximo ${i.maxReferences} referências por cena.`,
    "O primeiro segundo da primeira cena deve prender a atenção (gancho). A última cena fecha com a chamada para ação da copy.",
  ].join("\n");
}

function buildPrompt(i: DraftInput): string {
  const parts = [
    `COPY:\n${i.copy.trim()}`,
    `REFERÊNCIAS DISPONÍVEIS: ${i.availableLabels.length ? i.availableLabels.join(", ") : "nenhuma"}`,
  ];
  if (i.current?.length) {
    parts.push(
      "ROTEIRO ATUAL:\n" +
        i.current
          .map((s, n) => `${n + 1}. [${s.targetSeconds}s] ${s.visualPrompt} | fala: ${s.dialogue || "(sem fala)"}`)
          .join("\n"),
    );
  }
  if (i.feedback?.trim()) {
    parts.push(`AJUSTES PEDIDOS PELO USUÁRIO (aplique ao roteiro atual):\n${i.feedback.trim()}`);
  }
  return parts.join("\n\n");
}

export async function draftScript(text: TextModel, input: DraftInput): Promise<DraftedScene[]> {
  const schema = scriptDraftSchema(input.maxSeconds);
  const system = buildSystem(input);
  const prompt = buildPrompt(input);
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const draft = await text.generateJson({ task: "script", system, prompt, schema });
      return draft.scenes.map((s) => {
        const refs = resolveReferences(s.referenceLabels, input.availableLabels, input.maxReferences);
        return {
          dialogue: s.dialogue.trim(),
          visualPrompt: s.visualPrompt.trim(),
          targetSeconds: s.targetSeconds,
          referenceLabels: refs.used,
          notice: refs.notice,
        };
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
  throw new Error(`O modelo não devolveu um roteiro válido após 3 tentativas: ${reason}`);
}
