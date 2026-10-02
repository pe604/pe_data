import { describe, expect, it } from "vitest";
import { addNamesToTeam, namePools } from "@/lib/domain/team";
import type { TeamMemberOption } from "@/lib/domain/types";

const m = (name: string, o: Partial<TeamMemberOption> = {}): TeamMemberOption => ({
  id: name,
  name,
  peRank: null,
  inPe: false,
  inResearch: false,
  inVia: false,
  ...o,
});

const team = [
  m("Keyur", { inPe: true, peRank: 0 }),
  m("Arjun", { inPe: true, peRank: 1 }),
  m("Riya", { inResearch: true }),
  m("Kotak Bankers", { inVia: true }),
];

describe("namePools", () => {
  it("keeps PE and Research apart; Via offers PE + Via names", () => {
    const p = namePools(team);
    expect(p.PE).toEqual(["Keyur", "Arjun"]);
    expect(p.RESEARCH).toEqual(["Riya"]);
    expect(p.VIA).toEqual(["Keyur", "Arjun", "Kotak Bankers"]);
  });
});

describe("addNamesToTeam", () => {
  it("puts a newly assigned PE name at the end of the PE team bar", () => {
    const t = addNamesToTeam(team, ["Keyur", "Raghav"], "PE", ["Keyur"]);
    expect(t.find((x) => x.name === "Raghav")).toMatchObject({ inPe: true, peRank: 2 });
  });

  it("does not re-add a PE name already on the company (e.g. removed from the bar via Manage)", () => {
    const removed = [...team, m("Dushyant", { inPe: true })];
    const t = addNamesToTeam(removed, ["Dushyant", "Keyur"], "PE", ["Dushyant"]);
    expect(t.find((x) => x.name === "Dushyant")?.peRank).toBeNull();
  });

  it("adds Research and Via names to their own lists only", () => {
    const t = addNamesToTeam(team, ["Neha"], "RESEARCH");
    expect(t.find((x) => x.name === "Neha")).toMatchObject({ inResearch: true, inPe: false, peRank: null });
    const v = addNamesToTeam(team, ["riya"], "VIA");
    expect(v.find((x) => x.name === "Riya")).toMatchObject({ inResearch: true, inVia: true, inPe: false });
  });
});
