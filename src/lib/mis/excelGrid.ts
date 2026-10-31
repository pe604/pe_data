// Excel MIS → cell grid (SPEC §15.11). The model sees the layout as text with cell addresses to map the structure;
// figures are then read from the cells here, at full precision, never copied by the model. No server-only import so
// unit tests can use it; it only parses bytes it's given.
import ExcelJS from "exceljs";

export interface GridCell {
  /** What the sheet shows, roughly (numbers unformatted, dates as YYYY-MM-DD) */
  text: string;
  /** Numeric value, if the cell holds a number (formula results included) */
  num: number | null;
  /** Number formatted as a percentage in Excel (0.98 shown as 98%) */
  pct: boolean;
}

export interface GridSheet {
  name: string;
  /** row number → column letter → cell */
  rows: Map<number, Map<string, GridCell>>;
}

const MAX_ROWS = 400;
const MAX_COLS = 60;

/** Column number (1-based) → letters: 1 → A, 27 → AA. */
export function colLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

function cellOf(cell: ExcelJS.Cell): GridCell | null {
  const v = cell.value;
  const fmt = String(cell.numFmt ?? "");
  const pct = fmt.includes("%");
  let raw: unknown = v;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) raw = (v as { result?: unknown }).result;
    else if ("richText" in v) raw = (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
    else if ("text" in v) raw = (v as { text: unknown }).text;
    else if ("error" in v) raw = null;
  }
  if (raw === null || raw === undefined || raw === "") return null;
  if (raw instanceof Date) {
    // A huge number in a date-formatted cell loads as an invalid Date; one such cell mustn't stop the whole read.
    if (Number.isNaN(raw.getTime())) return null;
    return { text: raw.toISOString().slice(0, 10), num: null, pct: false };
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return { text: pct ? `${+(raw * 100).toFixed(4)}%` : String(+raw.toFixed(6)), num: raw, pct };
  }
  const text = String(raw).replace(/\s+/g, " ").trim();
  return text ? { text, num: null, pct: false } : null;
}

/** Visible sheets of an .xlsx/.xlsm as cell grids. */
export async function readWorkbook(data: Buffer): Promise<GridSheet[]> {
  const wb = new ExcelJS.Workbook();
  // exceljs's types want its own Buffer type; Node's Buffer is what it reads at runtime.
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const out: GridSheet[] = [];
  for (const ws of wb.worksheets) {
    if (ws.state && ws.state !== "visible") continue;
    const rows = new Map<number, Map<string, GridCell>>();
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (r > MAX_ROWS) return;
      const cells = new Map<string, GridCell>();
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        if (c > MAX_COLS || cell.isMerged && cell.master !== cell) return;
        const g = cellOf(cell);
        if (g) cells.set(colLetter(c), g);
      });
      if (cells.size) rows.set(r, cells);
    });
    if (rows.size) out.push({ name: ws.name, rows });
  }
  return out;
}

/** The grids as text for the model: "[Sheet: P&L]" then "R12: A=Revenue | C=123456789 | D=100%". */
export function gridText(sheets: GridSheet[], maxChars = 220_000): string {
  const out: string[] = [];
  let size = 0;
  for (const s of sheets) {
    out.push(`[Sheet: ${s.name}]`);
    for (const [r, cells] of s.rows) {
      const line = `R${r}: ` + [...cells].map(([c, g]) => `${c}=${g.text.slice(0, 80)}`).join(" | ");
      size += line.length + 1;
      if (size > maxChars) {
        out.push("[…truncated]");
        return out.join("\n");
      }
      out.push(line);
    }
  }
  return out.join("\n");
}

/** A cell's number as it reads on the sheet: percentages as percent (98, not 0.98). Null if empty or not a number. */
export function cellNumber(sheets: GridSheet[], sheet: string, row: number, col: string): number | null {
  const g = sheets.find((s) => s.name === sheet)?.rows.get(row)?.get(col.toUpperCase());
  if (!g || g.num === null) return null;
  return g.pct ? g.num * 100 : g.num;
}
