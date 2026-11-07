// Estado derivado das telas de geração, revisão e vídeo final (testado em tests/lib/scenes.test.ts).
// Só descreve o que a tela mostra: as regras de habilitar/desabilitar são as mesmas do ScenesPanel antes do
// redesenho (Fase B2, docs/design/direction.md) e as do servidor (src/services/scenes.ts).

export type AttemptStatus = "queued" | "generating" | "done" | "failed" | "blocked";
export type AttemptLike = {
  id: string;
  status: AttemptStatus;
  clipAssetId: string | null;
  error: string | null;
  prompt: string;
  createdAt: string | Date; // chega como string (JSON)
  updatedAt?: string | Date; // o worker grava ao começar a gerar
};
export type SceneLike = { approvedAttemptId: string | null; visualPrompt: string; attempts: AttemptLike[] };

// "you" = sua vez (tungstênio); "work" = a máquina está trabalhando (luz do dia); "done" = aprovado/pronto.
export type StatusTone = "you" | "work" | "done" | "bad";
export type BadgeKey = AttemptStatus | "approved";
export type SceneBadge = { key: BadgeKey; label: string; tone: StatusTone };

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

// Contagens do contador e da barra de ações. "Prontas" olha a tentativa MAIS RECENTE de cada cena:
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

export function readyText(c: SceneCounts): string {
  return `${c.ready} de ${c.total} cenas prontas`;
}

export function approvedText(c: SceneCounts): string {
  return `${c.approved} de ${c.total} cenas aprovadas`;
}

// "Montar vídeo final": mesma regra de antes (só com todas aprovadas e sem pedido em andamento; o servidor
// também recusa um projeto sem cenas), agora com o motivo escrito quando está desabilitado.
export type AssembleState = { canAssemble: boolean; reason: string | null };

export function assembleState(c: SceneCounts, working: boolean): AssembleState {
  const allApproved = c.total > 0 && c.approved === c.total;
  const canAssemble = !working && allApproved;
  if (allApproved) return { canAssemble, reason: null };
  const missing = c.total - c.approved;
  const falta = missing === 1 ? "falta 1 cena" : `faltam ${missing} cenas`;
  if (c.pending > 0) {
    const gen = c.pending === 1 ? "1 cena está gerando" : `${c.pending} cenas estão gerando`;
    return { canAssemble, reason: `Aguarde: ${gen}. Depois aprove todas as cenas para montar (${falta}).` };
  }
  return { canAssemble, reason: `Aprove todas as cenas para montar o vídeo: ${falta}.` };
}

// A próxima cena que depende de você na revisão: a primeira sem aprovação e sem geração em andamento (há uma
// versão para aprovar ou uma falha para regerar). Só ela ganha os cantos de visor (a "única ousadia").
export function nextUpIndex(scenes: SceneLike[]): number {
  return scenes.findIndex((s) => {
    const latest = latestAttempt(s);
    return !s.approvedAttemptId && latest !== undefined && !isPending(latest.status);
  });
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

function formatClock(value: string | Date | undefined): string {
  if (value === undefined) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : clockTime.format(d);
}

// Tempo que a API realmente fornece (nada de estimativa inventada): desde quando a tentativa está na fila
// (createdAt) ou gerando (updatedAt, gravado pelo worker ao enviar ao provedor).
export function pendingSince(a: AttemptLike | undefined): string | null {
  if (!a) return null;
  if (a.status === "queued") {
    const t = formatClock(a.createdAt);
    return t ? `Na fila desde ${t}` : null;
  }
  if (a.status === "generating") {
    const t = formatClock(a.updatedAt ?? a.createdAt);
    return t ? `Gerando desde ${t}` : null;
  }
  return null;
}

// Cartão da cena: qual versão aparece no palco, os selos, as versões e o que pode ser feito agora.
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
  shownTime: string;
  pending: boolean; // a tentativa mais recente está na fila ou gerando
  failed: boolean; // a tentativa mais recente falhou ou foi bloqueada
  approved: boolean; // a versão no palco é a aprovada
  badges: SceneBadge[];
  failure: string | null; // frase da falha/bloqueio da tentativa mais recente
  since: string | null; // "Gerando desde 14:35"
  versions: VersionView[]; // vazio com uma só tentativa
  canApprove: boolean;
  canRegenerate: boolean; // também vale para "Ajustar prompt"
  promptSeed: string; // texto inicial do "Ajustar prompt"
};

// Selos do cabeçalho do cartão. "Aprovada" vale para a cena; o estado da tentativa mais recente só aparece
// quando diz algo a mais (uma cena aprovada com a versão mais recente pronta mostra só "Aprovada").
// Na revisão, "Pronta" sem aprovação é a sua vez (tungstênio); na geração, é a máquina que terminou (verde).
export function sceneBadges(scene: { approvedAttemptId: string | null }, latest: AttemptLike | undefined, reviewing: boolean): SceneBadge[] {
  const badges: SceneBadge[] = [];
  if (scene.approvedAttemptId) badges.push({ key: "approved", label: "Aprovada", tone: "done" });
  if (latest && !(latest.status === "done" && scene.approvedAttemptId)) {
    const s = ATTEMPT_STATUS[latest.status];
    badges.push({ key: latest.status, label: s.label, tone: latest.status === "done" && reviewing ? "you" : s.tone });
  }
  return badges;
}

export function failureText(latest: AttemptLike | undefined, attemptCount: number): string | null {
  if (!latest || !isFailure(latest.status)) return null;
  const reason = latest.error?.trim() || "o provedor não informou o motivo.";
  const what = attemptCount > 1 ? `A versão ${attemptCount}` : "A geração";
  return latest.status === "blocked" ? `${what} foi bloqueada: ${reason}` : `${what} falhou: ${reason}`;
}

export function sceneCardModel<A extends AttemptLike>(
  scene: { approvedAttemptId: string | null; visualPrompt: string; attempts: A[] },
  selectedId: string | null,
  working: boolean,
  reviewing = true,
): SceneCardModel<A> {
  const attempts = scene.attempts;
  const latest = latestAttempt(scene);
  const latestDone = [...attempts].reverse().find((a) => a.status === "done");
  const shown = attempts.find((a) => a.id === (selectedId ?? scene.approvedAttemptId)) ?? latestDone;
  const pending = isPending(latest?.status);
  const failed = isFailure(latest?.status);
  const approved = Boolean(shown && shown.id === scene.approvedAttemptId);
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
    shownTime: shown ? formatAttemptTime(shown.createdAt) : "",
    pending,
    failed,
    approved,
    // Na revisão, a versão no palco aprovada já mostra o selo "Versão aprovada" junto das ações: o cabeçalho
    // não repete (espelho da Fase B2). Vendo outra versão, o cabeçalho lembra que a cena segue aprovada.
    badges: sceneBadges(scene, latest, reviewing).filter((b) => !(reviewing && approved && b.key === "approved")),
    failure: failureText(latest, attempts.length),
    since: pendingSince(latest),
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
