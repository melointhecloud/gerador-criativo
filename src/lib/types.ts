import type { Snapshot } from "@/services/projects";

// Resposta de GET /api/projects/:id. As datas chegam como string (JSON), mas a UI não as usa.
export type ProjectView = Snapshot & { estimatedSeconds: number };
export type PanelProps = {
  snap: ProjectView;
  working: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
};
