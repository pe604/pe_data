import { ZipArchive } from "archiver";
import { PassThrough, Readable } from "node:stream";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { FILE_KIND_LABELS } from "@/lib/domain/constants";
import { todayISO } from "@/lib/domain/dates";
import { errorResponse } from "@/lib/server/http";
import { contentDisposition } from "@/lib/server/upload";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";

/** All of a company's files as a zip, grouped into Deck/, Model/ and Other/. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole();
    const { id } = await params;
    const c = await db.company.findUniqueOrThrow({
      where: { id: id.slice(0, 40) },
      include: { files: { orderBy: { uploadedAt: "asc" } } },
    });
    const zip = new ZipArchive({ zlib: { level: 6 } });
    const out = new PassThrough();
    zip.pipe(out);
    const used = new Set<string>();
    for (const f of c.files) {
      const folder = FILE_KIND_LABELS[f.kind];
      let name = `${folder}/${f.originalName}`;
      for (let i = 2; used.has(name.toLowerCase()); i++) {
        name = `${folder}/${f.originalName.replace(/(\.[^.]*)?$/, ` (${i})$1`)}`;
      }
      used.add(name.toLowerCase());
      zip.append(storage().nodeStream(f.storageKey), { name });
    }
    void zip.finalize();
    const safe = c.name.replace(/[^\w &.-]+/g, "").trim() || "Company";
    return new Response(Readable.toWeb(out) as ReadableStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": contentDisposition("attachment", `${safe} files ${todayISO()}.zip`),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
