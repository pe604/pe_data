import "server-only";
import type React from "react";
import path from "node:path";
import { Document, Font, Link, Page, Path, StyleSheet, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { fmtDate } from "@/lib/domain/dates";
import { change, linkPieces, money, plain, sectorInfo, shortDate, type FundingDealItem, type PeriodStats } from "@/lib/domain/funding";
import type { LetterData } from "./letterData";

// The funding letter as a PDF (SPEC §15.16): an LP-style letter with a cover, the editor's letter, charts, sector
// notes and every round. A document, so it uses fixed Niveshaay brand colours (the same in light and dark mode).

const FONTS = path.join(process.cwd(), "assets", "fonts");
let registered = false;
function registerFonts() {
  if (registered) return;
  Font.register({
    family: "Plex",
    fonts: [400, 500, 600, 700].map((w) => ({ src: path.join(FONTS, `plex-${w}.woff`), fontWeight: w })),
  });
  Font.register({
    family: "Serif",
    fonts: [
      { src: path.join(FONTS, "serif-400.woff"), fontWeight: 400 },
      { src: path.join(FONTS, "serif-400-italic.woff"), fontWeight: 400, fontStyle: "italic" },
      { src: path.join(FONTS, "serif-600.woff"), fontWeight: 600 },
      { src: path.join(FONTS, "serif-700.woff"), fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((w) => [w]);
  registered = true;
}

const C = {
  green: "#27500A",
  green2: "#356A12",
  green3: "#5F8C43",
  greenSoft: "#E9F0E0",
  greenPale: "#F3F7EE",
  mint: "#C9DDB5",
  ink: "#16241A",
  ink2: "#3A483E",
  muted: "#6A766D",
  faint: "#98A29A",
  rule: "#DDE2D6",
  rule2: "#EBEEE5",
  paper: "#F5F6F0",
  gold: "#B8872C",
  goldSoft: "#F7EFDD",
  brick: "#8A2C1F",
  brickSoft: "#F7E8E4",
  white: "#FFFFFF",
};
const SECTOR: Record<string, string> = {
  ai: "#5B5BD6", fin: "#0B7A75", con: "#D9480F", hc: "#C2255C", en: "#A77B00", ev: "#2B8A3E", dt: "#1C64B4", def: "#4D6B2F",
  mfg: "#495A6B", log: "#C92A2A", agri: "#5C940D", edu: "#9C36B5", re: "#8B5E34", med: "#0C8599", oth: "#6C757D",
};
const STAGE: Record<string, string> = { SEED: "#9BCB72", EARLY: "#356A12", GROWTH: "#5B5BD6", LATE: "#C2255C", OTHER: "#C9CFC2" };
const sectorColour = (name: string) => SECTOR[sectorInfo(name).slug] ?? SECTOR.oth;

const s = StyleSheet.create({
  page: { fontFamily: "Plex", fontSize: 9.5, color: C.ink, paddingTop: 64, paddingBottom: 56, paddingHorizontal: 46, backgroundColor: C.white },
  cover: { fontFamily: "Plex", fontSize: 9.5, color: C.ink, paddingBottom: 56, backgroundColor: C.white },
  head: { position: "absolute", top: 26, left: 46, right: 46, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingBottom: 7, borderBottomWidth: 0.6, borderBottomColor: C.rule },
  headBrand: { fontFamily: "Serif", fontWeight: 700, fontSize: 11, color: C.green },
  headMeta: { fontSize: 8, color: C.muted, letterSpacing: 0.4 },
  foot: { position: "absolute", bottom: 26, left: 46, right: 46, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: C.faint },
  band: { backgroundColor: C.green, paddingHorizontal: 46, paddingTop: 38, paddingBottom: 30 },
  bandTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 34 },
  wordmark: { fontFamily: "Serif", fontWeight: 700, fontSize: 17, color: C.white },
  bandTag: { fontSize: 8, color: C.mint, letterSpacing: 1.6, textTransform: "uppercase", fontWeight: 600 },
  eyebrow: { fontSize: 8.5, color: C.mint, letterSpacing: 1.6, textTransform: "uppercase", fontWeight: 600, marginBottom: 6 },
  period: { fontFamily: "Serif", fontWeight: 600, fontSize: 30, color: C.white, marginBottom: 16 },
  headline: { fontFamily: "Serif", fontWeight: 700, fontSize: 21, lineHeight: 1.22, color: C.white, marginBottom: 10 },
  stand: { fontSize: 11, lineHeight: 1.5, color: "#DCE8D0", marginBottom: 16 },
  byline: { fontSize: 7.5, color: C.mint },
  body: { paddingHorizontal: 46, paddingTop: 22 },
  h2: { fontFamily: "Serif", fontWeight: 700, fontSize: 15, color: C.ink, marginBottom: 4 },
  h2sub: { fontSize: 8.5, color: C.muted, marginBottom: 12 },
  kicker: { fontSize: 7.5, fontWeight: 600, color: C.green, letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 5 },
  kpis: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4, marginBottom: 14 },
  kpi: { width: "33.333%", padding: 4 },
  kpiIn: { borderWidth: 0.6, borderColor: C.rule, borderRadius: 7, paddingVertical: 9, paddingHorizontal: 11, backgroundColor: C.white },
  kpiHero: { backgroundColor: C.greenPale, borderColor: C.mint },
  kl: { fontSize: 7.5, color: C.muted, marginBottom: 3 },
  kv: { fontSize: 18, fontWeight: 700, color: C.ink, letterSpacing: -0.4 },
  kd: { fontSize: 7.5, marginTop: 4, color: C.ink2 },
  up: { color: C.green2, fontWeight: 600 },
  down: { color: C.brick, fontWeight: 600 },
  box: { backgroundColor: C.greenPale, borderRadius: 8, padding: 14, marginBottom: 12, borderLeftWidth: 3, borderLeftColor: C.green },
  tk: { flexDirection: "row", marginBottom: 7 },
  tkN: { width: 16, height: 16, borderRadius: 4, backgroundColor: C.green, color: C.white, fontSize: 8, fontWeight: 700, textAlign: "center", paddingTop: 3, marginRight: 8 },
  tkT: { flex: 1, fontSize: 9.5, lineHeight: 1.45, color: C.ink },
  watch: { flexDirection: "row", marginBottom: 5 },
  watchDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.gold, marginTop: 4, marginRight: 8 },
  p: { fontFamily: "Serif", fontSize: 10.5, lineHeight: 1.62, color: C.ink2, marginBottom: 10 },
  lead: { fontFamily: "Serif", fontSize: 12, lineHeight: 1.55, color: C.ink, marginBottom: 10 },
  link: { color: C.green, textDecoration: "none", fontWeight: 600 },
  card: { borderWidth: 0.6, borderColor: C.rule, borderRadius: 8, padding: 12, marginBottom: 10 },
  cardH: { fontSize: 10, fontWeight: 600, color: C.ink },
  cardM: { fontSize: 7.5, color: C.muted, marginBottom: 9, marginTop: 1 },
  row2: { flexDirection: "row", marginHorizontal: -5 },
  col2: { flex: 1, paddingHorizontal: 5 },
  hb: { flexDirection: "row", alignItems: "center", marginBottom: 4.5 },
  hbName: { width: 130, fontSize: 8, color: C.ink2 },
  hbTrack: { flex: 1, height: 8, backgroundColor: C.rule2, borderRadius: 4 },
  hbVal: { width: 48, textAlign: "right", fontSize: 8, fontWeight: 600 },
  sec: { flexDirection: "row", marginBottom: 12 },
  secBar: { width: 3.5, borderRadius: 2, marginRight: 11 },
  secTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  secName: { fontSize: 8, fontWeight: 700, letterSpacing: 1.1, textTransform: "uppercase" },
  secFig: { fontSize: 8, color: C.muted },
  secH: { fontFamily: "Serif", fontWeight: 700, fontSize: 12, color: C.ink, marginTop: 3, marginBottom: 3 },
  secT: { fontFamily: "Serif", fontSize: 9.5, lineHeight: 1.55, color: C.ink2 },
  secDeals: { fontSize: 7.5, color: C.muted, marginTop: 4 },
  th: { flexDirection: "row", borderBottomWidth: 0.8, borderBottomColor: C.ink, paddingBottom: 4, marginBottom: 2 },
  tr: { flexDirection: "row", paddingVertical: 3.6, borderBottomWidth: 0.4, borderBottomColor: C.rule2 },
  thT: { fontSize: 7, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: 0.6 },
  td: { fontSize: 8, color: C.ink2 },
  note: { fontSize: 7.5, lineHeight: 1.5, color: C.muted, marginTop: 14, paddingTop: 8, borderTopWidth: 0.6, borderTopColor: C.rule },
});

/** Text with [[Company]] links to the round's first source. */
// View's style type: the same as Text's, without the SVG text overload.
type TextStyle = React.ComponentProps<typeof View>["style"];
function Rich({ text, urlFor, style }: { text: string; urlFor: (n: string) => string | null; style: TextStyle }) {
  return (
    <Text style={style}>
      {linkPieces(text, urlFor).map((p, i) =>
        p.href ? (
          <Link key={i} src={p.href} style={s.link}>
            {p.t}
          </Link>
        ) : (
          p.t
        ),
      )}
    </Text>
  );
}

function Delta({ now, before, label }: { now: number; before: number | null | undefined; label: string }) {
  const c = change(now, before);
  if (c == null) return <Text style={s.kd}>{label}</Text>;
  return (
    <Text style={s.kd}>
      <Text style={c >= 0 ? s.up : s.down}>
        {c >= 0 ? "+" : "−"}
        {Math.abs(c)}%
      </Text>{" "}
      {label}
    </Text>
  );
}

function Kpi({ label, value, children, hero }: { label: string; value: string; children?: React.ReactNode; hero?: boolean }) {
  return (
    <View style={s.kpi}>
      <View style={hero ? [s.kpiIn, s.kpiHero] : s.kpiIn}>
        <Text style={s.kl}>{label}</Text>
        <Text style={hero ? [s.kv, { color: C.green }] : s.kv}>{value}</Text>
        {children}
      </View>
    </View>
  );
}

function Kpis({ d }: { d: LetterData }) {
  const st = d.stats;
  const vs = d.prev ? `on ${d.prev.label}` : "";
  return (
    <View style={s.kpis}>
      <Kpi label="Equity raised" value={money(st.total)} hero>
        <Delta now={st.total} before={d.prev?.total} label={vs || `${st.disclosed} rounds disclosed`} />
      </Kpi>
      <Kpi label="Equity rounds" value={String(st.count)}>
        <Delta now={st.count} before={d.prev?.count} label={vs || `${st.count - st.disclosed} undisclosed`} />
      </Kpi>
      <Kpi label="Median round" value={money(st.median)}>
        <Text style={s.kd}>{st.under5} rounds under $5M</Text>
      </Kpi>
      <Kpi label="Largest round" value={money(st.largest?.amountUsdM)}>
        <Text style={s.kd}>{st.largest ? `${st.largest.company}${st.largest.lead ? `, ${st.largest.lead}` : ""}` : "None disclosed"}</Text>
      </Kpi>
      <Kpi label="Growth and late stage" value={money(st.growth.amount)}>
        <Text style={s.kd}>
          {st.growth.count} {st.growth.count === 1 ? "round" : "rounds"}, {Math.round(st.growth.share)}% of the money
        </Text>
      </Kpi>
      {d.bench ? (
        <Kpi label={`${d.bench.outlet} total`} value={money(d.bench.totalUsdM)}>
          {d.bench.changePct == null ? (
            <Text style={s.kd}>Their monthly report</Text>
          ) : (
            <Text style={s.kd}>
              <Text style={d.bench.changePct >= 0 ? s.up : s.down}>
                {d.bench.changePct >= 0 ? "+" : "−"}
                {Math.abs(d.bench.changePct)}%
              </Text>{" "}
              on last month
            </Text>
          )}
        </Kpi>
      ) : (
        <Kpi label="Top sector" value={st.sectors[0]?.name ?? "–"}>
          <Text style={s.kd}>{st.sectors[0] ? `${money(st.sectors[0].amount)}, ${Math.round(st.sectors[0].share)}% of the money` : ""}</Text>
        </Kpi>
      )}
    </View>
  );
}

function HBars({ rows, colour }: { rows: { name: string; amount: number; colour?: string; note?: string }[]; colour?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <View>
      {rows.map((r) => (
        <View key={r.name} style={s.hb} wrap={false}>
          <Text style={s.hbName}>{r.name}</Text>
          <View style={s.hbTrack}>
            <View style={{ width: `${Math.max(1, (r.amount / max) * 100)}%`, height: 8, borderRadius: 4, backgroundColor: r.colour ?? colour ?? C.green2 }} />
          </View>
          <Text style={s.hbVal}>{money(r.amount)}</Text>
        </View>
      ))}
    </View>
  );
}

/** Donut segments as SVG arcs. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => [cx + r * Math.cos(a - Math.PI / 2), cy + r * Math.sin(a - Math.PI / 2)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function Donut({ st }: { st: PeriodStats }) {
  const total = st.count || 1;
  const shown = st.stages.filter((x) => x.count);
  const lens = shown.map((x) => (x.count / total) * Math.PI * 2);
  const segs = shown.map((x, i) => {
    const a = lens.slice(0, i).reduce((p, q) => p + q, 0);
    const len = lens[i];
    return { ...x, d: arc(50, 50, 38, a + 0.02, len > 0.05 ? a + len - 0.02 : a + len) };
  });
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <View style={{ width: 100, height: 100, marginRight: 12 }}>
        <Svg width={100} height={100} viewBox="0 0 100 100">
          {segs.length === 1 ? (
            <Path d={`${arc(50, 50, 38, 0, Math.PI)} ${arc(50, 50, 38, Math.PI, Math.PI * 2 - 0.0001).replace(/^M [^A]+/, "")}`} stroke={STAGE[segs[0].key]} strokeWidth={14} fill="none" />
          ) : (
            segs.map((x) => <Path key={x.key} d={x.d} stroke={STAGE[x.key]} strokeWidth={14} fill="none" />)
          )}
        </Svg>
        <View style={{ position: "absolute", top: 36, left: 0, right: 0, alignItems: "center" }}>
          <Text style={{ fontSize: 17, fontWeight: 700 }}>{st.count}</Text>
          <Text style={{ fontSize: 6.5, color: C.muted }}>rounds</Text>
        </View>
      </View>
      <View style={{ flex: 1 }}>
        {st.stages.map((x) => (
          <View key={x.key} style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
            <View style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: STAGE[x.key], marginRight: 6 }} />
            <Text style={{ flex: 1, fontSize: 7.5, color: C.ink2 }}>{x.label}</Text>
            <Text style={{ fontSize: 7.5, fontWeight: 600 }}>{x.count}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Sizes({ st }: { st: PeriodStats }) {
  const max = Math.max(1, ...st.sizes.map((b) => b.count));
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", height: 104 }}>
      {st.sizes.map((b) => (
        <View key={b.label} style={{ flex: 1, alignItems: "center", paddingHorizontal: 3 }}>
          <Text style={{ fontSize: 7.5, fontWeight: 600, marginBottom: 2 }}>{b.count}</Text>
          <View style={{ width: "100%", height: Math.max(2, (b.count / max) * 74), backgroundColor: C.green2, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
          <Text style={{ fontSize: 6.3, color: C.muted, marginTop: 3 }}>{b.label}</Text>
        </View>
      ))}
    </View>
  );
}

function leadCounts(deals: FundingDealItem[]) {
  const m = new Map<string, number>();
  for (const d of deals) if (d.lead) m.set(d.lead, (m.get(d.lead) ?? 0) + 1);
  return [...m].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 7);
}

function Charts({ d }: { d: LetterData }) {
  const st = d.stats;
  const leads = leadCounts(d.deals);
  return (
    <View>
      <Text style={s.kicker}>In charts</Text>
      <Text style={s.h2}>Where the money went</Text>
      <Text style={s.h2sub}>Disclosed equity in US$. Debt and acquisitions are left out of every figure.</Text>
      <View style={s.card} wrap={false}>
        <Text style={s.cardH}>Money by sector</Text>
        <Text style={s.cardM}>Share of the {money(st.total)} raised</Text>
        <HBars rows={st.sectors.filter((x) => x.amount > 0).map((x) => ({ name: `${x.name} (${x.count})`, amount: x.amount, colour: sectorColour(x.name) }))} />
      </View>
      <View style={s.row2} wrap={false}>
        <View style={s.col2}>
          <View style={s.card}>
            <Text style={s.cardH}>Rounds by stage</Text>
            <Text style={s.cardM}>Number of equity rounds</Text>
            <Donut st={st} />
          </View>
        </View>
        <View style={s.col2}>
          <View style={s.card}>
            <Text style={s.cardH}>Round sizes</Text>
            <Text style={s.cardM}>How many rounds of each size</Text>
            <Sizes st={st} />
          </View>
        </View>
      </View>
      <View style={s.row2} wrap={false}>
        <View style={s.col2}>
          <View style={s.card}>
            <Text style={s.cardH}>Biggest investors by money</Text>
            <Text style={s.cardM}>Rounds each one led, credited in full</Text>
            <HBars rows={st.investors.slice(0, 7).map((i) => ({ name: `${i.name} (${i.count})`, amount: i.amount }))} colour="#5B5BD6" />
          </View>
        </View>
        <View style={s.col2}>
          <View style={s.card}>
            <Text style={s.cardH}>Most active lead investors</Text>
            <Text style={s.cardM}>Rounds led or named first</Text>
            {leads.length ? (
              leads.map(([n, c]) => (
                <View key={n} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3.2, borderBottomWidth: 0.4, borderBottomColor: C.rule2 }}>
                  <Text style={{ fontSize: 8, color: C.ink2 }}>{n}</Text>
                  <Text style={{ fontSize: 8, fontWeight: 600, color: C.green }}>{c} rounds</Text>
                </View>
              ))
            ) : (
              <Text style={{ fontSize: 8, color: C.muted }}>No investor led more than one round.</Text>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

function Sectors({ d, urlFor }: { d: LetterData; urlFor: (n: string) => string | null }) {
  const takes = d.column?.sectors ?? [];
  return (
    <View break>
      <Text style={s.kicker}>Sector by sector</Text>
      <Text style={s.h2}>The editor&apos;s take on each sector</Text>
      <Text style={s.h2sub}>Ranked by money raised.</Text>
      {d.stats.sectors.map((x) => {
        const take = takes.find((t) => t.name === x.name);
        const top = x.deals.filter((r) => r.amountUsdM != null).slice(0, 3);
        const col = sectorColour(x.name);
        return (
          <View key={x.name} style={s.sec} wrap={false}>
            <View style={[s.secBar, { backgroundColor: col }]} />
            <View style={{ flex: 1 }}>
              <View style={s.secTop}>
                <Text style={[s.secName, { color: col }]}>{x.name}</Text>
                <Text style={s.secFig}>
                  {x.amount ? money(x.amount) : "Undisclosed"} · {x.count} {x.count === 1 ? "round" : "rounds"} · {Math.round(x.share)}% of the money
                </Text>
              </View>
              {take && <Rich text={take.headline} urlFor={urlFor} style={s.secH} />}
              {take && <Rich text={take.text} urlFor={urlFor} style={s.secT} />}
              {top.length > 0 && <Text style={s.secDeals}>Largest: {top.map((r) => `${r.company} ${money(r.amountUsdM)}${r.lead ? ` (${r.lead})` : ""}`).join(" · ")}</Text>}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const W = { co: "23%", sec: "20%", rd: "14%", amt: "10%", lead: "23%", date: "10%" };
/** "Undisclosed" rather than "Undisclosed round" in a narrow column; "seed" becomes "Seed". */
const roundLabel = (r: string) => (r === "Undisclosed round" ? "Undisclosed" : r.charAt(0).toUpperCase() + r.slice(1));
function Table({ deals, title, sub }: { deals: FundingDealItem[]; title: string; sub: string }) {
  return (
    <View break>
      <Text style={s.kicker}>Appendix</Text>
      <Text style={s.h2}>{title}</Text>
      <Text style={s.h2sub}>{sub}</Text>
      <View style={s.th} fixed>
        <Text style={[s.thT, { width: W.co }]}>Company</Text>
        <Text style={[s.thT, { width: W.sec }]}>Sector</Text>
        <Text style={[s.thT, { width: W.rd }]}>Round</Text>
        <Text style={[s.thT, { width: W.amt, textAlign: "right", paddingRight: 8 }]}>Amount</Text>
        <Text style={[s.thT, { width: W.lead }]}>Lead</Text>
        <Text style={[s.thT, { width: W.date }]}>Reported</Text>
      </View>
      {deals.map((r) => (
        <View key={r.id} style={s.tr} wrap={false}>
          <View style={{ width: W.co, paddingRight: 6 }}>
            {r.sources[0] ? (
              <Link src={r.sources[0].url} style={[s.td, { color: C.ink, fontWeight: 600, textDecoration: "none" }]}>
                {r.company}
              </Link>
            ) : (
              <Text style={[s.td, { color: C.ink, fontWeight: 600 }]}>{r.company}</Text>
            )}
            {r.ours && <Text style={{ fontSize: 6.5, color: C.gold, fontWeight: 600 }}>{r.ours}</Text>}
          </View>
          <View style={{ width: W.sec, flexDirection: "row", alignItems: "flex-start", paddingRight: 8 }}>
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: sectorColour(r.sector), marginRight: 4, marginTop: 3 }} />
            <Text style={[s.td, { flex: 1 }]}>{r.sector}</Text>
          </View>
          <Text style={[s.td, { width: W.rd, paddingRight: 6 }]}>{roundLabel(r.round)}</Text>
          <Text style={[s.td, { width: W.amt, textAlign: "right", paddingRight: 8, fontWeight: 600, color: C.ink }]}>{r.amountUsdM == null ? "–" : money(r.amountUsdM)}</Text>
          <Text style={[s.td, { width: W.lead, paddingRight: 6 }]}>{r.lead ?? "–"}</Text>
          <Text style={[s.td, { width: W.date }]}>{shortDate(r.date)}</Text>
        </View>
      ))}
    </View>
  );
}

const writerName = (m: string) => m.replace(/^[^/]+\//, "").replace(/^claude-/, "Claude ").replace(/-(\d)/g, " $1").replace(/\b(opus|sonnet|haiku)\b/, (x) => x[0].toUpperCase() + x.slice(1));

function Frame({ d }: { d: LetterData }) {
  const title = d.kind === "MONTH" ? `Monthly funding letter · ${d.label}` : `Weekly funding note · ${d.label}`;
  return (
    <>
      <View style={s.head} fixed>
        <Text style={s.headBrand}>Niveshaay</Text>
        <Text style={s.headMeta}>{title}</Text>
      </View>
      <View style={s.foot} fixed>
        <Text>{d.shared ? "Prepared by Niveshaay from public news reports. Not investment advice." : "Confidential. Prepared for the Niveshaay team; not investment advice."}</Text>
        <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </View>
    </>
  );
}

function Letter({ d }: { d: LetterData }) {
  const urlFor = (name: string) => {
    if (d.bench && name === d.bench.outlet) return d.bench.url;
    return (d.deals.find((x) => x.company === name) ?? d.deals.find((x) => x.company.toLowerCase() === name.toLowerCase()))?.sources[0]?.url ?? null;
  };
  const month = d.kind === "MONTH";
  const headline = d.column?.headline ?? d.week?.headline ?? "";
  const body = d.column?.body ?? d.week?.body ?? [];
  const points = d.column?.takeaways ?? d.week?.highlights ?? [];
  const ours = d.deals.filter((x) => x.ours);
  return (
    <Document title={`Niveshaay ${month ? "funding letter" : "weekly funding note"}, ${d.label}`} author="Niveshaay" subject="Indian startup and growth equity">
      <Page size="A4" style={s.cover}>
        <View style={s.band}>
          <View style={s.bandTop}>
            <Text style={s.wordmark}>Niveshaay</Text>
            <Text style={s.bandTag}>{month ? "Monthly funding letter" : "Weekly funding note"}</Text>
          </View>
          <Text style={s.eyebrow}>Indian startup and growth equity</Text>
          <Text style={s.period}>{d.label}</Text>
          <Rich text={plain(headline)} urlFor={() => null} style={s.headline} />
          {d.column && <Text style={s.stand}>{plain(d.column.standfirst)}</Text>}
          <Text style={s.byline}>
            Written by {writerName(d.writer)} from {d.stats.count} equity rounds, {fmtDate(d.writtenAt)}. Figures checked against the deal list.
          </Text>
        </View>
        <View style={s.body}>
          <Text style={s.kicker}>{month ? "The month in numbers" : "The week in numbers"}</Text>
          <Kpis d={d} />
          <View style={s.box}>
            <Text style={[s.kicker, { marginBottom: 8 }]}>{month ? (d.shared ? "What it means for growth investors" : "What it means for us") : "Worth noting"}</Text>
            {points.map((t, i) => (
              <View key={i} style={s.tk}>
                <Text style={s.tkN}>{i + 1}</Text>
                <Rich text={t} urlFor={urlFor} style={s.tkT} />
              </View>
            ))}
          </View>
          {!month && (
            <View style={{ paddingHorizontal: 2 }}>
              <Text style={s.kicker}>Biggest rounds this week</Text>
              {d.deals
                .filter((x) => x.amountUsdM != null)
                .slice(0, 6)
                .map((x) => (
                  <View key={x.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 5, borderBottomWidth: 0.4, borderBottomColor: C.rule2 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: sectorColour(x.sector), marginRight: 8 }} />
                    <Text style={{ width: "34%", fontSize: 9.5, fontWeight: 600 }}>{x.company}</Text>
                    <Text style={{ flex: 1, fontSize: 8.5, color: C.muted }}>
                      {x.sector} · {roundLabel(x.round)}
                      {x.lead ? ` · ${x.lead}` : ""}
                    </Text>
                    <Text style={{ width: 60, textAlign: "right", fontSize: 10, fontWeight: 700, color: C.green }}>{money(x.amountUsdM)}</Text>
                  </View>
                ))}
            </View>
          )}
          {d.column && d.column.watch.length > 0 && (
            <View style={{ paddingHorizontal: 2 }}>
              <Text style={[s.kicker, { color: C.gold }]}>What to watch</Text>
              {d.column.watch.map((t, i) => (
                <View key={i} style={s.watch}>
                  <View style={s.watchDot} />
                  <Rich text={t} urlFor={urlFor} style={{ flex: 1, fontSize: 9, lineHeight: 1.45, color: C.ink2 }} />
                </View>
              ))}
            </View>
          )}
        </View>
        <View style={s.foot} fixed>
          <Text>{d.shared ? "Prepared by Niveshaay from public news reports. Not investment advice." : "Confidential. Prepared for the Niveshaay team; not investment advice."}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>

      <Page size="A4" style={s.page} wrap>
        <Frame d={d} />
        <Text style={s.kicker}>{month ? "From the desk" : "The week"}</Text>
        <Rich text={headline} urlFor={urlFor} style={[s.h2, { fontSize: 17, lineHeight: 1.25, marginBottom: 12 }]} />
        {body.map((p, i) => (
          <Rich key={i} text={p} urlFor={urlFor} style={i === 0 ? s.lead : s.p} />
        ))}
        {ours.length > 0 && (
          <View style={[s.box, { backgroundColor: C.goldSoft, borderLeftColor: C.gold, marginTop: 4 }]} wrap={false}>
            <Text style={[s.kicker, { color: C.gold }]}>Companies we have seen</Text>
            {ours.map((x) => (
              <Text key={x.id} style={{ fontSize: 9, color: C.ink2, marginBottom: 3 }}>
                <Text style={{ fontWeight: 600, color: C.ink }}>{x.company}</Text> raised {money(x.amountUsdM)}
                {x.lead ? ` led by ${x.lead}` : ""} ({(x.ours ?? "").toLowerCase()})
              </Text>
            ))}
          </View>
        )}
        <View break>
          <Charts d={d} />
        </View>
        {month && <Sectors d={d} urlFor={urlFor} />}
        <Table deals={d.deals} title={month ? "Every equity round" : "Every equity round this week"} sub={`${d.deals.length} rounds, largest first. Company names link to the first report.`} />
        <Text style={s.note}>
          How this is made: equity rounds reported by Entrackr, Inc42, VCCircle, Mint, YourStory and Economic Times, read from Google News twice a day. Code leaves out talks and plans, IPOs, listed-share trades,
          corporate joint ventures and secondary sales, and merges the same round reported by several outlets. Amounts in US$ at Rs 90 to the dollar. Investor totals credit each round in full to its lead. Our total is
          wider than Entrackr&apos;s: it also counts pre-IPO rounds and traditional businesses. The text is written by AI from the deal list and every figure in it is checked against that list
          {d.unchecked.length ? `; these could not be matched and should be checked before quoting: ${d.unchecked.join(", ")}` : ""}.
        </Text>
      </Page>
    </Document>
  );
}

/** The letter as PDF bytes. */
export async function renderLetter(d: LetterData): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<Letter d={d} />);
}

/** "Niveshaay funding letter October 2026.pdf" */
export const letterFileName = (d: LetterData) => `Niveshaay ${d.kind === "MONTH" ? "funding letter" : "weekly funding note"} ${d.label.replace(/[–]/g, "-")}.pdf`;

/** The WhatsApp caption that goes with the PDF. */
export function letterCaption(d: LetterData): string {
  const headline = plain(d.column?.headline ?? d.week?.headline ?? "");
  const ch = d.prev ? change(d.stats.total, d.prev.total) : null;
  const lines = [
    d.kind === "MONTH" ? `📊 *Funding letter: ${d.label}*` : `🗞️ *Weekly funding note: ${d.label}*`,
    `*${headline}*`,
    d.column ? plain(d.column.standfirst) : "",
    `💰 ${money(d.stats.total)} across ${d.stats.count} equity rounds${d.prev && ch != null ? ` (${ch >= 0 ? "+" : ""}${ch}% on ${d.prev.label})` : ""}`,
  ];
  return lines.filter(Boolean).join("\n\n");
}
