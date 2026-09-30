import "server-only";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { env } from "@/lib/env";

/**
 * The only code allowed to touch the filesystem for stored files (SPEC §2).
 * Keys are random; original filenames never reach the disk.
 */
export interface StorageDriver {
  put(data: Buffer): Promise<string>;
  /** Web stream of the stored bytes. */
  stream(key: string): ReadableStream<Uint8Array>;
  /** Node stream, for zipping. */
  nodeStream(key: string): Readable;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

class LocalDiskDriver implements StorageDriver {
  constructor(private root: string) {}

  private pathFor(key: string) {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error("Invalid storage key");
    return path.join(this.root, key.slice(0, 2), key);
  }

  async put(data: Buffer) {
    const key = randomUUID();
    const p = this.pathFor(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data, { flag: "wx" });
    return key;
  }

  nodeStream(key: string) {
    return createReadStream(this.pathFor(key));
  }

  stream(key: string) {
    return Readable.toWeb(this.nodeStream(key)) as ReadableStream<Uint8Array>;
  }

  async read(key: string) {
    const chunks: Buffer[] = [];
    for await (const c of this.nodeStream(key)) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }

  async delete(key: string) {
    await rm(this.pathFor(key), { force: true });
  }

  async exists(key: string) {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }
}

let driver: StorageDriver | null = null;

export function storage(): StorageDriver {
  if (!driver) {
    switch (env.STORAGE_DRIVER) {
      case "local":
        driver = new LocalDiskDriver(path.resolve(env.STORAGE_DIR));
        break;
    }
  }
  return driver;
}

/**
 * Temporary workspace for tools that need real files (LibreOffice PPTX → PDF).
 * Lives here so the "only StorageDriver touches the filesystem" rule holds.
 */
export async function withTempDir<T>(fn: (dir: string, write: (name: string, data: Buffer) => Promise<string>, readOut: (name: string) => Promise<Buffer>) => Promise<T>): Promise<T> {
  const dir = path.join(path.resolve(env.STORAGE_DIR), ".tmp", randomUUID());
  await mkdir(dir, { recursive: true });
  try {
    return await fn(
      dir,
      async (name, data) => {
        const p = path.join(dir, path.basename(name));
        await writeFile(p, data);
        return p;
      },
      async (name) => {
        const chunks: Buffer[] = [];
        for await (const c of createReadStream(path.join(dir, path.basename(name)))) chunks.push(c as Buffer);
        return Buffer.concat(chunks);
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
