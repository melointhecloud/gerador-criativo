import type { Deps } from "@/deps";
import { onAssembleDead, handleAssemble } from "@/modules/assembler";
import { handleGenerateCharacter, onGenerateCharacterDead } from "@/modules/character-designer";
import { handleGenerateScene, onGenerateSceneDead } from "@/modules/scene-generator";
import type { Handlers } from "./runner";

export function buildHandlers(deps: Deps): Handlers {
  return {
    generate_scene: {
      run: (p) => handleGenerateScene(deps, p as { attemptId: string }),
      onDead: (p, m) => onGenerateSceneDead(deps, p as { attemptId: string }, m),
    },
    generate_character: {
      run: (p) => handleGenerateCharacter(deps, p as { characterId: string }),
      onDead: (p, m) => onGenerateCharacterDead(deps, p as { characterId: string }, m),
    },
    assemble: {
      run: (p) => handleAssemble(deps, p as { projectId: string }),
      onDead: (p, m) => onAssembleDead(deps, p as { projectId: string }, m),
    },
  };
}
