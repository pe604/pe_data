"use server";

import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { nameKey, titleCase } from "@/lib/domain/names";
import type { CommentItem, CompanyRow, SectorOption, TeamMemberOption } from "@/lib/domain/types";
import { run, UserError } from "@/lib/server/action";
import { audit, ensureTeamMembers, getRow, listText } from "@/lib/server/company";

const id = z.string().min(1).max(40);

// ─── Comments ────────────────────────────────────────────────────────────────

export async function addComment(companyId: string, text: string) {
  return run<{ row: CompanyRow; comment: CommentItem }>(async () => {
    const me = await requireRole();
    const cid = id.parse(companyId);
    const t = z.string().trim().min(1).max(5000).parse(text);
    const c = await db.comment.create({ data: { companyId: cid, text: t, authorId: me.id } });
    return {
      row: await getRow(cid),
      comment: { id: c.id, text: c.text, author: me.name, authorId: me.id, createdAt: c.createdAt.toISOString(), editedAt: null },
    };
  });
}

export async function editComment(commentId: string, text: string) {
  return run<{ row: CompanyRow }>(async () => {
    const me = await requireRole();
    const cmId = id.parse(commentId);
    const t = z.string().trim().min(1).max(5000).parse(text);
    return db.$transaction(async (tx) => {
      const c = await tx.comment.update({ where: { id: cmId }, data: { text: t, editedAt: new Date() } });
      await audit(tx, c.companyId, me.id, [{ note: "Edited a comment" }]);
      return { row: await getRow(c.companyId, tx) };
    });
  });
}

// ─── PE team (SPEC §5.4) ─────────────────────────────────────────────────────

export async function saveTeamOrder(names: string[]) {
  return run<{ team: TeamMemberOption[]; peMeta: { by: string; at: string } }>(async () => {
    const me = await requireRole();
    const list = z.array(z.string().trim().min(1).max(60)).max(50).parse(names);
    return db.$transaction(async (tx) => {
      const before = await tx.teamMember.findMany({ where: { peRank: { not: null } }, orderBy: { peRank: "asc" } });
      const members = await ensureTeamMembers(tx, list);
      await tx.teamMember.updateMany({ where: { peRank: { not: null } }, data: { peRank: null } });
      for (const [i, m] of members.entries()) {
        await tx.teamMember.update({ where: { id: m.id }, data: { peRank: i } });
      }
      await audit(tx, null, me.id, [
        { field: "peTeam", from: listText(before.map((b) => b.name)) ?? "empty", to: listText(members.map((m) => m.name)) ?? "empty" },
      ]);
      const team = await tx.teamMember.findMany({ orderBy: { name: "asc" } });
      return {
        team: team.map((t) => ({ id: t.id, name: t.name, peRank: t.peRank })),
        peMeta: { by: me.name, at: new Date().toISOString() },
      };
    });
  });
}

// ─── Sectors (admin adds) ────────────────────────────────────────────────────

export async function addSector(name: string) {
  return run<{ sector: SectorOption; sectors: SectorOption[] }>(async () => {
    const me = await requireRole("ADMIN");
    const n = titleCase(z.string().trim().min(1).max(80).parse(name));
    const all = await db.sector.findMany();
    const existing = all.find((s) => nameKey(s.name) === nameKey(n));
    let sector = existing;
    if (!sector) {
      // sortOrder 0 + name ordering keeps the list A–Z; "Other" has 1000 so it stays last.
      sector = await db.sector.create({ data: { name: n, sortOrder: 0 } });
      await db.$transaction((tx) => audit(tx, null, me.id, [{ note: `Added sector ${n}` }]));
    }
    const sectors = await db.sector.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    if (!sector) throw new UserError("Could not add that sector.");
    return { sector: { id: sector.id, name: sector.name }, sectors: sectors.map((s) => ({ id: s.id, name: s.name })) };
  });
}
