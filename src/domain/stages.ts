export const MODES = ["ugc", "novelinha"] as const;
export type Mode = (typeof MODES)[number];

export const STAGES = [
  "briefing",
  "characters",
  "script",
  "generating",
  "review",
  "assembling",
  "done",
] as const;
export type Stage = (typeof STAGES)[number];

export function stagesFor(mode: Mode): Stage[] {
  return mode === "ugc" ? STAGES.filter((s) => s !== "characters") : [...STAGES];
}

export function nextStage(mode: Mode, stage: Stage): Stage | null {
  const list = stagesFor(mode);
  const i = list.indexOf(stage);
  return i >= 0 && i < list.length - 1 ? list[i + 1]! : null;
}

// Só se volta para etapas onde o usuário edita algo.
const NOT_REENTERABLE: Stage[] = ["generating", "assembling"];

export function canTransition(mode: Mode, from: Stage, to: Stage): boolean {
  const list = stagesFor(mode);
  const i = list.indexOf(from);
  const j = list.indexOf(to);
  if (i < 0 || j < 0 || i === j) return false;
  if (from === "assembling") return false;
  if (j === i + 1) return true;
  return j < i && !NOT_REENTERABLE.includes(to);
}
