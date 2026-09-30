import { z } from "zod";
import { createJob } from "@/lib/ai/jobs";
import { isDeckFile } from "@/lib/ai/deck";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { FILE_KIND_LABELS, FILE_KINDS } from "@/lib/domain/constants";
import type { FileItem } from "@/lib/domain/types";
import { aiConfigured, env, maxUploadBytes } from "@/lib/env";
import { UserError } from "@/lib/server/action";
import { audit } from "@/lib/server/company";
import { errorResponse } from "@/lib/server/http";
import { sniff } from "@/lib/server/upload";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";

const fields = z.object({
  kind: z.enum(FILE_KINDS),
  companyId: z.string().min(1).max(40).nullable(),
  /** Start a summary job when the file is a deck. */
  summarise: z.enum(["0", "1"]).default("0"),
});

/**
 * Upload one file. With companyId it is attached to that company; without, it is staged
 * for the Add company flow (attached on save, discarded on cancel).
 */
export async function POST(req: Request) {
  try {
    const me = await requireRole();
    // Refuse oversized bodies before reading them into memory (browsers always send Content-Length).
    const len = Number(req.headers.get("content-length"));
    if (!Number.isFinite(len) || len <= 0) return Response.json({ error: "Upload size is missing." }, { status: 411 });
    if (len > maxUploadBytes + 1024 * 1024) {
      return Response.json({ error: `That file is over ${env.MAX_UPLOAD_MB} MB. Compress it and try again.` }, { status: 413 });
    }
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new UserError("Choose a file to upload.");
    const p = fields.parse({
      kind: form.get("kind") ?? "OTHER",
      companyId: form.get("companyId") || null,
      summarise: form.get("summarise") ?? "0",
    });
    const name = file.name.replace(/[\\/]/g, "_").slice(0, 200) || "file";
    if (file.size > maxUploadBytes) throw new UserError(`That file is over ${env.MAX_UPLOAD_MB} MB. Compress it and try again.`);
    if (file.size === 0) throw new UserError("That file is empty.");
    const buf = Buffer.from(await file.arrayBuffer());
    const mime = await sniff(name, buf);
    if (!mime) throw new UserError("This file type cannot be stored. Upload a PDF, Office file, image or CSV.");
    if (p.companyId) await db.company.findUniqueOrThrow({ where: { id: p.companyId }, select: { id: true } });

    const key = await storage().put(buf);
    let saved;
    try {
      saved = await db.$transaction(async (tx) => {
        const f = await tx.file.create({
          data: {
            companyId: p.companyId,
            originalName: name,
            kind: p.kind,
            mime,
            sizeBytes: buf.length,
            storageKey: key,
            uploadedById: me.id,
          },
        });
        if (p.companyId) await audit(tx, p.companyId, me.id, [{ note: `Uploaded ${name} (${FILE_KIND_LABELS[p.kind]})` }]);
        return f;
      });
    } catch (e) {
      await storage().delete(key).catch(() => undefined);
      throw e;
    }

    let jobId: string | null = null;
    const wantsSummary = p.kind === "DECK" && isDeckFile(name) && aiConfigured;
    if (wantsSummary && (p.summarise === "1" || p.companyId)) {
      const busy = p.companyId
        ? await db.summaryJob.findFirst({ where: { companyId: p.companyId, status: { in: ["QUEUED", "RUNNING"] } } })
        : null;
      if (!busy) jobId = (await createJob(saved.id, p.companyId, me.id)).id;
    }

    const item: FileItem = {
      id: saved.id,
      originalName: saved.originalName,
      kind: saved.kind,
      mime: saved.mime,
      sizeBytes: saved.sizeBytes,
      uploadedBy: me.name,
      uploadedAt: saved.uploadedAt.toISOString(),
    };
    return Response.json({ file: item, jobId });
  } catch (e) {
    return errorResponse(e);
  }
}
