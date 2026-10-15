"use server";

// Portfolio tracking (SPEC §15): investment rounds and valuation marks for Invested companies. Amounts in ₹ Cr.
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db, type Tx } from "@/lib/db";
import { dateToISO, fmtDate, isISODate, todayISO } from "@/lib/domain/dates";
import { fmtCr } from "@/lib/domain/money";
import { INSTRUMENTS, MARK_SOURCES } from "@/lib/domain/portfolio";
import type { CompanyRow } from "@/lib/domain/types";
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
  date: pastDate,
  round: z.string().trim().max(60).nullable(),
  instrument: z.enum(INSTRUMENTS).nullable(),
  amount: crore.gt(0, "Enter the amount invested"),
  preMoney: crore.min(0).nullable(),
  stakePct: pct.nullable(),
});

const markSchema = z.object({
  date: pastDate,
  valuation: crore.min(0),
  stakePct: pct.gt(0, "Enter our stake"),
  source: z.enum(MARK_SOURCES),
  note: z.string().trim().max(500).nullable(),
});

/** Calendar day (validated YYYY-MM-DD) as a UTC midnight Date for a DATE column. */
const day = (iso: string) => new Date(iso + "T00:00:00Z");
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

async function investedCompany(tx: Tx, companyId: string) {
  const c = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { id: true, status: true } });
  if (c.status !== "INVESTED") throw new UserError("Rounds and valuations are only for companies in Invested.");
  return c;
}

const roundText = (r: { round: string | null; amount: number; date: string }) =>
  `${r.round || "round"}: ${fmtCr(r.amount)} on ${fmtDate(r.date)}`;

// ─── Rounds ──────────────────────────────────────────────────────────────────

/** Adds a round (roundId null) or edits one. Returns the updated table row. */
export async function saveRound(companyId: string, roundId: string | null, input: z.input<typeof roundSchema>) {
  return run<CompanyRow>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const rid = roundId === null ? null : id.parse(roundId);
    const p = roundSchema.parse(input);
    const data = {
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
      await audit(tx, cid, me.id, [{ note: "Removed investment " + roundText({ round: r.round, amount: Number(r.amount), date }) }]);
      return getRow(cid, tx);
    });
  });
}

// ─── Valuation marks ─────────────────────────────────────────────────────────

export async function addMark(companyId: string, input: z.input<typeof markSchema>) {
  return run<CompanyRow>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const p = markSchema.parse(input);
    return db.$transaction(async (tx) => {
      await investedCompany(tx, cid);
      await tx.valuationMark.create({
        data: {
          companyId: cid,
          date: day(p.date),
          valuation: r2(p.valuation),
          stakePct: r4(p.stakePct),
          source: p.source,
          note: p.note || null,
          createdById: me.id,
        },
      });
      await audit(tx, cid, me.id, [
        { note: `Added valuation mark (${p.source}): company ${fmtCr(r2(p.valuation))}, our stake ${r4(p.stakePct)}%, as of ${fmtDate(p.date)}` },
      ]);
      return getRow(cid, tx);
    });
  });
}

export async function deleteMark(companyId: string, markId: string) {
  return run<CompanyRow>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const mid = id.parse(markId);
    return db.$transaction(async (tx) => {
      await investedCompany(tx, cid);
      const m = await tx.valuationMark.findFirst({ where: { id: mid, companyId: cid } });
      if (!m) throw new UserError("That valuation no longer exists. Reload the page.");
      await tx.valuationMark.delete({ where: { id: mid } });
      await audit(tx, cid, me.id, [
        { note: `Removed valuation mark: company ${fmtCr(Number(m.valuation))} as of ${fmtDate(dateToISO(m.date) ?? "")}` },
      ]);
      return getRow(cid, tx);
    });
  });
}
