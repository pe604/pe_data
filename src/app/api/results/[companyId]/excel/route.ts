import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { quarterLabel } from "@/lib/domain/quarters";
import { parseQuarter } from "@/lib/domain/resultCalc";
import { buildResult, resultFormatZ } from "@/lib/domain/resultFormat";
import { buildResultWorkbook } from "@/lib/results/excel";
import { errorResponse } from "@/lib/server/http";
import { investedCompany, loadResultLines } from "@/lib/server/results";
import { contentDisposition } from "@/lib/server/upload";

export const runtime = "nodejs";

// POST the format shown in the builder and the quarter; returns the result as an .xlsx (SPEC §15.12, phase C).
// Saves nothing: "Save as result note" uploads the file through /api/files.
const body = z.object({
  base: z.string().refine((q) => parseQuarter(q) !== null, "Invalid quarter"),
  format: resultFormatZ,
});

export async function POST(req: Request, ctx: { params: Promise<{ companyId: string }> }) {
  try {
    await requireRole();
    const companyId = z.string().min(1).max(40).parse((await ctx.params).companyId);
    const { base, format } = body.parse(await req.json().catch(() => null));
    const c = await investedCompany(companyId);
    const built = buildResult(format, await loadResultLines(companyId), base);
    const buf = await buildResultWorkbook(built, quarterLabel(base));
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": contentDisposition("attachment", `${c.name} result ${quarterLabel(base)}.xlsx`),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
