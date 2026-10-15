import "server-only";
import { execFile } from "node:child_process";
import ExcelJS from "exceljs";
import { z } from "zod";
import { MIS_UNITS, quarterMonths, type MisExtract } from "@/lib/domain/mis";
import { quarterLabel, quarterRange } from "@/lib/domain/quarters";
import { fmtDate } from "@/lib/domain/dates";
import { env } from "@/lib/env";
import { withTempDir } from "@/lib/storage";
import { pdfText } from "./deck";
import { aiProvider, AiError, type DeckInput } from "./provider";

// MIS reader (SPEC §15.3): the model copies the quarter's figures exactly as printed plus the unit; it never converts
// or adds up (src/lib/domain/mis.ts does). Never log file contents or model output.

const MAX_TEXT = 150_000;

/** Excel → text, sheet by sheet, row by row (cells as shown, " | " separated). */
async function excelText(data: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  // exceljs's types want its own Buffer type; Node's Buffer is what it reads at runtime.
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const out: string[] = [];
  let size = 0;
  for (const ws of wb.worksheets) {
    if (ws.state && ws.state !== "visible") continue;
    out.push(`[Sheet: ${ws.name}]`);
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (size > MAX_TEXT || r > 2000) return;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        if (c > 60) return;
        const v = cell.value;
        const t =
          v && typeof v === "object" && "result" in v
            ? String((v as { result?: unknown }).result ?? "")
            : v instanceof Date
              ? v.toISOString().slice(0, 10)
              : (cell.text ?? "");
        cells.push(t.replace(/\s+/g, " ").trim());
      });
      const line = cells.join(" | ").replace(/( \| )+$/, "");
      if (line.replace(/[\s|]/g, "")) {
        out.push(`R${r}: ${line}`);
        size += line.length;
      }
    });
  }
  return out.join("\n").slice(0, MAX_TEXT);
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (e) => (e ? reject(e) : resolve())));
}

/** Old .xls → .xlsx via LibreOffice (in the Docker image). */
async function xlsToXlsx(data: Buffer): Promise<Buffer | null> {
  for (const soffice of [env.SOFFICE_PATH, "soffice", "libreoffice"].filter(Boolean)) {
    try {
      return await withTempDir(async (dir, write, readOut) => {
        const input = await write("mis.xls", data);
        await run(soffice, ["--headless", "--norestore", "--convert-to", "xlsx", "--outdir", dir, input], 120000);
        return readOut("mis.xlsx");
      });
    } catch {
      /* try next */
    }
  }
  return null;
}

/** The file as model input, plus its text for checking figures. */
export async function prepareMis(data: Buffer, fileName: string): Promise<DeckInput> {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "pdf") return { kind: "pdf", data, fileName, text: await pdfText(data) };
  if (ext === "xlsx" || ext === "xlsm") return { kind: "text", text: await excelText(data), fileName };
  if (ext === "xls") {
    const x = await xlsToXlsx(data);
    if (!x) throw new AiError("failed", "This old .xls file can't be read here. Save it as .xlsx and upload again.");
    return { kind: "text", text: await excelText(x), fileName };
  }
  throw new AiError("failed", "Upload the MIS as a PDF or Excel file.");
}

const fig = { type: ["string", "null"], description: "Exactly as printed, incl. brackets or minus for negatives; null if not shown" };
const metrics = {
  type: "object",
  properties: { revenue: fig, ebitda: fig, pat: fig },
  required: ["revenue", "ebitda", "pat"],
  additionalProperties: false,
};

const jsonSchema = {
  type: "object",
  properties: {
    unit: { type: ["string", "null"], enum: [...MIS_UNITS, null], description: "Unit the figures are printed in" },
    quarter: { ...metrics, type: ["object", "null"], description: "Totals for the whole quarter, if the file prints them" },
    months: {
      type: "array",
      description: "Monthly figures for the quarter's months, if the file prints them",
      items: {
        type: "object",
        properties: { month: { type: "string", description: "YYYY-MM" }, revenue: fig, ebitda: fig, pat: fig },
        required: ["month", "revenue", "ebitda", "pat"],
        additionalProperties: false,
      },
    },
    cashAtEnd: { ...fig, description: "Cash and bank balance (incl. cash equivalents) at the end of the quarter" },
  },
  required: ["unit", "quarter", "months", "cashAtEnd"],
  additionalProperties: false,
};

const figZ = z.string().nullable();
const metricsZ = z.object({ revenue: figZ, ebitda: figZ, pat: figZ });
const extractZ = z.object({
  unit: z.enum(MIS_UNITS).nullable(),
  quarter: metricsZ.nullable(),
  months: z.array(metricsZ.extend({ month: z.string().regex(/^\d{4}-\d{2}$/) })).max(36),
  cashAtEnd: figZ,
});

const SYSTEM = [
  "You read a portfolio company's MIS (management information system report) for an Indian private equity fund.",
  "Reply with one JSON object matching the schema.",
  "",
  "Rules:",
  "- Copy every figure EXACTLY as printed in the file: same digits, separators and brackets/minus for negatives. Never convert units, round, add up or compute anything.",
  "- unit: the unit the figures are stated in (e.g. \"Rs in Lakhs\" → Lakh, \"INR Cr\" → Cr, \"in Mn\" → Mn, \"in '000\" → Thousand, plain rupees → Rupees). Null if not stated.",
  "- Only the requested quarter. quarter = the quarter's totals if the file prints them (a quarter column, \"Q2\", \"Jul–Sep\", \"quarter ended 30 Sep\"). Do not use year-to-date, full-year or budget/plan columns as the quarter.",
  "- months = the actual figures for each of the quarter's three months if printed (not budget, not cumulative YTD). Leave out months that are not in the file.",
  "- revenue = revenue from operations / net sales / total income from operations (not other income). ebitda = EBITDA or operating EBITDA as labelled. pat = profit after tax / net profit.",
  "- cashAtEnd = cash and bank balance (incl. cash equivalents) at the end of the quarter, if shown.",
  "- Use null when the file doesn't show a figure. Never guess.",
].join("\n");

/** Reads one quarter's figures from an MIS file. */
export async function readMisFile(input: DeckInput, quarter: string, companyName: string, signal?: AbortSignal): Promise<MisExtract> {
  const { start, end } = quarterRange(quarter);
  const months = quarterMonths(quarter);
  const prompt = [
    `Company: ${companyName}`,
    `Quarter: ${quarterLabel(quarter)} (${fmtDate(start)} to ${fmtDate(end)}); its months are ${months.join(", ")}.`,
    input.kind === "pdf" ? "The MIS is attached as a PDF; its text layer follows." : "The MIS is an Excel file; its cells follow, sheet by sheet (R = row number).",
    "---",
    input.text,
  ].join("\n");
  const provider = aiProvider();
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await provider.generateJson({ system: SYSTEM, prompt, deck: input, jsonSchema, signal });
    try {
      const r = extractZ.safeParse(JSON.parse(text));
      if (r.success) return r.data;
    } catch {
      /* retry */
    }
  }
  throw new AiError("failed", "The MIS could not be read. Enter the figures by hand.");
}
