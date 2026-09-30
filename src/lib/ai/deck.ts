import "server-only";
import { execFile } from "node:child_process";
import JSZip from "jszip";
import { env } from "@/lib/env";
import { withTempDir } from "@/lib/storage";
import type { DeckInput } from "./provider";

// Turns a stored deck into model input (SPEC §9.1).
// PDF → sent natively. PPTX → LibreOffice PDF if available, else slide text.

function run(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err) => (err ? reject(err) : resolve()));
  });
}

const sofficeCandidates = () =>
  [
    env.SOFFICE_PATH,
    "soffice",
    "libreoffice",
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  ].filter(Boolean);

let sofficeCache: string | null | undefined;

async function findSoffice(): Promise<string | null> {
  if (sofficeCache !== undefined) return sofficeCache;
  for (const c of sofficeCandidates()) {
    try {
      await run(c, ["--version"], 15000);
      sofficeCache = c;
      return c;
    } catch {
      /* try next */
    }
  }
  sofficeCache = null;
  return null;
}

async function pptxToPdf(data: Buffer): Promise<Buffer | null> {
  const soffice = await findSoffice();
  if (!soffice) return null;
  try {
    return await withTempDir(async (dir, write, readOut) => {
      const input = await write("deck.pptx", data);
      await run(soffice, ["--headless", "--norestore", "--convert-to", "pdf", "--outdir", dir, input], 180000);
      return readOut("deck.pdf");
    });
  } catch {
    return null;
  }
}

/** Slide text from ppt/slides/slideN.xml <a:t> runs, in slide order. */
export async function pptxText(data: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  const slides = Object.keys(zip.files)
    .map((n) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(n))
    .filter((m): m is RegExpExecArray => !!m)
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  const decode = (s: string) =>
    s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  // Zip-bomb guard: refuse decks whose slide XML would expand to an unreasonable size.
  const MAX_SLIDE_BYTES = 5 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
  const sizeOf = (name: string) =>
    (zip.files[name] as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  if (slides.length > 500) throw new Error("no_text");
  let total = 0;
  for (const m of slides) {
    const s = sizeOf(m[0]);
    total += s;
    if (s > MAX_SLIDE_BYTES || total > MAX_TOTAL_BYTES) throw new Error("no_text");
  }
  const out: string[] = [];
  for (const m of slides) {
    const xml = await zip.files[m[0]].async("string");
    if (xml.length > MAX_SLIDE_BYTES) throw new Error("no_text");
    const paras = xml.split(/<\/a:p>/).map((p) =>
      [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((x) => decode(x[1])).join(""),
    );
    const text = paras.map((p) => p.trim()).filter(Boolean).join("\n");
    if (text) out.push(`[Slide ${m[1]}]\n${text}`);
  }
  return out.join("\n\n");
}

export async function prepareDeck(data: Buffer, fileName: string, mime: string): Promise<DeckInput> {
  const lower = fileName.toLowerCase();
  if (mime === "application/pdf" || lower.endsWith(".pdf")) return { kind: "pdf", data, fileName };
  if (lower.endsWith(".pptx")) {
    const pdf = await pptxToPdf(data);
    if (pdf) return { kind: "pdf", data: pdf, fileName };
    const text = await pptxText(data);
    if (!text.trim()) throw new Error("no_text");
    return { kind: "text", text: text.slice(0, 400_000), fileName };
  }
  throw new Error("bad_type");
}

export const isDeckFile = (name: string) => /\.(pdf|pptx)$/i.test(name);
