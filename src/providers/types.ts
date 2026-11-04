import type { ZodType } from "zod";

export type ImageData = { bytes: Buffer; mimeType: string };
export type ReferenceImage = ImageData & { label: string };

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export type TextTask = "script" | "characters";

export interface TextModel {
  generateJson<T>(args: { task: TextTask; system: string; prompt: string; schema: ZodType<T> }): Promise<T>;
}

export interface ImageModel {
  generateImage(args: { prompt: string; references?: ReferenceImage[] }): Promise<ImageData>;
}

export type VideoRequest = {
  prompt: string;
  references: ReferenceImage[];
  targetSeconds: number;
};

export type VideoPoll =
  | { state: "pending" }
  | { state: "done"; bytes: Buffer }
  | { state: "failed"; reason: string; retryable: boolean };

// start() inicia a geração e devolve uma referência durável (persistida no banco);
// poll() pode ser chamado de qualquer processo, inclusive após reinício do worker.
export interface VideoModel {
  start(req: VideoRequest): Promise<{ providerRef: string }>;
  poll(handle: { providerRef: string }): Promise<VideoPoll>;
}

export type Providers = { text: TextModel; image: ImageModel; video: VideoModel };
