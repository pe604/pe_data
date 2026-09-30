import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Short-lived scratch folder for tools that need real files (LibreOffice PPTX → PDF).
 * Lives in the OS temp dir and is always deleted afterwards; nothing is stored here.
 */
export async function withTempDir<T>(
  fn: (
    dir: string,
    write: (name: string, data: Buffer) => Promise<string>,
    readOut: (name: string) => Promise<Buffer>,
  ) => Promise<T>,
): Promise<T> {
  const dir = path.join(tmpdir(), "niveshaay-pipeline", randomUUID());
  await mkdir(dir, { recursive: true });
  try {
    return await fn(
      dir,
      async (name, data) => {
        const p = path.join(dir, path.basename(name));
        await writeFile(p, data);
        return p;
      },
      (name) => readFile(path.join(dir, path.basename(name))),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
