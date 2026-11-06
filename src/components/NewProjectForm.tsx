"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"ugc" | "novelinha">("ugc");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const p = await api<{ id: string }>("/api/projects", { body: { name, mode } });
      router.push(`/projects/${p.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>Novo criativo</h2>
      <input aria-label="Nome do projeto" placeholder="Nome do projeto" value={name} onChange={(e) => setName(e.target.value)} />
      <select aria-label="Tipo de criativo" value={mode} onChange={(e) => setMode(e.target.value as "ugc" | "novelinha")}>
        <option value="ugc">UGC (pessoa falando para a câmera)</option>
        <option value="novelinha">Novelinha (história com personagens)</option>
      </select>
      {error && <div className="error" role="alert">{error}</div>}
      <button disabled={loading || !name.trim()}>Criar</button>
    </form>
  );
}
