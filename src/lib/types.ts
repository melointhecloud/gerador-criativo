import type { Snapshot } from "@/services/projects";

// Resposta de GET /api/projects/:id. As datas chegam como string (JSON), mas a UI não as usa.
export type ProjectView = Snapshot & {
  estimatedSeconds: number; // segundos que a próxima geração vai custar (só cenas sem aprovação)
  scenesToGenerate: number;
  hasPendingGenerations: boolean; // alguma cena com tentativa na fila ou gerando (regra do servidor)
};
export type PanelProps = {
  snap: ProjectView;
  working: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
};
