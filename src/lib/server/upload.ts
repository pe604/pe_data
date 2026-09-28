import "server-only";
import { fileTypeFromBuffer } from "file-type";

// Upload validation (SPEC §13): extension allow-list + MIME sniffed from the bytes.

const TYPES: Record<string, string[]> = {
  pdf: ["application/pdf"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ppt: ["application/x-cfb"],
  xls: ["application/x-cfb"],
  doc: ["application/x-cfb"],
  xlsm: ["application/vnd.ms-excel.sheet.macroenabled.12", "application/zip"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  webp: ["image/webp"],
  gif: ["image/gif"],
  zip: ["application/zip"],
};
// Plain-text formats have no magic bytes; accept if the content is valid UTF-8 text.
const TEXT: Record<string, string> = { csv: "text/csv", txt: "text/plain", md: "text/markdown" };

const OFFICE_ZIP: Record<string, string> = {
  pptx: TYPES.pptx[0],
  xlsx: TYPES.xlsx[0],
  docx: TYPES.docx[0],
};
const LEGACY: Record<string, string> = {
  ppt: "application/vnd.ms-powerpoint",
  xls: "application/vnd.ms-excel",
  doc: "application/msword",
};

export const ALLOWED_EXTENSIONS = [...Object.keys(TYPES), ...Object.keys(TEXT)];

export function extOf(name: string) {
  return /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
}

/** Returns the MIME type to store, or null if the file is rejected. */
export async function sniff(name: string, buf: Buffer): Promise<string | null> {
  const ext = extOf(name);
  if (TEXT[ext]) {
    const sample = buf.subarray(0, 64 * 1024);
    if (sample.includes(0)) return null;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(sample.length < buf.length ? sample.subarray(0, sample.lastIndexOf(10) + 1 || sample.length) : sample);
    } catch {
      return null;
    }
    return TEXT[ext];
  }
  const allowed = TYPES[ext];
  if (!allowed) return null;
  const ft = await fileTypeFromBuffer(buf);
  if (!ft) return null;
  if (!allowed.includes(ft.mime)) {
    // Some Office files are detected as a generic zip.
    if (OFFICE_ZIP[ext] && ft.mime === "application/zip") return OFFICE_ZIP[ext];
    return null;
  }
  if (LEGACY[ext]) return LEGACY[ext];
  return OFFICE_ZIP[ext] ?? ft.mime;
}

/** Only these are shown inline in the browser; everything else downloads. */
export const INLINE_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);

export function contentDisposition(kind: "inline" | "attachment", filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
