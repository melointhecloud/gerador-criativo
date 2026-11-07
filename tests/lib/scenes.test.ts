import { describe, expect, it } from "vitest";
import {
  approvedText,
  assembleState,
  countScenes,
  finalVideoFacts,
  formatAttemptTime,
  readyText,
  sceneCardModel,
  type AttemptLike,
  type AttemptStatus,
} from "@/lib/scenes";

let seq = 0;
const attempt = (status: AttemptStatus, extra: Partial<AttemptLike> = {}): AttemptLike => ({
  id: `a${++seq}`,
  status,
  clipAssetId: status === "done" ? `clip${seq}` : null,
  error: null,
  prompt: `prompt ${seq}`,
  createdAt: "2026-11-05T17:32:00.000Z",
  ...extra,
});
const scene = (attempts: AttemptLike[], approvedAttemptId: string | null = null) => ({
  approvedAttemptId,
  visualPrompt: "descrição visual",
  attempts,
});

describe("countScenes", () => {
  it("conta como pronta só a cena cuja tentativa MAIS RECENTE está pronta", () => {
    const old = attempt("done");
    const c = countScenes([
      scene([attempt("done")]),
      scene([old, attempt("generating")], null), // v1 pronta, v2 gerando: não conta
      scene([attempt("queued")]),
      scene([attempt("failed")]),
    ]);
    expect(c).toEqual({ total: 4, ready: 1, approved: 0, pending: 2, failed: 1 });
    expect(readyText(c)).toBe("1 de 4 cenas prontas");
  });
  it("conta aprovadas pelo approvedAttemptId", () => {
    const a = attempt("done");
    const c = countScenes([scene([a], a.id), scene([attempt("done")])]);
    expect(approvedText(c)).toBe("1 de 2 cenas aprovadas");
  });
});

describe("assembleState", () => {
  const counts = (approved: number, total: number, pending = 0) => ({ total, approved, pending, ready: 0, failed: 0 });
  it("monta só com todas aprovadas e sem pedido em andamento", () => {
    expect(assembleState(counts(3, 3), false)).toEqual({ canAssemble: true, reason: null });
    expect(assembleState(counts(3, 3), true)).toEqual({ canAssemble: false, reason: null });
  });
  it("diz quantas cenas faltam", () => {
    expect(assembleState(counts(2, 3), false)).toEqual({
      canAssemble: false,
      reason: "Aprove todas as cenas para montar o vídeo: falta 1 cena.",
    });
    expect(assembleState(counts(0, 3), false).reason).toBe("Aprove todas as cenas para montar o vídeo: faltam 3 cenas.");
  });
  it("com gerações em andamento, pede para aguardar", () => {
    expect(assembleState(counts(1, 3, 1), false).reason).toBe(
      "Aguarde: 1 cena está gerando. Depois aprove todas as cenas para montar (faltam 2 cenas).",
    );
    expect(assembleState(counts(1, 3, 2), false).reason).toMatch(/^Aguarde: 2 cenas estão gerando\./);
  });
});

describe("sceneCardModel", () => {
  it("sem escolha, mostra a aprovada; sem aprovada, a mais recente pronta", () => {
    const v1 = attempt("done");
    const v2 = attempt("done");
    expect(sceneCardModel(scene([v1, v2], v1.id), null, false).shown).toBe(v1);
    expect(sceneCardModel(scene([v1, v2]), null, false).shown).toBe(v2);
    const m = sceneCardModel(scene([v1, v2]), v1.id, false);
    expect(m.shown).toBe(v1);
    expect(m.shownNumber).toBe(1);
  });
  it("versões: rótulo, data, só prontas selecionáveis; uma tentativa não mostra versões", () => {
    const v1 = attempt("done");
    const v2 = attempt("failed", { error: "Bloqueado pelo filtro" });
    const m = sceneCardModel(scene([v1, v2], v1.id), null, false);
    expect(m.versions.map((v) => [v.label, v.selectable, v.selected, v.approved])).toEqual([
      ["v1", true, true, true],
      ["v2", false, false, false],
    ]);
    expect(m.versions[0]!.time).toBe("5 de nov. 14:32");
    expect(sceneCardModel(scene([v1]), null, false).versions).toEqual([]);
  });
  it("estado e erro vêm da tentativa mais recente", () => {
    const v1 = attempt("done");
    const v2 = attempt("blocked", { error: "Conteúdo bloqueado" });
    const m = sceneCardModel(scene([v1, v2]), null, false);
    expect(m.status).toEqual({ label: "Bloqueada", tone: "bad", key: "blocked" });
    expect(m.failed).toBe(true);
    expect(m.error).toBe("Conteúdo bloqueado");
    expect(m.shown).toBe(v1); // a versão antiga pronta continua no palco
  });
  it("aprovar: só versão pronta, ainda não aprovada, sem pedido em andamento", () => {
    const v1 = attempt("done");
    expect(sceneCardModel(scene([v1]), null, false).canApprove).toBe(true);
    expect(sceneCardModel(scene([v1], v1.id), null, false).canApprove).toBe(false);
    expect(sceneCardModel(scene([v1]), null, true).canApprove).toBe(false);
    expect(sceneCardModel(scene([attempt("queued")]), null, false).canApprove).toBe(false);
  });
  it("regerar e ajustar prompt: não com geração pendente nem com pedido em andamento", () => {
    const v1 = attempt("done");
    const v2 = attempt("generating");
    const pending = sceneCardModel(scene([v1, v2]), null, false);
    expect(pending.pending).toBe(true);
    expect(pending.canRegenerate).toBe(false);
    expect(pending.canApprove).toBe(true); // a v1 pronta ainda pode ser aprovada (regra de antes)
    expect(sceneCardModel(scene([v1]), null, true).canRegenerate).toBe(false);
    expect(sceneCardModel(scene([attempt("failed")]), null, false).canRegenerate).toBe(true);
  });
  it("o prompt editável começa no prompt da tentativa mais recente (ou na descrição visual)", () => {
    const v1 = attempt("done", { prompt: "prompt ajustado" });
    expect(sceneCardModel(scene([v1]), null, false).promptSeed).toBe("prompt ajustado");
    expect(sceneCardModel(scene([]), null, false).promptSeed).toBe("descrição visual");
  });
});

describe("formatAttemptTime / finalVideoFacts", () => {
  it("formata a data no fuso de São Paulo e ignora datas inválidas", () => {
    expect(formatAttemptTime("2026-11-05T17:32:00.000Z")).toBe("5 de nov. 14:32");
    expect(formatAttemptTime("x")).toBe("");
  });
  it("metadados do vídeo final: só o que a API fornece", () => {
    expect(finalVideoFacts(18.43, 3)).toEqual([
      { label: "Duração", value: "18,4 s" },
      { label: "Cenas", value: "3" },
      { label: "Formato", value: "MP4 720×1280" },
    ]);
    expect(finalVideoFacts(null, 2).map((f) => f.label)).toEqual(["Cenas", "Formato"]);
  });
});
