// Name matching: team member autofill (SPEC §6.3) and company duplicate detection (SPEC §7.4).

export const norm = (s: string | null | undefined) =>
  String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Key used for case-insensitive TeamMember uniqueness. */
export const nameKey = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function titleCase(s: string): string {
  return s.trim().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Rank team member names for a query: prefix (incl. first name), then substring,
 * then Levenshtein ≤1 (≤2 for 4+ characters). Empty query returns A–Z.
 */
export function rankNames(q: string, pool: string[]): string[] {
  const nq = norm(q);
  if (!nq) return pool.slice().sort((a, b) => a.localeCompare(b));
  const scored: [number, string][] = [];
  for (const n of pool) {
    const nn = norm(n);
    const first = norm(n.split(/\s+/)[0]);
    let s = 99;
    if (nn.startsWith(nq) || first.startsWith(nq)) s = 0;
    else if (nn.includes(nq)) s = 1;
    else {
      const d = Math.min(levenshtein(nq, nn), levenshtein(nq, first), levenshtein(nq, nn.slice(0, nq.length)));
      if (d <= 1) s = 2;
      else if (d <= 2 && nq.length >= 4) s = 3;
    }
    if (s < 99) scored.push([s, n]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1])).map((x) => x[1]);
}

/** Company name normalisation for duplicate detection. */
export function normCompany(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\b(private|pvt|limited|ltd|llp|inc|india|the)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function isDuplicateName(a: string, b: string): boolean {
  const x = normCompany(a);
  const y = normCompany(b);
  if (x.length < 2 || y.length < 2) return false;
  return x === y || (x.length >= 5 && levenshtein(x, y) <= 1);
}

export function findDuplicate<T extends { id: string; name: string }>(
  name: string,
  list: T[],
  exceptId?: string,
): T | null {
  return list.find((c) => c.id !== exceptId && isDuplicateName(name, c.name)) ?? null;
}

/** Bulk-add parsing: strip leading bullets and numbering, drop blanks. */
export function parseBulkNames(text: string): string[] {
  return String(text || "")
    .split(/\r?\n/)
    .map((x) => x.replace(/^[\s\-•*\d.)]+/, "").trim())
    .filter(Boolean);
}
