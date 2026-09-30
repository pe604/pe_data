import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { errorResponse } from "@/lib/server/http";
import { contentDisposition, INLINE_MIME } from "@/lib/server/upload";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";

/** View (inline, PDFs and images only) or download a stored file. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireRole();
    const { id } = await params;
    const f = await db.file.findUniqueOrThrow({ where: { id: id.slice(0, 40) } });
    // A deck staged in someone's Add company flow is theirs until the company is saved.
    if (!f.companyId && f.uploadedById !== me.id) return Response.json({ error: "Not found." }, { status: 404 });
    const download = new URL(req.url).searchParams.get("download") === "1";
    const inline = !download && INLINE_MIME.has(f.mime);
    return new Response(storage().stream(f.storageKey), {
      headers: {
        "Content-Type": inline ? f.mime : "application/octet-stream",
        "Content-Length": String(f.sizeBytes),
        "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", f.originalName),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        // Browsers' built-in PDF viewers break under a sandbox CSP, so only images get one.
        ...(f.mime.startsWith("image/") ? { "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox" } : {}),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
