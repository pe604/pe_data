"use client";

import { useEffect, useMemo, useState } from "react";
import { listMeetings } from "@/actions/tracker";
import { todayISO } from "@/lib/domain/dates";
import { groupMeetings } from "@/lib/domain/quarters";
import type { CompanyRow, MeetingItem } from "@/lib/domain/types";
import { useStore } from "../store";
import { MEETINGS_EVENT, MeetingForm, MeetingList } from "./meetings";

/** Invested tab → Meetings: every visit and call across the portfolio, past and upcoming (SPEC §15). */
export function MeetingsView({ companies }: { companies: CompanyRow[] }) {
  const { toast, openDrawer } = useStore();
  const [list, setList] = useState<MeetingItem[] | null>(null);
  const [editing, setEditing] = useState<MeetingItem | "new" | null>(null);
  const [person, setPerson] = useState("");
  const [company, setCompany] = useState("");

  useEffect(() => {
    let live = true;
    void listMeetings().then((r) => {
      if (!live) return;
      if (r.ok) setList(r.data);
      else toast(r.error);
    });
    const sync = (e: Event) => setList((e as CustomEvent<MeetingItem[]>).detail);
    window.addEventListener(MEETINGS_EVENT, sync);
    return () => {
      live = false;
      window.removeEventListener(MEETINGS_EVENT, sync);
    };
  }, [toast]);

  const people = useMemo(() => [...new Set((list ?? []).flatMap((m) => m.attendees))].sort(), [list]);
  const shown = useMemo(
    () => (list ?? []).filter((m) => (!person || m.attendees.includes(person)) && (!company || m.companyId === company)),
    [list, person, company],
  );
  const g = groupMeetings(shown, todayISO());
  const options = companies.map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
  const done = (l: MeetingItem[]) => {
    setList(l);
    setEditing(null);
  };

  return (
    <div className="pview">
      <div className="pview-head">
        <label className="sortwrap">
          Person
          <select className="sel" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Filter by person">
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="sortwrap">
          Company
          <select className="sel" value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Filter by company">
            <option value="">All companies</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <span className="tb-spacer" />
        {editing === null && (
          <button className="btn primary" type="button" onClick={() => setEditing("new")}>
            Add meeting
          </button>
        )}
      </div>
      {editing !== null && (
        <MeetingForm
          key={editing === "new" ? "new" : editing.id + editing.status}
          initial={editing === "new" ? null : editing}
          companies={options}
          companyId={editing === "new" ? company || undefined : undefined}
          onDone={done}
          onCancel={() => setEditing(null)}
        />
      )}
      {!list ? (
        <p className="muted">Loading…</p>
      ) : !list.length && editing === null ? (
        <div className="empty">
          <h3>No meetings yet</h3>
          <p>Plan visits and calls with portfolio companies here, then mark them done with notes.</p>
        </div>
      ) : (
        <>
          <MeetingList title="Needs updating" items={g.overdue} showCompany onChanged={setList} onEdit={setEditing} onOpenCompany={(id) => openDrawer(id, "meetings")} />
          <MeetingList
            title="Upcoming"
            items={g.upcoming}
            showCompany
            empty="No meetings planned."
            onChanged={setList}
            onEdit={setEditing}
            onOpenCompany={(id) => openDrawer(id, "meetings")}
          />
          <MeetingList title="Past" items={g.past} showCompany empty="No past meetings." onChanged={setList} onEdit={setEditing} onOpenCompany={(id) => openDrawer(id, "meetings")} />
        </>
      )}
    </div>
  );
}

/** Company file → Meetings tab: this company's meetings only. */
export function CompanyMeetings({ companyId }: { companyId: string }) {
  const { toast } = useStore();
  const [list, setList] = useState<MeetingItem[] | null>(null);
  const [editing, setEditing] = useState<MeetingItem | "new" | null>(null);

  useEffect(() => {
    let live = true;
    void listMeetings().then((r) => {
      if (!live) return;
      if (r.ok) setList(r.data);
      else toast(r.error);
    });
    const sync = (e: Event) => setList((e as CustomEvent<MeetingItem[]>).detail);
    window.addEventListener(MEETINGS_EVENT, sync);
    return () => {
      live = false;
      window.removeEventListener(MEETINGS_EVENT, sync);
    };
  }, [toast]);

  const mine = (list ?? []).filter((m) => m.companyId === companyId);
  const g = groupMeetings(mine, todayISO());
  const done = (l: MeetingItem[]) => {
    setList(l);
    setEditing(null);
  };

  return (
    <div className="inv">
      <div className="inv-head">
        <h3>Meetings</h3>
        {editing === null && (
          <button className="btn sm" type="button" onClick={() => setEditing("new")}>
            Add meeting
          </button>
        )}
      </div>
      {editing !== null && (
        <MeetingForm
          key={editing === "new" ? "new" : editing.id + editing.status}
          initial={editing === "new" ? null : editing}
          companyId={companyId}
          onDone={done}
          onCancel={() => setEditing(null)}
        />
      )}
      {!list ? (
        <p className="muted">Loading…</p>
      ) : !mine.length && editing === null ? (
        <p className="muted">No meetings yet. Plan the next visit or call.</p>
      ) : (
        <>
          <MeetingList title="Needs updating" items={g.overdue} showCompany={false} onChanged={setList} onEdit={setEditing} />
          <MeetingList title="Upcoming" items={g.upcoming} showCompany={false} empty="No meetings planned." onChanged={setList} onEdit={setEditing} />
          <MeetingList title="Past" items={g.past} showCompany={false} empty="No past meetings." onChanged={setList} onEdit={setEditing} />
        </>
      )}
    </div>
  );
}
