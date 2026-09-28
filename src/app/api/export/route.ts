import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { todayISO } from "@/lib/domain/dates";
import { buildWorkbook } from "@/lib/excel/export";
import { rowInclude, toRow } from "@/lib/server/company";
import { errorResponse } from "@/lib/server/http";
import { contentDisposition } from "@/lib/server/upload";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireRole();
    const companies = (await db.company.findMany({ include: rowInclude })).map(toRow);
    const buf = await buildWorkbook(companies);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": contentDisposition("attachment", `Niveshaay Deal Pipeline ${todayISO()}.xlsx`),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
