import "server-only";
import { z } from "zod";
import {
  isPeriodKey,
  lineKey,
  sameFigures,
  textLineFigures,
  LINE_KINDS,
  MONEY_SCALES,
  comparePeriods,
  fmtLineValue,
  moneyToCr,
  monthsVsTotals,
  notInText,
  parseFigure,
  type LineKind,
  type LineUnit,
  type MoneyScale,
  type ReadValue,
} from "@/lib/domain/misHistory";
import { cellNumber, gridText, readWorkbook } from "@/lib/mis/excelGrid";
import { pdfText } from "./deck";
import { execFile } from "node:child_process";
import { aiModel, env } from "@/lib/env";
import { withTempDir } from "@/lib/storage";
import { aiProvider, AiError } from "./provider";

// Full MIS reader (SPEC §15.11). Excel: the model maps the structure and figures come from the cells. PDF: the model
// maps the structure, then copies figures as printed in batches, each checked against the file's text.
// Never log file contents, prompts or model output.

export interface DraftRow {
  ref: string;
  section: string;
  label: string;
  unit: LineUnit;
  unitLabel: string | null;
  kind: LineKind;
  values: ReadValue[];
  flags: string[];
}

export interface MisReadDraft {
  format: "excel" | "pdf";
  periods: string[];
  rows: DraftRow[];
}

// ─── Shared rules ────────────────────────────────────────────────────────────

const RULES = [
  "You read a portfolio company's MIS (management information report) for an Indian private equity fund and map its figures into a history of line items by period.",
  "",
  "SCOPE: the P&L (revenue lines and splits, costs, margins, EBITDA, depreciation, finance cost, other income, PBT, tax, PAT) and key business metrics (volumes, users/customers, AUM, orders, production and capacity, cash, debt, net debt, working capital and its days, headcount totals, capex). Also per-channel or per-segment P&Ls. SKIP: receivables/payables ageing by customer or vendor, loan-facility lists, customer-wise revenue lists, order-win lists, inventory ageing, detailed balance-sheet notes (a few balance-sheet totals like cash, debt, net worth are fine), cap tables and shareholding. If the file has nothing in scope (e.g. it's only a cap table), return no tables.",
  "ONLY ACTUALS: never budget, plan, target, forecast, variance, '% complete', or '% of revenue' columns. When a % column sits next to every amount column (share of revenue), skip it; margin ROWS (e.g. 'Gross Margin %', 'EBITDA %') are fine.",
  "",
  "PERIODS (keys): month 'YYYY-MM' (e.g. 'Jan-26' → '2026-01'); Indian financial-year quarter 'FYyy-Qn' (Q1 = Apr–Jun; 'Q1FY27', 'Q1 FY2027', 'Apr–Jun 2026' → 'FY27-Q1'); half-year 'FYyy-H1'/'FYyy-H2'; full year 'FYyy' ('FY26', 'FY 2025-26', 'year ended 31.03.2026' → 'FY26'); year-to-date 'YTD-YYYY-MM' ending that month ('FY27 YTD' or 'YTD' in a report up to Sep-26 → 'YTD-2026-09'). A balance-sheet column 'as on 31.03.2026' or 'Mar-26' → '2026-03'. For a single 'reporting month' column (e.g. 'SEPT' in a Sep-26 report) use that month.",
  "",
  "SECTIONS: name the table each row belongs to as it's headed, short: 'P&L', 'Balance sheet', 'Key metrics', 'Amazon.in', 'Retail EBO', 'smallcase Assets'. Rows with the same label in different tables are different lines, so their sections must differ.",
  "ENTITY: if the MIS (its file name or title) is for a subsidiary, region or other entity rather than the main/consolidated company (e.g. '(UAE)', 'Subsidiary', 'Standalone' next to a consolidated one), prefix every section with it: 'UAE – P&L'. Figures in another currency (e.g. AED): leave those tables out unless an INR version of the same table is not in the file.",
  "LABELS: as printed, tidied (no trailing colons). When a sub-row's label only makes sense with its parent ('1P', '3P', 'Others'), prefix the parent: 'Non-Fee Assets – 1P'.",
  "UNIT: 'money' with its scale (Rupees, Thousand, Lakh, Mn, Cr, Bn) from the header or unit column ('Rs. cr' → Cr, 'Rs. lakhs' → Lakh, 'INR mn' → Mn, plain 'INR' figures like 297,614,023 → Rupees); 'percent' for percentages; 'number' for anything else with unitLabel as printed ('# (000s)', '# lakhs', 'INR/meter', 'x', 'days', 'units').",
  "KIND: 'FLOW' for amounts over a period that add up (revenue, costs, profit, volumes produced or sold, orders, inflows, capex spent, cash generated); 'STOCK' for balances at a date (cash, debt, receivables, inventory, payables, net worth, assets/AUM, cumulative counts, users/investors/subscribers at a date, capacity, number of lines, employees); 'RATIO' for percentages, margins, per-unit figures, days, multiples, take rates, ROAS.",
  "Leave out rows that are empty for every period. Never invent rows or periods.",
].join("\n");

const unitFields = {
  unit: { type: "string", enum: ["money", "percent", "number"] },
  scale: { type: ["string", "null"], enum: [...MONEY_SCALES, null], description: "Money scale; null unless unit is money" },
  unitLabel: { type: ["string", "null"], description: "For unit number: the unit as printed; else null" },
  kind: { type: "string", enum: [...LINE_KINDS] },
};
const unitZ = {
  unit: z.enum(["money", "percent", "number"]),
  scale: z.enum(MONEY_SCALES).nullable(),
  unitLabel: z.string().nullable(),
  kind: z.enum(LINE_KINDS),
};

type RowSpec = { section: string; label: string } & z.infer<z.ZodObject<typeof unitZ>>;

const lineUnit = (r: RowSpec): LineUnit => (r.unit === "money" ? "INR_CR" : r.unit === "percent" ? "PCT" : "NUM");
const toStored = (n: number, r: RowSpec) => (r.unit === "money" ? moneyToCr(n, (r.scale ?? "Cr") as MoneyScale) : n);
const fmtFor = (r: RowSpec) => (n: number) => fmtLineValue(n, lineUnit(r));

async function ask<T>(schema: z.ZodType<T>, jsonSchema: unknown, prompt: string, pdf: { data: Buffer; fileName: string; text: string } | null): Promise<T> {
  const provider = aiProvider();
  const call = async () => {
    // Busy or briefly failing upstream (429, 5xx): wait and try again, up to 3 more times.
    for (let i = 0; ; i++) {
      try {
        return await provider.generateJson({
          system: RULES,
          prompt,
          jsonSchema,
          model: aiModel,
          maxTokens: 32_000,
          ...(pdf ? { deck: { kind: "pdf" as const, ...pdf } } : {}),
        });
      } catch (e) {
        const status = e instanceof AiError ? (e.status ?? 0) : 0;
        const empty = e instanceof AiError && e.code === "empty";
        // A dropped connection (DNS, reset) surfaces as fetch's TypeError: also worth another try.
        const network = e instanceof TypeError && /fetch failed/i.test(e.message);
        if (i >= 3 || !(status === 429 || status >= 500 || network || (empty && i === 0))) throw e;
        await new Promise((r) => setTimeout(r, [5_000, 15_000, 30_000][i]));
      }
    }
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await call();
    try {
      const r = schema.safeParse(JSON.parse(text));
      if (r.success) return r.data;
    } catch {
      /* retry */
    }
  }
  throw new AiError("failed", "The MIS could not be read. Try again, or enter the figures by hand.");
}

function finish(format: "excel" | "pdf", rows: DraftRow[]): MisReadDraft {
  const kept = rows.filter((r) => r.values.length);
  const periods = [...new Set(kept.flatMap((r) => r.values.map((v) => v.period)))].sort(comparePeriods);
  for (const r of kept) r.values.sort((a, b) => comparePeriods(a.period, b.period));
  return { format, periods, rows: kept };
}

// ─── Excel ───────────────────────────────────────────────────────────────────

const excelJson = {
  type: "object",
  additionalProperties: false,
  required: ["tables"],
  properties: {
    tables: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sheet", "section", "columns", "rows"],
        properties: {
          sheet: { type: "string" },
          section: { type: "string" },
          columns: {
            type: "array",
            description: "Only the columns holding actual figures for a period",
            items: { type: "object", additionalProperties: false, required: ["col", "period"], properties: { col: { type: "string" }, period: { type: "string" } } },
          },
          rows: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["row", "label", "unit", "scale", "unitLabel", "kind"],
              properties: { row: { type: "integer" }, label: { type: "string" }, ...unitFields },
            },
          },
        },
      },
    },
  },
};
const excelZ = z.object({
  tables: z.array(
    z.object({
      sheet: z.string(),
      section: z.string(),
      columns: z.array(z.object({ col: z.string(), period: z.string() })),
      rows: z.array(z.object({ row: z.number().int(), label: z.string(), ...unitZ })),
    }),
  ),
});

async function readExcel(data: Buffer, fileName: string, companyName: string): Promise<MisReadDraft> {
  const sheets = await readWorkbook(data);
  if (!sheets.length) throw new AiError("failed", "That Excel file has no visible sheets with data.");
  const prompt = [
    `Company: ${companyName}`,
    `File: ${fileName}`,
    "The MIS is an Excel file. Its cells follow, sheet by sheet: 'R12: A=Revenue | C=297614023' means row 12, column A holds 'Revenue', column C holds 297614023.",
    "Map the tables in scope: for each, the sheet, a section name, which columns hold which period, and the rows in scope with their row number, label, unit and kind. Give cell addresses only; do not copy figures.",
    "---",
    gridText(sheets),
  ].join("\n");
  const map = await ask(excelZ, excelJson, prompt, null);
  const rows: DraftRow[] = [];
  map.tables.forEach((t, ti) => {
    const cols = t.columns.filter((c) => /^[A-Z]{1,3}$/i.test(c.col) && isPeriodKey(c.period));
    t.rows.forEach((r, ri) => {
      const spec: RowSpec = { ...r, section: t.section.trim(), label: r.label.trim() };
      const values: ReadValue[] = [];
      for (const c of cols) {
        const n = cellNumber(sheets, t.sheet, r.row, c.col);
        if (n === null || values.some((v) => v.period === c.period)) continue;
        values.push({ period: c.period, value: toStored(n, spec), raw: String(n) });
      }
      rows.push({
        ref: `T${ti}R${ri}`,
        section: spec.section,
        label: spec.label,
        unit: lineUnit(spec),
        unitLabel: spec.unit === "number" ? spec.unitLabel : null,
        kind: spec.kind,
        values,
        flags: monthsVsTotals(spec.kind, values, fmtFor(spec)),
      });
    });
  });
  return finish("excel", rows);
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

const pdfMapJson = {
  type: "object",
  additionalProperties: false,
  required: ["tables"],
  properties: {
    tables: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "periods", "rows"],
        properties: {
          section: { type: "string" },
          periods: {
            type: "array",
            description: "The table's actual-figure columns, left to right",
            items: { type: "object", additionalProperties: false, required: ["header", "period"], properties: { header: { type: "string" }, period: { type: "string" } } },
          },
          rows: {
            type: "array",
            items: { type: "object", additionalProperties: false, required: ["label", "unit", "scale", "unitLabel", "kind"], properties: { label: { type: "string" }, ...unitFields } },
          },
        },
      },
    },
  },
};
const pdfMapZ = z.object({
  tables: z.array(
    z.object({
      section: z.string(),
      periods: z.array(z.object({ header: z.string(), period: z.string() })),
      rows: z.array(z.object({ label: z.string(), ...unitZ })),
    }),
  ),
});

const pdfValuesJson = {
  type: "object",
  additionalProperties: false,
  required: ["rows"],
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "values"],
        properties: {
          ref: { type: "string" },
          values: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["period", "raw"],
              properties: { period: { type: "string" }, raw: { type: ["string", "null"], description: "Exactly as printed; null if blank or a dash" } },
            },
          },
        },
      },
    },
  },
};
const pdfValuesZ = z.object({
  rows: z.array(z.object({ ref: z.string(), values: z.array(z.object({ period: z.string(), raw: z.string().nullable() })) })),
});

const BATCH = 40;
const MAX_FIGURES = 160;

async function readPdf(data: Buffer, fileName: string, companyName: string): Promise<MisReadDraft> {
  const text = await pdfText(data);
  const pdf = { data, fileName, text };
  const map = await ask(
    pdfMapZ,
    pdfMapJson,
    [
      `Company: ${companyName}`,
      `File: ${fileName}`,
      "The MIS is attached as a PDF; its text layer follows (columns may be out of order in the text; trust the PDF's layout).",
      "Map the tables in scope: for each, a section name, its actual-figure period columns (header as printed and period key), and the rows in scope with label, unit and kind. Do not copy figures yet.",
      "---",
      text,
    ].join("\n"),
    pdf,
  );
  type Spec = RowSpec & { ref: string; periods: { header: string; period: string }[] };
  const specs: Spec[] = [];
  map.tables.forEach((t, ti) => {
    const periods = t.periods.filter((p) => isPeriodKey(p.period));
    t.rows.forEach((r, ri) => specs.push({ ...r, section: t.section.trim(), label: r.label.trim(), ref: `T${ti}R${ri}`, periods }));
  });
  // Batches capped by figures, not rows: a table with 24 period columns fills an answer much faster.
  const batches: Spec[][] = [];
  let cur: Spec[] = [];
  let figures = 0;
  for (const s of specs) {
    const n = Math.max(1, s.periods.length);
    if (cur.length && (cur.length >= BATCH || figures + n > MAX_FIGURES)) {
      batches.push(cur);
      cur = [];
      figures = 0;
    }
    cur.push(s);
    figures += n;
  }
  if (cur.length) batches.push(cur);
  const copied = new Map<string, { period: string; raw: string | null }[]>();
  const failed = new Set<string>();
  for (let i = 0; i < batches.length; i += 3) {
    const done = await Promise.all(
      batches.slice(i, i + 3).map((b) =>
        ask(
          pdfValuesZ,
          pdfValuesJson,
          [
            `Company: ${companyName}`,
            "Copy each listed row's figures from the attached MIS, EXACTLY as printed (same digits, separators, brackets or minus for negatives, % signs). Never convert, round, add up or calculate. null where blank or a dash.",
            "Be careful with wide tables: count the columns. In the text layer below, a row's figures are usually on the row's own line, left to right in the table's column order.",
            "Rows (ref | section | label | columns as 'header → period'):",
            ...b.map((s) => `${s.ref} | ${s.section} | ${s.label} | ${s.periods.map((p) => `${p.header} → ${p.period}`).join("; ")}`),
            "--- Text layer:",
            text,
          ].join("\n"),
          pdf,
        ).catch(() => {
          // One bad batch should not lose the whole file: its rows fall back to the text layer below, flagged.
          for (const s of b) failed.add(s.ref);
          return { rows: [] };
        }),
      ),
    );
    for (const d of done) for (const r of d.rows) copied.set(r.ref, r.values);
  }
  if (specs.length && failed.size === specs.length) throw new AiError("failed", "The MIS could not be read. Try again, or enter the figures by hand.");
  const seen = new Map<string, number>(); // label → how many rows with it so far, to pick the right text line
  const rows: DraftRow[] = specs.map((s) => {
    const own = lineKey(s.label.split(" – ").pop() ?? s.label);
    const occurrence = seen.get(own) ?? 0;
    seen.set(own, occurrence + 1);
    const model = new Map<string, string>();
    for (const v of copied.get(s.ref) ?? []) if (v.raw && !model.has(v.period)) model.set(v.period, v.raw);
    // The row's line in the text layer, if it has exactly one figure per column.
    const line = textLineFigures(text, s.label, s.periods.length, occurrence);
    const fromLine = line ? new Map(s.periods.map((p, i) => [p.period, line[i]])) : null;
    const nums = (m: Map<string, string>) => s.periods.map((p) => parseFigure(m.get(p.period) ?? null));
    const flags: string[] = [];
    let chosen = model;
    if (failed.has(s.ref)) {
      if (fromLine) chosen = fromLine;
      flags.push(fromLine ? "The AI could not copy this row; taken from the file's text: check against the file" : "The AI could not copy this row: enter its figures by hand");
    } else if (fromLine) {
      const a = nums(model);
      const b = nums(fromLine);
      const same = a.every((x, i) => x === b[i]);
      if (!same && sameFigures(a, b)) {
        flags.push("The PDF's text has these figures in a different column order: check the columns against the file");
      } else if (!same) {
        chosen = fromLine;
        flags.push("Taken from the file's text line for this row (the AI's reading of the page differed): check against the file");
      }
    }
    const values: ReadValue[] = [];
    for (const p of s.periods) {
      const raw = chosen.get(p.period);
      const n = raw ? parseFigure(raw) : null;
      if (raw && n !== null && !values.some((x) => x.period === p.period)) values.push({ period: p.period, value: toStored(n, s), raw });
    }
    const missing = notInText(values, text);
    if (missing.length) flags.push(`Not found in the file's text: ${missing.join(", ")}`);
    return {
      ref: s.ref,
      section: s.section,
      label: s.label,
      unit: lineUnit(s),
      unitLabel: s.unit === "number" ? s.unitLabel : null,
      kind: s.kind,
      values,
      flags: [...monthsVsTotals(s.kind, values, fmtFor(s)), ...flags],
    };
  });
  return finish("pdf", rows);
}

// ─── Old .xls ────────────────────────────────────────────────────────────────

function runCmd(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (e) => (e ? reject(e) : resolve())));
}

/** Old .xls → .xlsx via LibreOffice (in the Docker image); null when it isn't available. */
async function xlsToXlsx(data: Buffer): Promise<Buffer | null> {
  for (const soffice of [env.SOFFICE_PATH, "soffice", "libreoffice"].filter(Boolean)) {
    try {
      return await withTempDir(async (dir, write, readOut) => {
        const input = await write("mis.xls", data);
        await runCmd(soffice, ["--headless", "--norestore", "--convert-to", "xlsx", "--outdir", dir, input], 120000);
        return readOut("mis.xlsx");
      });
    } catch {
      /* try next */
    }
  }
  return null;
}

// ─── Entry ───────────────────────────────────────────────────────────────────

/** Reads a whole MIS file (PDF, .xlsx, .xlsm, .xls) into draft rows for review. Nothing is saved. */
export async function readMisHistory(data: Buffer, fileName: string, companyName: string): Promise<MisReadDraft> {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "pdf") return readPdf(data, fileName, companyName);
  if (ext === "xlsx" || ext === "xlsm") return readExcel(data, fileName, companyName);
  if (ext === "xls") {
    const x = await xlsToXlsx(data);
    if (!x) throw new AiError("failed", "This old .xls file can't be read here. Save it as .xlsx and upload again.");
    return readExcel(x, fileName, companyName);
  }
  throw new AiError("failed", "Read figures works on PDF and Excel MIS files.");
}
