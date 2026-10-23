"use client";

import { useEffect, useState } from "react";
import {
  addMember,
  deleteMember,
  getReminderPanel,
  renameMember,
  saveReminderSettings,
  sendTestReminder,
  setMemberTeam,
  type ReminderPanel,
} from "@/actions/reminders";
import { fmtDate } from "@/lib/domain/dates";
import { fmtWhatsapp, IDLE_DAYS, REPEAT_DAYS, TEAM_LABELS, TEAMS } from "@/lib/domain/reminders";
import type { MemberIdle } from "@/lib/whatsapp/reminders";
import { useStore } from "../store";
import { Modal, ModalHead } from "../ui/overlay";

/**
 * WhatsApp numbers for the PE and Research teams (SPEC §15.7, §15.8): number, messages on/off, test; PEs also see
 * their idle deals.
 */
export function RemindersModal({ onClose }: { onClose: () => void }) {
  const { toast } = useStore();
  const [panel, setPanel] = useState<ReminderPanel | null>(null);

  useEffect(() => {
    void getReminderPanel().then((r) => (r.ok ? setPanel(r.data) : toast(r.error)));
  }, [toast]);
  // Each person shows once: a team (e.g. Scuttlebutt) first, then PE, then Research.
  const pe = panel?.members.filter((m) => m.pe && !m.team) ?? [];
  const research = panel?.members.filter((m) => m.research && !m.pe && !m.team) ?? [];

  return (
    <Modal onClose={onClose} size="wide" labelledBy="rm-title">
      <ModalHead id="rm-title" title="WhatsApp" sub="Team numbers for idle deal reminders and Research assignment messages." onClose={onClose} />
      <div className="m-content">
        {!panel ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            {!panel.configured && <div className="banner info">WhatsApp isn&rsquo;t connected, so nothing is sent. Numbers can still be saved.</div>}
            <h3 className="sec-title rm-sec">PE team</h3>
            <p className="hint">
              When a pipeline deal has no activity for {IDLE_DAYS} days, its PE gets a WhatsApp at 10 am, then every {REPEAT_DAYS} days until
              something changes. A stage change, comment, file, edit or new assignment counts as activity.
            </p>
            <Section members={pe} panel={panel} setPanel={setPanel} empty="No PE names yet. Add the PE team with Manage." />
            <h3 className="sec-title rm-sec">Research team</h3>
            <p className="hint">
              When someone is assigned a company in Assigned Research, they get a WhatsApp naming the company and its PE team, with the deck
              attached.
            </p>
            <Section
              members={research}
              panel={panel}
              setPanel={setPanel}
              empty="No Research names yet. They appear here once someone is assigned in Assigned Research, or add them below."
            />
            {TEAMS.map((t) => (
              <div key={t}>
                <h3 className="sec-title rm-sec">{TEAM_LABELS[t]} team</h3>
                <p className="hint">
                  Assigned through Assigned Research. A member gets the usual message and deck; the head is also told which member was
                  assigned, with the deck.
                </p>
                <Section
                  members={panel.members.filter((m) => m.team === t).sort((a, b) => Number(b.teamHead) - Number(a.teamHead))}
                  panel={panel}
                  setPanel={setPanel}
                  empty={`No one in ${TEAM_LABELS[t]} yet. Move someone here with their Team choice, or add them below.`}
                />
              </div>
            ))}
            <AddPerson onSaved={setPanel} />
          </>
        )}
      </div>
      <div className="m-foot">
        <button className="btn" type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

function Section({ members, panel, setPanel, empty }: { members: MemberIdle[]; panel: ReminderPanel; setPanel: (p: ReminderPanel) => void; empty: string }) {
  if (!members.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="rm-list">
      {members.map((m) => (
        <MemberRow key={m.memberId} m={m} configured={panel.configured} onSaved={setPanel} />
      ))}
    </ul>
  );
}

const TEAM_OPTIONS: [string, string][] = [["", "Research"], ...TEAMS.flatMap((t): [string, string][] => [[t, TEAM_LABELS[t]], [`${t}_HEAD`, `${TEAM_LABELS[t]} head`]])];
const teamValue = (m: MemberIdle) => (m.team ? (m.teamHead ? `${m.team}_HEAD` : m.team) : "");

/** Add a Research person (optionally straight into a team) before their first assignment. */
function AddPerson({ onSaved }: { onSaved: (p: ReminderPanel) => void }) {
  const { toast, refresh } = useStore();
  const [name, setName] = useState("");
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const r = await addMember(name, team);
    setBusy(false);
    if (!r.ok) return toast(r.error);
    onSaved(r.data);
    void refresh();
    toast(`Added ${name.trim()}.`);
    setName("");
  };
  return (
    <div className="rm-add">
      <h3 className="sec-title rm-sec">Add a person</h3>
      <div className="rm-top">
        <label className="rm-num">
          <span className="sr-only">Name of the person to add</span>
          <input className="inp" placeholder="Name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
        </label>
        <label>
          <span className="sr-only">Team for the new person</span>
          <select className="sel" value={team} onChange={(e) => setTeam(e.target.value)}>
            {TEAM_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <button className="btn sm primary" type="button" onClick={add} disabled={busy || !name.trim()}>
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  );
}

function MemberRow({ m, configured, onSaved }: { m: MemberIdle; configured: boolean; onSaved: (p: ReminderPanel) => void }) {
  const { toast } = useStore();
  const [num, setNum] = useState(fmtWhatsapp(m.whatsappNumber));
  const [on, setOn] = useState(m.remindersOn);
  const { refresh } = useStore();
  const [busy, setBusy] = useState<"" | "save" | "test" | "rename" | "delete">("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = num.trim() !== fmtWhatsapp(m.whatsappNumber) || on !== m.remindersOn;
  const first = m.name.split(" ")[0];

  const rename = async () => {
    if (renaming === null || !renaming.trim() || renaming.trim() === m.name) return setRenaming(null);
    setBusy("rename");
    const r = await renameMember(m.memberId, renaming);
    setBusy("");
    if (!r.ok) return toast(r.error);
    setRenaming(null);
    onSaved(r.data);
    void refresh();
    toast(`Renamed ${m.name}.`);
  };

  const changeTeam = async (choice: string) => {
    setBusy("save");
    const r = await setMemberTeam(m.memberId, choice);
    setBusy("");
    if (!r.ok) return toast(r.error);
    onSaved(r.data);
    const label = TEAM_OPTIONS.find(([v]) => v === choice)?.[1] ?? "Research";
    toast(`${m.name} is now in ${label === "Research" ? "Research" : label.endsWith("head") ? `charge of ${label.replace(/ head$/, "")}` : label}.`);
  };

  const remove = async () => {
    setBusy("delete");
    const r = await deleteMember(m.memberId);
    setBusy("");
    if (!r.ok) return toast(r.error);
    onSaved(r.data);
    void refresh();
    toast(`Deleted ${m.name}.`);
  };
  const due = m.idle.filter((i) => i.due).length;

  const save = async () => {
    setBusy("save");
    const r = await saveReminderSettings(m.memberId, num, on);
    setBusy("");
    if (!r.ok) return toast(r.error);
    const saved = r.data.members.find((x) => x.memberId === m.memberId);
    setNum(fmtWhatsapp(saved?.whatsappNumber ?? null));
    onSaved(r.data);
    toast(`Saved for ${m.name}.`);
  };

  const test = async () => {
    setBusy("test");
    const r = await sendTestReminder(m.memberId);
    setBusy("");
    toast(r.ok ? `Test sent to ${m.name}.` : r.error);
  };

  return (
    <li className="rm-row">
      <div className="rm-top">
        {renaming !== null ? (
          <span className="rm-name rm-rename">
            <label>
              <span className="sr-only">New name for {m.name}</span>
              <input
                className="inp"
                value={renaming}
                autoFocus
                maxLength={60}
                onChange={(e) => setRenaming(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void rename();
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setRenaming(null);
                  }
                }}
              />
            </label>
            <button className="btn sm primary" type="button" onClick={rename} disabled={!!busy}>
              {busy === "rename" ? "Saving…" : "Save name"}
            </button>
            <button className="btn-ghost sm" type="button" onClick={() => setRenaming(null)}>
              Cancel
            </button>
          </span>
        ) : (
          <strong className="rm-name">
            {m.name}
            {m.teamHead && <span className="rm-tag">Head</span>}
            {m.pe && m.research && !m.team && <span className="rm-tag">also Research</span>}
          </strong>
        )}
        <label className="rm-num">
          <span className="sr-only">WhatsApp number for {m.name}</span>
          <input
            className="inp"
            type="tel"
            inputMode="tel"
            placeholder="WhatsApp number, e.g. +91 98765 43210"
            value={num}
            onChange={(e) => setNum(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && dirty && void save()}
          />
        </label>
        <label className="ck">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
          Messages on
        </label>
        {(!m.pe || m.team) && (
          <label>
            <span className="sr-only">Team for {m.name}</span>
            <select className="sel sm" value={teamValue(m)} onChange={(e) => void changeTeam(e.target.value)} disabled={!!busy}>
              {TEAM_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        )}
        {dirty ? (
          <button className="btn sm primary" type="button" onClick={save} disabled={!!busy}>
            {busy === "save" ? "Saving…" : "Save"}
          </button>
        ) : (
          <button
            className="btn sm"
            type="button"
            onClick={test}
            disabled={!!busy || !configured || !m.whatsappNumber}
            title={!m.whatsappNumber ? "Save a number first" : !configured ? "WhatsApp isn't connected" : undefined}
          >
            {busy === "test" ? "Sending…" : "Send test"}
          </button>
        )}
        <span className="rm-acts">
          <button className="btn-ghost sm" type="button" onClick={() => setRenaming(m.name)} disabled={!!busy || renaming !== null}>
            Rename
          </button>
          <button className="btn-ghost sm danger-text" type="button" onClick={() => setConfirmDelete(true)} disabled={!!busy}>
            Delete
          </button>
        </span>
      </div>
      {confirmDelete && (
        <div className="banner err rm-confirm" role="alert">
          <span>
            Delete {m.name}?{" "}
            {m.companies
              ? `${first} will be removed from ${m.companies} compan${m.companies === 1 ? "y" : "ies"} they're assigned to (recorded in each History).`
              : `${first} isn't assigned to any company.`}
          </span>
          <button className="btn sm danger" type="button" onClick={remove} disabled={!!busy}>
            {busy === "delete" ? "Deleting…" : "Delete"}
          </button>
          <button className="btn sm" type="button" onClick={() => setConfirmDelete(false)} disabled={!!busy}>
            Cancel
          </button>
        </div>
      )}
      {!m.pe ? null : m.idle.length === 0 ? (
        <p className="hint">No idle deals.</p>
      ) : (
        <p className="hint rm-idle">
          {m.idle.length} idle deal{m.idle.length === 1 ? "" : "s"}
          {due ? `, ${due} due for a reminder today` : ""}:{" "}
          {m.idle.map((i, k) => (
            <span key={i.companyId}>
              {k > 0 && " · "}
              <span className={i.due ? "warn-text" : undefined}>
                {i.company} {i.idleDays} d
              </span>
              {i.lastReminder && <span className="muted"> (reminded {fmtDate(i.lastReminder)})</span>}
            </span>
          ))}
        </p>
      )}
      {!m.whatsappNumber && m.idle.length > 0 && on && <p className="hint warn-text">No number saved, so {m.name.split(" ")[0]} won&rsquo;t get these.</p>}
      {!m.whatsappNumber && !m.pe && <p className="hint warn-text">No number saved, so {m.name.split(" ")[0]} won&rsquo;t get assignment messages.</p>}
    </li>
  );
}
