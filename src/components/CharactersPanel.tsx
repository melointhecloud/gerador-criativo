"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import type { PanelProps, ProjectView } from "@/lib/types";

type Character = ProjectView["characters"][number];

function CharacterCard({ c, run, working }: Pick<PanelProps, "run" | "working"> & { c: Character }) {
  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description);
  const dirty = name !== c.name || description !== c.description;

  return (
    <div className="card stack">
      {c.assetId ? (
        <img className="thumb" src={`/api/assets/${c.assetId}`} alt={c.name} />
      ) : (
        <div className="thumb row" style={{ justifyContent: "center" }}>
          <span className="muted">{c.imageStatus === "failed" ? `Falhou: ${c.imageError ?? ""}` : "Gerando imagem…"}</span>
        </div>
      )}
      <input aria-label="Nome do personagem" value={name} onChange={(e) => setName(e.target.value)} />
      <textarea aria-label="Aparência do personagem" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="row">
        {dirty && (
          <button
            disabled={working}
            onClick={() =>
              void run(() => api(`/api/characters/${c.id}`, { method: "PATCH", body: { name, description } }))
            }
          >
            Salvar
          </button>
        )}
        <button
          className="secondary"
          disabled={working || c.imageStatus === "pending"}
          onClick={() => void run(() => api(`/api/characters/${c.id}/regenerate`, { method: "POST", body: {} }))}
        >
          Regerar imagem
        </button>
        <button
          className={c.approved ? "" : "secondary"}
          disabled={working || c.approved || c.imageStatus !== "ready" || dirty}
          onClick={() => void run(() => api(`/api/characters/${c.id}/approve`, { method: "POST", body: {} }))}
        >
          {c.approved ? "Aprovado ✓" : "Aprovar"}
        </button>
        <button
          className="secondary"
          disabled={working}
          onClick={() => {
            if (!confirm(`Remover o personagem “${c.name}”? As cenas que o usam vão avisar que perderam a referência.`)) return;
            void run(() => api(`/api/characters/${c.id}`, { method: "DELETE" }));
          }}
        >
          Remover
        </button>
      </div>
    </div>
  );
}

export function CharactersPanel({ snap, run, working }: PanelProps) {
  const { project, characters } = snap;
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const allApproved = characters.length > 0 && characters.every((c) => c.approved);

  return (
    <div className="stack">
      <div className="card row" style={{ justifyContent: "space-between" }}>
        <span>
          {characters.length === 0
            ? "Gere os personagens a partir da copy. Você poderá editar, regerar e aprovar cada um."
            : `${characters.filter((c) => c.approved).length} de ${characters.length} personagens aprovados`}
        </span>
        <button
          className={characters.length ? "secondary" : ""}
          disabled={working}
          onClick={() => {
            if (characters.length && !confirm("Isso substitui todos os personagens atuais. Continuar?")) return;
            void run(() => api(`/api/projects/${project.id}/characters/propose`, { method: "POST", body: {} }));
          }}
        >
          {working ? "Trabalhando…" : characters.length ? "Sugerir de novo" : "Sugerir personagens"}
        </button>
      </div>

      <div className="grid">
        {characters.map((c) => (
          <CharacterCard key={`${c.id}:${c.name}:${c.description}:${c.assetId}`} c={c} run={run} working={working} />
        ))}
      </div>

      <div className="card stack">
        <strong>Adicionar personagem</strong>
        <input aria-label="Nome" placeholder="Nome" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <textarea
          aria-label="Aparência"
          placeholder="Aparência: idade, rosto, cabelo, roupa…"
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
        />
        <button
          className="secondary"
          disabled={working || !newName.trim() || !newDescription.trim()}
          onClick={() =>
            void run(async () => {
              await api(`/api/projects/${project.id}/characters`, { body: { name: newName, description: newDescription } });
              setNewName("");
              setNewDescription("");
            })
          }
        >
          Adicionar
        </button>
      </div>

      <button
        disabled={working || !allApproved}
        onClick={() => void run(() => api(`/api/projects/${project.id}/stage`, { body: { stage: "script" } }))}
      >
        Continuar para o roteiro
      </button>
    </div>
  );
}
