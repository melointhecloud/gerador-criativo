import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export async function runFfmpeg(args: string[]): Promise<void> {
  try {
    await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (e) {
    const stderr = (e as { stderr?: string }).stderr;
    throw new Error(`ffmpeg falhou: ${stderr || (e as Error).message}`);
  }
}

export type Probe = { durationSeconds: number; hasAudio: boolean; width: number; height: number };

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await exec("ffprobe", [
    "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file,
  ]);
  const j = JSON.parse(stdout) as {
    format: { duration?: string };
    streams: { codec_type: string; width?: number; height?: number }[];
  };
  const video = j.streams.find((s) => s.codec_type === "video");
  if (!video) throw new Error("arquivo sem trilha de vídeo");
  return {
    durationSeconds: Number(j.format.duration ?? 0),
    hasAudio: j.streams.some((s) => s.codec_type === "audio"),
    width: video.width ?? 0,
    height: video.height ?? 0,
  };
}

// Clipe sintético para testes e para o provider de desenvolvimento.
export async function makeTestClip(
  file: string,
  seconds: number,
  opts: { width?: number; height?: number; audio?: boolean } = {},
): Promise<void> {
  const w = opts.width ?? 360;
  const h = opts.height ?? 640;
  const audio = opts.audio ?? true;
  const args = ["-f", "lavfi", "-i", `testsrc2=size=${w}x${h}:rate=30:duration=${seconds}`];
  if (audio) args.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`);
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
  if (audio) args.push("-c:a", "aac", "-shortest");
  args.push(file);
  await runFfmpeg(args);
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "gerador-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
