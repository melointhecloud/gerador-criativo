import { DomainError } from "@/services/errors";
import { getAsset, removeReference } from "@/services/projects";
import { FILE_HEADERS, api } from "@/web/http";
import { parseRange } from "@/web/range";
import { isMissingObject } from "@/web/storage-errors";

const EXT: Record<string, string> = { "video/mp4": "mp4", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

// Lê o objeto inteiro e fatia o Buffer (o Storage não tem leitura parcial). Os arquivos têm poucos MB;
// se isso crescer, trocar por leitura em stream com range.
export const GET = api(async ({ req, params, deps }) => {
  const asset = await getAsset(deps.db, params.assetId);
  let bytes: Buffer;
  try {
    bytes = await deps.storage.get(asset.storageKey);
  } catch (e) {
    if (isMissingObject(e)) throw new DomainError("Arquivo não encontrado", 404);
    throw e;
  }
  const headers = new Headers({
    ...FILE_HEADERS,
    "Content-Type": asset.mimeType,
    "Accept-Ranges": "bytes",
  });
  if (new URL(req.url).searchParams.get("download")) {
    headers.set("Content-Disposition", `attachment; filename="criativo-${asset.id.slice(0, 8)}.${EXT[asset.mimeType] ?? "bin"}"`);
  }

  const range = parseRange(req.headers.get("range"), bytes.length);
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${bytes.length}`);
    return new Response(null, { status: 416, headers });
  }
  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${bytes.length}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    return new Response(new Uint8Array(bytes.subarray(range.start, range.end + 1)), { status: 206, headers });
  }
  headers.set("Content-Length", String(bytes.length));
  return new Response(new Uint8Array(bytes), { headers });
});

// Só apaga imagens de referência (o serviço recusa os outros tipos).
export const DELETE = api(async ({ params, deps }) => {
  await removeReference(deps.db, params.assetId);
  return { ok: true };
});
