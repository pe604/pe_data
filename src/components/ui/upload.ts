import type { FileKind } from "@/lib/domain/constants";
import type { FileItem } from "@/lib/domain/types";

export type UploadResult = { ok: true; file: FileItem; jobId: string | null } | { ok: false; error: string };

/** POST /api/files. Without companyId the file is staged for the Add company flow. */
export async function uploadFile(
  file: File,
  opts: { kind: FileKind; companyId: string | null; summarise?: boolean },
): Promise<UploadResult> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("kind", opts.kind);
  if (opts.companyId) fd.append("companyId", opts.companyId);
  if (opts.summarise) fd.append("summarise", "1");
  try {
    const res = await fetch("/api/files", { method: "POST", body: fd });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body.error ?? "The upload failed. Try again." };
    return { ok: true, file: body.file, jobId: body.jobId ?? null };
  } catch {
    return { ok: false, error: "The upload failed. Check your connection and try again." };
  }
}
