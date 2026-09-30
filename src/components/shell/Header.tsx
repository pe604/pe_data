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
      await saveBlob(await res.blob(), name ? decodeURIComponent(name) : "Niveshaay Deal Pipeline.xlsx");
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
        <span className="app">Deal pipeline</span>
      </div>
      <div className="top-right">
        <button className="btn" type="button" onClick={exportExcel} disabled={busy}>
          <IconDownload />
          {busy ? "Preparing…" : "Export to Excel"}
        </button>
        <button className="btn primary" type="button" onClick={openAdd}>
          <IconPlus />
          Add company
        </button>
      </div>
    </header>
  );
}
