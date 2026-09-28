// Calendar-date helpers. Dates are ISO "YYYY-MM-DD" strings in the Asia/Kolkata calendar.

export const APP_TIME_ZONE = "Asia/Kolkata";

const isoFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date in India, whatever the server or browser timezone. */
export function todayISO(now: Date = new Date()): string {
  return isoFmt.format(now);
}

const DAY_MS = 86_400_000;

function isoToUtcMs(iso: string): number {
  return Date.parse(iso + "T00:00:00Z");
}

export function addDays(iso: string, n: number): string {
  return new Date(isoToUtcMs(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from a to b (b defaults to today). Never negative. */
export function daysBetween(a: string | null, b?: string | null): number {
  if (!a) return 0;
  const x = isoToUtcMs(a);
  const y = isoToUtcMs(b || todayISO());
  if (Number.isNaN(x) || Number.isNaN(y)) return 0;
  return Math.max(0, Math.round((y - x) / DAY_MS));
}

/** Days waiting. Frozen at exitAt once a company leaves the pipeline. Null when no date. */
export function daysFor(c: {
  dateReceived: string | null;
  status: string;
  exitAt: string | null;
}, today?: string): number | null {
  if (!c.dateReceived) return null;
  const end = c.status !== "PIPELINE" && c.exitAt ? c.exitAt : today || todayISO();
  return daysBetween(c.dateReceived, end);
}

/** a1 ≤30, a2 31–60, a3 >60, frozen for exited companies. */
export function ageClass(days: number, status: string): "a1" | "a2" | "a3" | "frozen" {
  if (status !== "PIPELINE") return "frozen";
  return days > 60 ? "a3" : days > 30 ? "a2" : "a1";
}

/** "12 Mar 2026" */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "12 Mar 2026, 14:05" in India time. */
export function fmtTime(ts: string | number | Date | null | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: APP_TIME_ZONE,
  });
}

/** DB @db.Date values come back as UTC midnight. */
export function dateToISO(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function isoToDate(iso: string | null | undefined): Date | null {
  return iso ? new Date(iso + "T00:00:00Z") : null;
}

export function isISODate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(isoToUtcMs(s));
}
