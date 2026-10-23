"use client";

import { useEffect, useState } from "react";
import { deleteMember, getReminderPanel, renameMember, saveReminderSettings, sendTestReminder, type ReminderPanel } from "@/actions/reminders";
import { fmtDate } from "@/lib/domain/dates";
import { fmtWhatsapp, IDLE_DAYS, REPEAT_DAYS } from "@/lib/domain/reminders";
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
            {panel.members.some((m) => m.pe) ? (
              <ul className="rm-list">
                {panel.members
                  .filter((m) => m.pe)
                  .map((m) => (
                    <MemberRow key={m.memberId} m={m} configured={panel.configured} onSaved={setPanel} />
                  ))}
              </ul>
            ) : (
              <p className="muted">No PE names yet. Add the PE team with Manage.</p>
            )}
            <h3 className="sec-title rm-sec">Research team</h3>
            <p className="hint">
              When someone is assigned a company in Assigned Research, they get a WhatsApp naming the company and its PE team, with the deck
              attached.
            </p>
            {panel.members.some((m) => m.research && !m.pe) ? (
              <ul className="rm-list">
                {panel.members
                  .filter((m) => m.research && !m.pe)
                  .map((m) => (
                    <MemberRow key={m.memberId} m={m} configured={panel.configured} onSaved={setPanel} />
                  ))}
              </ul>
            ) : (
              <p className="muted">No Research names yet. They appear here once someone is assigned in Assigned Research.</p>
            )}
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
            {m.pe && m.research && <span className="rm-tag">also Research</span>}
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
