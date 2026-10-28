"use client";

import { useState } from "react";
import { importMisTable } from "@/actions/misHistory";
import { MONEY_SCALES, type MoneyScale } from "@/lib/domain/misHistory";
import type { MisReadView } from "@/lib/domain/types";
import { useStore } from "../store";
import { Modal, ModalHead } from "../ui/overlay";

// Paste from Excel (SPEC §15.11): a copied table → the review screen. No AI; nothing is saved here.

const SCALE_LABELS: Record<MoneyScale, string> = { Rupees: "₹", Thousand: "₹ thousand", Lakh: "₹ lakh", Mn: "₹ mn", Cr: "₹ Cr", Bn: "₹ bn" };

export function MisPaste({ companyId, onClose, onRead }: { companyId: string; onClose: () => void; onRead: (view: MisReadView) => void }) {
  const { toast } = useStore();
  const [text, setText] = useState("");
  const [scale, setScale] = useState<MoneyScale>("Cr");
  const [section, setSection] = useState("P&L");
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    const r = await importMisTable(companyId, text, scale, section);
    setBusy(false);
    if (!r.ok) return toast(r.error);
    onRead(r.data);
  };

  return (
    <Modal onClose={onClose} size="wide" busy={busy} labelledBy="mp-title">
      <ModalHead
        id="mp-title"
        title="Paste from Excel"
        sub="Copy a table in Excel with periods across the top (Q2 FY27, H1 FY27, FY26, Sep-26) and line names down the first column, then paste it here. A row with a name and no figures starts a new section."
        onClose={onClose}
      />
      <div className="m-content">
        <div className="grid2">
          <label className="field">
            <span>Money in</span>
            <select className="sel" style={{ width: "100%" }} value={scale} onChange={(e) => setScale(e.target.value as MoneyScale)}>
              {MONEY_SCALES.map((s) => (
                <option key={s} value={s}>
                  {SCALE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Section</span>
            <input className="inp" value={section} onChange={(e) => setSection(e.target.value)} />
          </label>
          <label className="field full">
            <span>Table</span>
            <textarea
              className="ta mp-ta"
              rows={12}
              autoFocus
              spellCheck={false}
              value={text}
              placeholder={"Rs Cr\tQ1 FY27\tQ2 FY27\nRevenue\t270.1\t291.3\nEBITDA\t(10.3)\t(9.9)"}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
        </div>
      </div>
      <div className="m-foot">
        <span className="left">Percent lines are spotted from &quot;%&quot; or &quot;margin&quot;. You can change units in the review.</span>
        <button className="btn" type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn primary" type="button" onClick={go} disabled={busy || !text.trim()}>
          {busy ? "Reading…" : "Review figures"}
        </button>
      </div>
    </Modal>
  );
}
