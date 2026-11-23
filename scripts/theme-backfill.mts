// SPEC §17.2, step 3: gives companies without a theme one.
//   npx tsx --conditions=react-server scripts/theme-backfill.mts [thesis/thesis-seed.json] --dry-run
//   npx tsx --conditions=react-server scripts/theme-backfill.mts [thesis/thesis-seed.json] --apply-plan thesis/theme-plan.json
//   npx tsx --conditions=react-server scripts/theme-backfill.mts [thesis/thesis-seed.json]            (asks the model and writes)
// 1. Invested companies named in the seed's holdingThemes take that value (exact name), without the model.
// 2. The rest with no theme and themeEdited false, except companies with an analyst read (the read sets theirs, SPEC §17.2),
//    go to the cheap check model in batches of 60: name, sector and sub-sector only.
// --dry-run writes nothing to the database: it prints counts per theme and saves the plan (company ids and codes, no
// names) to thesis/theme-plan.json, so --apply-plan writes exactly what was reviewed. Never prints company names.
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { aiUsage } from "../src/lib/ai/provider";
import { pickThemes } from "../src/lib/ai/themes";
import { currentUser } from "../src/lib/auth/session";
import { db } from "../src/lib/db";
import { companyThemes, themeOptions, thesisSeedZ, type ThemeRow } from "../src/lib/domain/thesis";
import { currentThesis } from "../src/lib/server/thesis";

const BATCH = 60;
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const planIdx = args.indexOf("--apply-plan");
const planFile = planIdx >= 0 ? args[planIdx + 1] : null;
const seedFile = args.find((a, i) => !a.startsWith("--") && i !== planIdx + 1) ?? "thesis/thesis-seed.json";

type Plan = { createdAt: string; thesisVersion: number | null; assign: { id: string; code: string | null; how: "HOLDING" | "MODEL" }[] };

const rows = await currentThesis();
const version = (await db.thesisVersion.findFirst({ orderBy: { version: "desc" } }))?.version ?? null;
const themes = companyThemes(themeOptions(rows));
const codes = new Set(themes.map((t) => t.code));
const keywords = new Map(rows.filter((r): r is typeof r & ThemeRow => r.kind === "THEME").map((r) => [r.code, r.data.keywords]));
const nameOf = (code: string | null) => (code ? `${code} ${themes.find((t) => t.code === code)?.name ?? ""}` : "No theme");

const companies = await db.company.findMany({
  select: { id: true, name: true, status: true, subSector: true, themeCode: true, themeEdited: true, sector: { select: { name: true } }, activeReadId: true },
});

let plan: Plan;
if (planFile) {
  plan = JSON.parse(readFileSync(planFile, "utf8")) as Plan;
  if (plan.thesisVersion !== version) throw new Error(`The plan was made for thesis version ${plan.thesisVersion}; the current one is ${version}. Run --dry-run again.`);
} else {
  const seed = thesisSeedZ.parse(JSON.parse(readFileSync(seedFile, "utf8")));
  const assign: Plan["assign"] = [];
  const open = companies.filter((c) => !c.themeEdited && !c.themeCode);
  // 1. Holdings by exact name
  const byName = new Map(Object.entries(seed.holdingThemes));
  let matched = 0;
  const taken = new Set<string>();
  for (const c of companies.filter((x) => x.status === "INVESTED" && !x.themeEdited)) {
    if (!byName.has(c.name)) continue;
    const code = byName.get(c.name) ?? null;
    matched++;
    taken.add(c.id);
    if (code !== null && !codes.has(code)) continue;
    if ((c.themeCode ?? null) !== code) assign.push({ id: c.id, code, how: "HOLDING" });
  }
  const names = new Set(companies.filter((x) => x.status === "INVESTED").map((x) => x.name));
  console.log(`holdingThemes: ${byName.size} names, ${matched} matched an Invested company, ${[...byName.keys()].filter((n) => !names.has(n)).length} did not match`);

  // 2. The model, for the rest
  const todo = open.filter((c) => !taken.has(c.id) && !c.activeReadId);
  console.log(`asking the model about ${todo.length} companies (${companies.length - todo.length - taken.size} left alone: theme set by a person, already themed, or the theme came from a read)`);
  const list = themes.map((t) => ({ ...t, keywords: keywords.get(t.code) ?? [] }));
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH).map((c, j) => ({ key: `C${j + 1}`, id: c.id, name: c.name, sector: c.sector?.name ?? null, subSector: c.subSector }));
    let answer: Map<string, string | null> | null = null;
    for (let attempt = 0; attempt < 2 && !answer; attempt++) {
      answer = await pickThemes(batch, list).catch((e: Error) => {
        console.error(`batch ${i / BATCH + 1} failed (${e.name})${attempt ? "" : ", retrying"}`);
        return null;
      });
    }
    for (const b of batch) assign.push({ id: b.id, code: answer?.get(b.key) ?? null, how: "MODEL" });
  }
  plan = { createdAt: new Date().toISOString(), thesisVersion: version, assign };
}

// Counts per theme after the plan, across every company
const after = new Map(companies.map((c) => [c.id, c.themeCode]));
for (const a of plan.assign) after.set(a.id, a.code);
const total = companies.length;
const per = new Map<string, number>();
for (const code of after.values()) per.set(code ?? "", (per.get(code ?? "") ?? 0) + 1);
const pct = (n: number) => `${((n / Math.max(total, 1)) * 100).toFixed(1)}%`;
console.log(`\nAfter this run (${total} companies):`);
for (const [code, n] of [...per].sort((a, b) => b[1] - a[1])) console.log(`  ${nameOf(code || null)}: ${n} (${pct(n)})`);
const top = Math.max(0, ...[...per].filter(([c]) => c).map(([, n]) => n));
console.log(`largest theme ${pct(top)}, no theme ${pct(per.get("") ?? 0)}`);
console.log(`plan: ${plan.assign.filter((a) => a.how === "HOLDING").length} from holdingThemes, ${plan.assign.filter((a) => a.how === "MODEL" && a.code).length} from the model, ${plan.assign.filter((a) => a.how === "MODEL" && !a.code).length} left without a theme`);
console.log(`AI: ${aiUsage.calls} calls, US$${aiUsage.costUsd.toFixed(4)}`);

if (dry) {
  const out = "thesis/theme-plan.json";
  writeFileSync(out, JSON.stringify(plan));
  console.log(`\nDry run: nothing written to the database. Plan saved to ${out}.`);
} else {
  const me = await currentUser();
  if (!me) throw new Error("No user to record the change");
  let wrote = 0;
  for (let i = 0; i < plan.assign.length; i += 100) {
    const chunk = plan.assign.slice(i, i + 100);
    wrote += await db.$transaction(async (tx) => {
      let n = 0;
      for (const a of chunk) {
        if (a.code !== null && !codes.has(a.code)) continue;
        // Never over a person's choice, even if one was made since the plan.
        const r = await tx.company.updateMany({ where: { id: a.id, themeEdited: false }, data: { themeCode: a.code } });
        if (!r.count) continue;
        const before = companies.find((c) => c.id === a.id)?.themeCode ?? null;
        if (before !== a.code) {
          await tx.auditLog.create({ data: { companyId: a.id, actorId: me.id, field: "theme", fromValue: before ? nameOf(before) : null, toValue: a.code ? nameOf(a.code) : null } });
          n++;
        }
      }
      return n;
    });
  }
  console.log(`\nWrote ${wrote} themes.`);
}
await db.$disconnect();
