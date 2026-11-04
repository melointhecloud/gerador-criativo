import { z } from "zod";

const baseSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PROVIDER: z.enum(["gemini", "fake"]).default("gemini"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_TEXT_MODEL: z.string().optional(),
  GEMINI_IMAGE_MODEL: z.string().optional(),
  GEMINI_VIDEO_MODEL: z.string().default("gemini-omni-1.1-flash"),
  MAX_SCENE_REFERENCES: z.coerce.number().int().min(1).default(3),
  SCENE_MAX_SECONDS: z.coerce.number().int().min(3).default(8),
  STORAGE: z.enum(["fs", "s3"]).default("fs"),
  LOCAL_STORAGE_DIR: z.string().default("./storage-data"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  ACCESS_PASSWORD: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(4),
});

export const envSchema = baseSchema.superRefine((v, ctx) => {
  const need = (keys: (keyof typeof v)[]) => {
    for (const k of keys) {
      if (!v[k]) ctx.addIssue({ code: "custom", path: [k], message: `${String(k)} é obrigatório` });
    }
  };
  if (v.PROVIDER === "gemini") need(["GEMINI_API_KEY", "GEMINI_TEXT_MODEL", "GEMINI_IMAGE_MODEL"]);
  if (v.STORAGE === "s3") need(["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]);
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return envSchema.parse(source);
}
