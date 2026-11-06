// Objeto ausente no storage: ENOENT (FsStorage) ou NoSuchKey/404 (S3). Vira 404 em vez de 500.
export function isMissingObject(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const x = e as { code?: unknown; name?: unknown; $metadata?: { httpStatusCode?: number } };
  return x.code === "ENOENT" || x.code === "NoSuchKey" || x.name === "NoSuchKey" || x.name === "NotFound" || x.$metadata?.httpStatusCode === 404;
}
