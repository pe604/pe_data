"use server";

// The analyst read's actions (SPEC §17.9–17.11). Every one starts with requireRole() and a zod schema.
// A read is returned to the page only; never logged. Loading a read goes through POST /api/reads.
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { fmtHalf, isTeamKey, MIN_REASON, SCORE_NAMES, storedReadZ, TEAM_KEYS, teamScoreZ, type StoredRead, type TeamKey } from "@/lib/domain/read";
import type { CompanyRow } from "@/lib/domain/types";
import { run, UserError } from "@/lib/server/action";
import { audit, getRow } from "@/lib/server/company";
import { currentThesis } from "@/lib/server/thesis";
import type { Prisma } from "@/generated/prisma/client";

const id = z.string().min(1).max(40);

export interface TeamScoreItem {
  key: TeamKey;
  score: number;
  reason: string;
  by: string;
  at: string;
}

export interface ReadView {
  id: string;
  read: StoredRead;
  thesisVersion: number;
  thesisLabel: string;
  loadedBy: string;
  loadedAt: string;
}

export interface EarlierRead {
  id: string;
  readAt: string;
  overall: number;
  loadedBy: string;
  loadedAt: string;
}

export interface ReadDetail {
  active: ReadView | null;
  earlier: EarlierRead[];
  team: TeamScoreItem[];
  /** Current principle code → text, for "Against the thesis" */
  principles: Record<string, string>;
}

type ReadRecord = Prisma.AnalystReadGetPayload<{ include: { loadedBy: { select: { name: true } } } }>;

async function view(r: ReadRecord): Promise<ReadView> {
  const label = (await db.thesisVersion.findUnique({ where: { version: r.thesisVersion } }))?.label ?? String(r.thesisVersion);
  return { id: r.id, read: storedReadZ.parse(r.body), thesisVersion: r.thesisVersion, thesisLabel: label, loadedBy: r.loadedBy.name, loadedAt: r.loadedAt.toISOString() };
}

/** Everything the Read tab shows (SPEC §17.10). */
export async function getReadDetail(companyId: string) {
  return run<ReadDetail>(async () => {
    await requireRole();
    const cid = id.parse(companyId);
    const c = await db.company.findUnique({
      where: { id: cid },
      select: {
        activeRead: { include: { loadedBy: { select: { name: true } } } },
        reads: { orderBy: { loadedAt: "desc" }, select: { id: true, readAt: true, overall: true, loadedAt: true, loadedBy: { select: { name: true } } } },
        fitInputs: { where: { code: { in: [...TEAM_KEYS] } }, include: { by: { select: { name: true } } }, orderBy: { at: "asc" } },
      },
    });
    if (!c) throw new UserError("That company no longer exists. Reload the page.");
    const rows = await currentThesis();
    return {
      active: c.activeRead ? await view(c.activeRead) : null,
      earlier: c.reads
        .filter((r) => r.id !== c.activeRead?.id)
        .map((r) => ({ id: r.id, readAt: r.readAt.toISOString().slice(0, 10), overall: Number(r.overall), loadedBy: r.loadedBy.name, loadedAt: r.loadedAt.toISOString() })),
      team: c.fitInputs.flatMap((i) => (isTeamKey(i.code) ? [{ key: i.code, score: Number(i.score), reason: i.reason, by: i.by.name, at: i.at.toISOString() }] : [])),
      principles: Object.fromEntries(rows.flatMap((r) => (r.kind === "PRINCIPLE" ? [[r.code, r.data.text]] : []))),
    };
  });
}

/** An earlier read, shown read-only. */
export async function getEarlierRead(companyId: string, readId: string) {
  return run<ReadView>(async () => {
    await requireRole();
    const r = await db.analystRead.findFirst({ where: { id: id.parse(readId), companyId: id.parse(companyId) }, include: { loadedBy: { select: { name: true } } } });
    if (!r) throw new UserError("That read no longer exists.");
    return view(r);
  });
}

/** A team score on one of the five or the overall (SPEC §17.9). Survives a new read. */
export async function setReadInput(companyId: string, key: string, score: number, reason: string) {
  return run<CompanyRow>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const parsed = teamScoreZ.safeParse({ key, score, reason });
    if (!parsed.success) throw new UserError(parsed.error.issues[0]?.message ?? "That value is not valid.");
    const p = parsed.data;
    return db.$transaction(async (tx) => {
      const c = await tx.company.findUniqueOrThrow({ where: { id: cid }, select: { activeReadId: true } });
      if (!c.activeReadId) throw new UserError("Load a read before setting a team score.");
      const before = await tx.fitInput.findUnique({ where: { companyId_code: { companyId: cid, code: p.key } } });
      await tx.fitInput.upsert({
        where: { companyId_code: { companyId: cid, code: p.key } },
        create: { companyId: cid, code: p.key, score: p.score, reason: p.reason, kind: "TEAM", byId: me.id },
        update: { score: p.score, reason: p.reason, kind: "TEAM", byId: me.id, at: new Date() },
      });
      const was = before && isTeamKey(before.code) && before.kind === "TEAM" ? ` (was ${fmtHalf(Number(before.score))})` : "";
      await audit(tx, cid, me.id, [{ note: `Read: ${SCORE_NAMES[p.key].toLowerCase()} set to ${fmtHalf(p.score)}${was}. ${p.reason}` }]);
      return getRow(cid, tx);
    });
  });
}

/** Removes a team score: the read's score stands again (SPEC §17.9). */
export async function removeReadInput(companyId: string, key: string) {
  return run<CompanyRow>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const k = z.enum(TEAM_KEYS).parse(key);
    return db.$transaction(async (tx) => {
      const r = await tx.fitInput.deleteMany({ where: { companyId: cid, code: k } });
      if (r.count) await audit(tx, cid, me.id, [{ note: `Read: ${SCORE_NAMES[k].toLowerCase()} team score removed, back to the read's score` }]);
      return getRow(cid, tx);
    });
  });
}

/** Marks the sweet spot as checked, with a note (SPEC §17.8, H01). Kept on the read and carried to later reads. */
export async function checkSweetSpot(companyId: string, note: string) {
  return run<CompanyRow>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const n = z.string().trim().min(MIN_REASON, `Say how it was checked, in at least ${MIN_REASON} characters.`).max(1000).safeParse(note);
    if (!n.success) throw new UserError(n.error.issues[0]?.message ?? "That value is not valid.");
    return db.$transaction(async (tx) => {
      const c = await tx.company.findUniqueOrThrow({ where: { id: cid }, select: { activeRead: { select: { id: true, body: true } } } });
      const r = c.activeRead;
      const body = r ? storedReadZ.parse(r.body) : null;
      if (!r || !body?.highlights.some((h) => h.code === "H01")) throw new UserError("This company has no sweet spot to check.");
      const next: StoredRead = { ...body, sweetCheck: { note: n.data, by: me.name, at: new Date().toISOString() } };
      await tx.analystRead.update({ where: { id: r.id }, data: { body: next as unknown as Prisma.InputJsonValue } });
      await audit(tx, cid, me.id, [{ note: `Sweet spot marked as checked. ${n.data}` }]);
      return getRow(cid, tx);
    });
  });
}
