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
  periodMonths,
  readingsDiffer,
  type LineKind,
  type LineUnit,
  type MoneyScale,
  type ReadValue,
} from "@/lib/domain/misHistory";
import { cellNumber, gridText, readWorkbook } from "@/lib/mis/excelGrid";
import { pdfText } from "./deck";
import { execFile } from "node:child_process";
import { env, misModel, misPdfModel } from "@/lib/env";
import { withTempDir } from "@/lib/storage";
import { aiProvider, AiError, type DeckInput, type ImageInput } from "./provider";

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
  format: "excel" | "pdf" | "image";
  periods: string[];
  rows: DraftRow[];
}

// ─── Shared rules ────────────────────────────────────────────────────────────

const RULES = [
  "You read a portfolio company's MIS (management information report) for an Indian private equity fund and map its figures into a history of line items by period.",
  "",
  "SCOPE: only what a one-page quarterly result needs. The company's main (consolidated, or the only) P&L at summary level: revenue (and its 2-4 main splits if shown), COGS / direct costs, gross profit or margin, the main expense heads (employee, marketing, other), contribution margins if the MIS uses them, EBITDA, depreciation, finance cost, other income, exceptional items, PBT, tax, PAT, and margin rows. Plus at most 10 headline business metrics (volumes, orders, customers/users, AUM, capacity or utilisation, capex, cash, debt). Usually 15-40 rows in all.",
  "SKIP everything else, completely: per-channel, per-store, per-product, per-region or per-segment P&Ls and splits beyond the main ones, sub-ledgers and expense breakdowns below the main heads, balance-sheet detail, ageing, customer/vendor/order/loan lists, inventory detail, headcount detail, cohort tables, budget/plan, cap tables, shareholding and agreements (SHA). If the file has nothing in scope, return no tables.",
  "ONLY ACTUALS: never budget, plan, target, forecast, variance, growth (YoY, QoQ, % change), '% complete', or '% of revenue' columns. When a % column sits next to every amount column (share of revenue), skip it; margin ROWS (e.g. 'Gross Margin %', 'EBITDA %') are fine.",
  "",
  "PERIODS (keys): month 'YYYY-MM' (e.g. 'Jan-26' → '2026-01'); Indian financial-year quarter 'FYyy-Qn' (Q1 = Apr–Jun; 'Q1FY27', 'Q1 FY2027', 'Apr–Jun 2026' → 'FY27-Q1'); half-year 'FYyy-H1'/'FYyy-H2'; full year 'FYyy' ('FY26', 'FY 2025-26', 'year ended 31.03.2026' → 'FY26'); year-to-date 'YTD-YYYY-MM' ending that month ('FY27 YTD' or 'YTD' in a report up to Sep-26 → 'YTD-2026-09'). A balance-sheet column 'as on 31.03.2026' or 'Mar-26' → '2026-03'. For a single 'reporting month' column (e.g. 'SEPT' in a Sep-26 report) use that month.",
  "",
  "SECTIONS: name the table each row belongs to as it's headed, short: 'P&L', 'Balance sheet', 'Key metrics', 'Amazon.in', 'Retail EBO', 'smallcase Assets'. Rows with the same label in different tables are different lines, so their sections must differ.",
  "ENTITY: if the MIS (its file name or title) is for a subsidiary, region or other entity rather than the main/consolidated company (e.g. '(UAE)', 'Subsidiary', 'Standalone' next to a consolidated one), prefix every section with it: 'UAE – P&L'. Figures in another currency (e.g. AED): leave those tables out unless an INR version of the same table is not in the file.",
  "LABELS: as printed, tidied (no trailing colons). When a sub-row's label only makes sense with its parent ('1P', '3P', 'Others'), prefix the parent: 'Non-Fee Assets – 1P'.",
  "UNIT: 'money' with its scale (Rupees, Thousand, Lakh, Mn, Cr, Bn) from the header or unit column ('Rs. cr' → Cr, 'Rs. lakhs' → Lakh, 'INR mn' → Mn, plain 'INR' figures like 297,614,023 → Rupees); 'percent' for percentages; 'number' for anything else with unitLabel as printed ('# (000s)', '# lakhs', 'INR/meter', 'x', 'days', 'units').",
  "KIND: 'FLOW' for amounts over a period that add up (revenue, costs, profit, volumes produced or sold, orders, inflows, capex spent, cash generated); 'STOCK' for balances at a date (cash, debt, receivables, inventory, payables, net worth, assets/AUM, cumulative counts, users/investors/subscribers at a date, capacity, number of lines, employees); 'RATIO' for percentages, margins, per-unit figures, days, multiples, take rates, ROAS.",
  "PERIODS IN SCOPE: only columns for periods ending in the last 15 months of the file (the latest quarter, the previous quarter, the same quarter last year, and their months, half-years and year to date). Skip older columns.",
  "Leave out rows that are empty for every period. Never invent rows or periods.",
].join("\n");

/** Periods kept from a read: those ending within 15 months of the latest one (a result needs no more). */
const KEEP_MONTHS = 15;

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

/** How to read: the model, and the lines a company's saved result format uses (read only those). */
export interface ReadOptions {
  /** For Excel and images (text + image model) */
  model?: string;
  /** For PDFs (needs a model that reads PDFs) */
  pdfModel?: string;
  /** Labels of the lines the company's result uses; empty = the summary scope in RULES */
  want?: string[];
}

/** Prompt lines limiting the read to a saved result's lines. */
const wantText = (o: ReadOptions) =>
  o.want?.length
    ? [`THIS COMPANY'S RESULT uses only these lines; read only them (match by meaning; give the MIS's own label), and nothing else: ${o.want.join("; ")}.`]
    : [];

async function ask<T>(schema: z.ZodType<T>, jsonSchema: unknown, prompt: string, deck: DeckInput | ImageInput | null, model: string): Promise<T> {
  const provider = aiProvider();
  const call = async () => {
    // Busy or briefly failing upstream (429, 5xx): wait and try again, up to 3 more times.
    for (let i = 0; ; i++) {
      try {
        return await provider.generateJson({
          system: RULES,
          prompt,
          jsonSchema,
          model,
          maxTokens: 32_000,
          ...(deck ? { deck } : {}),
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
  // The model now and then returns cut-off or malformed JSON: up to three tries.
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = await call();
    try {
      const r = schema.safeParse(JSON.parse(text));
      if (r.success) return r.data;
      console.warn("[mis-read] answer did not match the schema", attempt);
    } catch {
      console.warn("[mis-read] answer was not valid JSON", attempt, text.length);
    }
  }
  throw new AiError("failed", "The MIS could not be read. Try again, or enter the figures by hand.");
}

function finish(format: MisReadDraft["format"], rows: DraftRow[]): MisReadDraft {
  // Keep only recent periods: those ending within KEEP_MONTHS of the latest period read.
  const endOf = (p: string) => periodMonths(p).at(-1) ?? "";
  const latest = rows.flatMap((r) => r.values.map((v) => endOf(v.period))).sort().at(-1);
  if (latest) {
    const [y, m] = latest.split("-").map(Number);
    const t = y * 12 + (m - 1) - (KEEP_MONTHS - 1);
    const cutoff = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
    for (const r of rows) r.values = r.values.filter((v) => endOf(v.period) >= cutoff);
  }
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

async function readExcel(data: Buffer, fileName: string, companyName: string, o: ReadOptions): Promise<MisReadDraft> {
  const sheets = await readWorkbook(data);
  if (!sheets.length) throw new AiError("failed", "That Excel file has no visible sheets with data.");
  const prompt = [
    `Company: ${companyName}`,
    `File: ${fileName}`,
    ...wantText(o),
    "The MIS is an Excel file. Its cells follow, sheet by sheet: 'R12: A=Revenue | C=123456789' means row 12, column A holds 'Revenue', column C holds 123456789.",
    "Map the tables in scope: for each, the sheet, a section name, which columns hold which period, and the rows in scope with their row number, label, unit and kind. Give cell addresses only; do not copy figures.",
    "---",
    gridText(sheets),
  ].join("\n");
  const map = await ask(excelZ, excelJson, prompt, null, o.model ?? misModel);
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

async function readPdf(data: Buffer, fileName: string, companyName: string, o: ReadOptions): Promise<MisReadDraft> {
  const text = await pdfText(data);
  const pdf = { kind: "pdf" as const, data, fileName, text };
  const map = await ask(
    pdfMapZ,
    pdfMapJson,
    [
      `Company: ${companyName}`,
      `File: ${fileName}`,
      ...wantText(o),
      "The MIS is attached as a PDF; its text layer follows (columns may be out of order in the text; trust the PDF's layout).",
      "Map the tables in scope: for each, a section name, its actual-figure period columns (header as printed and period key), and the rows in scope with label, unit and kind. Do not copy figures yet.",
      "---",
      text,
    ].join("\n"),
    pdf,
    o.pdfModel ?? misPdfModel,
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
          o.pdfModel ?? misPdfModel,
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

// ─── Image (a past result, a screenshot of an MIS) ───────────────────────────

const imageJson = {
  type: "object",
  additionalProperties: false,
  required: ["tables"],
  properties: {
    tables: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "rows"],
        properties: {
          section: { type: "string" },
          rows: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "unit", "scale", "unitLabel", "kind", "values"],
              properties: {
                label: { type: "string" },
                ...unitFields,
                values: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["period", "raw"],
                    properties: { period: { type: "string" }, raw: { type: "string", description: "Exactly as printed" } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
const imageZ = z.object({
  tables: z.array(
    z.object({
      section: z.string(),
      rows: z.array(z.object({ label: z.string(), ...unitZ, values: z.array(z.object({ period: z.string(), raw: z.string() })) })),
    }),
  ),
});

const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** One reading of the image into draft rows (no flags yet). */
async function readImageOnce(image: ImageInput, fileName: string, companyName: string, o: ReadOptions): Promise<DraftRow[]> {
  const map = await ask(
    imageZ,
    imageJson,
    [
      `Company: ${companyName}`,
      `File: ${fileName}`,
      ...wantText(o),
      "The attached image is a table of the company's figures: a result summary made by the fund, or a page of an MIS.",
      "Read every table in scope: section, and each row's label, unit, kind and figures by period key, each figure EXACTLY as printed (digits, separators, brackets or minus, % sign). Leave out blank or dash cells. Never calculate or round.",
      "Read the column headers carefully and count the columns, so each figure gets its own column's period.",
    ].join("\n"),
    image,
    o.model ?? misModel,
  );
  const rows: DraftRow[] = [];
  map.tables.forEach((t, ti) =>
    t.rows.forEach((r, ri) => {
      const spec: RowSpec = { ...r, section: t.section.trim(), label: r.label.trim() };
      const values: ReadValue[] = [];
      for (const v of r.values) {
        const n = parseFigure(v.raw);
        if (n === null || !isPeriodKey(v.period) || values.some((x) => x.period === v.period)) continue;
        values.push({ period: v.period, value: toStored(n, spec), raw: v.raw });
      }
      rows.push({ ref: `T${ti}R${ri}`, section: spec.section, label: spec.label, unit: lineUnit(spec), unitLabel: spec.unit === "number" ? spec.unitLabel : null, kind: spec.kind, values, flags: [] });
    }),
  );
  return rows;
}

/** An image has no text to check against: it's read twice, independently, and the readings are compared. */
async function readImage(data: Buffer, fileName: string, companyName: string, o: ReadOptions): Promise<MisReadDraft> {
  const mime = IMAGE_MIME[fileName.toLowerCase().split(".").pop() ?? ""];
  const image: ImageInput = { kind: "image", data, mime, fileName };
  const [first, second] = await Promise.all([readImageOnce(image, fileName, companyName, o), readImageOnce(image, fileName, companyName, o).catch(() => null)]);
  if (!second) {
    for (const r of first) r.flags.push("Read once only (the second reading failed): check against the image");
    return finish("image", first.map((r) => ({ ...r, flags: [...monthsVsTotals(r.kind, r.values, (n) => fmtLineValue(n, r.unit)), ...r.flags] })));
  }
  // Pair rows by section, label and how many times that pair came before.
  const keyed = (rows: DraftRow[]) => {
    const seen = new Map<string, number>();
    return rows.map((r) => {
      const k = `${lineKey(r.section)}|${lineKey(r.label)}`;
      const n = seen.get(k) ?? 0;
      seen.set(k, n + 1);
      return { key: `${k}|${n}`, row: r };
    });
  };
  const secondKeyed = keyed(second);
  const b = new Map(secondKeyed.map((x) => [x.key, x.row]));
  const used = new Set<string>();
  const rows: DraftRow[] = keyed(first).map(({ key, row }) => {
    // Same section and label; else the same label alone (the readings may name a table differently).
    let otherKey: string | undefined = b.has(key) && !used.has(key) ? key : undefined;
    if (!otherKey) {
      const label = lineKey(row.label);
      const same = secondKeyed.filter((x) => !used.has(x.key) && lineKey(x.row.label) === label);
      if (same.length === 1) otherKey = same[0].key;
    }
    const other = otherKey ? b.get(otherKey) : undefined;
    const fmt = (n: number) => fmtLineValue(n, row.unit);
    const flags = monthsVsTotals(row.kind, row.values, fmt);
    if (!other || !otherKey) flags.push("Found in only one of two readings of the image: check against it");
    else {
      used.add(otherKey);
      const diff = readingsDiffer(row.values, other.values, fmt);
      if (diff.length) flags.push(`Two readings of the image differ (first one kept): ${diff.join("; ")}`);
      else if (other.unit !== row.unit) flags.push("Two readings of the image differ on the unit: check it");
    }
    return { ...row, flags };
  });
  for (const x of secondKeyed) {
    if (used.has(x.key)) continue;
    rows.push({ ...x.row, ref: `B${x.row.ref}`, flags: ["Found in only one of two readings of the image: check against it"] });
  }
  return finish("image", rows);
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

/** Reads a whole MIS or result file (PDF, .xlsx, .xlsm, .xls, PNG, JPG, WebP) into draft rows for review. Nothing is saved. */
export async function readMisHistory(data: Buffer, fileName: string, companyName: string, o: ReadOptions = {}): Promise<MisReadDraft> {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return readPdf(data, fileName, companyName, o);
  if (IMAGE_MIME[ext]) return readImage(data, fileName, companyName, o);
  if (ext === "xlsx" || ext === "xlsm") return readExcel(data, fileName, companyName, o);
  if (ext === "xls") {
    const x = await xlsToXlsx(data);
    if (!x) throw new AiError("failed", "This old .xls file can't be read here. Save it as .xlsx and upload again.");
    return readExcel(x, fileName, companyName, o);
  }
  throw new AiError("failed", "Read figures works on PDF, Excel and image (PNG, JPG) files.");
}
