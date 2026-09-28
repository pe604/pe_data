"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconX } from "./icons";

// ─── Popover ─────────────────────────────────────────────────────────────────

export function Popover({
  anchor,
  onClose,
  width = 280,
  children,
  label,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  // Position below the anchor (or above if there's no room); re-run when the content grows.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = Math.max(12, Math.min(r.left, innerWidth - w - 12));
      let top = r.bottom + 6;
      if (top + h > innerHeight - 12) top = Math.max(12, Math.min(r.top - h - 6, innerHeight - h - 12));
      setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchor]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      // Clicks inside a modal opened from the popover shouldn't close it.
      if ((t as Element).closest?.(".modal-root")) return;
      close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
      }
    };
    const scroll = (e: Event) => {
      if (e.target instanceof Node && (e.target as Element).contains?.(anchor)) close.current();
    };
    document.addEventListener("mousedown", down, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={ref}
      className="pop"
      role="dialog"
      aria-label={label}
      style={{ width, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      {children}
    </div>,
    document.body,
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────

export function Modal({
  onClose,
  size,
  busy,
  children,
  labelledBy,
}: {
  onClose: () => void;
  size?: "" | "wide" | "full";
  busy?: boolean;
  children: React.ReactNode;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    close.current = onClose;
    busyRef.current = busy;
  }, [onClose, busy]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector(".pop")) return; // popover handles its own Escape
      const roots = document.querySelectorAll(".modal-root");
      if (roots[roots.length - 1] !== ref.current?.parentElement) return; // only the top modal
      e.stopPropagation();
      if (!busyRef.current) close.current();
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      prev?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      className="modal-root"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busyRef.current) onClose();
      }}
    >
      <div ref={ref} className={"modal " + (size ?? "")} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ModalHead({ title, sub, onClose, id }: { title: string; sub?: string; onClose?: () => void; id?: string }) {
  return (
    <div className="m-head">
      <div>
        <h2 id={id}>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {onClose && (
        <button className="icon-btn" type="button" onClick={onClose} aria-label="Close">
          <IconX />
        </button>
      )}
    </div>
  );
}

export function ConfirmModal({
  title,
  text,
  okLabel,
  danger,
  onOk,
  onCancel,
}: {
  title: string;
  text: string;
  okLabel: string;
  danger?: boolean;
  onOk: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal onClose={onCancel}>
      <ModalHead title={title} sub={text} />
      <div className="m-foot">
        <button className="btn" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className={"btn " + (danger ? "danger-solid" : "primary")} type="button" onClick={onOk} autoFocus>
          {okLabel}
        </button>
      </div>
    </Modal>
  );
}

/** Modal with a required reason (Reject, Delete). */
export function ReasonModal({
  title,
  sub,
  label,
  placeholder,
  okLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  sub: string;
  label: string;
  placeholder: string;
  okLabel: string;
  onSubmit: (reason: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal onClose={onCancel} busy={busy}>
      <ModalHead title={title} sub={sub} />
      <div className="m-content">
        <label className="field" style={{ margin: 0 }}>
          <span>{label}</span>
          <textarea className="ta" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} autoFocus />
        </label>
      </div>
      <div className="m-foot">
        <button className="btn" type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn danger-solid"
          type="button"
          disabled={!v.trim() || busy}
          onClick={async () => {
            setBusy(true);
            const ok = await onSubmit(v.trim());
            if (!ok) setBusy(false);
          }}
        >
          {busy ? "Saving…" : okLabel}
        </button>
      </div>
    </Modal>
  );
}
