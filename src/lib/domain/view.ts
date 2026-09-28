// Filtering, sorting and URL state for the dashboard (SPEC §5, §6.2). Pure and client-safe.
import { STAGES, stageIndex, type Stage, type Status } from "./constants";
import { daysFor, todayISO } from "./dates";
import type { CompanyRow } from "./types";

export type Tab = "pipeline" | "rejected" | "invested";
export const TAB_STATUS: Record<Tab, Status> = {
  pipeline: "PIPELINE",
  rejected: "REJECTED",
  invested: "INVESTED",
};

export type SetKey = "priority" | "stage" | "sector" | "pe" | "research" | "via" | "onedrive";
export const SET_KEYS: SetKey[] = ["priority", "stage", "sector", "pe", "research", "via", "onedrive"];

export interface Filters {
  q: string;
  from: string;
  to: string;
  priority: string[]; // "1".."5" | "unset"
  stage: string[]; // Stage values
  sector: string[]; // sector names
  pe: string[];
  research: string[];
  via: string[];
  onedrive: string[]; // "linked" | "missing"
}

export const emptyFilters = (): Filters => ({
  q: "",
  from: "",
  to: "",
  priority: [],
  stage: [],
  sector: [],
  pe: [],
  research: [],
  via: [],
  onedrive: [],
});

export const SORTS = [
  ["priority", "Priority 1 → 5"],
  ["priority-desc", "Priority 5 → 1"],
  ["date-new", "Newest received"],
  ["date-old", "Oldest received"],
  ["days-most", "Most days waiting"],
  ["days-least", "Fewest days waiting"],
  ["stage", "Stage, earliest first"],
  ["stage-rev", "Stage, latest first"],
  ["name-az", "Company A–Z"],
  ["name-za", "Company Z–A"],
  ["sector-az", "Sector A–Z"],
  ["sector-za", "Sector Z–A"],
] as const;
export type SortKey = (typeof SORTS)[number][0];
export const DEFAULT_SORT: SortKey = "priority";

/** Column header → [first click, second click]. */
export const HEADER_SORTS: Record<string, [SortKey, SortKey]> = {
  co: ["name-az", "name-za"],
  sector: ["sector-az", "sector-za"],
  stage: ["stage", "stage-rev"],
  pri: ["priority", "priority-desc"],
  date: ["date-new", "date-old"],
  days: ["days-most", "days-least"],
};

export function activeFilterCount(f: Filters): number {
  return (
    (f.q ? 1 : 0) +
    (f.from || f.to ? 1 : 0) +
    SET_KEYS.reduce((n, k) => n + f[k].length, 0)
  );
}

/** Apply every filter except `skip` (for cross-filtered bar counts). */
export function applyFilters(list: CompanyRow[], f: Filters, skip?: "stage" | "pe"): CompanyRow[] {
  let out = list;
  if (f.q) {
    const q = f.q.toLowerCase();
    out = out.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.sector ?? "").toLowerCase().includes(q) ||
        (c.subSector ?? "").toLowerCase().includes(q) ||
        c.commentSearch.includes(q) ||
        (c.rejectReason ?? "").toLowerCase().includes(q),
    );
  }
  if (f.from) out = out.filter((c) => !!c.dateReceived && c.dateReceived >= f.from);
  if (f.to) out = out.filter((c) => !!c.dateReceived && c.dateReceived <= f.to);
  if (f.priority.length) out = out.filter((c) => f.priority.includes(c.priority ? String(c.priority) : "unset"));
  if (skip !== "stage" && f.stage.length) out = out.filter((c) => f.stage.includes(c.stage));
  if (f.sector.length) out = out.filter((c) => f.sector.includes(c.sector ?? ""));
  if (f.onedrive.length) out = out.filter((c) => f.onedrive.includes(c.oneDriveUrl ? "linked" : "missing"));
  for (const k of ["pe", "research", "via"] as const) {
    if (k === "pe" && skip === "pe") continue;
    if (f[k].length) out = out.filter((c) => c[k].some((n) => f[k].includes(n)));
  }
  return out;
}

/** Stage shown for sorting: the exit stage for exited companies, direct-invested last. */
function sortStage(c: CompanyRow): number {
  if (c.status === "PIPELINE") return stageIndex(c.stage);
  if (c.directInvested) return STAGES.length;
  return stageIndex(c.exitStage ?? c.stage);
}

export function sortRows(list: CompanyRow[], s: SortKey, today = todayISO()): CompanyRow[] {
  const out = list.slice();
  const newest = (a: CompanyRow, b: CompanyRow) => (b.dateReceived ?? "").localeCompare(a.dateReceived ?? "");
  const pr = (c: CompanyRow, desc: boolean) => (c.priority ? (desc ? 6 - c.priority : c.priority) : 9);
  // Blank values always last, whichever direction.
  const blanksLast = <T>(get: (c: CompanyRow) => T | null, cmp: (x: T, y: T) => number) =>
    (a: CompanyRow, b: CompanyRow) => {
      const x = get(a);
      const y = get(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return cmp(x, y);
    };
  const str = (x: string, y: string) => x.localeCompare(y, undefined, { sensitivity: "base" });
  const num = (x: number, y: number) => x - y;
  const days = (c: CompanyRow) => daysFor(c, today);
  switch (s) {
    case "priority":
      return out.sort((a, b) => pr(a, false) - pr(b, false) || newest(a, b));
    case "priority-desc":
      return out.sort((a, b) => pr(a, true) - pr(b, true) || newest(a, b));
    case "date-new":
      return out.sort(blanksLast((c) => c.dateReceived, (x, y) => y.localeCompare(x)));
    case "date-old":
      return out.sort(blanksLast((c) => c.dateReceived, (x, y) => x.localeCompare(y)));
    case "days-most":
      return out.sort(blanksLast(days, (x, y) => y - x));
    case "days-least":
      return out.sort(blanksLast(days, num));
    case "stage":
      return out.sort((a, b) => sortStage(a) - sortStage(b));
    case "stage-rev":
      return out.sort((a, b) => sortStage(b) - sortStage(a));
    case "name-az":
      return out.sort((a, b) => str(a.name, b.name));
    case "name-za":
      return out.sort((a, b) => str(b.name, a.name));
    case "sector-az":
      return out.sort(blanksLast((c) => c.sector || null, str));
    case "sector-za":
      return out.sort(blanksLast((c) => c.sector || null, (x, y) => str(y, x)));
  }
  return out;
}

// ─── URL state ───────────────────────────────────────────────────────────────

export interface ViewState {
  tab: Tab;
  sort: SortKey;
  f: Filters;
}

export function viewToQuery(v: ViewState): string {
  const p = new URLSearchParams();
  if (v.tab !== "pipeline") p.set("tab", v.tab);
  if (v.sort !== DEFAULT_SORT) p.set("sort", v.sort);
  if (v.f.q) p.set("q", v.f.q);
  if (v.f.from) p.set("from", v.f.from);
  if (v.f.to) p.set("to", v.f.to);
  for (const k of SET_KEYS) for (const x of v.f[k]) p.append(k, x);
  const s = p.toString();
  return s ? "?" + s : "";
}

export function queryToView(search: string | URLSearchParams): ViewState {
  const p = typeof search === "string" ? new URLSearchParams(search) : search;
  const tab = (["pipeline", "rejected", "invested"] as const).find((t) => t === p.get("tab")) ?? "pipeline";
  const sort = SORTS.find(([k]) => k === p.get("sort"))?.[0] ?? DEFAULT_SORT;
  const f = emptyFilters();
  f.q = p.get("q") ?? "";
  f.from = p.get("from") ?? "";
  f.to = p.get("to") ?? "";
  for (const k of SET_KEYS) f[k] = p.getAll(k);
  f.stage = f.stage.filter((s) => (STAGES as readonly string[]).includes(s)) as Stage[];
  return { tab, sort, f };
}
