import { DomainError } from "@/services/errors";
import { addReference } from "@/services/projects";
import { api } from "@/web/http";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Arquivo de 10 MB mais a sobrecarga do multipart (limite do Content-Length, que pode ser maior que o arquivo).
const MAX_BODY_BYTES = 10.5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export const POST = api(async ({ req, params, deps }) => {
  // Recusa cedo pelo Content-Length declarado, antes de o formData() ler o corpo para a memória.
  // (Cabeçalho ausente ou mentiroso não é barrado aqui; o `file.size` abaixo é a checagem após o parse.)
  const declared = Number(req.headers.get("content-length"));
  if (req.headers.has("content-length") && declared > MAX_BODY_BYTES) throw new DomainError("Imagem maior que 10 MB", 413);
  const form = await req.formData().catch(() => {
    throw new DomainError("Envie o formulário com uma imagem");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new DomainError("Envie um arquivo de imagem");
  // O tipo vem do próprio File (nunca de um campo do formulário); o serviço também valida.
  if (!IMAGE_TYPES.has(file.type)) throw new DomainError("Formato de imagem não suportado (use PNG, JPEG ou WebP)");
  if (file.size === 0) throw new DomainError("O arquivo está vazio");
  if (file.size > MAX_IMAGE_BYTES) throw new DomainError("Imagem maior que 10 MB"); // depois do parse: o arquivo já está em memória; o limite é por tamanho real, não pelo cabeçalho
  const label = String(form.get("label") ?? "").trim();
  if (!label || label.length > 100) throw new DomainError("Dê um rótulo à imagem (ex.: produto, pessoa), com até 100 caracteres");
  return addReference(deps, {
    projectId: params.id,
    label,
    bytes: Buffer.from(await file.arrayBuffer()),
    mimeType: file.type,
  });
});
