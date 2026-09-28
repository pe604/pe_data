import { describe, expect, it } from "vitest";
import { findDuplicate, isDuplicateName, levenshtein, normCompany, parseBulkNames, rankNames, titleCase } from "@/lib/domain/names";

const TEAM = ["Keyur", "Arjun", "Arvind Sir", "Priya", "Rohan"];

describe("rankNames (SPEC §6.3)", () => {
  it("matches typos: keyurr → Keyur", () => {
    expect(rankNames("keyurr", TEAM)[0]).toBe("Keyur");
  });
  it("prefix matches rank first: ar → Arjun, Arvind Sir", () => {
    // Near misses (distance ≤1) may follow, as in the prototype.
    expect(rankNames("ar", TEAM).slice(0, 2)).toEqual(["Arjun", "Arvind Sir"]);
  });
  it("prefers prefix over substring", () => {
    expect(rankNames("ri", ["Priya", "Rishi"])).toEqual(["Rishi", "Priya"]);
  });
  it("matches on first name", () => {
    expect(rankNames("arv", TEAM)[0]).toBe("Arvind Sir");
  });
  it("allows distance 2 only for 4+ character inputs", () => {
    expect(rankNames("rhn", TEAM)).toEqual([]);
    expect(rankNames("prria", TEAM)).toContain("Priya");
  });
  it("returns everything A–Z for an empty query", () => {
    expect(rankNames("", ["b", "a"])).toEqual(["a", "b"]);
  });
});

describe("duplicate detection (SPEC §7.4)", () => {
  it("normalises legal suffixes and punctuation", () => {
    expect(normCompany("The Voltaris India Pvt. Ltd.")).toBe("voltaris");
    expect(normCompany("ABC Private Limited")).toBe("abc");
  });
  it("matches equal names after normalisation", () => {
    expect(isDuplicateName("Mokobara Pvt Ltd", "mokobara")).toBe(true);
  });
  it("matches Levenshtein ≤1 only for 5+ characters", () => {
    expect(isDuplicateName("Mokobarra", "Mokobara")).toBe(true);
    expect(isDuplicateName("Zepa", "Zept")).toBe(false);
    expect(isDuplicateName("Mokobara", "Mokabora")).toBe(false);
  });
  it("finds the matching company", () => {
    const list = [{ id: "1", name: "Voltaris Grid Systems" }, { id: "2", name: "Mokobara" }];
    expect(findDuplicate("mokobara limited", list)?.id).toBe("2");
    expect(findDuplicate("Something else", list)).toBeNull();
  });
});

describe("helpers", () => {
  it("levenshtein", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
  });
  it("titleCase", () => {
    expect(titleCase("  arvind   sir ")).toBe("Arvind Sir");
  });
  it("parseBulkNames strips bullets and numbering", () => {
    expect(parseBulkNames("1. Innovist\n- Mokobara\n• Theater\n\n2) Foo Bar\n  ")).toEqual(["Innovist", "Mokobara", "Theater", "Foo Bar"]);
  });
});
