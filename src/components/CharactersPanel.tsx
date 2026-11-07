"use client";
import { useId, useState } from "react";
import { api } from "@/lib/api";
import { confirmTexts } from "@/lib/confirmTexts";
import { characterActions, isDirty } from "@/lib/flow";
import type { PanelProps, ProjectView } from "@/lib/types";
import { useConfirm } from "./ConfirmDialog";
import { AlertIcon, CheckIcon, PlusIcon } from "./icons";
import { UnsavedBadge } from "./UnsavedBadge";

type Character = ProjectView["characters"][number];

function CharacterImage({ c }: { c: Character }) {
  const pending = c.imageStatus === "pending";
  // Imagem antiga apagada enquanto gera de novo ou depois de falhar: o texto do estado fica legível por cima.
  const dimmed = pending || c.imageStatus === "failed";
  return (
    <div className={`media-frame${dimmed ? " is-dimmed" : ""}`}>
      {c.assetId && <img src={`/api/assets/${c.assetId}`} alt={c.name} />}
      {pending && (
        <div className="media-state is-work">
          <span>Gerando imagem…</span>
          <div className="progress-bar" aria-hidden="true" />
        </div>
      )}
      {!pending && c.imageStatus === "failed" && (
        <div className="media-state is-bad">
          <AlertIcon />
          <span>Falhou: {c.imageError ?? "a imagem não foi gerada."}</span>
        </div>
      )}
    </div>
  );
}

// Gerando/falhou já aparecem escritos sobre a imagem: o selo só diz a situação da aprovação.
function CharacterBadge({ c }: { c: Character }) {
  if (c.imageStatus !== "ready") return null;
  if (c.approved)
    return (
      <span className="badge badge-done">
        <CheckIcon />
        Aprovado
      </span>
    );
  return <span className="badge badge-you">Para aprovar</span>;
}

function CharacterCard({ c, run, working }: Pick<PanelProps, "run" | "working"> & { c: Character }) {
  const uid = useId();
  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description);
  // O cartão não remonta quando a imagem fica pronta (a chave é só o id): o texto em edição sobrevive.
  // Quando o nome/aparência SALVOS mudam no servidor, o formulário volta para eles (como a remontagem fazia).
  const [saved, setSaved] = useState({ name: c.name, description: c.description });
  if (saved.name !== c.name || saved.description !== c.description) {
    setSaved({ name: c.name, description: c.description });
    setName(c.name);
    setDescription(c.description);
  }
  const confirm = useConfirm();
  const dirty = isDirty({ name: c.name, description: c.description }, { name, description });
  const descriptionChanged = description !== c.description;
  const actions = characterActions(c, dirty, working);
  const reasonId = `${uid}-motivo`;

  return (
    <li className="panel cast-card">
      <CharacterImage c={c} />
      <div className="cast-card-head">
        <h3>{c.name}</h3>
        <CharacterBadge c={c} />
      </div>
      <div className="field">
        <label htmlFor={`${uid}-nome`}>Nome</label>
        <input id={`${uid}-nome`} aria-label="Nome do personagem" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${uid}-aparencia`}>Aparência</label>
        <textarea
          id={`${uid}-aparencia`}
          aria-label="Aparência do personagem"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="save-row">
        <UnsavedBadge dirty={dirty} />
        {dirty && (
          <button
            type="button"
            disabled={working}
            onClick={() => void run(() => api(`/api/characters/${c.id}`, { method: "PATCH", body: { name, description } }))}
          >
            Salvar
          </button>
        )}
        {dirty && descriptionChanged && <p className="hint">Ao salvar uma nova aparência, a imagem é gerada de novo.</p>}
      </div>

      <div className="cast-actions">
        {!c.approved && (
          <button
            type="button"
            disabled={!actions.canApprove}
            aria-describedby={actions.reason ? reasonId : undefined}
            onClick={() => void run(() => api(`/api/characters/${c.id}/approve`, { method: "POST", body: {} }))}
          >
            Aprovar
          </button>
        )}
        <button
          type="button"
          className="secondary"
          disabled={!actions.canRegenerate}
          aria-describedby={actions.reason ? reasonId : undefined}
          onClick={async () => {
            if (!(await confirm(confirmTexts.regenerateImage(c.name)))) return;
            void run(() => api(`/api/characters/${c.id}/regenerate`, { method: "POST", body: {} }));
          }}
        >
          Regerar imagem
        </button>
        <button
          type="button"
          className="danger"
          disabled={working}
          onClick={async () => {
            if (!(await confirm(confirmTexts.removeCharacter(c.name)))) return;
            void run(() => api(`/api/characters/${c.id}`, { method: "DELETE" }));
          }}
        >
          Remover
        </button>
      </div>
      {actions.reason && (
        <p id={reasonId} className="hint">
          {actions.reason}
        </p>
      )}
    </li>
  );
}

export function CharactersPanel({ snap, run, working }: PanelProps) {
  const { project, characters } = snap;
  const uid = useId();
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const confirm = useConfirm();
  const approvedCount = characters.filter((c) => c.approved).length;
  const allApproved = characters.length > 0 && characters.every((c) => c.approved);
  const hasCharacters = characters.length > 0;

  async function propose() {
    const ask = hasCharacters ? confirmTexts.reproposeCharacters() : confirmTexts.proposeCharacters();
    if (!(await confirm(ask))) return;
    void run(() => api(`/api/projects/${project.id}/characters/propose`, { method: "POST", body: {} }));
  }

  const continueReason = !hasCharacters
    ? "Sugira ou adicione personagens e aprove cada um para continuar."
    : allApproved
      ? null
      : "Aprove todos os personagens para continuar.";

  return (
    <div className="stack stack-lg">
      {hasCharacters ? (
        <div className="toolbar">
          <p className="tabular">
            {approvedCount} de {characters.length} personagens aprovados
          </p>
          <button type="button" className="secondary" disabled={working} onClick={() => void propose()}>
            {working ? "Trabalhando…" : "Sugerir de novo"}
          </button>
        </div>
      ) : (
        <section className="panel framed empty-state stack" aria-labelledby={`${uid}-vazio`}>
          <h3 id={`${uid}-vazio`}>Nenhum personagem ainda</h3>
          <p className="hint">Gere os personagens a partir da copy. Você poderá editar, regerar e aprovar cada um.</p>
          <div>
            <button type="button" disabled={working} onClick={() => void propose()}>
              {working ? "Trabalhando…" : "Sugerir personagens"}
            </button>
          </div>
          {working && <div className="progress-bar" aria-hidden="true" />}
        </section>
      )}

      <ul className="cast-grid">
        {characters.map((c) => (
          <CharacterCard key={c.id} c={c} run={run} working={working} />
        ))}
        <li className="panel cast-card cast-add">
          <h3 id={`${uid}-novo`}>Adicionar personagem</h3>
          <div className="field">
            <label htmlFor={`${uid}-novo-nome`}>Nome</label>
            <input
              id={`${uid}-novo-nome`}
              aria-label="Nome"
              placeholder="Nome"
              autoComplete="off"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-novo-aparencia`}>Aparência</label>
            <textarea
              id={`${uid}-novo-aparencia`}
              aria-label="Aparência"
              placeholder="Idade, rosto, cabelo, roupa…"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
            />
          </div>
          <p className="hint">A ferramenta gera uma imagem para o novo personagem.</p>
          <div>
            <button
              type="button"
              className="secondary"
              disabled={working || !newName.trim() || !newDescription.trim()}
              onClick={async () => {
                if (!(await confirm(confirmTexts.addCharacter(newName.trim())))) return;
                void run(async () => {
                  await api(`/api/projects/${project.id}/characters`, { body: { name: newName, description: newDescription } });
                  setNewName("");
                  setNewDescription("");
                });
              }}
            >
              <PlusIcon />
              Adicionar personagem
            </button>
          </div>
        </li>
      </ul>

      <div className="action-bar">
        <div className="action-bar-status">
          {continueReason ? (
            <p id={`${uid}-continuar`} className="hint">
              {continueReason}
            </p>
          ) : (
            <p className="hint">Todos os personagens aprovados.</p>
          )}
        </div>
        <button
          type="button"
          disabled={working || !allApproved}
          aria-describedby={continueReason ? `${uid}-continuar` : undefined}
          onClick={() => void run(() => api(`/api/projects/${project.id}/stage`, { body: { stage: "script" } }))}
        >
          Continuar para o roteiro
        </button>
      </div>
    </div>
  );
}
