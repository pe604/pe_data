"use server";

// Portfolio tracking (SPEC §15): investment rounds (with fund) for Invested companies. Amounts in ₹ Cr.
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db, type Tx } from "@/lib/db";
import { dateToISO, fmtDate, isISODate, todayISO } from "@/lib/domain/dates";
import { fmtCr } from "@/lib/domain/money";
import { FUNDS, INSTRUMENTS } from "@/lib/domain/portfolio";
import type { CompanyRow, ContactItem } from "@/lib/domain/types";
import { run, UserError } from "@/lib/server/action";
import { audit, getRow } from "@/lib/server/company";

const id = z.string().min(1).max(40);
const pastDate = z
  .string()
  .refine(isISODate, "Invalid date")
  .refine((d) => d <= todayISO(), "The date can't be in the future.");
const crore = z.number().finite().max(10_000_000);
const pct = z.number().finite().min(0).max(100);

const roundSchema = z.object({
  fund: z.enum(FUNDS, { message: "Choose the fund: Hedgehogs, Sambhav or Other" }),
  date: pastDate,
  round: z.string().trim().max(60).nullable(),
  instrument: z.enum(INSTRUMENTS).nullable(),
  amount: crore.gt(0, "Enter the amount invested"),
  preMoney: crore.min(0).nullable(),
  stakePct: pct.nullable(),
});


/** Calendar day (validated YYYY-MM-DD) as a UTC midnight Date for a DATE column. */
const day = (iso: string) => new Date(iso + "T00:00:00Z");
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

async function investedCompany(tx: Tx, companyId: string) {
  const c = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { id: true, status: true } });
  if (c.status !== "INVESTED") throw new UserError("Rounds are only for companies in Invested.");
  return c;
}

const roundText = (r: { fund: string | null; round: string | null; amount: number; date: string }) =>
  `${r.round || "round"}${r.fund ? ` (${r.fund})` : ""}: ${fmtCr(r.amount)} on ${fmtDate(r.date)}`;

// ─── Rounds ──────────────────────────────────────────────────────────────────

/** Adds a round (roundId null) or edits one. Returns the updated table row. */
export async function saveRound(companyId: string, roundId: string | null, input: z.input<typeof roundSchema>) {
  return run<CompanyRow>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const rid = roundId === null ? null : id.parse(roundId);
    const p = roundSchema.parse(input);
    const data = {
      fund: p.fund,
      date: day(p.date),
      round: p.round || null,
      instrument: p.instrument,
      amount: r2(p.amount),
      preMoney: p.preMoney === null ? null : r2(p.preMoney),
      stakePct: p.stakePct === null ? null : r4(p.stakePct),
    };
    return db.$transaction(async (tx) => {
      await investedCompany(tx, cid);
      if (rid) {
        const before = await tx.investmentRound.findFirst({ where: { id: rid, companyId: cid } });
        if (!before) throw new UserError("That round no longer exists. Reload the page.");
        await tx.investmentRound.update({ where: { id: rid }, data });
        await audit(tx, cid, me.id, [{ note: "Edited investment " + roundText({ ...p, amount: data.amount }) }]);
      } else {
        await tx.investmentRound.create({ data: { ...data, companyId: cid, createdById: me.id } });
        await audit(tx, cid, me.id, [{ note: "Added investment " + roundText({ ...p, amount: data.amount }) }]);
      }
      return getRow(cid, tx);
    });
  });
}

export async function deleteRound(companyId: string, roundId: string) {
  return run<CompanyRow>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const rid = id.parse(roundId);
    return db.$transaction(async (tx) => {
      await investedCompany(tx, cid);
      const r = await tx.investmentRound.findFirst({ where: { id: rid, companyId: cid } });
      if (!r) throw new UserError("That round no longer exists. Reload the page.");
      await tx.investmentRound.delete({ where: { id: rid } });
      const date = dateToISO(r.date) ?? "";
      await audit(tx, cid, me.id, [{ note: "Removed investment " + roundText({ fund: r.fund, round: r.round, amount: Number(r.amount), date }) }]);
      return getRow(cid, tx);
    });
  });
}

// ─── Contacts (company POCs) ─────────────────────────────────────────────────

const contactSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  designation: z.string().trim().max(120).nullable(),
  email: z.string().trim().max(200).email("Enter a valid email").nullable().or(z.literal("").transform(() => null)),
  phone: z.string().trim().max(40).nullable(),
  isPrimary: z.boolean(),
});

async function loadContacts(companyId: string): Promise<ContactItem[]> {
  const rows = await db.companyContact.findMany({
    where: { companyId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  return rows.map((c) => ({ id: c.id, name: c.name, designation: c.designation, email: c.email, phone: c.phone, isPrimary: c.isPrimary }));
}

/** Adds (contactId null) or edits a contact. The first contact is primary; marking one primary unmarks the others. */
export async function saveContact(companyId: string, contactId: string | null, input: z.input<typeof contactSchema>) {
  return run<ContactItem[]>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const ctid = contactId === null ? null : id.parse(contactId);
    let p: z.infer<typeof contactSchema>;
    try {
      p = contactSchema.parse(input);
    } catch (e) {
      const msg = e instanceof z.ZodError ? e.issues[0]?.message : undefined;
      throw msg && !msg.startsWith("Invalid") ? new UserError(msg) : e;
    }
    const data = { name: p.name, designation: p.designation || null, email: p.email || null, phone: p.phone || null };
    await db.$transaction(async (tx) => {
      await investedCompany(tx, cid);
      const count = await tx.companyContact.count({ where: { companyId: cid } });
      const primary = p.isPrimary || count === 0 || (ctid !== null && count === 1);
      if (primary) await tx.companyContact.updateMany({ where: { companyId: cid }, data: { isPrimary: false } });
      if (ctid) {
        const before = await tx.companyContact.findFirst({ where: { id: ctid, companyId: cid } });
        if (!before) throw new UserError("That contact no longer exists. Reload the page.");
        await tx.companyContact.update({ where: { id: ctid }, data: { ...data, isPrimary: primary } });
        await audit(tx, cid, me.id, [{ note: `Updated contact ${p.name}` }]);
      } else {
        await tx.companyContact.create({ data: { ...data, companyId: cid, isPrimary: primary } });
        await audit(tx, cid, me.id, [{ note: `Added contact ${p.name}${p.designation ? ` (${p.designation})` : ""}` }]);
      }
      // Always keep one primary contact.
      if (!(await tx.companyContact.count({ where: { companyId: cid, isPrimary: true } }))) {
        const first = await tx.companyContact.findFirst({ where: { companyId: cid }, orderBy: { createdAt: "asc" } });
        if (first) await tx.companyContact.update({ where: { id: first.id }, data: { isPrimary: true } });
      }
    });
    return loadContacts(cid);
  });
}

export async function deleteContact(companyId: string, contactId: string) {
  return run<ContactItem[]>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const ctid = id.parse(contactId);
    await db.$transaction(async (tx) => {
      await investedCompany(tx, cid);
      const c = await tx.companyContact.findFirst({ where: { id: ctid, companyId: cid } });
      if (!c) throw new UserError("That contact no longer exists. Reload the page.");
      await tx.companyContact.delete({ where: { id: ctid } });
      if (c.isPrimary) {
        const first = await tx.companyContact.findFirst({ where: { companyId: cid }, orderBy: { createdAt: "asc" } });
        if (first) await tx.companyContact.update({ where: { id: first.id }, data: { isPrimary: true } });
      }
      await audit(tx, cid, me.id, [{ note: `Removed contact ${c.name}` }]);
    });
    return loadContacts(cid);
  });
}
