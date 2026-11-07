import type { Stage } from "@/domain/stages";
import { STAGE_LABELS } from "./labels";

// Funções puras das telas do fluxo (testadas em tests/lib/flow.test.ts).

// Formulário com alterações não salvas: algum campo difere do valor salvo no servidor.
export function isDirty<T extends Record<string, unknown>>(saved: T, draft: T): boolean {
  return (Object.keys(saved) as (keyof T)[]).some((k) => !Object.is(saved[k], draft[k]));
}

const countFormat = new Intl.NumberFormat("pt-BR");

export function formatCharCount(text: string): string {
  const n = [...text].length;
  return `${countFormat.format(n)} ${n === 1 ? "caractere" : "caracteres"}`;
}

// Ações do cartão de personagem. "Regerar imagem" e "Aprovar" usam a aparência SALVA, por isso ficam
// desabilitadas enquanto há edição não salva; "Aprovar" só com a imagem pronta (regra do servidor).
export type CharacterLike = { approved: boolean; imageStatus: "pending" | "ready" | "failed" };
export type CharacterActions = { canApprove: boolean; canRegenerate: boolean; reason: string | null };

export function characterActions(c: CharacterLike, dirty: boolean, working: boolean): CharacterActions {
  const canRegenerate = !working && !dirty && c.imageStatus !== "pending";
  const canApprove = !working && !dirty && !c.approved && c.imageStatus === "ready";
  let reason: string | null = null;
  if (dirty) reason = "Salve as alterações para aprovar ou regerar: a imagem usa a aparência salva.";
  else if (c.imageStatus === "pending") reason = "Aguarde a imagem ficar pronta para aprovar.";
  else if (c.imageStatus === "failed") reason = "A imagem falhou. Use “Regerar imagem” para tentar de novo.";
  return { canApprove, canRegenerate, reason };
}

// Frase da região aria-live do projeto: muda só quando o progresso muda.
export type ProgressInput = {
  stage: Stage;
  characters: { approved: boolean; imageStatus: string }[];
  scenes: { approvedAttemptId: string | null; attempts: { status: string }[] }[];
};

function latestStatus(s: ProgressInput["scenes"][number]): string | undefined {
  return s.attempts[s.attempts.length - 1]?.status;
}

export function progressMessage({ stage, characters, scenes }: ProgressInput): string {
  const prefix = `Etapa atual: ${STAGE_LABELS[stage]}.`;
  switch (stage) {
    case "characters": {
      if (characters.length === 0) return `${prefix} Nenhum personagem ainda.`;
      const pending = characters.filter((c) => c.imageStatus === "pending").length;
      const approved = characters.filter((c) => c.approved).length;
      const images = pending ? ` Gerando ${pending === 1 ? "1 imagem" : `${pending} imagens`}.` : "";
      return `${prefix} ${approved} de ${characters.length} personagens aprovados.${images}`;
    }
    case "script":
      return scenes.length ? `${prefix} Roteiro com ${scenes.length} cenas.` : `${prefix} Roteiro ainda não gerado.`;
    case "generating": {
      const done = scenes.filter((s) => latestStatus(s) === "done").length;
      return `${prefix} ${done} de ${scenes.length} cenas prontas.`;
    }
    case "review": {
      const approved = scenes.filter((s) => s.approvedAttemptId).length;
      const pending = scenes.filter((s) => ["queued", "generating"].includes(latestStatus(s) ?? "")).length;
      const gen = pending ? ` Gerando ${pending === 1 ? "1 cena" : `${pending} cenas`}.` : "";
      return `${prefix} ${approved} de ${scenes.length} cenas aprovadas.${gen}`;
    }
    case "assembling":
      return `${prefix} Montando o vídeo final.`;
    case "done":
      return `${prefix} Vídeo final pronto.`;
    default:
      return prefix;
  }
}

// Clique em link que sairia da tela (usado pelo aviso de alterações não salvas). Devolve o destino
// (caminho relativo) quando o clique deve ser interceptado, ou null para deixar o navegador seguir.
export type LinkClick = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
};
export type LinkTarget = { href: string; target: string; download: boolean };

export function guardedDestination(click: LinkClick, link: LinkTarget, current: string): string | null {
  if (click.defaultPrevented || click.button !== 0) return null;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null; // nova aba/janela
  if (link.download || (link.target && link.target !== "_self")) return null;
  const from = new URL(current);
  const to = new URL(link.href, from);
  if (to.origin !== from.origin) return null;
  if (to.pathname === from.pathname && to.search === from.search) return null; // âncora na mesma página
  return `${to.pathname}${to.search}${to.hash}`;
}
