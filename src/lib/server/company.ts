import "server-only";
import { db, type Tx } from "@/lib/db";
import { PERSON_ROLES, type PersonRole } from "@/lib/domain/constants";
import { dateToISO } from "@/lib/domain/dates";
import { nameKey, titleCase } from "@/lib/domain/names";
import type { CompanyRow, DashboardData, Me } from "@/lib/domain/types";
import { safeHref } from "@/lib/domain/onedrive";
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
} satisfies Prisma.CompanyInclude;

type RowSource = Prisma.CompanyGetPayload<{ include: typeof rowInclude }>;

export function toRow(c: RowSource): CompanyRow {
  const people = (role: PersonRole) =>
    c.people.filter((p) => p.role === role).map((p) => p.teamMember.name);
  const latest = c.comments[0];
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
    rejectReason: c.rejectReason,
    oneDriveUrl: safeHref(c.oneDriveUrl),
    pe: people("PE"),
    research: people("RESEARCH"),
    via: people("VIA"),
    latestComment: latest
      ? { text: latest.text, author: latest.author.name, at: latest.createdAt.toISOString() }
      : null,
    commentCount: c.comments.length,
    fileCount: c._count.files,
    commentSearch: c.comments.map((x) => x.text).join("\n").toLowerCase(),
  };
}

export async function getRow(id: string, tx: Tx | typeof db = db): Promise<CompanyRow> {
  const c = await tx.company.findUniqueOrThrow({ where: { id }, include: rowInclude });
  return toRow(c);
}

export async function loadDashboard(me: Me): Promise<DashboardData> {
  const [companies, sectors, team, peLog] = await Promise.all([
    db.company.findMany({ include: rowInclude }),
    db.sector.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.teamMember.findMany({ orderBy: { name: "asc" } }),
    db.auditLog.findFirst({
      where: { companyId: null, field: "peTeam" },
      orderBy: { at: "desc" },
      include: { actor: { select: { name: true } } },
    }),
  ]);
  return {
    companies: companies.map(toRow),
    sectors: sectors.map((s) => ({ id: s.id, name: s.name })),
    team: team.map((t) => ({ id: t.id, name: t.name, peRank: t.peRank })),
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

/** Finds or creates TeamMembers (Title Case, case-insensitive unique). Returns ids in input order. */
export async function ensureTeamMembers(tx: Tx, names: string[]): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const key = nameKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const m = await tx.teamMember.upsert({
      where: { nameKey: key },
      create: { name: titleCase(raw), nameKey: key },
      update: {},
    });
    out.push({ id: m.id, name: m.name });
  }
  return out;
}

export async function replacePeople(tx: Tx, companyId: string, role: PersonRole, names: string[]) {
  const members = await ensureTeamMembers(tx, names);
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
