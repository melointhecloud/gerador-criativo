"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { AlertIcon } from "./icons";

const MODES = [
  {
    value: "ugc",
    title: "UGC",
    text: "Uma pessoa fala para a câmera sobre o produto. Você envia as fotos de referência (produto, pessoa).",
  },
  {
    value: "novelinha",
    title: "Novelinha",
    text: "Uma história curta com personagens. A ferramenta sugere os personagens e você aprova cada um.",
  },
] as const;

// O título do formulário fica na página (muda entre a lista vazia e a lista com projetos): `labelledBy` aponta para ele.
export function NewProjectForm({ labelledBy }: { labelledBy: string }) {
  const router = useRouter();
  const uid = useId();
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
    <form className="stack stack-lg" onSubmit={submit} aria-labelledby={labelledBy}>
      <div className="field">
        <label htmlFor={`${uid}-nome`}>Nome do projeto</label>
        <input
          id={`${uid}-nome`}
          aria-label="Nome do projeto"
          placeholder="Ex.: Lançamento sérum vitamina C"
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <fieldset>
        <legend>Tipo de criativo</legend>
        <div className="choice-group">
          {MODES.map((m) => (
            <label key={m.value} className="choice">
              <input
                type="radio"
                name={`${uid}-modo`}
                value={m.value}
                checked={mode === m.value}
                onChange={() => setMode(m.value)}
                aria-describedby={`${uid}-${m.value}`}
              />
              <span className="choice-title">{m.title}</span>
              <span id={`${uid}-${m.value}`} className="choice-text">
                {m.text}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <p className="field-error" role="alert">
          <AlertIcon />
          {error}
        </p>
      )}
      <button className="button-block" disabled={loading || !name.trim()}>
        {loading ? "Criando…" : "Criar e abrir o briefing"}
      </button>
    </form>
  );
}
