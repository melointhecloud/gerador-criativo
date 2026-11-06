import type { Env } from "@/config/env";
import { createDevProviders } from "./dev";
import type { Providers } from "./types";

// Parcial (Plano 2, Task 11): só o provider de desenvolvimento existe. O ramo `gemini` entra depois do spike
// do provider de vídeo (Plano 1, Task 3).
export async function createProviders(env: Env): Promise<Providers> {
  if (env.PROVIDER === "fake") return createDevProviders();
  throw new Error(
    "Provider Gemini ainda não implementado: depende do spike do provider de vídeo (Plano 1, Task 3 / Plano 2, Task 11).",
  );
}
