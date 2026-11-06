import { DomainError } from "@/services/errors";
import { addReference } from "@/services/projects";
import { api } from "@/web/http";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export const POST = api(async ({ req, params, deps }) => {
  const form = await req.formData().catch(() => {
    throw new DomainError("Envie o formulário com uma imagem");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new DomainError("Envie um arquivo de imagem");
  // O tipo vem do próprio File (nunca de um campo do formulário); o serviço também valida.
  if (!IMAGE_TYPES.has(file.type)) throw new DomainError("Formato de imagem não suportado (use PNG, JPEG ou WebP)");
  if (file.size === 0) throw new DomainError("O arquivo está vazio");
  if (file.size > MAX_IMAGE_BYTES) throw new DomainError("Imagem maior que 10 MB"); // antes de ler para a memória
  const label = String(form.get("label") ?? "").trim();
  if (!label || label.length > 100) throw new DomainError("Dê um rótulo à imagem (ex.: produto, pessoa), com até 100 caracteres");
  return addReference(deps, {
    projectId: params.id,
    label,
    bytes: Buffer.from(await file.arrayBuffer()),
    mimeType: file.type,
  });
});
