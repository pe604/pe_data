import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { canonicalRead, fmtScore, parseRead, readCompany, sameCompanyName, storedReadZ, type Read, type ReadContext, type Reason, type StoredRead } from "@/lib/domain/read";
import { companyThemes, themeOptions } from "@/lib/domain/thesis";
import type { Prisma } from "@/generated/prisma/client";
import { UserError } from "./action";
import { audit } from "./company";
import { currentThesis } from "./thesis";

// Loading an analyst read (SPEC §17.11). One function for every way in: the route, the Read tab's file picker (via the
// route) and scripts/read-import.mts. A read holds deck figures: nothing here logs it. Ids, counts and codes only.

/** A refused read: the reasons, safe to show (paths and codes, never the read's text). */
export class ReadRefused extends UserError {
  constructor(public reasons: Reason[]) {
    super(reasons.map((r) => r.message).join(" "));
  }
}

export interface LoadedRead {
  id: string;
  companyId: string;
  /** False when this exact read was already the one shown */
  changed: boolean;
}

/** The current thesis codes a read is checked against, plus theme names for the audit line. */
export async function readContext(): Promise<ReadContext & { version: number | null; themeName: (code: string | null) => string | null }> {
  const [rows, latest] = await Promise.all([currentThesis(), db.thesisVersion.findFirst({ orderBy: { version: "desc" }, select: { version: true } })]);
  const themes = companyThemes(themeOptions(rows));
  return {
    principleCodes: rows.filter((r) => r.kind === "PRINCIPLE").map((r) => r.code),
    themeCodes: themes.map((t) => t.code),
    version: latest?.version ?? null,
    themeName: (code) => (code ? `${code} ${themes.find((t) => t.code === code)?.name ?? ""}`.trim() : null),
  };
}

export const readHash = (read: Read) => createHash("sha256").update(canonicalRead(read)).digest("hex");

/**
 * Checks and stores one read (SPEC §17.11):
 * 1. readZ and the code checks of §17.6 and §17.7; any failure refuses the whole read (ReadRefused).
 * 2. `company` must match exactly one Pipeline or Rejected company, ignoring case and outer spaces.
 * 3. Principle and theme codes must be in the current thesis (part of the checks in 1).
 * 4. One transaction: the AnalystRead (stored once per company and content), activeReadId, the theme when no person has
 *    set it (null included), the sweet spot check carried over, and the audit row.
 */
export async function loadRead(input: unknown, actorId: string, ctxIn?: Awaited<ReturnType<typeof readContext>>): Promise<LoadedRead> {
  const ctx = ctxIn ?? (await readContext());
  if (ctx.version === null) throw new UserError("Load the thesis before loading reads.");
  const p = parseRead(input, ctx);
  if (!p.ok) throw new ReadRefused(p.reasons);
  const read = p.read;

  const candidates = await db.company.findMany({ where: { status: { in: ["PIPELINE", "REJECTED"] } }, select: { id: true, name: true } });
  const matches = candidates.filter((c) => sameCompanyName(c.name, read.company));
  if (!matches.length) throw new ReadRefused([{ code: "NO_COMPANY", at: "company", message: "No pipeline or rejected company has that name. Check the name matches the dashboard exactly." }]);
  if (matches.length > 1) throw new ReadRefused([{ code: "SEVERAL_COMPANIES", at: "company", message: `${matches.length} pipeline or rejected companies have that name. Rename one so the read can find its company.` }]);
  const companyId = matches[0]?.id ?? "";
  const hash = readHash(read);
  const version = ctx.version;

  return db.$transaction(async (tx) => {
    // One load at a time per company, so two loads cannot both carry over or both write the audit row.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"read:" + companyId}))`;
    const c = await tx.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { themeCode: true, themeEdited: true, activeReadId: true, activeRead: { select: { body: true } } },
    });
    const prev = c.activeRead ? storedReadZ.safeParse(c.activeRead.body) : null;
    const sweetCheck = prev?.success ? (prev.data.sweetCheck ?? null) : null;

    const existing = await tx.analystRead.findUnique({ where: { companyId_hash: { companyId, hash } }, select: { id: true } });
    if (existing && existing.id === c.activeReadId) return { id: existing.id, companyId, changed: false };

    let id: string;
    if (existing) {
      id = existing.id;
      if (sweetCheck) {
        const old = storedReadZ.parse((await tx.analystRead.findUniqueOrThrow({ where: { id }, select: { body: true } })).body);
        await tx.analystRead.update({ where: { id }, data: { body: { ...old, sweetCheck } as unknown as Prisma.InputJsonValue } });
      }
    } else {
      const body: StoredRead = { ...read, sweetCheck };
      const created = await tx.analystRead.create({
        data: {
          companyId,
          thesisVersion: version,
          overall: read.overall.score,
          confidence: read.overall.confidence,
          body: body as unknown as Prisma.InputJsonValue,
          hash,
          readAt: new Date(`${read.readAt}T00:00:00Z`),
          author: read.author,
          loadedById: actorId,
        },
        select: { id: true },
      });
      id = created.id;
    }

    const theme = !c.themeEdited && c.themeCode !== read.theme.code ? read.theme.code : undefined;
    await tx.company.update({ where: { id: companyId }, data: { activeReadId: id, ...(theme !== undefined ? { themeCode: theme } : {}) } });
    await audit(tx, companyId, actorId, [
      { note: `Read loaded: ${fmtScore(read.overall.score)} out of 10` },
      ...(theme !== undefined ? [{ field: "theme", from: ctx.themeName(c.themeCode), to: ctx.themeName(theme) }] : []),
    ]);
    return { id, companyId, changed: true };
  });
}

/** One result per read for the route and the file picker: never the read itself. */
export type LoadResult = { company: string | null; ok: true; id: string; companyId: string } | { company: string | null; ok: false; reasons: Reason[] };

/** Loads a list of reads one by one; one refused read does not stop the others. */
export async function loadReads(inputs: unknown[], actorId: string): Promise<LoadResult[]> {
  const ctx = await readContext();
  const out: LoadResult[] = [];
  for (const input of inputs) {
    const company = readCompany(input);
    try {
      const r = await loadRead(input, actorId, ctx);
      out.push({ company, ok: true, id: r.id, companyId: r.companyId });
    } catch (e) {
      if (e instanceof ReadRefused) out.push({ company, ok: false, reasons: e.reasons });
      else if (e instanceof UserError) out.push({ company, ok: false, reasons: [{ code: "NO_THESIS", at: "(read)", message: e.message }] });
      else {
        console.error("[reads] load failed", (e as { code?: string })?.code ?? (e as Error)?.name);
        out.push({ company, ok: false, reasons: [{ code: "FAILED", at: "(read)", message: "Could not save this read. Try again." }] });
      }
    }
  }
  return out;
}
