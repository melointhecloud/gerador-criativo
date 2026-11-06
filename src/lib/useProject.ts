"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { ProjectView } from "./types";

const POLL_MS = 3000;

function isBusy(s: ProjectView): boolean {
  return (
    s.project.stage === "generating" ||
    s.project.stage === "assembling" ||
    s.characters.some((c) => c.imageStatus === "pending") ||
    s.hasPendingGenerations
  );
}

export function useProject(id: string) {
  const [snap, setSnap] = useState<ProjectView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const next = await api<ProjectView>(`/api/projects/${id}`);
      if (!alive.current) return;
      setSnap(next);
      setLoadError(null);
    } catch (e) {
      if (alive.current) setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  // Consulta periódica só enquanto há trabalho em andamento. Um timer por vez: a próxima consulta
  // só é agendada depois que a anterior termina (sem acúmulo de requisições se o servidor demorar).
  const busy = snap ? isBusy(snap) : false;
  useEffect(() => {
    if (!busy) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      await reload();
      if (!stopped) timer = setTimeout(() => void tick(), POLL_MS);
    };
    timer = setTimeout(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [busy, reload]);

  return { snap, loadError, reload };
}
