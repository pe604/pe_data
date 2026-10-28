// Indian financial-year quarters (Q1 Apr–Jun … Q4 Jan–Mar), the quarterly tracker and meeting helpers (SPEC §15).
// Pure: unit-tested in tests/unit/quarters.test.ts. Keys look like "FY27-Q2" (Jul–Sep 2026).
import { addDays } from "./dates";

const KEY = /^FY(\d{2})-Q([1-4])$/;

export const isQuarterKey = (k: string) => KEY.test(k);

/** Quarter containing a date. */
export function quarterOf(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const fy = (m >= 4 ? y + 1 : y) % 100;
  const q = m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4;
  return `FY${String(fy).padStart(2, "0")}-Q${q}`;
}

/** First and last day of a quarter. */
export function quarterRange(key: string): { start: string; end: string } {
  const m = KEY.exec(key);
  if (!m) throw new Error("bad quarter " + key);
  const fy = 2000 + Number(m[1]);
  const q = Number(m[2]);
  const startMonth = q === 4 ? 1 : 4 + (q - 1) * 3; // 1-based
  const year = q === 4 ? fy : fy - 1;
  const start = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const endMonth = startMonth + 2;
  const nextFirst = endMonth === 12 ? `${year + 1}-01-01` : `${year}-${String(endMonth + 1).padStart(2, "0")}-01`;
  return { start, end: addDays(nextFirst, -1) };
}

/** "FY27-Q2" → "Q2 FY27". */
export function quarterLabel(key: string): string {
  const m = KEY.exec(key);
  return m ? `Q${m[2]} FY${m[1]}` : key;
}

export function shiftQuarter(key: string, n: number): string {
  const { start } = quarterRange(key);
  const [y, mo] = start.split("-").map(Number);
  const months = y * 12 + (mo - 1) + n * 3;
  return quarterOf(`${Math.floor(months / 12)}-${String((months % 12) + 1).padStart(2, "0")}-15`);
}

/** The quarter whose results are being collected now: the last one that has ended. */
export const lastEndedQuarter = (today: string) => shiftQuarter(quarterOf(today), -1);

/** Picker options, newest first: the current quarter and `back` before it. */
export function quarterOptions(today: string, back = 8): string[] {
  const cur = quarterOf(today);
  return Array.from({ length: back + 1 }, (_, i) => shiftQuarter(cur, -i));
}

export const DEFAULT_MIS_DAYS = 45;

/** Default MIS due date: 45 days after quarter end. */
export const defaultMisDue = (key: string) => addDays(quarterRange(key).end, DEFAULT_MIS_DAYS);

/**
 * The results period for a quarter: the three months after it ends (when calls and visits about
 * those results happen). Q2 FY27 (Jul–Sep) → 1 Oct – 31 Dec 2026.
 */
export const resultsPeriod = (key: string) => quarterRange(shiftQuarter(key, 1));

// ─── Meetings ────────────────────────────────────────────────────────────────

export const MEETING_TYPES = ["Plant visit", "Management meeting", "Quarterly call", "Other"] as const;
export const MEETING_STATUSES = ["PLANNED", "DONE", "CANCELLED"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];
export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = { PLANNED: "Planned", DONE: "Done", CANCELLED: "Cancelled" };

export interface MeetingLite {
  date: string;
  status: MeetingStatus;
}

/** Planned but its date has passed: needs to be marked done (or cancelled). */
export const isOverdueMeeting = (m: MeetingLite, today: string) => m.status === "PLANNED" && m.date < today;

/** Meetings split for the portfolio list: overdue (oldest first), upcoming (soonest first), past (newest first). */
export function groupMeetings<T extends MeetingLite>(list: T[], today: string) {
  const overdue = list.filter((m) => isOverdueMeeting(m, today)).sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = list.filter((m) => m.status === "PLANNED" && m.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = list.filter((m) => m.status !== "PLANNED").sort((a, b) => b.date.localeCompare(a.date));
  return { overdue, upcoming, past };
}

/** "1 done · 1 planned" for meetings in a date range, or null when none. */
export function meetingSummary(list: MeetingLite[], from: string, to: string): string | null {
  const inRange = list.filter((m) => m.date >= from && m.date <= to && m.status !== "CANCELLED");
  if (!inRange.length) return null;
  const done = inRange.filter((m) => m.status === "DONE").length;
  const planned = inRange.length - done;
  return [done ? `${done} done` : "", planned ? `${planned} planned` : ""].filter(Boolean).join(" · ");
}

/** MIS cell state against a due date. The tracker no longer shows due dates (SPEC §15.2); kept for the data. */
export function misState(misAt: string | null, due: string, today: string): "received" | "overdue" | "pending" {
  if (misAt) return "received";
  return today > due ? "overdue" : "pending";
}

/** File types the tracker uploads for each column (all also on the server's allow-list). */
export const QUARTER_FILE_EXTS = {
  MIS: ["pdf", "xlsx", "xlsm", "xls", "csv"],
  RESULT_NOTE: ["pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "png", "jpg", "jpeg", "webp"],
} as const;

/**
 * Splits picked files (several, or a whole folder) into ones to upload and ones skipped: wrong type, hidden or
 * system files (".DS_Store", Office "~$" lock files), or empty.
 */
export function splitUploads<F extends { name: string; size: number }>(files: F[], kind: keyof typeof QUARTER_FILE_EXTS): { upload: F[]; skipped: F[] } {
  const ok = (f: F) => {
    if (!f.size || f.name.startsWith(".") || f.name.startsWith("~$")) return false;
    const ext = /\.([a-z0-9]+)$/i.exec(f.name)?.[1]?.toLowerCase() ?? "";
    return (QUARTER_FILE_EXTS[kind] as readonly string[]).includes(ext);
  };
  return { upload: files.filter(ok), skipped: files.filter((f) => !ok(f)) };
}
