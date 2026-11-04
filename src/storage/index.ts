import type { Env } from "@/config/env";
import { FsStorage } from "./fs";
import { S3Storage } from "./s3";
import type { Storage } from "./types";

export type { Storage } from "./types";

export function createStorage(env: Env): Storage {
  if (env.STORAGE === "fs") return new FsStorage(env.LOCAL_STORAGE_DIR);
  return new S3Storage(env.S3_BUCKET!, {
    endpoint: env.S3_ENDPOINT!,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
  });
}
