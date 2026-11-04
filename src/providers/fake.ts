import type { ZodType } from "zod";
import {
  ProviderError,
  type ImageData,
  type ImageModel,
  type ReferenceImage,
  type TextModel,
  type TextTask,
  type VideoModel,
  type VideoPoll,
  type VideoRequest,
} from "./types";

export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

type TextCall = { task: TextTask; system: string; prompt: string };

export class FakeTextModel implements TextModel {
  readonly calls: TextCall[] = [];

  // `responses`: fila de objetos devolvidos em ordem; ou função que decide pela chamada.
  constructor(private responses: unknown[] | ((call: TextCall) => unknown)) {}

  async generateJson<T>(args: { task: TextTask; system: string; prompt: string; schema: ZodType<T> }): Promise<T> {
    const call = { task: args.task, system: args.system, prompt: args.prompt };
    this.calls.push(call);
    const next = typeof this.responses === "function" ? this.responses(call) : this.responses.shift();
    if (next === undefined) throw new ProviderError("FakeTextModel: sem respostas na fila", false);
    return args.schema.parse(next);
  }
}

export class FakeImageModel implements ImageModel {
  readonly calls: { prompt: string; references?: ReferenceImage[] }[] = [];

  async generateImage(args: { prompt: string; references?: ReferenceImage[] }): Promise<ImageData> {
    this.calls.push(args);
    return { bytes: PNG_1X1, mimeType: "image/png" };
  }
}

export class FakeVideoModel implements VideoModel {
  readonly starts: VideoRequest[] = [];
  private polls = new Map<string, number>();

  constructor(
    private opts: {
      clip: Buffer;
      pendingPolls?: number;
      failure?: { reason: string; retryable: boolean };
    },
  ) {}

  async start(req: VideoRequest) {
    this.starts.push(req);
    return { providerRef: `fake-${this.starts.length}` };
  }

  async poll({ providerRef }: { providerRef: string }): Promise<VideoPoll> {
    const n = (this.polls.get(providerRef) ?? 0) + 1;
    this.polls.set(providerRef, n);
    if (n <= (this.opts.pendingPolls ?? 0)) return { state: "pending" };
    if (this.opts.failure) return { state: "failed", ...this.opts.failure };
    return { state: "done", bytes: this.opts.clip };
  }
}
