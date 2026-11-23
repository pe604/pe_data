import "server-only";
import { db, type Tx } from "@/lib/db";
import { PERSON_ROLES, type PersonRole } from "@/lib/domain/constants";
import { dateToISO } from "@/lib/domain/dates";
import { nameKey, titleCase } from "@/lib/domain/names";
import type { CompanyRow, DashboardData, Me, TeamMemberOption } from "@/lib/domain/types";
import { safeHref } from "@/lib/domain/onedrive";
import { FUNDS, holdingOf, type Fund } from "@/lib/domain/portfolio";
import { themeOptions } from "@/lib/domain/thesis";
import { highlightsOf, readStale, storedReadZ, type Confidence } from "@/lib/domain/read";
import { todayISO } from "@/lib/domain/dates";
import { currentThesis } from "@/lib/server/thesis";

/** DB text → Fund (null for rounds entered before funds existed). */
export const asFund = (f: string | null): Fund | null => (FUNDS as readonly string[]).includes(f ?? "") ? (f as Fund) : null;
import { aiConfigured, env } from "@/lib/env";
import type { Prisma } from "@/generated/prisma/client";

export const rowInclude = {
  sector: { select: { name: true } },
  people: { include: { teamMember: { select: { name: true } } }, orderBy: { position: "asc" } },
  comments: {
    select: { text: true, createdAt: true, author: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  },
  _count: { select: { files: true } },
  rounds: { select: { date: true, amount: true, fund: true } },
  // Newest first: the latest shows in the Invested table; all are searchable.
  updates: {
    select: { date: true, text: true, createdBy: { select: { name: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  },
  // Analyst read (SPEC §17.10): the numbers only; the body is read here for its highlights and never sent to the table.
  activeRead: { select: { overall: true, confidence: true, readAt: true, loadedAt: true, thesisVersion: true, body: true } },
  // The team's overall score (SPEC §17.9). Version 1 codes (F1 to P5) are ignored.
  fitInputs: { where: { code: "OVERALL" }, select: { score: true } },
  // The newest deck, for staleness and the waiting list (SPEC §17.3, §17.7).
  files: { where: { kind: "DECK" }, select: { uploadedAt: true }, orderBy: { uploadedAt: "desc" }, take: 1 },
} satisfies Prisma.CompanyInclude;

/** What a row needs beyond the company: the current thesis version and priority themes, and today (Asia/Kolkata). */
export interface RowContext {
  thesisVersion: number | null;
  priorityThemes: Set<string>;
  today: string;
}

export async function rowContext(tx: Tx | typeof db = db): Promise<RowContext> {
  const [latest, themes] = await Promise.all([
    tx.thesisVersion.findFirst({ orderBy: { version: "desc" }, select: { version: true } }),
    tx.thesisRow.findMany({ where: { kind: "THEME", toVersion: null }, select: { code: true, data: true } }),
  ]);
  return {
    thesisVersion: latest?.version ?? null,
    priorityThemes: new Set(themes.filter((t) => (t.data as { priority?: unknown } | null)?.priority === true).map((t) => t.code)),
    today: todayISO(),
  };
}

/** Prisma Decimal | null → number | null. */
export const num = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d));

type RowSource = Prisma.CompanyGetPayload<{ include: typeof rowInclude }>;

export function toRow(c: RowSource, ctx: RowContext): CompanyRow {
  const people = (role: PersonRole) =>
    c.people.filter((p) => p.role === role).map((p) => p.teamMember.name);
  const latest = c.comments[0];
  const r = c.activeRead;
  const parsed = r ? storedReadZ.safeParse(r.body) : null;
  const body = parsed?.success ? parsed.data : null;
  const lastDeck = c.files[0]?.uploadedAt ?? null;
  return {
    id: c.id,
    name: c.name,
    sectorId: c.sectorId,
    sector: c.sector?.name ?? null,
    subSector: c.subSector,
    stage: c.stage,
    priority: c.priority,
    status: c.status,
    dateReceived: dateToISO(c.dateReceived),
    exitAt: dateToISO(c.exitAt),
    exitStage: c.exitStage,
    directInvested: c.directInvested,
    holding:
      c.status === "INVESTED"
        ? holdingOf(c.rounds.map((r) => ({ date: dateToISO(r.date) ?? "", amount: Number(r.amount), fund: asFund(r.fund) })))
        : null,
    rejectReason: c.rejectReason,
    oneDriveUrl: safeHref(c.oneDriveUrl),
    pe: people("PE"),
    research: people("RESEARCH"),
    via: people("VIA"),
    latestComment: latest
      ? { text: latest.text, author: latest.author.name, at: latest.createdAt.toISOString() }
      : null,
    commentCount: c.comments.length,
    latestUpdate: c.updates[0] ? { text: c.updates[0].text, date: dateToISO(c.updates[0].date) ?? "", author: c.updates[0].createdBy.name } : null,
    updateCount: c.updates.length,
    fileCount: c._count.files,
    commentSearch: [...c.comments.map((x) => x.text), ...c.updates.map((u) => u.text)].join("\n").toLowerCase(),
    themeCode: c.themeCode,
    themeEdited: c.themeEdited,
    read: r
      ? {
          overall: Number(r.overall),
          team: c.fitInputs[0] ? Number(c.fitInputs[0].score) : null,
          confidence: r.confidence as Confidence,
          stale: readStale(
            { readAt: dateToISO(r.readAt) ?? ctx.today, loadedAt: r.loadedAt.toISOString(), thesisVersion: r.thesisVersion },
            { lastDeckAt: lastDeck?.toISOString() ?? null, thesisVersion: ctx.thesisVersion, today: ctx.today },
          ),
        }
      : null,
    highlights: c.status === "INVESTED" ? [] : highlightsOf(body, !!c.themeCode && ctx.priorityThemes.has(c.themeCode)),
    hasDeck: !!lastDeck,
  };
}

export async function getRow(id: string, tx: Tx | typeof db = db): Promise<CompanyRow> {
  const [c, ctx] = await Promise.all([tx.company.findUniqueOrThrow({ where: { id }, include: rowInclude }), rowContext(tx)]);
  return toRow(c, ctx);
}

export async function loadDashboard(me: Me): Promise<DashboardData> {
  const [companies, sectors, team, peLog, thesis, ctx] = await Promise.all([
    db.company.findMany({ include: rowInclude }),
    db.sector.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.teamMember.findMany({ orderBy: { name: "asc" } }),
    db.auditLog.findFirst({
      where: { companyId: null, field: "peTeam" },
      orderBy: { at: "desc" },
      include: { actor: { select: { name: true } } },
    }),
    currentThesis(),
    rowContext(),
  ]);
  return {
    companies: companies.map((c) => toRow(c, ctx)),
    sectors: sectors.map((s) => ({ id: s.id, name: s.name })),
    themes: themeOptions(thesis),
    team: team.map(toTeamOption),
    peMeta: peLog ? { by: peLog.actor.name, at: peLog.at.toISOString() } : null,
    me,
    aiEnabled: aiConfigured,
    maxUploadMb: env.MAX_UPLOAD_MB,
  };
}

// ─── Audit ───────────────────────────────────────────────────────────────────

export interface Change {
  field: string;
  from: string | null;
  to: string | null;
}

export async function audit(
  tx: Tx,
  companyId: string | null,
  actorId: string,
  entries: (Change | { note: string })[],
) {
  const rows = entries
    .filter((e) => ("note" in e ? true : (e.from ?? "") !== (e.to ?? "")))
    .map((e) =>
      "note" in e
        ? { companyId, actorId, note: e.note }
        : { companyId, actorId, field: e.field, fromValue: e.from, toValue: e.to },
    );
  if (rows.length) await tx.auditLog.createMany({ data: rows });
}

// ─── People ──────────────────────────────────────────────────────────────────

const LIST_FLAG = {
  PE: { inPe: true },
  RESEARCH: { inResearch: true },
  VIA: { inVia: true },
} as const satisfies Record<PersonRole, Prisma.TeamMemberUpdateInput>;

export const toTeamOption = (t: {
  id: string;
  name: string;
  peRank: number | null;
  inPe: boolean;
  inResearch: boolean;
  inVia: boolean;
}): TeamMemberOption => ({ id: t.id, name: t.name, peRank: t.peRank, inPe: t.inPe, inResearch: t.inResearch, inVia: t.inVia });

/**
 * Finds or creates TeamMembers (Title Case, case-insensitive unique) and adds them to `role`'s name list.
 * Returns them in input order.
 */
export async function ensureTeamMembers(
  tx: Tx,
  names: string[],
  role: PersonRole,
): Promise<{ id: string; name: string; peRank: number | null }[]> {
  const out: { id: string; name: string; peRank: number | null }[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const key = nameKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const m = await tx.teamMember.upsert({
      where: { nameKey: key },
      create: { name: titleCase(raw), nameKey: key, ...LIST_FLAG[role] },
      update: LIST_FLAG[role],
    });
    out.push({ id: m.id, name: m.name, peRank: m.peRank });
  }
  return out;
}

export async function replacePeople(tx: Tx, companyId: string, role: PersonRole, names: string[]) {
  const members = await ensureTeamMembers(tx, names, role);
  const previous = new Set(
    (await tx.companyPerson.findMany({ where: { companyId, role }, select: { teamMemberId: true } })).map((p) => p.teamMemberId),
  );
  // A name newly assigned as PE joins the end of the PE team bar. Names already on this company don't, so
  // someone removed from the bar via Manage isn't re-added just because this company's PE list was edited.
  if (role === "PE") {
    for (const m of members) {
      if (m.peRank !== null || previous.has(m.id)) continue;
      const max = (await tx.teamMember.aggregate({ _max: { peRank: true } }))._max.peRank ?? -1;
      await tx.teamMember.update({ where: { id: m.id }, data: { peRank: max + 1 } });
    }
  }
  await tx.companyPerson.deleteMany({ where: { companyId, role } });
  if (members.length) {
    await tx.companyPerson.createMany({
      data: members.map((m, i) => ({ companyId, teamMemberId: m.id, role, position: i })),
    });
  }
  return members.map((m) => m.name);
}

export async function peopleOf(tx: Tx, companyId: string) {
  const rows = await tx.companyPerson.findMany({
    where: { companyId },
    include: { teamMember: { select: { name: true } } },
    orderBy: { position: "asc" },
  });
  const by = Object.fromEntries(PERSON_ROLES.map((r) => [r, [] as string[]])) as Record<PersonRole, string[]>;
  for (const r of rows) by[r.role].push(r.teamMember.name);
  return by;
}

export const listText = (a: string[]) => (a.length ? a.join(", ") : null);
