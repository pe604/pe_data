"use server";

// Company updates for portfolio companies (SPEC §15.4): a dated news log, newest first.
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { dateToISO, fmtDate, isISODate, todayISO } from "@/lib/domain/dates";
import type { CompanyRow, UpdateItem } from "@/lib/domain/types";
import { run, UserError } from "@/lib/server/action";
import { audit, getRow } from "@/lib/server/company";

const id = z.string().min(1).max(40);
const input = z.object({
  date: z
    .string()
    .refine(isISODate, "Invalid date")
    .refine((d) => d <= todayISO(), "The date can't be in the future."),
  text: z.string().trim().min(1, "Write the update").max(5000),
});
const day = (iso: string) => new Date(iso + "T00:00:00Z");
const short = (t: string) => (t.length > 80 ? t.slice(0, 77) + "…" : t);

async function investedCompany(companyId: string) {
  const c = await db.company.findUnique({ where: { id: companyId }, select: { status: true } });
  if (!c) throw new UserError("That company no longer exists. Reload the page.");
  if (c.status !== "INVESTED") throw new UserError("Company updates are only for companies in Invested.");
}

async function listFor(companyId: string): Promise<UpdateItem[]> {
  const rows = await db.companyUpdate.findMany({
    where: { companyId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: { createdBy: { select: { name: true } } },
  });
  return rows.map((u) => ({
    id: u.id,
    date: dateToISO(u.date) ?? "",
    text: u.text,
    author: u.createdBy.name,
    source: u.source === "WHATSAPP" ? "WHATSAPP" : "MANUAL",
    createdAt: u.createdAt.toISOString(),
  }));
}

export async function listUpdates(companyId: string) {
  return run<UpdateItem[]>(async () => {
    await requireRole();
    return listFor(id.parse(companyId));
  });
}

function parse(v: z.input<typeof input>) {
  try {
    return input.parse(v);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message : undefined;
    throw msg && msg !== "Invalid date" ? new UserError(msg) : e;
  }
}

/** Adds (updateId null) or edits an update. Returns the refreshed list and table row. */
export async function saveUpdate(companyId: string, updateId: string | null, v: z.input<typeof input>) {
  return run<{ updates: UpdateItem[]; row: CompanyRow }>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const uid = updateId === null ? null : id.parse(updateId);
    const p = parse(v);
    await investedCompany(cid);
    await db.$transaction(async (tx) => {
      if (uid) {
        const before = await tx.companyUpdate.findFirst({ where: { id: uid, companyId: cid } });
        if (!before) throw new UserError("That update no longer exists. Reload the page.");
        await tx.companyUpdate.update({ where: { id: uid }, data: { date: day(p.date), text: p.text } });
        await audit(tx, cid, me.id, [{ note: `Edited company update of ${fmtDate(p.date)}: ${short(p.text)}` }]);
      } else {
        await tx.companyUpdate.create({ data: { companyId: cid, date: day(p.date), text: p.text, createdById: me.id } });
        await audit(tx, cid, me.id, [{ note: `Added company update (${fmtDate(p.date)}): ${short(p.text)}` }]);
      }
    });
    return { updates: await listFor(cid), row: await getRow(cid) };
  });
}

export async function deleteUpdate(companyId: string, updateId: string) {
  return run<{ updates: UpdateItem[]; row: CompanyRow }>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const uid = id.parse(updateId);
    await investedCompany(cid);
    await db.$transaction(async (tx) => {
      const u = await tx.companyUpdate.findFirst({ where: { id: uid, companyId: cid } });
      if (!u) throw new UserError("That update no longer exists. Reload the page.");
      await tx.companyUpdate.delete({ where: { id: uid } });
      await audit(tx, cid, me.id, [{ note: `Removed company update of ${fmtDate(dateToISO(u.date) ?? "")}: ${short(u.text)}` }]);
    });
    return { updates: await listFor(cid), row: await getRow(cid) };
  });
}
