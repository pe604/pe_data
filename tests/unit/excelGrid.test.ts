import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { cellNumber, colLetter, gridText, readWorkbook } from "@/lib/mis/excelGrid";

async function sample(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("P&L");
  ws.getCell("A1").value = "Particulars";
  ws.getCell("B1").value = new Date(Date.UTC(2026, 6, 1));
  ws.getCell("C1").value = "%";
  ws.getCell("A2").value = "Revenue";
  ws.getCell("B2").value = 123456789.4567;
  ws.getCell("C2").value = 1;
  ws.getCell("C2").numFmt = "0.0%";
  ws.getCell("A3").value = "EBITDA";
  ws.getCell("B3").value = { formula: "B2*0.012", result: 1481481.47 };
  ws.getCell("C3").value = 0.012;
  ws.getCell("C3").numFmt = "0.0%";
  const hidden = wb.addWorksheet("Workings");
  hidden.state = "hidden";
  hidden.getCell("A1").value = "secret";
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("Excel grid (SPEC §15.11)", () => {
  it("letters columns", () => {
    expect([1, 26, 27, 52, 53].map(colLetter)).toEqual(["A", "Z", "AA", "AZ", "BA"]);
  });

  it("reads visible sheets, formula results and percentages at full precision", async () => {
    const sheets = await readWorkbook(await sample());
    expect(sheets.map((s) => s.name)).toEqual(["P&L"]);
    expect(cellNumber(sheets, "P&L", 2, "B")).toBe(123456789.4567);
    expect(cellNumber(sheets, "P&L", 3, "B")).toBe(1481481.47);
    expect(cellNumber(sheets, "P&L", 3, "C")).toBeCloseTo(1.2, 9);
    expect(cellNumber(sheets, "P&L", 2, "A")).toBeNull();
    expect(cellNumber(sheets, "Nope", 2, "B")).toBeNull();
    const text = gridText(sheets);
    expect(text).toContain("[Sheet: P&L]");
    expect(text).toContain("R1: A=Particulars | B=2026-07-01 | C=%");
    expect(text).toContain("R3: A=EBITDA | B=1481481.47 | C=1.2%");
    expect(text).not.toContain("secret");
  });
});
