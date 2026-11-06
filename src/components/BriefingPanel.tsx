"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import type { PanelProps } from "@/lib/types";

export function BriefingPanel({ snap, run, working }: PanelProps) {
  const { project, references } = snap;
  const [name, setName] = useState(project.name);
  const [copy, setCopy] = useState(project.copy);
  const [label, setLabel] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const isUgc = project.mode === "ugc";

  const saveBriefing = () => api(`/api/projects/${project.id}`, { method: "PATCH", body: { name, copy } });

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file || !label.trim()) throw new Error("Escolha uma imagem e dê um rótulo (ex.: produto, pessoa)");
    const form = new FormData();
    form.set("label", label);
    form.set("file", file);
    await api(`/api/projects/${project.id}/references`, { form });
    setLabel("");
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="stack">
      <div className="card stack">
        <label>
          Nome
          <input aria-label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Copy / storytelling
          <textarea
            aria-label="Copy / storytelling"
            style={{ minHeight: 200 }}
            value={copy}
            onChange={(e) => setCopy(e.target.value)}
            placeholder="Cole aqui a copy ou a história do criativo"
          />
        </label>
      </div>

      {isUgc && (
        <div className="card stack">
          <strong>Imagens de referência</strong>
          <p className="muted">
            O produto e/ou a pessoa que devem aparecer. O rótulo (ex.: “produto”) é como o roteiro se refere à imagem.
          </p>
          <div className="grid">
            {references.map((r) => (
              <div key={r.id} className="stack">
                <img className="thumb" src={`/api/assets/${r.id}`} alt={r.label ?? "Imagem de referência"} />
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span>{r.label}</span>
                  <button
                    className="secondary"
                    disabled={working}
                    onClick={() => {
                      if (!window.confirm(`Remover a referência “${r.label ?? "sem rótulo"}”? As cenas que a usam vão avisar que perderam a referência.`)) return;
                      void run(() => api(`/api/assets/${r.id}`, { method: "DELETE" }));
                    }}
                  >
                    Remover
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="row">
            <input
              ref={fileRef}
              aria-label="Arquivo de imagem"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ flex: 2 }}
            />
            <input
              aria-label="Rótulo da imagem"
              placeholder="Rótulo (ex.: produto)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="secondary" disabled={working} onClick={() => void run(upload)}>
              Enviar
            </button>
          </div>
        </div>
      )}

      <button
        disabled={working || !copy.trim()}
        onClick={() =>
          void run(async () => {
            await saveBriefing();
            await api(`/api/projects/${project.id}/stage`, { body: { stage: isUgc ? "script" : "characters" } });
          })
        }
      >
        {isUgc ? "Continuar para o roteiro" : "Continuar para os personagens"}
      </button>
    </div>
  );
}
