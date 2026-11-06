import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeTestClip } from "@/modules/ffmpeg";
import { FakeImageModel, FakeTextModel, FakeVideoModel } from "./fake";
import type { Providers, VideoModel, VideoPoll, VideoRequest } from "./types";

async function buildClip(): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "dev-clip-"));
  try {
    const file = path.join(dir, "clip.mp4");
    await makeTestClip(file, 3);
    return await readFile(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// O clipe (ffmpeg) só é montado no primeiro start(): o `web` cria estes providers mas só usa o modelo de texto,
// e a imagem Docker do web não tem ffmpeg. A promessa é memorizada; se falhar, é descartada para a próxima tentativa.
class LazyClipVideoModel implements VideoModel {
  private inner: Promise<FakeVideoModel> | null = null;

  private get(): Promise<FakeVideoModel> {
    if (!this.inner) {
      const p = buildClip().then((clip) => new FakeVideoModel({ clip, pendingPolls: 2 }));
      this.inner = p;
      p.catch(() => {
        if (this.inner === p) this.inner = null;
      });
    }
    return this.inner;
  }

  async start(req: VideoRequest) {
    return (await this.get()).start(req);
  }

  // poll() vem do mesmo processo depois do start(); se o worker reiniciar, o FakeVideoModel recomeça a contagem de pendências.
  async poll(handle: { providerRef: string }): Promise<VideoPoll> {
    return (await this.get()).poll(handle);
  }
}

// Providers sem custo para desenvolver UI e fluxo (PROVIDER=fake).
export async function createDevProviders(): Promise<Providers> {

  const text = new FakeTextModel(({ task }) =>
    task === "characters"
      ? {
          characters: [
            { name: "Marina", description: "Mulher de 35 anos, cabelo cacheado castanho, jaqueta jeans" },
            { name: "Rafael", description: "Homem de 40 anos, barba curta, camisa social azul" },
          ],
        }
      : {
          scenes: [
            { dialogue: "Você não vai acreditar no que eu descobri.", visualPrompt: "Close no rosto, tom de segredo", targetSeconds: 3, referenceLabels: [] },
            { dialogue: "Eu testei por uma semana inteira.", visualPrompt: "Plano médio, mostrando o produto", targetSeconds: 3, referenceLabels: [] },
            { dialogue: "Corre no link da bio.", visualPrompt: "Close, apontando para baixo", targetSeconds: 3, referenceLabels: [] },
          ],
        },
  );
  return { text, image: new FakeImageModel(), video: new LazyClipVideoModel() };
}
