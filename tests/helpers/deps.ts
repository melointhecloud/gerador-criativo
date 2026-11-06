import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Deps } from "@/deps";
import { makeTestClip } from "@/modules/ffmpeg";
import { FakeImageModel, FakeTextModel, FakeVideoModel } from "@/providers/fake";
import { FsStorage } from "@/storage/fs";
import { testDb } from "./db";

export async function makeClipBytes(seconds: number, opts: { audio?: boolean; width?: number; height?: number } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "clip-"));
  try {
    const file = path.join(dir, "c.mp4");
    await makeTestClip(file, seconds, opts);
    return await readFile(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function makeDeps(
  opts: {
    text?: ConstructorParameters<typeof FakeTextModel>[0];
    video?: Partial<ConstructorParameters<typeof FakeVideoModel>[0]>;
  } = {},
) {
  const dir = await mkdtemp(path.join(tmpdir(), "deps-"));
  const text = new FakeTextModel(opts.text ?? []);
  const image = new FakeImageModel();
  const video = new FakeVideoModel({ clip: opts.video?.clip ?? (await makeClipBytes(1)), ...opts.video });
  const deps: Deps = {
    db: testDb,
    storage: new FsStorage(dir),
    providers: { text, image, video },
    config: { maxSceneReferences: 3, sceneMaxSeconds: 8 },
  };
  return { deps, text, image, video, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
