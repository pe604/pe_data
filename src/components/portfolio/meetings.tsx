"use client";

import { useState } from "react";
import { deleteMeeting, saveMeeting } from "@/actions/tracker";
import { fmtDate, todayISO } from "@/lib/domain/dates";
import { isOverdueMeeting, MEETING_STATUS_LABELS, MEETING_STATUSES, MEETING_TYPES } from "@/lib/domain/quarters";
import type { MeetingItem } from "@/lib/domain/types";
import { useStore } from "../store";
import { ChipPicker } from "../ui/ChipPicker";

// Meetings with portfolio companies: form and list, shared by the Meetings view and the company file (SPEC §15).

type Input = Parameters<typeof saveMeeting>[1];

/** Meetings are shown in several places (Meetings view, company file, tracker); keep them in sync. */
export const MEETINGS_EVENT = "meetings-changed";
export function announceMeetings(list: MeetingItem[]) {
  window.dispatchEvent(new CustomEvent<MeetingItem[]>(MEETINGS_EVENT, { detail: list }));
}

export function MeetingForm({
  initial,
  companies,
  companyId,
  onDone,
  onCancel,
}: {
  initial: MeetingItem | null;
  /** Shown as a company picker when no fixed companyId is given. */
  companies?: { id: string; name: string }[];
  companyId?: string;
  onDone: (list: MeetingItem[]) => void;
  onCancel: () => void;
}) {
  const { pools, toast } = useStore();
  const [f, setF] = useState({
    companyId: initial?.companyId ?? companyId ?? "",
    date: initial?.date ?? todayISO(),
    type: initial?.type ?? MEETING_TYPES[0],
    status: initial?.status ?? ("PLANNED" as Input["status"]),
    attendees: initial?.attendees ?? [],
    notes: initial?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<typeof f>) => setF((s) => ({ ...s, ...p }));
  const futureDone = f.status === "DONE" && f.date > todayISO();
  const valid = !!f.companyId && !!f.date && !futureDone;

  return (
    <form
      className="inv-form"
      aria-label={initial ? "Edit meeting" : "Add meeting"}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setSaving(true);
        const r = await saveMeeting(initial?.id ?? null, {
          companyId: f.companyId,
          date: f.date,
          type: f.type as Input["type"],
          status: f.status,
          attendees: f.attendees,
          notes: f.notes.trim() || null,
        });
        setSaving(false);
        if (!r.ok) return toast(r.error);
        toast(initial ? "Meeting updated." : f.status === "PLANNED" ? "Meeting planned." : "Meeting added.");
        announceMeetings(r.data);
        onDone(r.data);
      }}
    >
      <div className="grid3">
        {!companyId && companies && (
          <label className="field">
            <span>Company</span>
            <select className="sel" value={f.companyId} onChange={(e) => set({ companyId: e.target.value })} required>
              <option value="">Choose…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Meeting date</span>
          <input className="inp" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} required />
        </label>
        <label className="field">
          <span>Type</span>
          <select className="sel" value={f.type} onChange={(e) => set({ type: e.target.value })}>
            {MEETING_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Status</span>
          <select className="sel" value={f.status} onChange={(e) => set({ status: e.target.value as Input["status"] })}>
            {MEETING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {MEETING_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <span>Who is going</span>
          <ChipPicker value={f.attendees} onChange={(v) => set({ attendees: v })} pool={pools.PE} label="Who is going" />
        </div>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>{f.status === "DONE" ? "Notes and next steps" : "Agenda or notes"}</span>
          <textarea className="ta" style={{ minHeight: 70 }} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
      </div>
      {futureDone && <p className="hint err">A meeting can&apos;t be done on a future date. Keep it as Planned.</p>}
      <div className="foot">
        <button className="btn-ghost sm" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn sm primary" type="submit" disabled={!valid || saving}>
          {saving ? "Saving…" : initial ? "Save meeting" : "Add meeting"}
        </button>
      </div>
    </form>
  );
}

/** One group of meetings (overdue / upcoming / past). */
export function MeetingList({
  title,
  items,
  showCompany,
  empty,
  onChanged,
  onEdit,
  onOpenCompany,
}: {
  title: string;
  items: MeetingItem[];
  showCompany: boolean;
  empty?: string;
  onChanged: (list: MeetingItem[]) => void;
  onEdit: (m: MeetingItem) => void;
  onOpenCompany?: (id: string) => void;
}) {
  const { toast } = useStore();
  const [confirm, setConfirm] = useState<string | null>(null);
  const today = todayISO();
  if (!items.length && !empty) return null;
  return (
    <section className="mtg-group">
      <h3>
        {title} <span className="n">{items.length}</span>
      </h3>
      {!items.length ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="mtg-list">
          {items.map((m) => (
            <li key={m.id} className={isOverdueMeeting(m, today) ? "overdue" : undefined}>
              <div className="mtg-date">{fmtDate(m.date)}</div>
              <div className="mtg-main">
                <div>
                  {showCompany &&
                    (onOpenCompany ? (
                      <button className="co-name" type="button" onClick={() => onOpenCompany(m.companyId)}>
                        {m.companyName}
                      </button>
                    ) : (
                      <strong>{m.companyName}</strong>
                    ))}
                  {showCompany && " · "}
                  {m.type}
                  <span className={"mtg-status " + m.status.toLowerCase()}>
                    {isOverdueMeeting(m, today) ? "Not marked done" : MEETING_STATUS_LABELS[m.status]}
                  </span>
                </div>
                {m.attendees.length > 0 && <div className="sub">{m.attendees.join(", ")}</div>}
                {m.notes && <div className="mtg-notes">{m.notes}</div>}
              </div>
              <div className="acts">
                {m.status === "PLANNED" && m.date <= today && (
                  <button className="btn-ghost sm" type="button" onClick={() => onEdit({ ...m, status: "DONE" })}>
                    Mark done
                  </button>
                )}
                <button className="btn-ghost sm" type="button" onClick={() => onEdit(m)}>
                  Edit
                </button>
                <button
                  className="btn-ghost sm danger-text"
                  type="button"
                  onClick={async () => {
                    if (confirm !== m.id) return setConfirm(m.id);
                    setConfirm(null);
                    const r = await deleteMeeting(m.id);
                    if (!r.ok) return toast(r.error);
                    toast("Meeting removed.");
                    announceMeetings(r.data);
                    onChanged(r.data);
                  }}
                >
                  {confirm === m.id ? "Confirm remove" : "Remove"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
