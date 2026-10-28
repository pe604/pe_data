import "server-only";
import { db } from "@/lib/db";
import type { LineData } from "@/lib/domain/resultFormat";
import { UserError } from "./action";

// Results generator (SPEC §15.12): shared loading for the Results actions and the Excel route.

/** The company's figures history as plain numbers for the result builder. */
export async function loadResultLines(companyId: string): Promise<LineData[]> {
  const lines = await db.misLine.findMany({
    where: { companyId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { values: { select: { period: true, value: true } } },
  });
  return lines.map((l) => ({
    id: l.id,
    section: l.section,
    label: l.label,
    unit: l.unit as LineData["unit"],
    kind: l.kind as LineData["kind"],
    values: Object.fromEntries(l.values.map((v) => [v.period, Number(v.value)])),
  }));
}

/** An Invested company, or a UserError. */
export async function investedCompany(companyId: string) {
  const c = await db.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, status: true } });
  if (!c) throw new UserError("That company no longer exists. Reload the page.");
  if (c.status !== "INVESTED") throw new UserError("Results are only for companies in Invested.");
  return c;
}
