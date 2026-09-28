"use client";

import { useEffect, useState } from "react";
import { addComment, editComment } from "@/actions/misc";
import { FIELD_LABELS } from "@/lib/domain/constants";
import { fmtTime } from "@/lib/domain/dates";
import type { CompanyDetail } from "@/lib/domain/types";
import { useStore } from "../store";

export function CommentsTab({
  detail,
  reload,
  setBusyEditing,
}: {
  detail: CompanyDetail;
  reload: () => Promise<void>;
  setBusyEditing: (b: boolean) => void;
}) {
  const { toast, syncRow } = useStore();
  const [text, setText] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState(false);
  const cid = detail.row.id;

  useEffect(() => setBusyEditing(!!editId), [editId, setBusyEditing]);

  const add = async () => {
    const v = text.trim();
    if (!v) return;
    setBusy(true);
    const r = await addComment(cid, v);
    setBusy(false);
    if (!r.ok) return toast(r.error);
    setText("");
    syncRow(r.data.row);
    void reload();
  };

  return (
    <>
      <div className="cbox">
        <textarea
          className="ta"
          placeholder="Add a comment for the team"
          aria-label="New comment"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void add();
          }}
        />
        <div className="row">
          <span className="hint">Comments are saved with your name and the date.</span>
          <button className="btn primary sm" type="button" onClick={add} disabled={busy || !text.trim()}>
            Add comment
          </button>
        </div>
      </div>
      {!detail.comments.length ? (
        <p className="muted">No comments yet.</p>
      ) : (
        <ul className="clist">
          {detail.comments.map((x) =>
            editId === x.id ? (
              <li key={x.id}>
                <textarea className="ta" value={editText} onChange={(e) => setEditText(e.target.value)} autoFocus aria-label="Edit comment" />
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                  <button className="btn sm" type="button" onClick={() => setEditId(null)}>
                    Cancel
                  </button>
                  <button
                    className="btn sm primary"
                    type="button"
                    disabled={!editText.trim()}
                    onClick={async () => {
                      const r = await editComment(x.id, editText);
                      if (!r.ok) return toast(r.error);
                      setEditId(null);
                      syncRow(r.data.row);
                      void reload();
                    }}
                  >
                    Save
                  </button>
                </div>
              </li>
            ) : (
              <li key={x.id}>
                <div className="chead">
                  <strong>{x.author}</strong>
                  <span>
                    {fmtTime(x.createdAt)}
                    {x.editedAt ? " (edited)" : ""}
                  </span>
                  <span className="grow" />
                  <button
                    className="btn-ghost sm"
                    type="button"
                    onClick={() => {
                      setEditId(x.id);
                      setEditText(x.text);
                    }}
                  >
                    Edit
                  </button>
                </div>
                <div className="ctext">{x.text}</div>
              </li>
            ),
          )}
        </ul>
      )}
    </>
  );
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function HistoryTab({ detail }: { detail: CompanyDetail }) {
  if (!detail.history.length) return <p className="muted">No changes recorded yet.</p>;
  return (
    <ul className="hist">
      {detail.history.map((e) => (
        <li key={e.id}>
          <time>{fmtTime(e.at)}</time>
          <span className="what">
            <b>{e.actor}</b>{" "}
            {e.note ? (
              lowerFirst(e.note)
            ) : (
              <>
                changed {FIELD_LABELS[e.field ?? ""] ?? e.field} from {e.fromValue ?? "empty"} to <b>{e.toValue ?? "empty"}</b>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
