// Name lists for Assigned PE, Assigned Research and Via. Pure: unit-tested in tests/unit/team.test.ts.
import type { PersonRole } from "./constants";
import type { TeamMemberOption } from "./types";

/** Autofill suggestions per field: PE and Research are separate; Via suggests PE names plus Via names. */
export function namePools(team: TeamMemberOption[]): Record<PersonRole, string[]> {
  const pick = (f: (t: TeamMemberOption) => boolean) => team.filter(f).map((t) => t.name);
  return {
    PE: pick((t) => t.inPe),
    RESEARCH: pick((t) => t.inResearch),
    VIA: pick((t) => t.inPe || t.inVia),
  };
}

const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Local (optimistic) version of what the server does in replacePeople: add `names` to `role`'s list, and put PE
 * names that are newly assigned (not in `previous`) at the end of the PE team bar. Server data replaces it later.
 */
export function addNamesToTeam(
  team: TeamMemberOption[],
  names: string[],
  role: PersonRole,
  previous: string[] = [],
): TeamMemberOption[] {
  const flag = role === "PE" ? "inPe" : role === "RESEARCH" ? "inResearch" : "inVia";
  const before = new Set(previous.map(key));
  let maxRank = Math.max(-1, ...team.map((t) => t.peRank ?? -1));
  const out = team.map((t) => ({ ...t }));
  for (const n of names) {
    const k = key(n);
    if (!k) continue;
    let m = out.find((t) => key(t.name) === k);
    if (!m) {
      m = { id: "local-" + k, name: n.trim(), peRank: null, inPe: false, inResearch: false, inVia: false };
      out.push(m);
    }
    m[flag] = true;
    if (role === "PE" && m.peRank === null && !before.has(k)) m.peRank = ++maxRank;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
