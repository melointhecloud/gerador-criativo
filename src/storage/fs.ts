import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Storage } from "./types";

export class FsStorage implements Storage {
  private root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (path.isAbsolute(key) || !full.startsWith(this.root + path.sep)) {
      throw new Error(`chave inválida: ${key}`);
    }
    return full;
  }

  async put(key: string, bytes: Buffer, _contentType: string): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }
}
