// Downloads the Excel export as the dev user and checks its formatting (SPEC §12).
// Usage: node scripts/verify-export.mjs   (dev server running with DEV_LOGIN=true; read-only)
import ExcelJS from "exceljs";
import { chromium } from "playwright";

const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch();
const page = await browser.newPage({ baseURL: base });
await page.goto("/signin");
await page.getByRole("button", { name: /Developer login/ }).click();
await page.waitForURL(base + "/");
const ctx = page.request;
const res = await ctx.get("/api/export");
if (!res.ok()) throw new Error("Export failed: " + res.status());
const cd = res.headers()["content-disposition"];
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(await res.body());

const problems = [];
const check = (cond, msg) => cond || problems.push(msg);

check(/Niveshaay Deal Pipeline \d{4}-\d{2}-\d{2}\.xlsx/.test(decodeURIComponent(cd)), "filename: " + cd);
check(wb.worksheets.map((w) => w.name).join(",") === "Pipeline,Rejected,Invested", "sheet names");

const expectHeaders = {
  Pipeline: ["Sr. No.", "Company", "Sector", "Sub-sector", "Stage", "Priority", "Assigned PE", "Assigned Research", "Latest comment", "Comments", "Via", "Date received", "Days", "OneDrive", "Files"],
  Rejected: ["Sr. No.", "Company", "Sector", "Sub-sector", "Stage at exit", "Priority", "Assigned PE", "Assigned Research", "Rejection reason", "Rejected on", "Via", "Date received", "Days in pipeline", "OneDrive"],
  Invested: ["Sr. No.", "Company", "Sector", "Sub-sector", "Stage at exit", "Priority", "Assigned PE", "Assigned Research", "Latest comment", "Via", "Date received", "Invested on", "Days in pipeline", "OneDrive"],
};

for (const ws of wb.worksheets) {
  const t = ws.getCell("A1");
  check(t.value === "Niveshaay Deal Pipeline: " + ws.name, `${ws.name} title`);
  check(t.font?.name === "Times New Roman" && t.font?.size === 14 && t.font?.bold && t.font?.color?.argb === "FF004800", `${ws.name} title font`);
  check(/compan(y|ies)\. Exported on /.test(String(ws.getCell("A2").value)) && ws.getCell("A2").font?.italic, `${ws.name} subtitle`);
  const headers = ws.getRow(3).values.slice(1);
  check(JSON.stringify(headers) === JSON.stringify(expectHeaders[ws.name]), `${ws.name} headers: ${headers.join("|")}`);
  const h = ws.getCell("A3");
  check(h.font?.bold && h.font?.color?.argb === "FFFFFFFF" && h.fill?.fgColor?.argb === "FF1F4E79", `${ws.name} header style`);
  const view = ws.views[0];
  check(view?.state === "frozen" && view.xSplit === 2 && view.ySplit === 3, `${ws.name} freeze panes at C4`);
  const body = ws.getRow(4);
  check(body.getCell(2).font?.name === "Times New Roman" && body.getCell(2).font?.size === 11, `${ws.name} body font`);
  if (String(ws.getCell("A4").value) !== "No companies in this list.") {
    check(!!ws.autoFilter, `${ws.name} autofilter`);
    const odCol = expectHeaders[ws.name].indexOf("OneDrive") + 1;
    for (let r = 4; r <= ws.rowCount; r++) {
      const v = ws.getRow(r).getCell(odCol).value;
      if (v && typeof v === "object") check(v.text === "Open folder" && /^https?:/.test(v.hyperlink), `${ws.name} hyperlink row ${r}`);
      const dcol = expectHeaders[ws.name].indexOf("Date received") + 1;
      const dc = ws.getRow(r).getCell(dcol);
      if (dc.value) check(dc.numFmt === "dd-mmm-yyyy", `${ws.name} date format row ${r}`);
      if (r % 2 === 1 && r > 4) check(ws.getRow(r).getCell(1).fill?.fgColor?.argb === "FFF4F7F1", `${ws.name} zebra row ${r}`);
    }
  }
  console.log(`${ws.name}: ${Math.max(0, ws.rowCount - 3)} data rows`);
}

await browser.close();
if (problems.length) {
  console.error("FAILED:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log("Export OK: fonts, fills, headers, freeze panes, autofilter, dates and hyperlinks verified.");
