import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { letterFileName, renderLetter } from "@/lib/funding/letter";
import { loadLetter } from "@/lib/funding/letterData";
import { errorResponse } from "@/lib/server/http";
import { contentDisposition } from "@/lib/server/upload";

export const runtime = "nodejs";

// The funding letter for a month ("2026-10") or week ("2026-W44") as a PDF (SPEC §15.16).
export async function GET(_req: Request, { params }: { params: Promise<{ period: string }> }) {
  try {
    await requireRole();
    const period = z.string().regex(/^\d{4}-(\d{2}|W\d{2})$/).parse((await params).period);
    const letter = await loadLetter(period);
    if (!letter) return Response.json({ error: "No letter has been written for that period yet." }, { status: 404 });
    const pdf = await renderLetter(letter);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition("inline", letterFileName(letter)),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
