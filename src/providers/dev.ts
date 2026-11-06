import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeTestClip } from "@/modules/ffmpeg";
import { FakeImageModel, FakeTextModel, FakeVideoModel } from "./fake";
import type { Providers } from "./types";

// Providers sem custo para desenvolver UI e fluxo (PROVIDER=fake).
export async function createDevProviders(): Promise<Providers> {
  const dir = await mkdtemp(path.join(tmpdir(), "dev-clip-"));
  let clip: Buffer;
  try {
    const file = path.join(dir, "clip.mp4");
    await makeTestClip(file, 3);
    clip = await readFile(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

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
  return { text, image: new FakeImageModel(), video: new FakeVideoModel({ clip, pendingPolls: 2 }) };
}
