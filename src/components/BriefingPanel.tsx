"use client";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/api";
import { confirmTexts } from "@/lib/confirmTexts";
import { formatCharCount, isDirty } from "@/lib/flow";
import type { PanelProps } from "@/lib/types";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { useConfirm } from "./ConfirmDialog";
import { AlertIcon } from "./icons";
import { UnsavedBadge } from "./UnsavedBadge";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // mesmo limite do servidor

type UploadErrors = { file?: string; label?: string; request?: string };

export function BriefingPanel({ snap, run, working }: PanelProps) {
  const { project, references } = snap;
  const uid = useId();
  const [name, setName] = useState(project.name);
  const [copy, setCopy] = useState(project.copy);
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<UploadErrors>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const isUgc = project.mode === "ugc";
  const continueLabel = isUgc ? "Continuar para o roteiro" : "Continuar para os personagens";

  // Nome e copy só são salvos em "Continuar…" (como antes): avisa antes de sair da tela sem salvar.
  const dirty = isDirty({ name: project.name, copy: project.copy }, { name, copy });
  useUnsavedGuard(dirty, () => confirm(confirmTexts.discardBriefing(continueLabel)));

  // Prévia local do arquivo escolhido (URL blob:, nada sai do navegador antes de enviar).
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const saveBriefing = () => api(`/api/projects/${project.id}`, { method: "PATCH", body: { name, copy } });

  function chooseFile(next: File | null) {
    setFile(next);
    setErrors((e) => ({ ...e, file: undefined, request: undefined }));
  }

  function validateUpload(): UploadErrors {
    const found: UploadErrors = {};
    if (!file) found.file = "Escolha uma imagem (PNG, JPG ou WebP).";
    else if (file.size > MAX_IMAGE_BYTES) found.file = "A imagem passa de 10 MB. Escolha um arquivo menor.";
    if (!label.trim()) found.label = "Dê um rótulo à imagem (ex.: produto, pessoa).";
    return found;
  }

  async function upload() {
    const form = new FormData();
    form.set("label", label);
    form.set("file", file!);
    try {
      await api(`/api/projects/${project.id}/references`, { form });
    } catch (e) {
      // O erro do envio fica junto do formulário de envio (não no topo da página).
      setErrors({ request: e instanceof Error ? e.message : String(e) });
      return;
    }
    setLabel("");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const fileErrorId = `${uid}-arquivo-erro`;
  const labelErrorId = `${uid}-rotulo-erro`;
  const continueReasonId = `${uid}-continuar-motivo`;
  const missingCopy = !copy.trim();

  return (
    <div className="stack stack-lg">
      <div className={`briefing-layout${isUgc ? " has-references" : ""}`}>
        <section className="panel stack stack-lg" aria-labelledby={`${uid}-texto`}>
          <h3 id={`${uid}-texto`}>Texto do criativo</h3>
          <div className="field">
            <label htmlFor={`${uid}-nome`}>Nome</label>
            <input id={`${uid}-nome`} aria-label="Nome" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-copy`}>Copy / storytelling</label>
            <textarea
              id={`${uid}-copy`}
              aria-label="Copy / storytelling"
              aria-describedby={`${uid}-contagem`}
              className="copy-input"
              value={copy}
              onChange={(e) => setCopy(e.target.value)}
              placeholder="Cole aqui a copy ou a história do criativo"
            />
            <p id={`${uid}-contagem`} className="hint tabular">
              {formatCharCount(copy)}
            </p>
          </div>
        </section>

        {isUgc && (
          <section className="panel stack stack-lg" aria-labelledby={`${uid}-refs`}>
            <div className="stack stack-sm">
              <h3 id={`${uid}-refs`}>Imagens de referência</h3>
              <p className="hint">
                O produto e/ou a pessoa que devem aparecer. O rótulo (ex.: “produto”) é como o roteiro se refere à imagem.
              </p>
            </div>

            {references.length > 0 ? (
              <ul className="ref-grid">
                {references.map((r) => (
                  <li key={r.id} className="ref">
                    <div className="media-frame">
                      <img src={`/api/assets/${r.id}`} alt={r.label ?? "Imagem de referência"} />
                    </div>
                    <div className="ref-caption">
                      <span className="ref-label">{r.label ?? "Sem rótulo"}</span>
                      <button
                        type="button"
                        className="danger button-sm"
                        disabled={working}
                        aria-label={`Remover a referência ${r.label ?? "sem rótulo"}`}
                        onClick={async () => {
                          if (!(await confirm(confirmTexts.removeReference(r.label)))) return;
                          void run(() => api(`/api/assets/${r.id}`, { method: "DELETE" }));
                        }}
                      >
                        Remover
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">Nenhuma imagem enviada ainda.</p>
            )}

            <div className="upload panel-raised">
              <div className="media-frame upload-preview">
                {preview ? <img src={preview} alt="Prévia da imagem escolhida" /> : <span className="media-caption">Prévia</span>}
              </div>
              <div className="stack">
                <div className="field">
                  <label htmlFor={`${uid}-arquivo`}>Arquivo de imagem</label>
                  <input
                    id={`${uid}-arquivo`}
                    ref={fileRef}
                    aria-label="Arquivo de imagem"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    aria-invalid={errors.file ? true : undefined}
                    aria-describedby={errors.file ? `${fileErrorId} ${uid}-arquivo-ajuda` : `${uid}-arquivo-ajuda`}
                    onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
                  />
                  {errors.file && (
                    <p id={fileErrorId} className="field-error" role="alert">
                      <AlertIcon />
                      {errors.file}
                    </p>
                  )}
                  <p id={`${uid}-arquivo-ajuda`} className="hint">
                    PNG, JPG ou WebP, até 10 MB.
                  </p>
                </div>
                <div className="field">
                  <label htmlFor={`${uid}-rotulo`}>Rótulo</label>
                  <input
                    id={`${uid}-rotulo`}
                    aria-label="Rótulo da imagem"
                    placeholder="Ex.: produto"
                    autoComplete="off"
                    value={label}
                    aria-invalid={errors.label ? true : undefined}
                    aria-describedby={errors.label ? labelErrorId : undefined}
                    onChange={(e) => {
                      setLabel(e.target.value);
                      if (errors.label || errors.request) setErrors((x) => ({ ...x, label: undefined, request: undefined }));
                    }}
                  />
                  {errors.label && (
                    <p id={labelErrorId} className="field-error" role="alert">
                      <AlertIcon />
                      {errors.label}
                    </p>
                  )}
                </div>
                {errors.request && (
                  <p className="field-error" role="alert">
                    <AlertIcon />
                    {errors.request}
                  </p>
                )}
                <div>
                  <button
                    type="button"
                    className="secondary"
                    disabled={working}
                    onClick={() => {
                      const found = validateUpload();
                      setErrors(found);
                      if (found.file || found.label) return;
                      void run(upload);
                    }}
                  >
                    Enviar imagem
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>

      <div className="action-bar">
        <div className="action-bar-status">
          <UnsavedBadge dirty={dirty} />
          {missingCopy ? (
            <p id={continueReasonId} className="hint">
              Escreva a copy para continuar.
            </p>
          ) : dirty ? (
            <p className="hint">O nome e a copy são salvos quando você continua.</p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={working || missingCopy}
          aria-describedby={missingCopy ? continueReasonId : undefined}
          onClick={() =>
            void run(async () => {
              await saveBriefing();
              await api(`/api/projects/${project.id}/stage`, { body: { stage: isUgc ? "script" : "characters" } });
            })
          }
        >
          {continueLabel}
        </button>
      </div>
    </div>
  );
}
