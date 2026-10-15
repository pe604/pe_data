import { describe, expect, it } from "vitest";
import { fmtCr, fmtCrNumber, parseCr, totalCr } from "@/lib/domain/money";
import { sortRows } from "@/lib/domain/view";
import type { CompanyRow } from "@/lib/domain/types";

describe("₹ Cr amounts", () => {
  it("formats in Indian grouping", () => {
    expect(fmtCrNumber(1250.5)).toBe("1,250.5");
    expect(fmtCrNumber(125000)).toBe("1,25,000");
    expect(fmtCr(12)).toBe("₹ 12 Cr");
    expect(fmtCr(null)).toBeNull();
  });

  it("parses typed amounts", () => {
    expect(parseCr("12.5")).toBe(12.5);
    expect(parseCr("1,250")).toBe(1250);
    expect(parseCr("₹ 20 Cr")).toBe(20);
    expect(parseCr("7.256cr")).toBe(7.26);
    expect(parseCr("  ")).toBeNull();
    expect(parseCr("-5")).toBeUndefined();
    expect(parseCr("abc")).toBeUndefined();
  });

  it("totals only entered amounts", () => {
    expect(totalCr([10, null, 2.5])).toBe(12.5);
    expect(totalCr([null, null])).toBeNull();
  });

  it("sorts by amount invested, blanks last", () => {
    const row = (id: string, invested: number | null) =>
      ({ id, name: id, holding: invested === null ? null : { invested, rounds: 1, firstDate: null, currentValue: null, moic: null, markDate: null } }) as CompanyRow;
    const rows = [row("a", 5), row("b", null), row("c", 20)];
    expect(sortRows(rows, "amount-high").map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(sortRows(rows, "amount-low").map((r) => r.id)).toEqual(["a", "c", "b"]);
  });
});
