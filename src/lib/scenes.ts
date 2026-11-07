// Estado derivado das telas de geração e revisão (testado em tests/lib/scenes.test.ts). Só descreve o que a
// tela mostra: as regras são as mesmas do ScenesPanel antes do redesenho (Fase B2, docs/design/direction.md).

export type AttemptStatus = "queued" | "generating" | "done" | "failed" | "blocked";
export type AttemptLike = {
  id: string;
  status: AttemptStatus;
  clipAssetId: string | null;
  error: string | null;
  prompt: string;
  createdAt: string | Date; // chega como string (JSON)
};
export type SceneLike = { approvedAttemptId: string | null; visualPrompt: string; attempts: AttemptLike[] };

export type StatusTone = "work" | "done" | "bad";
export const ATTEMPT_STATUS: Record<AttemptStatus, { label: string; tone: StatusTone }> = {
  queued: { label: "Na fila", tone: "work" },
  generating: { label: "Gerando…", tone: "work" },
  done: { label: "Pronta", tone: "done" },
  failed: { label: "Falhou", tone: "bad" },
  blocked: { label: "Bloqueada", tone: "bad" },
};

export function latestAttempt<A extends AttemptLike>(scene: { attempts: A[] }): A | undefined {
  return scene.attempts[scene.attempts.length - 1];
}

export function isPending(status: AttemptStatus | undefined): boolean {
  return status === "queued" || status === "generating";
}

export function isFailure(status: AttemptStatus | undefined): boolean {
  return status === "failed" || status === "blocked";
}

// Contagens da barra de ações e do contador. "Prontas" olha a tentativa MAIS RECENTE de cada cena:
// uma versão antiga pronta não conta enquanto a cena gera de novo.
export type SceneCounts = { total: number; ready: number; approved: number; pending: number; failed: number };

export function countScenes(scenes: SceneLike[]): SceneCounts {
  const latest = scenes.map((s) => latestAttempt(s)?.status);
  return {
    total: scenes.length,
    ready: latest.filter((s) => s === "done").length,
    approved: scenes.filter((s) => s.approvedAttemptId).length,
    pending: latest.filter(isPending).length,
    failed: latest.filter(isFailure).length,
  };
}

function scenesWord(n: number): string {
  return n === 1 ? "1 cena" : `${n} cenas`;
}

export function readyText(c: SceneCounts): string {
  return `${c.ready} de ${c.total} cenas prontas`;
}

export function approvedText(c: SceneCounts): string {
  return `${c.approved} de ${c.total} cenas aprovadas`;
}

// "Montar vídeo final": mesma regra de antes (só com todas aprovadas e sem pedido em andamento),
// agora com o motivo escrito quando está desabilitado.
export type AssembleState = { canAssemble: boolean; reason: string | null };

export function assembleState(c: SceneCounts, working: boolean): AssembleState {
  const canAssemble = !working && c.approved === c.total;
  if (c.approved === c.total) return { canAssemble, reason: null };
  const missing = c.total - c.approved;
  const falta = missing === 1 ? "falta 1 cena" : `faltam ${missing} cenas`;
  if (c.pending > 0) {
    const gen = c.pending === 1 ? "1 cena está gerando" : `${c.pending} cenas estão gerando`;
    return { canAssemble, reason: `Aguarde: ${gen}. Depois aprove todas as cenas para montar (${falta}).` };
  }
  return { canAssemble, reason: `Aprove todas as cenas para montar o vídeo: ${falta}.` };
}

const attemptTime = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});
const clockTime = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

// "5 de nov. 14:32" (o Intl põe vírgula entre data e hora em alguns ambientes: metadados vão sem "·" nem vírgula)
export function formatAttemptTime(value: string | Date): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return attemptTime.format(d).replace(",", "");
}

export function formatClock(value: string | Date): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : clockTime.format(d);
}

// Cartão da cena: qual versão aparece no palco, o selo, as versões e o que pode ser feito agora.
export type VersionView = {
  id: string;
  number: number;
  label: string; // "v2"
  time: string;
  status: AttemptStatus;
  selectable: boolean; // só versões prontas têm vídeo
  selected: boolean;
  approved: boolean;
};

export type SceneCardModel<A extends AttemptLike> = {
  latest: A | undefined;
  shown: A | undefined; // versão no palco
  shownNumber: number | null;
  pending: boolean; // a tentativa mais recente está na fila ou gerando
  failed: boolean; // a tentativa mais recente falhou ou foi bloqueada
  approved: boolean; // a versão no palco é a aprovada
  status: { label: string; tone: StatusTone; key: AttemptStatus } | null; // estado da tentativa mais recente
  error: string | null; // motivo da falha/bloqueio da tentativa mais recente
  versions: VersionView[]; // vazio com uma só tentativa
  canApprove: boolean;
  canRegenerate: boolean; // também vale para "Ajustar prompt"
  promptSeed: string; // texto inicial do "Ajustar prompt"
};

export function sceneCardModel<A extends AttemptLike>(
  scene: { approvedAttemptId: string | null; visualPrompt: string; attempts: A[] },
  selectedId: string | null,
  working: boolean,
): SceneCardModel<A> {
  const attempts = scene.attempts;
  const latest = latestAttempt(scene);
  const latestDone = [...attempts].reverse().find((a) => a.status === "done");
  const shown = attempts.find((a) => a.id === (selectedId ?? scene.approvedAttemptId)) ?? latestDone;
  const pending = isPending(latest?.status);
  const failed = isFailure(latest?.status);
  const approved = Boolean(shown && shown.id === scene.approvedAttemptId);
  const status = latest ? { ...ATTEMPT_STATUS[latest.status], key: latest.status } : null;
  const versions =
    attempts.length > 1
      ? attempts.map((a, i) => ({
          id: a.id,
          number: i + 1,
          label: `v${i + 1}`,
          time: formatAttemptTime(a.createdAt),
          status: a.status,
          selectable: a.status === "done",
          selected: shown?.id === a.id,
          approved: a.id === scene.approvedAttemptId,
        }))
      : [];
  const shownIndex = shown ? attempts.indexOf(shown) : -1;
  return {
    latest,
    shown,
    shownNumber: shownIndex >= 0 ? shownIndex + 1 : null,
    pending,
    failed,
    approved,
    status,
    error: latest?.error ?? null,
    versions,
    canApprove: !working && Boolean(shown) && shown!.status === "done" && !approved,
    canRegenerate: !working && !pending,
    promptSeed: latest?.prompt ?? scene.visualPrompt,
  };
}

// Vídeo final: só os metadados que a API realmente fornece (duração medida pelo ffmpeg, número de cenas
// aprovadas) e o formato fixo da montagem (src/modules/assembler.ts: 720×1280, MP4).
const secondsFormat = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export type Fact = { label: string; value: string };

export function finalVideoFacts(durationSeconds: number | null, sceneCount: number): Fact[] {
  const facts: Fact[] = [];
  if (durationSeconds) facts.push({ label: "Duração", value: `${secondsFormat.format(durationSeconds)} s` });
  facts.push({ label: "Cenas", value: String(sceneCount) });
  facts.push({ label: "Formato", value: "MP4 720×1280" });
  return facts;
}

export { scenesWord };
