"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteCompany,
  getCompanyDetail,
  investCompany,
  rejectCompany,
  restoreCompany,
  updateCompany,
} from "@/actions/companies";
import { getJob } from "@/actions/files";
import { STAGE_LABELS } from "@/lib/domain/constants";
import { daysFor, fmtDate, todayISO } from "@/lib/domain/dates";
import type { CompanyDetail } from "@/lib/domain/types";
import { DatePopover, OneDrivePopover, SectorPopover } from "../cells/popovers";
import { useStore, type DrawerTab } from "../store";
import { IconX } from "../ui/icons";
import { ReasonModal } from "../ui/overlay";
import { CommentsTab, HistoryTab } from "./CommentsHistory";
import { MaterialsTab } from "./MaterialsTab";
import { SummaryTab } from "./SummaryTab";

type Props = { openId: string | null; tab: DrawerTab; setTab: (t: DrawerTab) => void; onClose: () => void };

export function Drawer({ openId, tab, setTab, onClose }: Props) {
  const { getRow, detailVersion, syncRow, toast } = useStore();
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [busyEditing, setBusyEditing] = useState(false);
  const row = openId ? getRow(openId) : undefined;
  const closeBtn = useRef<HTMLButtonElement>(null);
  const reqId = useRef(0);

  const reload = useCallback(async () => {
    if (!openId) return;
    const my = ++reqId.current;
    const r = await getCompanyDetail(openId);
    if (my !== reqId.current) return;
    if (r.ok) {
      setDetail(r.data);
      syncRow(r.data.row);
    } else {
      toast(r.error);
    }
  }, [openId, syncRow, toast]);

  // Stale detail for another company is ignored below (`d`), so no need to clear it here.
  useEffect(() => {
    // reload() only sets state after its fetch resolves (async), not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (openId) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, detailVersion]);

  useEffect(() => {
    if (openId) setTimeout(() => closeBtn.current?.focus(), 50);
  }, [openId]);

  // Poll a running summary job; refresh when it finishes.
  const jobId = detail?.activeJob?.id;
  useEffect(() => {
    if (!jobId) return;
    const t = setInterval(async () => {
      const r = await getJob(jobId);
      if (!r.ok) return;
      if (r.data.status === "DONE") {
        clearInterval(t);
        toast("Summary ready.");
        void reload();
      } else if (r.data.status === "FAILED" || r.data.status === "CANCELLED") {
        clearInterval(t);
        if (r.data.status === "FAILED") toast(r.data.error ?? "The summary could not be written.");
        void reload();
      } else {
        setDetail((d) => (d && d.activeJob ? { ...d, activeJob: { ...d.activeJob, step: r.data.step } } : d));
      }
    }, 2500);
    return () => clearInterval(t);
  }, [jobId, reload, toast]);

  // Escape closes the drawer (unless a popover, modal or edit is open).
  useEffect(() => {
    if (!openId) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busyEditing) return;
      if (document.querySelector(".pop, .modal-root")) return;
      onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [openId, onClose, busyEditing]);

  const open = !!openId && !!row;
  const d = detail && row && detail.row.id === row.id ? detail : null;

  return (
    <>
      <div className={"scrim" + (open ? " open" : "")} onClick={() => !busyEditing && onClose()} />
      <aside className={"drawer" + (open ? " open" : "")} aria-hidden={!open} aria-label="Company file">
        {open && row && (
          <DrawerBody
            key={row.id}
            closeBtn={closeBtn}
            detail={d}
            tab={tab}
            setTab={setTab}
            onClose={onClose}
            reload={reload}
            setBusyEditing={setBusyEditing}
          />
        )}
      </aside>
    </>
  );
}

function DrawerBody({
  closeBtn,
  detail,
  tab,
  setTab,
  onClose,
  reload,
  setBusyEditing,
}: {
  closeBtn: React.RefObject<HTMLButtonElement | null>;
  detail: CompanyDetail | null;
  tab: DrawerTab;
  setTab: (t: DrawerTab) => void;
  onClose: () => void;
  reload: () => Promise<void>;
  setBusyEditing: (b: boolean) => void;
}) {
  const store = useStore();
  const { mutate, putRow, removeRow, toast } = store;
  const [editName, setEditName] = useState(false);
  const [modal, setModal] = useState<"reject" | "delete" | null>(null);
  const [pop, setPop] = useState<{ kind: "sector" | "od" | "date"; el: HTMLElement } | null>(null);
  const openId = detail?.row.id;
  const c = store.companies.find((x) => x.id === openId) ?? detail?.row;

  useEffect(() => setBusyEditing(editName), [editName, setBusyEditing]);

  if (!c) {
    return (
      <div className="dh">
        <div className="dh-top">
          <button ref={closeBtn} className="icon-btn" type="button" onClick={onClose} aria-label="Close company file">
            <IconX />
          </button>
        </div>
        <p className="muted" style={{ padding: "20px 0" }}>
          Loading…
        </p>
      </div>
    );
  }

  const st = c.status;
  const days = daysFor(c);

  const invest = async () => {
    const r = await mutate(c.id, { status: "INVESTED", exitAt: todayISO(), exitStage: c.stage }, () => investCompany(c.id));
    if (r)
      toast(`${c.name} moved to Invested.`, {
        label: "Undo",
        run: () =>
          void mutate(c.id, { status: "PIPELINE", exitAt: null, exitStage: null }, () => restoreCompany(c.id, true)),
      });
  };
  const restore = async () => {
    const r = await mutate(
      c.id,
      { status: "PIPELINE", exitAt: null, exitStage: null, rejectReason: null, directInvested: false, dateReceived: c.dateReceived ?? todayISO() },
      () => restoreCompany(c.id),
    );
    if (r) toast(`${c.name} is back in the pipeline.`);
  };
  const saveName = (v: string) => {
    setEditName(false);
    const n = v.trim();
    if (n && n !== c.name) void mutate(c.id, { name: n }, () => updateCompany(c.id, { name: n }));
  };

  const tabs: [DrawerTab, string, number | null][] = [
    ["summary", "Summary", null],
    ["materials", "Materials", detail?.files.length ?? c.fileCount],
    ["comments", "Comments", detail?.comments.length ?? c.commentCount],
    ["history", "History", null],
  ];

  return (
    <>
      <div className="dh">
        <div className="dh-top">
          <button ref={closeBtn} className="icon-btn" type="button" onClick={onClose} aria-label="Close company file">
            <IconX />
          </button>
          <div className="dh-actions">
            {st === "PIPELINE" ? (
              <>
                <button className="btn" type="button" onClick={invest}>
                  Invest
                </button>
                <button className="btn danger" type="button" onClick={() => setModal("reject")}>
                  Reject
                </button>
              </>
            ) : (
              <button className="btn" type="button" onClick={restore}>
                Restore to pipeline
              </button>
            )}
            <button className="btn-ghost danger-text" type="button" onClick={() => setModal("delete")}>
              Delete
            </button>
          </div>
        </div>
        {editName ? (
          <input
            className="dh-name-input"
            defaultValue={c.name}
            aria-label="Company name"
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveName(e.currentTarget.value);
              if (e.key === "Escape") {
                e.stopPropagation();
                setEditName(false);
              }
            }}
            onBlur={(e) => saveName(e.currentTarget.value)}
          />
        ) : (
          <h2 className="dh-name">
            <button type="button" title="Rename" onClick={() => setEditName(true)}>
              {c.name || "Untitled"}
            </button>
          </h2>
        )}
        <div className="dh-meta">
          <span className={"badge " + st.toLowerCase()}>{st === "PIPELINE" ? "Pipeline" : st === "REJECTED" ? "Rejected" : "Invested"}</span>
          <button className="meta-btn" type="button" onClick={(e) => setPop({ kind: "sector", el: e.currentTarget })}>
            {c.sector || c.subSector ? [c.sector, c.subSector].filter(Boolean).join(", ") : "Add sector"}
          </button>
          {c.oneDriveUrl ? (
            <>
              <a className="meta-btn" href={c.oneDriveUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--green)", fontWeight: 500 }}>
                OneDrive folder
              </a>
              <button className="meta-btn" type="button" style={{ color: "var(--muted)" }} onClick={(e) => setPop({ kind: "od", el: e.currentTarget })}>
                Edit link
              </button>
            </>
          ) : (
            <button className="meta-btn" type="button" onClick={(e) => setPop({ kind: "od", el: e.currentTarget })}>
              Add OneDrive link
            </button>
          )}
          <button
            className="meta-btn"
            type="button"
            title="Change the date received"
            onClick={(e) => setPop({ kind: "date", el: e.currentTarget })}
          >
            {c.dateReceived ? `Received ${fmtDate(c.dateReceived)}` : "Set date received"}
          </button>
          {c.dateReceived && (
            <span>
              {days} days{st !== "PIPELINE" ? " in pipeline" : ""}
            </span>
          )}
          {st === "PIPELINE" && <span>{STAGE_LABELS[c.stage]}</span>}
        </div>
        {st === "REJECTED" && (
          <div className="reject-note">
            <strong>Rejected on {fmtDate(c.exitAt)}.</strong> {c.rejectReason}
          </div>
        )}
        {st === "INVESTED" && (
          <div className="reject-note" style={{ background: "var(--gold-soft)" }}>
            <strong style={{ color: "var(--gold)" }}>
              {c.exitAt ? `Invested on ${fmtDate(c.exitAt)}.` : "Portfolio company, added directly to Invested."}
            </strong>
          </div>
        )}
        <nav className="dtabs" role="tablist" aria-label="Company file sections">
          {tabs.map(([k, l, n]) => (
            <button key={k} className="dtab" role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}>
              {l}
              {n ? <span className="n">{n}</span> : null}
            </button>
          ))}
        </nav>
      </div>
      <div className="dbody">
        {!detail ? (
          <p className="muted">Loading…</p>
        ) : tab === "summary" ? (
          <SummaryTab detail={detail} reload={reload} goMaterials={() => setTab("materials")} setBusyEditing={setBusyEditing} />
        ) : tab === "materials" ? (
          <MaterialsTab detail={detail} reload={reload} />
        ) : tab === "comments" ? (
          <CommentsTab detail={detail} reload={reload} setBusyEditing={setBusyEditing} />
        ) : (
          <HistoryTab detail={detail} />
        )}
      </div>

      {pop?.kind === "sector" && <SectorPopover c={c} anchor={pop.el} onClose={() => setPop(null)} />}
      {pop?.kind === "od" && <OneDrivePopover c={c} anchor={pop.el} onClose={() => setPop(null)} />}
      {pop?.kind === "date" && <DatePopover c={c} anchor={pop.el} onClose={() => setPop(null)} />}

      {modal === "reject" && (
        <ReasonModal
          title={`Reject ${c.name}`}
          sub="The company moves to Rejected with this reason. You can restore it later."
          label="Reason for rejecting"
          placeholder="e.g. Valuation too rich at ₹400 Cr pre-money on ₹55 Cr revenue"
          okLabel="Reject company"
          onCancel={() => setModal(null)}
          onSubmit={async (reason) => {
            const r = await rejectCompany(c.id, reason);
            if (!r.ok) {
              toast(r.error);
              return false;
            }
            putRow(r.data);
            setModal(null);
            toast(`${c.name} moved to Rejected.`);
            return true;
          }}
        />
      )}
      {modal === "delete" && (
        <ReasonModal
          title={`Delete ${c.name} permanently?`}
          sub="This removes the company, its files and its history for everyone. Use Reject instead to keep a record."
          label="Reason for deleting"
          placeholder="e.g. Duplicate entry"
          okLabel="Delete permanently"
          onCancel={() => setModal(null)}
          onSubmit={async (reason) => {
            const r = await deleteCompany(c.id, reason);
            if (!r.ok) {
              toast(r.error);
              return false;
            }
            setModal(null);
            onClose();
            removeRow(c.id);
            toast(`${c.name} was deleted.`);
            return true;
          }}
        />
      )}
    </>
  );
}
