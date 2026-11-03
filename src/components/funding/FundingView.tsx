"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { getFunding, updateFundingDeal, type FundingView as Data } from "@/actions/funding";
import { fmtDate } from "@/lib/domain/dates";
import {
  change,
  DEAL_KINDS,
  FUNDING_SECTOR_NAMES,
  INR_PER_USD,
  linkPieces,
  money,
  periodStats,
  sectorInfo,
  shortDate,
  type FundingDealItem,
  type PeriodStats,
  type SectorStat,
} from "@/lib/domain/funding";
import { useStore } from "../store";

/** A share of the money: "<1%" rather than "0%" for a small one. */
const pct = (share: number) => (share > 0 && share < 1 ? "<1%" : `${Math.round(share)}%`);

const KIND_LABEL = { EQUITY: "Equity round", DEBT: "Debt", ACQUISITION: "Acquisition" } as const;

/** Text with [[Company]] links to the deal's first source. */
function Linked({ text, urlFor }: { text: string; urlFor: (n: string) => string | null }) {
  return (
    <>
      {linkPieces(text, urlFor).map((p, i) =>
        p.href ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">
            {p.t}
          </a>
        ) : (
          <Fragment key={i}>{p.t}</Fragment>
        ),
      )}
    </>
  );
}

function Delta({ pct, label }: { pct: number | null; label: string }) {
  if (pct == null) return <span className="fd-kd">{label}</span>;
  return (
    <span className={`fd-kd ${pct >= 0 ? "up" : "down"}`}>
      {pct >= 0 ? "▲" : "▼"} {Math.abs(pct)}% {label}
    </span>
  );
}

function Kpis({ s, data }: { s: PeriodStats; data: Data }) {
  const prev = data.prev;
  // "on Sep": short enough for a phone's two-column cards.
  const vs = prev ? (data.period.kind === "MONTH" ? `on ${prev.label.slice(0, 3)}` : "on prior week") : "";
  const top = s.sectors.find((x) => x.amount > 0);
  return (
    <section className="fd-kpis" aria-label="Key figures">
      <div className="fd-card fd-kpi fd-kpi-hero">
        <div className="fd-kl">Equity raised</div>
        <div className="fd-kv">{money(s.total)}</div>
        <Delta pct={prev ? change(s.total, prev.total) : null} label={prev ? vs : `${s.disclosed} rounds disclosed`} />
      </div>
      <div className="fd-card fd-kpi">
        <div className="fd-kl">Equity rounds</div>
        <div className="fd-kv">{s.count}</div>
        <Delta pct={prev ? change(s.count, prev.count) : null} label={prev ? vs : `${s.count - s.disclosed} undisclosed`} />
      </div>
      <div className="fd-card fd-kpi">
        <div className="fd-kl">Median round</div>
        <div className="fd-kv">{money(s.median)}</div>
        <span className="fd-kd">{s.under5} rounds under $5M</span>
      </div>
      <div className="fd-card fd-kpi">
        <div className="fd-kl">Largest round</div>
        <div className="fd-kv">{money(s.largest?.amountUsdM)}</div>
        <span className="fd-kd" title={s.largest?.company}>
          {s.largest ? `${s.largest.company}${s.largest.lead ? `, ${s.largest.lead}` : ""}` : "None disclosed"}
        </span>
      </div>
      <div className="fd-card fd-kpi">
        <div className="fd-kl">Growth and late stage</div>
        <div className="fd-kv">{money(s.growth.amount)}</div>
        <span className="fd-kd up">
          {s.growth.count} rounds · {pct(s.growth.share)}
        </span>
      </div>
      {data.bench ? (
        <div className="fd-card fd-kpi">
          <div className="fd-kl">
            <a href={data.bench.url} target="_blank" rel="noopener noreferrer">
              {data.bench.outlet}
            </a>{" "}
            total
          </div>
          <div className="fd-kv">{money(data.bench.totalUsdM)}</div>
          <Delta pct={data.bench.changePct} label="on last month" />
        </div>
      ) : (
        <div className="fd-card fd-kpi">
          <div className="fd-kl">Top sector</div>
          <div className="fd-kv fd-kv-sm">{top?.name ?? "–"}</div>
          <span className="fd-kd">{top ? `${money(top.amount)} · ${pct(top.share)}` : "No disclosed rounds"}</span>
        </div>
      )}
    </section>
  );
}

const writerName = (model: string | null) => (model ? model.replace(/^[^/]+\//, "").replace(/^claude-/, "Claude ").replace(/-(\d)/g, " $1").replace(/\b(opus|sonnet|haiku)\b/, (m) => m[0].toUpperCase() + m.slice(1)) : "AI");

function Column({ data, count, urlFor }: { data: Data; count: number; urlFor: (n: string) => string | null }) {
  const { column: c, week: w } = data;
  const by = (
    <div className="fd-by">
      Written by {writerName(data.writer)} from the {count} rounds on this page{data.writtenAt ? `, ${fmtDate(data.writtenAt.slice(0, 10))}` : ""}.
      {data.unchecked.length > 0 && <span className="fd-warn"> Check these figures before quoting: {data.unchecked.join(", ")}.</span>}
    </div>
  );
  if (c)
    return (
      <section className="fd-card fd-column" aria-label="Month in review">
        <article className="fd-art">
          <div className="fd-eyebrow">
            <span className="fd-dot" />
            {data.period.label.replace(/ \d{4}$/, "")} in review
          </div>
          <h2>
            <Linked text={c.headline} urlFor={urlFor} />
          </h2>
          <p className="fd-stand">
            <Linked text={c.standfirst} urlFor={urlFor} />
          </p>
          {by}
          {c.body.map((p, i) => (
            <p key={i} className="fd-b">
              <Linked text={p} urlFor={urlFor} />
            </p>
          ))}
        </article>
        <aside className="fd-side">
          <h3>What it means for us</h3>
          {c.takeaways.map((t, i) => (
            <div key={i} className="fd-tk">
              <span>{i + 1}</span>
              <div>
                <Linked text={t} urlFor={urlFor} />
              </div>
            </div>
          ))}
          {c.watch.length > 0 && (
            <div className="fd-watch">
              <h3>What to watch</h3>
              {c.watch.map((t, i) => (
                <div key={i} className="fd-wt">
                  <Linked text={t} urlFor={urlFor} />
                </div>
              ))}
            </div>
          )}
        </aside>
      </section>
    );
  if (w)
    return (
      <section className="fd-card fd-column" aria-label="Week in review">
        <article className="fd-art">
          <div className="fd-eyebrow">
            <span className="fd-dot" />
            {data.weekOf ? `Latest weekly note, ${data.weekOf}` : "The week in review"}
          </div>
          <h2>
            <Linked text={w.headline} urlFor={urlFor} />
          </h2>
          {by}
          {w.body.map((p, i) => (
            <p key={i} className="fd-b">
              <Linked text={p} urlFor={urlFor} />
            </p>
          ))}
        </article>
        <aside className="fd-side">
          <h3>Worth noting</h3>
          {w.highlights.map((t, i) => (
            <div key={i} className="fd-tk">
              <span>{i + 1}</span>
              <div>
                <Linked text={t} urlFor={urlFor} />
              </div>
            </div>
          ))}
          {data.period.kind === "MONTH" && <p className="fd-side-note">The full column for {data.period.label.replace(/ \d{4}$/, "")} is written once the month is over.</p>}
        </aside>
      </section>
    );
  return (
    <section className="fd-card fd-column-empty">
      <div className="fd-eyebrow">
        <span className="fd-dot" />
        {data.period.kind === "MONTH" ? "The month in review" : "The week in review"}
      </div>
      <p>
        {data.period.kind === "MONTH"
          ? `The column for ${data.period.label} is written in the first days of the next month, once the month's reports are out. The figures below update twice a day.`
          : "Weekly notes are written on Monday mornings for the week before."}
      </p>
    </section>
  );
}

function SectorBars({ s }: { s: PeriodStats }) {
  const rows = s.sectors.filter((x) => x.amount > 0);
  const max = Math.max(1, ...rows.map((x) => x.amount));
  return (
    <section className="fd-card fd-ch fd-wide" aria-label="Money by sector">
      <h3>Money by sector</h3>
      <div className="fd-m">Disclosed equity, US$</div>
      {rows.map((x) => (
        <div key={x.name} className={`fd-hb fd-c-${x.slug}`}>
          <span className="fd-n">{x.name}</span>
          <div className="fd-track">
            <i style={{ width: `${(x.amount / max) * 100}%` }} />
          </div>
          <span className="fd-v">{money(x.amount)}</span>
        </div>
      ))}
      {!rows.length && <p className="fd-m">No disclosed amounts yet.</p>}
    </section>
  );
}

function StageDonut({ s }: { s: PeriodStats }) {
  const R = 44;
  const circ = 2 * Math.PI * R;
  const lens = s.stages.map((st) => (s.count ? (st.count / s.count) * circ : 0));
  const segs = s.stages.map((st, i) => {
    const before = lens.slice(0, i).reduce((a, b) => a + b, 0);
    return { ...st, dash: `${Math.max(0, lens[i] - (st.count && st.count < s.count ? 1.5 : 0)).toFixed(1)} ${circ.toFixed(1)}`, off: (-before).toFixed(1) };
  });
  return (
    <section className="fd-card fd-ch" aria-label="Rounds by stage">
      <h3>Rounds by stage</h3>
      <div className="fd-m">Number of equity rounds</div>
      <div className="fd-donut">
        <svg viewBox="0 0 120 120" role="img" aria-label={s.stages.map((x) => `${x.label} ${x.count}`).join(", ")}>
          <circle cx="60" cy="60" r={R} fill="none" className="fd-ring" strokeWidth="18" />
          {segs.map((x) =>
            x.count ? <circle key={x.key} cx="60" cy="60" r={R} fill="none" strokeWidth="18" transform="rotate(-90 60 60)" className={`fd-st-${x.key}`} strokeDasharray={x.dash} strokeDashoffset={x.off} /> : null,
          )}
          <text x="60" y="60" textAnchor="middle" className="fd-donut-n">
            {s.count}
          </text>
          <text x="60" y="76" textAnchor="middle" className="fd-donut-l">
            rounds
          </text>
        </svg>
        <div className="fd-lg">
          {s.stages.map((x) => (
            <div key={x.key}>
              <span className={`fd-sw fd-st-${x.key}`} />
              <span>{x.label}</span>
              <b>{x.count}</b>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Sizes({ s }: { s: PeriodStats }) {
  const max = Math.max(1, ...s.sizes.map((b) => b.count));
  return (
    <section className="fd-card fd-ch" aria-label="Round sizes">
      <h3>Round sizes</h3>
      <div className="fd-m">How many rounds of each size</div>
      <div className="fd-vb">
        {s.sizes.map((b) => (
          <div key={b.label} className="fd-col">
            <span className="fd-top">{b.count}</span>
            <div className="fd-bar" style={{ height: `${Math.max(3, (b.count / max) * 110)}px` }} />
            <span className="fd-lab">{b.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function InvestorsByMoney({ s }: { s: PeriodStats }) {
  const rows = s.investors.slice(0, 7);
  const max = Math.max(1, ...rows.map((x) => x.amount));
  return (
    <section className="fd-card fd-ch" aria-label="Investors by money deployed">
      <h3>Biggest investors by money</h3>
      <div className="fd-m">Total of the rounds each one led, US$</div>
      {rows.map((x, i) => (
        <div key={x.name} className="fd-ib">
          <div className="fd-ib-top">
            <span className="fd-ib-name">
              <span className="fd-ib-rank">{i + 1}</span>
              {x.name}
            </span>
            <span className="fd-v">{money(x.amount)}</span>
          </div>
          <div className="fd-track thin">
            <i style={{ width: `${(x.amount / max) * 100}%` }} />
          </div>
          <span className="fd-ib-n">{x.count === 1 ? "1 round" : `${x.count} rounds`}</span>
        </div>
      ))}
      {!rows.length && <p className="fd-m">No leads named yet.</p>}
    </section>
  );
}

function ActiveLeads({ deals }: { deals: FundingDealItem[] }) {
  const rows = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of deals) if (d.kind === "EQUITY" && !d.hidden && d.lead) m.set(d.lead, (m.get(d.lead) ?? 0) + 1);
    return [...m].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 7);
  }, [deals]);
  return (
    <section className="fd-card fd-ch" aria-label="Most active lead investors">
      <h3>Most active lead investors</h3>
      <div className="fd-m">Rounds led or named first</div>
      {rows.map(([n, c]) => (
        <div key={n} className="fd-inv">
          <span>{n}</span>
          <span className="fd-pill">{c} rounds</span>
        </div>
      ))}
      {!rows.length && <p className="fd-m">No investor led more than one round.</p>}
    </section>
  );
}

function DealEdit({ d, onSave, onCancel }: { d: FundingDealItem; onSave: (p: Parameters<typeof updateFundingDeal>[1]) => void; onCancel: () => void }) {
  const [f, setF] = useState({ company: d.company, sector: d.sector, kind: d.kind, amount: d.amountUsdM == null ? "" : String(d.amountUsdM), round: d.round, lead: d.lead ?? "" });
  const amount = f.amount.trim() === "" ? null : Number(f.amount);
  const valid = f.company.trim() && f.round.trim() && (amount === null || (Number.isFinite(amount) && amount > 0));
  return (
    <form
      className="fd-edit"
      aria-label={`Edit ${d.company}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave({ company: f.company, sector: f.sector, kind: f.kind, amountUsdM: amount, round: f.round, lead: f.lead.trim() || null });
      }}
    >
      <label className="field">
        <span>Company</span>
        <input className="inp" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} />
      </label>
      <label className="field">
        <span>Sector</span>
        <select className="sel" value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value as typeof f.sector })}>
          {FUNDING_SECTOR_NAMES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Type</span>
        <select className="sel" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind })}>
          {DEAL_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Amount, US$ million</span>
        <input className="inp" inputMode="decimal" value={f.amount} placeholder="Undisclosed" onChange={(e) => setF({ ...f, amount: e.target.value })} />
      </label>
      <label className="field">
        <span>Round</span>
        <input className="inp" value={f.round} onChange={(e) => setF({ ...f, round: e.target.value })} />
      </label>
      <label className="field">
        <span>Lead investor</span>
        <input className="inp" value={f.lead} onChange={(e) => setF({ ...f, lead: e.target.value })} />
      </label>
      <div className="fd-edit-foot">
        <span className="hint">Only equity rounds count in the figures. Rupees convert at ₹{INR_PER_USD} to the dollar.</span>
        <button className="btn-ghost sm" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn sm primary" type="submit" disabled={!valid}>
          Save
        </button>
      </div>
    </form>
  );
}

function DealTable({ rows, onPatch }: { rows: FundingDealItem[]; onPatch: (id: string, p: Parameters<typeof updateFundingDeal>[1]) => Promise<boolean> }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="fd-box">
      <table className="fd-table">
        <thead>
          <tr>
            <th scope="col">Company</th>
            <th scope="col">Round</th>
            <th scope="col" className="fd-r">
              Amount
            </th>
            <th scope="col">Lead investor</th>
            <th scope="col">Reported</th>
            <th scope="col">Sources</th>
            <th scope="col">
              <span className="sr">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <Fragment key={d.id}>
              <tr className={d.hidden ? "fd-off" : undefined}>
                <td>
                  <span className="fd-co">{d.company}</span>
                  {d.ours && <span className="fd-ours">{d.ours}</span>}
                  {d.hidden && <span className="fd-ours muted">Left out</span>}
                  {d.what && <span className="fd-w">{d.what}</span>}
                </td>
                <td>
                  <span className={`fd-rd fd-st-${d.stage}-soft`}>{d.round}</span>
                </td>
                <td className="fd-r fd-co">{money(d.amountUsdM)}</td>
                <td>{d.lead ?? "–"}</td>
                <td className="fd-nowrap">{shortDate(d.date)}</td>
                <td>
                  {d.sources.filter((x, i, all) => all.findIndex((y) => y.outlet === x.outlet) === i).slice(0, 3).map((x, i) => (
                    <a key={i} className="fd-s" href={x.url} target="_blank" rel="noopener noreferrer">
                      {x.outlet}
                    </a>
                  ))}
                </td>
                <td className="fd-acts">
                  <button className="btn-ghost sm" type="button" onClick={() => setEditing(editing === d.id ? null : d.id)}>
                    Edit
                  </button>
                  <button className="btn-ghost sm" type="button" onClick={() => void onPatch(d.id, { hidden: !d.hidden })} title={d.hidden ? "Count it again" : "Not a real round: leave it out of the figures"}>
                    {d.hidden ? "Count it" : "Leave out"}
                  </button>
                </td>
              </tr>
              {editing === d.id && (
                <tr className="fd-edit-row">
                  <td colSpan={7}>
                    <DealEdit
                      d={d}
                      onCancel={() => setEditing(null)}
                      onSave={async (p) => {
                        if (await onPatch(d.id, p)) setEditing(null);
                      }}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tiles({ s, open, onPick }: { s: PeriodStats; open: string | null; onPick: (name: string) => void }) {
  return (
    <div className="fd-tiles">
      {s.sectors.map((x, i) => (
        <button key={x.name} type="button" className={`fd-tile fd-c-${x.slug}${open === x.name ? " on" : ""}`} aria-pressed={open === x.name} aria-label={`${x.name}: ${x.amount ? money(x.amount) : "undisclosed"}, ${x.count} ${x.count === 1 ? "round" : "rounds"}`} onClick={() => onPick(x.name)}>
          <div className="fd-trow">
            <span className="fd-ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={sectorInfo(x.name).icon} />
              </svg>
            </span>
            <span className="fd-rank">#{i + 1}</span>
          </div>
          <div className="fd-tn">{x.name}</div>
          <div className="fd-tv">{x.amount ? money(x.amount) : "Undisclosed"}</div>
          <div className="fd-td">
            {x.count} {x.count === 1 ? "round" : "rounds"} · {pct(x.share)} of money
          </div>
          <div className="fd-share">
            <i style={{ width: `${Math.max(x.amount ? 2 : 0, x.share)}%` }} />
          </div>
        </button>
      ))}
    </div>
  );
}

function SectorPanel({ x, data, rows, urlFor, onClose, onPatch }: { x: SectorStat; data: Data; rows: FundingDealItem[]; urlFor: (n: string) => string | null; onClose: () => void; onPatch: (id: string, p: Parameters<typeof updateFundingDeal>[1]) => Promise<boolean> }) {
  const take = data.column?.sectors.find((t) => t.name === x.name);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [x.name]);
  return (
    <section ref={ref} className={`fd-card fd-panel fd-c-${x.slug}`} aria-label={x.name}>
      <div className="fd-pband">
        <div>
          <div className="fd-eyebrow">{x.name}</div>
          {take ? (
            <>
              <h2>
                <Linked text={take.headline} urlFor={urlFor} />
              </h2>
              <p>
                <Linked text={take.text} urlFor={urlFor} />
              </p>
            </>
          ) : (
            <h2>{x.count === 1 ? "One round" : `${x.count} rounds`} so far</h2>
          )}
          <div className="fd-pstats">
            <span>
              <b>{x.amount ? money(x.amount) : "Undisclosed"}</b>raised
            </span>
            <span>
              <b>{x.count}</b>rounds
            </span>
            <span>
              <b>{money(x.median)}</b>median round
            </span>
            <span>
              <b>{pct(x.share)}</b>of the money
            </span>
          </div>
        </div>
        <button type="button" className="fd-close" onClick={onClose}>
          Close
        </button>
      </div>
      <DealTable rows={rows} onPatch={onPatch} />
    </section>
  );
}

/** Funding tab (SPEC §15.16): the month or week in figures, the editor's column, charts and sector tiles. */
export function FundingView() {
  const { toast } = useStore();
  const [data, setData] = useState<Data | null>(null);
  const [period, setPeriod] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // The period the data on screen was loaded for ("" for the default); different = loading.
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined);
  const loading = loadedFor !== period;

  useEffect(() => {
    let live = true;
    void getFunding(period)
      .then((r) => {
        if (!live) return;
        if (r.ok) setData(r.data);
        else toast(r.error);
      })
      .catch(() => live && toast("Could not load funding. Check your connection and try again."))
      .finally(() => live && setLoadedFor(period));
    return () => {
      live = false;
    };
  }, [period, toast]);

  const stats = useMemo(() => (data ? periodStats(data.deals) : null), [data]);
  const urlFor = useMemo(() => {
    const deals = data?.deals ?? [];
    return (name: string) => {
      if (data?.bench && name === data.bench.outlet) return data.bench.url;
      const d = deals.find((x) => x.company === name) ?? deals.find((x) => x.company.toLowerCase() === name.toLowerCase());
      return d?.sources[0]?.url ?? null;
    };
  }, [data]);

  const patch = async (id: string, p: Parameters<typeof updateFundingDeal>[1]): Promise<boolean> => {
    if (!data) return false;
    const before = data;
    // Optimistic: the figures recompute at once.
    setData({ ...before, deals: before.deals.map((d) => (d.id === id ? { ...d, ...p, lead: p.lead === undefined ? d.lead : p.lead, amountUsdM: p.amountUsdM === undefined ? d.amountUsdM : p.amountUsdM } : d)) });
    const r = await updateFundingDeal(id, p, before.period.key).catch(() => null);
    if (r?.ok) {
      setData(r.data);
      return true;
    }
    setData(before);
    toast(r && !r.ok ? r.error : "Could not save that change. Check your connection and try again.");
    return false;
  };

  if (!data || !stats) return <div className="fd">{loading ? <p className="muted">Loading…</p> : null}</div>;

  const months = data.periods.filter((p) => p.kind === "MONTH");
  const weeks = data.periods.filter((p) => p.kind === "WEEK");
  const openStat = stats.sectors.find((x) => x.name === open) ?? null;
  const ours = data.deals.filter((d) => d.ours && d.kind === "EQUITY" && !d.hidden);

  return (
    <div className={`fd${loading ? " fd-loading" : ""}`}>
      <div className="fd-head">
        <div>
          <h1>Funding</h1>
          <p className="fd-sub">Indian startup and growth equity rounds, read from the news twice a day.</p>
        </div>
        <div className="fd-chips" role="group" aria-label="Period">
          {months.slice(0, 4).map((p) => (
            <button
              key={p.key}
              type="button"
              className={`fd-chip${data.period.key === p.key ? " on" : ""}`}
              aria-pressed={data.period.key === p.key}
              onClick={() => {
                setOpen(null);
                setPeriod(p.key);
              }}
            >
              {p.label}
              {p.key === months[0].key ? " so far" : ""}
            </button>
          ))}
          <select
            className={`sel fd-week-sel${data.period.kind === "WEEK" ? " on" : ""}`}
            aria-label="Week"
            value={data.period.kind === "WEEK" ? data.period.key : ""}
            onChange={(e) => {
              setOpen(null);
              setPeriod(e.target.value || months[1]?.key || months[0].key);
            }}
          >
            <option value="">By week…</option>
            {weeks.map((w) => (
              <option key={w.key} value={w.key}>
                Week of {w.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {stats.count === 0 && !data.column ? (
        <div className="fd-card fd-column-empty">
          <h2 className="fd-empty-h">No rounds read yet for {data.period.kind === "MONTH" ? data.period.label : `the week of ${data.period.label}`}</h2>
          <p>{data.since ? "Rounds appear here as the news reports them. The news is read twice a day." : "The first read of the news is under way. Rounds for the last two months appear within the hour."}</p>
        </div>
      ) : (
        <>
          <Kpis s={stats} data={data} />
          <Column data={data} count={stats.count} urlFor={urlFor} />

          {ours.length > 0 && (
            <section className="fd-card fd-seen" aria-label="Companies we have seen">
              <h3>Companies we have seen</h3>
              <div className="fd-seen-list">
                {ours.map((d) => (
                  <span key={d.id} className="fd-seen-item">
                    <b>{d.company}</b> raised {money(d.amountUsdM)}
                    {d.lead ? ` from ${d.lead}` : ""} <span className="fd-ours">{d.ours}</span>
                  </span>
                ))}
              </div>
            </section>
          )}

          <div className="fd-charts">
            <SectorBars s={stats} />
            <StageDonut s={stats} />
            <Sizes s={stats} />
            <InvestorsByMoney s={stats} />
            <ActiveLeads deals={data.deals} />
          </div>

          <div className="fd-sec">
            <h2>Sectors</h2>
            <span className="fd-mm">Ranked by money raised. Select a sector for {data.column ? "the editor's take and " : ""}every round.</span>
          </div>
          <Tiles s={stats} open={open} onPick={(n) => setOpen((o) => (o === n ? null : n))} />
          {openStat && (
            <SectorPanel
              x={openStat}
              data={data}
              rows={data.deals.filter((d) => d.kind === "EQUITY" && d.sector === openStat.name).sort((a, b) => Number(a.hidden) - Number(b.hidden) || (b.amountUsdM ?? -1) - (a.amountUsdM ?? -1))}
              urlFor={urlFor}
              onClose={() => setOpen(null)}
              onPatch={patch}
            />
          )}
        </>
      )}

      <p className="fd-foot">
        Equity rounds reported by Entrackr, Inc42, VCCircle, Mint, YourStory and Economic Times, read from Google News and checked against our rules: talks, plans, IPOs and listed-share trades are left out. Acquisitions and debt are kept out of every figure and chart. Amounts in US$ at ₹{INR_PER_USD} to the dollar; investor totals credit each round in full to its lead, because reports rarely give each investor&apos;s share. Use Edit or Leave out to correct a round; figures update at once.
      </p>
    </div>
  );
}
