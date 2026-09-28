import "server-only";
import ExcelJS from "exceljs";
import { STAGE_LABELS, type Status } from "@/lib/domain/constants";
import { daysFor, fmtTime, todayISO } from "@/lib/domain/dates";
import type { CompanyRow } from "@/lib/domain/types";

// Export to Excel (SPEC §12). Always everything, ignoring filters.

type Col = {
  h: string;
  w: number;
  t?: "num" | "date" | "c";
  bold?: boolean;
  wrap?: boolean;
  link?: boolean;
  v: (c: CompanyRow, i: number) => string | number | Date | null;
};

const FONT = "Times New Roman";
const DARK_GREEN = "FF004800";
const BLUE = "FF1F4E79";
const GRID = "FFD6DCE4";
const ZEBRA = "FFF4F7F1";

const xDate = (iso: string | null) => (iso ? new Date(iso + "T00:00:00Z") : null);
const list = (a: string[]) => a.join(", ");
const stageAtExit = (c: CompanyRow) =>
  c.directInvested ? "Added directly" : STAGE_LABELS[c.exitStage ?? c.stage];

function columns(status: Status, today: string): Col[] {
  const days = (c: CompanyRow) => daysFor(c, today);
  const base: Col[] = [
    { h: "Sr. No.", w: 7, t: "num", v: (_c, i) => i + 1 },
    { h: "Company", w: 30, bold: true, v: (c) => c.name },
    { h: "Sector", w: 24, v: (c) => c.sector ?? "" },
    { h: "Sub-sector", w: 26, v: (c) => c.subSector ?? "" },
  ];
  const people: Col[] = [
    { h: "Priority", w: 9, t: "c", v: (c) => (c.priority ? "P" + c.priority : "") },
    { h: "Assigned PE", w: 22, wrap: true, v: (c) => list(c.pe) },
    { h: "Assigned Research", w: 22, wrap: true, v: (c) => list(c.research) },
  ];
  const od: Col = { h: "OneDrive", w: 14, link: true, v: (c) => (c.oneDriveUrl ? "Open folder" : "") };
  const latest: Col = { h: "Latest comment", w: 48, wrap: true, v: (c) => c.latestComment?.text ?? "" };
  const via: Col = { h: "Via", w: 18, wrap: true, v: (c) => list(c.via) };
  const received: Col = { h: "Date received", w: 15, t: "date", v: (c) => xDate(c.dateReceived) };

  if (status === "PIPELINE")
    return [
      ...base,
      { h: "Stage", w: 20, v: (c) => STAGE_LABELS[c.stage] },
      ...people,
      latest,
      { h: "Comments", w: 11, t: "num", v: (c) => c.commentCount },
      via,
      received,
      { h: "Days", w: 8, t: "num", v: (c) => days(c) ?? "" },
      od,
      { h: "Files", w: 8, t: "num", v: (c) => c.fileCount },
    ];
  if (status === "REJECTED")
    return [
      ...base,
      { h: "Stage at exit", w: 20, v: stageAtExit },
      ...people,
      { h: "Rejection reason", w: 52, wrap: true, v: (c) => c.rejectReason ?? "" },
      { h: "Rejected on", w: 15, t: "date", v: (c) => xDate(c.exitAt) },
      via,
      received,
      { h: "Days in pipeline", w: 11, t: "num", v: (c) => days(c) ?? "" },
      od,
    ];
  return [
    ...base,
    { h: "Stage at exit", w: 20, v: stageAtExit },
    ...people,
    latest,
    via,
    received,
    { h: "Invested on", w: 15, t: "date", v: (c) => xDate(c.exitAt) },
    { h: "Days in pipeline", w: 11, t: "num", v: (c) => days(c) ?? "" },
    od,
  ];
}

function addSheet(wb: ExcelJS.Workbook, all: CompanyRow[], status: Status, title: string, today: string) {
  const pr = (c: CompanyRow) => c.priority ?? 9;
  const rows = all
    .filter((c) => c.status === status)
    .sort((a, b) => pr(a) - pr(b) || (b.dateReceived ?? "").localeCompare(a.dateReceived ?? ""));
  const cols = columns(status, today);
  const ws = wb.addWorksheet(title, { views: [{ state: "frozen", xSplit: 2, ySplit: 3, showGridLines: false }] });
  ws.columns = cols.map((c) => ({ width: c.w }));
  ws.mergeCells(1, 1, 1, cols.length);
  ws.mergeCells(2, 1, 2, cols.length);

  const t = ws.getCell(1, 1);
  t.value = "Niveshaay Deal Pipeline: " + title;
  t.font = { name: FONT, size: 14, bold: true, color: { argb: DARK_GREEN } };
  t.alignment = { vertical: "middle" };
  ws.getRow(1).height = 26;

  const sub = ws.getCell(2, 1);
  sub.value = `${rows.length} ${rows.length === 1 ? "company" : "companies"}. Exported on ${fmtTime(new Date())}.`;
  sub.font = { name: FONT, size: 10, italic: true, color: { argb: "FF595959" } };
  ws.getRow(2).height = 18;

  const border: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: GRID } },
    left: { style: "thin", color: { argb: GRID } },
    bottom: { style: "thin", color: { argb: GRID } },
    right: { style: "thin", color: { argb: GRID } },
  };

  const hr = ws.getRow(3);
  hr.values = cols.map((c) => c.h);
  hr.height = 24;
  cols.forEach((d, ci) => {
    const cell = hr.getCell(ci + 1);
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
    cell.alignment = { vertical: "middle", horizontal: d.t === "num" || d.t === "date" ? "center" : "left", wrapText: true };
    cell.border = border;
  });

  rows.forEach((c, i) => {
    const r = ws.addRow(cols.map((d) => d.v(c, i)));
    cols.forEach((d, ci) => {
      const cell = r.getCell(ci + 1);
      cell.font = { name: FONT, size: 11, bold: !!d.bold, color: { argb: "FF000000" } };
      cell.alignment = {
        vertical: "top",
        wrapText: !!d.wrap,
        horizontal: d.t === "num" ? "right" : d.t === "date" || d.t === "c" ? "center" : "left",
      };
      cell.border = border;
      if (i % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      if (d.t === "date" && cell.value) cell.numFmt = "dd-mmm-yyyy";
      if (d.link && c.oneDriveUrl) {
        cell.value = { text: "Open folder", hyperlink: c.oneDriveUrl };
        cell.font = { name: FONT, size: 11, color: { argb: "FF0563C1" }, underline: true };
      }
    });
  });

  if (!rows.length) {
    const r = ws.addRow(["No companies in this list."]);
    r.getCell(1).font = { name: FONT, size: 11, italic: true, color: { argb: "FF595959" } };
    ws.mergeCells(4, 1, 4, cols.length);
  } else {
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + rows.length, column: cols.length } };
  }
}

export async function buildWorkbook(all: CompanyRow[]): Promise<Buffer> {
  const today = todayISO();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Niveshaay Deal Pipeline";
  wb.created = new Date();
  addSheet(wb, all, "PIPELINE", "Pipeline", today);
  addSheet(wb, all, "REJECTED", "Rejected", today);
  addSheet(wb, all, "INVESTED", "Invested", today);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
