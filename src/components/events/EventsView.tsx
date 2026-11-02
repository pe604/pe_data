"use client";

import { useEffect, useMemo, useState } from "react";
import { deleteEvent, listEvents, saveEvent, setEventStatus } from "@/actions/events";
import { fmtDate, todayISO } from "@/lib/domain/dates";
import {
  EVENT_KIND_LABELS,
  EVENT_KINDS,
  EVENT_SECTORS,
  EVENT_STATUS_LABELS,
  EVENT_STATUSES,
  EVENT_TIER_LABELS,
  EVENT_TIERS,
  eventDateLabel,
  groupEvents,
  safeEventUrl,
  type EventItem,
  type EventsView as Data,
} from "@/lib/domain/events";
import { useStore } from "../store";
import { ChipPicker } from "../ui/ChipPicker";

type Input = Parameters<typeof saveEvent>[1];

const BLANK: Input = {
  name: "",
  kind: "NETWORKING",
  sector: null,
  organiser: null,
  city: null,
  venue: null,
  description: null,
  startDate: null,
  endDate: null,
  dateNote: null,
  datesConfirmed: true,
  url: null,
  tier: "WORTH_A_LOOK",
  why: null,
  status: "INTERESTED",
  attendees: [],
  notes: null,
};

function EventForm({ initial, onDone, onCancel }: { initial: EventItem | null; onDone: (d: Data) => void; onCancel: () => void }) {
  const { pools, toast } = useStore();
  const [f, setF] = useState<Input>(() => (initial ? { ...BLANK, ...initial, sector: initial.sector as Input["sector"] } : BLANK));
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<Input>) => setF((s) => ({ ...s, ...p }));
  const str = (v: string) => v || null;
  const badUrl = !!f.url && !safeEventUrl(f.url);
  const badEnd = !!f.endDate && (!f.startDate || f.endDate < f.startDate);
  const valid = !!f.name.trim() && !badUrl && !badEnd;

  return (
    <form
      className="inv-form"
      aria-label={initial ? "Edit event" : "Add event"}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setSaving(true);
        const r = await saveEvent(initial?.id ?? null, f);
        setSaving(false);
        if (!r.ok) return toast(r.error);
        toast(initial ? "Event updated." : "Event added.");
        onDone(r.data);
      }}
    >
      <div className="grid3">
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>Event name</span>
          <input className="inp" value={f.name} onChange={(e) => set({ name: e.target.value })} required />
        </label>
        <label className="field">
          <span>Type</span>
          <select className="sel" value={f.kind} onChange={(e) => set({ kind: e.target.value as Input["kind"] })}>
            {EVENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {EVENT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Sector</span>
          <select className="sel" value={f.sector ?? ""} onChange={(e) => set({ sector: (e.target.value || null) as Input["sector"] })}>
            <option value="">Choose…</option>
            {EVENT_SECTORS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Tier</span>
          <select className="sel" value={f.tier} onChange={(e) => set({ tier: e.target.value as Input["tier"] })}>
            {EVENT_TIERS.map((t) => (
              <option key={t} value={t}>
                {EVENT_TIER_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Start date</span>
          <input className="inp" type="date" value={f.startDate ?? ""} onChange={(e) => set({ startDate: str(e.target.value) })} />
        </label>
        <label className="field">
          <span>End date</span>
          <input className="inp" type="date" value={f.endDate ?? ""} onChange={(e) => set({ endDate: str(e.target.value) })} />
        </label>
        <label className="field">
          <span>City</span>
          <input className="inp" value={f.city ?? ""} onChange={(e) => set({ city: str(e.target.value) })} />
        </label>
        <label className="field">
          <span>Venue</span>
          <input className="inp" value={f.venue ?? ""} onChange={(e) => set({ venue: str(e.target.value) })} />
        </label>
        <label className="field">
          <span>Organiser</span>
          <input className="inp" value={f.organiser ?? ""} onChange={(e) => set({ organiser: str(e.target.value) })} />
        </label>
        <label className="field">
          <span>Link</span>
          <input className="inp" value={f.url ?? ""} onChange={(e) => set({ url: str(e.target.value) })} placeholder="https://" />
        </label>
        <label className="field">
          <span>Status</span>
          <select className="sel" value={f.status} onChange={(e) => set({ status: e.target.value as Input["status"] })}>
            {EVENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {EVENT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        {!f.startDate && (
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>Date hint</span>
            <input className="inp" value={f.dateNote ?? ""} onChange={(e) => set({ dateNote: str(e.target.value) })} placeholder="Last held in March" />
          </label>
        )}
        <label className="ev-check" style={{ gridColumn: "1 / -1" }}>
          <input type="checkbox" checked={f.datesConfirmed} onChange={(e) => set({ datesConfirmed: e.target.checked })} />
          Dates checked with the organiser
        </label>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <span>Who is going</span>
          <ChipPicker value={f.attendees} onChange={(v) => set({ attendees: v })} pool={pools.PE} label="Who is going" />
        </div>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>What it is</span>
          <input className="inp" value={f.description ?? ""} onChange={(e) => set({ description: str(e.target.value) })} />
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>Why it matters</span>
          <input className="inp" value={f.why ?? ""} onChange={(e) => set({ why: str(e.target.value) })} />
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>Notes</span>
          <textarea className="ta" style={{ minHeight: 70 }} value={f.notes ?? ""} onChange={(e) => set({ notes: str(e.target.value) })} />
        </label>
      </div>
      {badUrl && <p className="hint err">Enter a link starting with http:// or https://.</p>}
      {badEnd && <p className="hint err">The end date can&apos;t be before the start date.</p>}
      <div className="foot">
        <button className="btn-ghost sm" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn sm primary" type="submit" disabled={!valid || saving}>
          {saving ? "Saving…" : initial ? "Save event" : "Add event"}
        </button>
      </div>
    </form>
  );
}

function EventRow({ e, onStatus, onEdit, onDelete }: { e: EventItem; onStatus: (s: EventItem["status"]) => void; onEdit: () => void; onDelete: () => void }) {
  const url = safeEventUrl(e.url);
  return (
    <li className={`ev-row${e.status === "SKIPPED" ? " off" : ""}`}>
      <div className="ev-date">{eventDateLabel(e)}</div>
      <div className="ev-main">
        <div className="ev-name">
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer">
              {e.name}
            </a>
          ) : (
            e.name
          )}
          {e.tier === "TOP" && <span className="ev-top">Top</span>}
          {!e.datesConfirmed && e.kind !== "OWN" && <span className="ev-check-tag">{e.startDate ? "Check dates" : "No date yet"}</span>}
        </div>
        <div className="ev-meta">{[EVENT_KIND_LABELS[e.kind], e.sector, e.city, e.venue, e.organiser].filter(Boolean).join(" · ")}</div>
        {e.dateNote && !e.startDate && <div className="ev-meta">{e.dateNote}</div>}
        {e.description && <div className="ev-why">{e.description}</div>}
        {e.why && <div className="ev-why">{e.why}</div>}
        {e.attendees.length > 0 && <div className="ev-meta">Going: {e.attendees.join(", ")}</div>}
        {e.notes && <div className="ev-why">{e.notes}</div>}
      </div>
      <div className="ev-acts">
        <select className="sel sm" aria-label={`Status of ${e.name}`} value={e.status} onChange={(x) => onStatus(x.target.value as EventItem["status"])}>
          {EVENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {EVENT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <button className="btn-ghost sm" type="button" onClick={onEdit}>
          Edit
        </button>
        <button className="btn-ghost sm" type="button" aria-label={`Delete ${e.name}`} onClick={onDelete}>
          Delete
        </button>
      </div>
    </li>
  );
}

/** Events tab: what's coming up and who is going (SPEC §15.14). */
export function EventsView() {
  const { toast } = useStore();
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState<EventItem | "new" | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [sector, setSector] = useState("");
  const [status, setStatus] = useState("");
  const [topOnly, setTopOnly] = useState(false);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    let live = true;
    void listEvents().then((r) => {
      if (!live) return;
      if (r.ok) setData(r.data);
      else toast(r.error);
    });
    return () => {
      live = false;
    };
  }, [toast]);

  const list = data?.list;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (list ?? []).filter(
      (e) =>
        (!kind || e.kind === kind) &&
        (!sector || e.sector === sector) &&
        (status ? e.status === status : e.status !== "SKIPPED") &&
        (!topOnly || e.tier === "TOP") &&
        (!s || [e.name, e.organiser, e.city, e.venue, e.sector].some((v) => v?.toLowerCase().includes(s))),
    );
  }, [list, q, kind, sector, status, topOnly]);
  const g = groupEvents(shown, todayISO());

  const changeStatus = async (e: EventItem, next: EventItem["status"]) => {
    const before = data;
    if (!before) return;
    setData({ ...before, list: before.list.map((x) => (x.id === e.id ? { ...x, status: next } : x)) });
    const r = await setEventStatus(e.id, next).catch(() => null);
    if (r?.ok) return setData(r.data);
    setData(before);
    toast(r && !r.ok ? r.error : "Could not save that change. Check your connection and try again.");
  };
  const remove = async (e: EventItem) => {
    if (!window.confirm(`Delete ${e.name}? This can't be undone.`)) return;
    const r = await deleteEvent(e.id);
    if (!r.ok) return toast(r.error);
    setData(r.data);
    toast("Event deleted.");
  };
  const rows = (items: EventItem[]) => (
    <ul className="ev-list">
      {items.map((e) => (
        <EventRow key={e.id} e={e} onStatus={(s) => void changeStatus(e, s)} onEdit={() => setEditing(e)} onDelete={() => void remove(e)} />
      ))}
    </ul>
  );

  return (
    <div className="pview">
      <div className="pview-head">
        <input className="inp ev-search" type="search" placeholder="Search events" aria-label="Search events" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="sel" aria-label="Filter by type" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All types</option>
          {EVENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {EVENT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <select className="sel" aria-label="Filter by sector" value={sector} onChange={(e) => setSector(e.target.value)}>
          <option value="">All sectors</option>
          {EVENT_SECTORS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select className="sel" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Not skipped</option>
          {EVENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {EVENT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <label className="ev-check">
          <input type="checkbox" checked={topOnly} onChange={(e) => setTopOnly(e.target.checked)} />
          Top events only
        </label>
        <span className="tb-spacer" />
        {editing === null && (
          <button className="btn primary" type="button" onClick={() => setEditing("new")}>
            Add event
          </button>
        )}
      </div>
      {editing !== null && (
        <EventForm
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? null : editing}
          onDone={(d) => {
            setData(d);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {!data ? (
        <p className="muted">Loading…</p>
      ) : !shown.length ? (
        <div className="empty">
          <h3>No events here</h3>
          <p>Change the filters, or add an event.</p>
        </div>
      ) : (
        <div className="ev-body">
          {g.months.map((m) => (
            <section key={m.label} className="ev-group">
              <h3>{m.label}</h3>
              {rows(m.items)}
            </section>
          ))}
          {g.undated.length > 0 && (
            <section className="ev-group">
              <h3>Dates to be confirmed</h3>
              {rows(g.undated)}
            </section>
          )}
          {g.past.length > 0 && (
            <section className="ev-group">
              <button className="linkbtn" type="button" onClick={() => setShowPast((v) => !v)}>
                {showPast ? "Hide past events" : `Show past events (${g.past.length})`}
              </button>
              {showPast && rows(g.past)}
            </section>
          )}
          <p className="hint ev-foot">
            New events are looked for every Monday.
            {data.lastScan ? ` Last checked ${fmtDate(data.lastScan.at.slice(0, 10))}: ${data.lastScan.added} added.` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
