import "server-only";
import ExcelJS from "exceljs";
import type { BuiltResult } from "@/lib/domain/resultFormat";
import { LOGO_PNG_BASE64, LOGO_SIZE } from "./logo";

// The result as an Excel sheet (SPEC §15.12, phase C): same look as the image. Figures are numbers with number
// formats; change cells are text as printed ("25.00%", "NM").

// Brand colours of the result (same as the .rs styles in globals.css), as ARGB.
const C = { band: "FFDAE1F3", navy: "FF1F4E78", dark: "FF395324", light: "FFC6E0B3", white: "FFFFFFFF", ink: "FF000000", rule: "FF7F7F7F", note: "FF404040" };
const FONT = "Times New Roman";
const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const thin: ExcelJS.Border = { style: "thin", color: { argb: C.rule } };
const box: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };

export async function buildResultWorkbook(r: BuiltResult, sheetName: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Niveshaay Deal Pipeline";
  const ws = wb.addWorksheet(sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Result", { views: [{ showGridLines: false }] });
  const cols = 1 + r.headers.length;
  const longest = Math.max(28, ...r.tables.flatMap((t) => [t.caption.length, ...t.rows.map((x) => x.label.length)]));
  ws.columns = [{ width: Math.min(60, longest + 4) }, ...r.headers.map((h) => ({ width: Math.max(13, h.length + 3) }))];

  // Title band with the logo at the right.
  ws.mergeCells(1, 1, 1, cols);
  const title = ws.getCell(1, 1);
  title.value = r.title;
  title.font = { name: FONT, size: 18, bold: true, color: { argb: C.ink } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  title.fill = fill(C.band);
  ws.getRow(1).height = 58;
  const logo = wb.addImage({ base64: LOGO_PNG_BASE64, extension: "png" });
  const h = 52;
  ws.addImage(logo, { tl: { col: cols - 1.4, row: 0.08 }, ext: { width: Math.round((h * LOGO_SIZE.width) / LOGO_SIZE.height), height: h }, editAs: "oneCell" });

  let at = 2;
  r.tables.forEach((t, ti) => {
    if (ti > 0) at++; // a blank row between tables
    const head = ws.getRow(at++);
    head.height = 20;
    [t.caption, ...r.headers].forEach((v, i) => {
      const c = head.getCell(i + 1);
      c.value = v;
      c.font = { name: FONT, size: 12, bold: true, color: { argb: C.white } };
      c.fill = fill(C.navy);
      c.border = box;
      c.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle" };
    });
    for (const row of t.rows) {
      const x = ws.getRow(at++);
      x.height = 18;
      const key = row.style === "key";
      const sub = row.style === "sub";
      const label = x.getCell(1);
      label.value = row.label;
      label.font = { name: FONT, size: 12, bold: key, italic: sub, color: { argb: key ? C.white : C.ink } };
      label.fill = fill(key ? C.dark : C.light);
      label.border = box;
      label.alignment = { horizontal: "left", vertical: "middle", indent: sub ? 2 : 0 };
      row.cells.forEach((cell, i) => {
        const c = x.getCell(i + 2);
        if (cell.value !== undefined) {
          c.value = cell.value;
          c.numFmt = row.pct ? '0.00"%"' : "0.00";
        } else c.value = cell.text || null;
        c.font = { name: FONT, size: 12, bold: key && row.pct, italic: sub, color: { argb: C.ink } };
        c.fill = fill(key && !row.pct ? C.light : C.white);
        c.border = box;
        c.alignment = { horizontal: "right", vertical: "middle" };
      });
    }
  });

  for (const n of r.notes) {
    const row = at++;
    ws.mergeCells(row, 1, row, cols);
    const c = ws.getCell(row, 1);
    c.value = n;
    c.font = { name: FONT, size: 10, italic: true, color: { argb: C.note } };
    c.alignment = { wrapText: true, vertical: "top" };
    ws.getRow(row).height = Math.max(15, Math.ceil(n.length / (cols * 14)) * 14);
  }

  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
