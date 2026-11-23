import "server-only";
import { db } from "@/lib/db";
import { thesisRowZ, type StoredThesisRow } from "@/lib/domain/thesis";

// Reading the thesis (SPEC §17.1). Rows are validated on the way out; a row that fails is left out and logged by code.

export interface ThesisVersionInfo {
  version: number;
  label: string;
  note: string;
  createdAt: string;
}

function parse(rows: Awaited<ReturnType<typeof db.thesisRow.findMany>>): StoredThesisRow[] {
  const out: StoredThesisRow[] = [];
  for (const r of rows) {
    const p = thesisRowZ.safeParse({ kind: r.kind, code: r.code, data: r.data, evidence: r.evidence, decision: r.decision });
    if (p.success) out.push({ ...p.data, id: r.id, fromVersion: r.fromVersion, toVersion: r.toVersion });
    else console.error("[thesis] invalid row", r.id);
  }
  return out;
}

/** The current rows (toVersion null). */
export async function currentThesis(): Promise<StoredThesisRow[]> {
  return parse(await db.thesisRow.findMany({ where: { toVersion: null }, orderBy: [{ kind: "asc" }, { code: "asc" }] }));
}

/** The rows as they stood at `version`. */
export async function thesisAt(version: number): Promise<StoredThesisRow[]> {
  return parse(
    await db.thesisRow.findMany({
      where: { fromVersion: { lte: version }, OR: [{ toVersion: null }, { toVersion: { gt: version } }] },
      orderBy: [{ kind: "asc" }, { code: "asc" }],
    }),
  );
}

export async function thesisVersions(): Promise<ThesisVersionInfo[]> {
  const rows = await db.thesisVersion.findMany({ orderBy: { version: "desc" } });
  return rows.map((v) => ({ version: v.version, label: v.label, note: v.note, createdAt: v.createdAt.toISOString() }));
}
