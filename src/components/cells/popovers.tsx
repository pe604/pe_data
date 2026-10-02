"use client";

import { useRef, useState } from "react";
import { setPeople, updateCompany } from "@/actions/companies";
import { addSector } from "@/actions/misc";
import type { PersonRole } from "@/lib/domain/constants";
import { todayISO } from "@/lib/domain/dates";
import { checkLink } from "@/lib/domain/onedrive";
import type { CompanyRow } from "@/lib/domain/types";
import { useStore } from "../store";
import { ChipPicker } from "../ui/ChipPicker";
import { Popover } from "../ui/overlay";

type Base = { c: CompanyRow; anchor: HTMLElement; onClose: () => void };

const ROLE_LABEL: Record<PersonRole, string> = { PE: "Assigned PE", RESEARCH: "Assigned Research", VIA: "Via" };
const ROLE_KEY = { PE: "pe", RESEARCH: "research", VIA: "via" } as const;

export function PeoplePopover({ c, anchor, onClose, role }: Base & { role: PersonRole }) {
  const { pools, mutate, addTeamNames } = useStore();
  const [value, setValue] = useState(c[ROLE_KEY[role]]);
  return (
    <Popover anchor={anchor} onClose={onClose} width={300} label={ROLE_LABEL[role]}>
      <h4>
        {ROLE_LABEL[role]} for {c.name}
      </h4>
      <ChipPicker
        value={value}
        pool={pools[role]}
        label={ROLE_LABEL[role]}
        autoFocus
        onChange={(v) => {
          addTeamNames(v, role, value);
          setValue(v);
          const patch: Partial<CompanyRow> = { [ROLE_KEY[role]]: v };
          // SPEC §7.5, applied optimistically too; the server is the source of truth.
          if (role !== "VIA" && v.length && c.status === "PIPELINE" && c.stage === "NOT_ASSIGNED") patch.stage = "CALL_PENDING";
          void mutate(c.id, patch, () => setPeople(c.id, role, v));
        }}
      />
      <div className="foot">
        <button className="btn sm primary" type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </Popover>
  );
}

export function SectorPopover({ c, anchor, onClose }: Base) {
  const { sectors, setSectors, mutate, me, toast } = useStore();
  const [sectorId, setSectorId] = useState(c.sectorId ?? "");
  const [newName, setNewName] = useState("");
  const [sub, setSub] = useState(c.subSector ?? "");
  const [busy, setBusy] = useState(false);
  const isNew = sectorId === "__new";

  const save = async () => {
    let sid: string | null = sectorId || null;
    let sname = sectors.find((s) => s.id === sid)?.name ?? null;
    if (isNew) {
      if (!newName.trim()) return;
      setBusy(true);
      const r = await addSector(newName);
      setBusy(false);
      if (!r.ok) return toast(r.error);
      setSectors(r.data.sectors);
      sid = r.data.sector.id;
      sname = r.data.sector.name;
    }
    const patch: { sectorId?: string | null; subSector?: string | null } = {};
    if (sid !== c.sectorId) patch.sectorId = sid;
    if (sub.trim() !== (c.subSector ?? "")) patch.subSector = sub.trim() || null;
    onClose();
    if (Object.keys(patch).length) {
      void mutate(
        c.id,
        { ...(patch.sectorId !== undefined ? { sectorId: sid, sector: sname } : {}), ...(patch.subSector !== undefined ? { subSector: patch.subSector } : {}) },
        () => updateCompany(c.id, patch),
      );
    }
  };

  return (
    <Popover anchor={anchor} onClose={onClose} width={300} label="Sector and sub-sector">
      <h4>Sector &amp; sub-sector</h4>
      <label className="field" style={{ marginTop: 0 }}>
        <span>Sector</span>
        <select className="sel" style={{ width: "100%" }} value={sectorId} onChange={(e) => setSectorId(e.target.value)} autoFocus>
          <option value="">Choose a sector</option>
          {sectors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          {me.role === "ADMIN" && <option value="__new">Add a new sector…</option>}
        </select>
      </label>
      {isNew && (
        <label className="field">
          <span>New sector name</span>
          <input className="inp" type="text" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
        </label>
      )}
      <label className="field">
        <span>Sub-sector</span>
        <input
          className="inp"
          type="text"
          value={sub}
          placeholder="e.g. Transmission components"
          onChange={(e) => setSub(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
      </label>
      <div className="foot">
        <button className="btn-ghost sm" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="btn sm primary" type="button" onClick={save} disabled={busy}>
          Save
        </button>
      </div>
    </Popover>
  );
}

export function DatePopover({ c, anchor, onClose }: Base) {
  const { mutate } = useStore();
  const [v, setV] = useState(c.dateReceived ?? "");
  const save = () => {
    onClose();
    const next = v || null;
    if (next !== c.dateReceived) void mutate(c.id, { dateReceived: next }, () => updateCompany(c.id, { dateReceived: next }));
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={240} label="Date received">
      <h4>Date received</h4>
      <input
        className="inp"
        type="date"
        aria-label="Date received"
        value={v}
        max={todayISO()}
        onChange={(e) => setV(e.target.value)}
        autoFocus
        onKeyDown={(e) => e.key === "Enter" && save()}
      />
      <div className="foot">
        <button className="btn-ghost sm" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="btn sm primary" type="button" onClick={save}>
          Save
        </button>
      </div>
    </Popover>
  );
}

/** Paste / edit / remove / copy the OneDrive folder link (SPEC §6.4). */
export function OneDrivePopover({ c, anchor, onClose }: Base) {
  const { mutate, toast } = useStore();
  const [v, setV] = useState(c.oneDriveUrl ?? "");
  const [warn, setWarn] = useState<{ bad: boolean; msg: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const inp = useRef<HTMLInputElement>(null);

  const saveUrl = (url: string | null, msg: string) => {
    onClose();
    if (url !== c.oneDriveUrl) {
      void mutate(c.id, { oneDriveUrl: url }, () => updateCompany(c.id, { oneDriveUrl: url })).then((r) => r && toast(msg));
    }
  };

  const save = () => {
    const t = v.trim();
    if (!t) return saveUrl(null, "OneDrive link removed.");
    const r = checkLink(t);
    if (!r.ok) return setWarn({ bad: true, msg: r.msg });
    if (r.warn && !confirmed) {
      setConfirmed(true);
      return setWarn({ bad: false, msg: r.warn });
    }
    saveUrl(r.url, `OneDrive link saved for ${c.name}.`);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(c.oneDriveUrl ?? "");
      toast("Link copied.");
    } catch {
      inp.current?.select();
      toast("Select the link and press Ctrl+C to copy it.");
    }
  };

  return (
    <Popover anchor={anchor} onClose={onClose} width={340} label="OneDrive folder">
      <h4>OneDrive folder for {c.name}</h4>
      <input
        ref={inp}
        className="inp"
        type="url"
        inputMode="url"
        placeholder="Paste the folder link"
        aria-label="OneDrive link"
        value={v}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setV(e.target.value);
          setConfirmed(false);
          setWarn(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
      />
      {warn && <p className={"od-warn" + (warn.bad ? " bad" : "")}>{warn.msg}</p>}
      <div className="foot">
        {c.oneDriveUrl && (
          <>
            <button className="btn-ghost sm danger-text" type="button" onClick={() => saveUrl(null, "OneDrive link removed.")}>
              Remove
            </button>
            <button className="btn-ghost sm" type="button" onClick={copy}>
              Copy link
            </button>
            <span style={{ flex: 1 }} />
          </>
        )}
        <button className="btn-ghost sm" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="btn sm primary" type="button" onClick={save}>
          {confirmed ? "Save anyway" : "Save"}
        </button>
      </div>
    </Popover>
  );
}
