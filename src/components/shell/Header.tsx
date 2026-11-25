"use client";

import { useState } from "react";
import { useStore } from "../store";
import { IconDownload, IconPlus } from "../ui/icons";
import { saveBlob } from "../ui/download";

export function Header() {
  const { openAdd, toast } = useStore();
  const [busy, setBusy] = useState(false);

  const exportExcel = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/export");
      if (!res.ok) throw new Error();
      const name = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get("Content-Disposition") ?? "")?.[1];
      await saveBlob(await res.blob(), name ? decodeURIComponent(name) : "Niveshaay PE Desk.xlsx");
    } catch {
      toast("The Excel file could not be created. Reload the page and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="top">
      <div className="brand">
        <span className="wm">Niveshaay</span>
        <span className="app">PE Desk</span>
      </div>
      <div className="top-right">
        <button className="btn btn-export" type="button" onClick={exportExcel} disabled={busy} aria-label={busy ? "Preparing the Excel file" : "Export to Excel"}>
          <IconDownload />
          <span className="btn-label">{busy ? "Preparing…" : "Export to Excel"}</span>
        </button>
        <button className="btn primary btn-add" type="button" onClick={openAdd} aria-label="Add company">
          <IconPlus />
          <span className="btn-label">Add company</span>
        </button>
      </div>
    </header>
  );
}
