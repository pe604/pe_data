"use client";

import { useEffect, useState } from "react";
import { checkNewsNow, getNewsWatch, saveNewsWatch, type NewsWatchView } from "@/actions/news";
import { fmtTime } from "@/lib/domain/dates";
import { useStore } from "../store";

// Company file → Overview → News watch (SPEC §15.10): what the news agent searches for, and Check now.

export function NewsWatchCard({ companyId, onFound }: { companyId: string; onFound: () => Promise<void> }) {
  const { toast } = useStore();
  const [w, setW] = useState<NewsWatchView | null>(null);
  const [editing, setEditing] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let live = true;
    void getNewsWatch(companyId).then((r) => live && (r.ok ? setW(r.data) : toast(r.error)));
    return () => {
      live = false;
    };
  }, [companyId, toast]);

  const check = async () => {
    setChecking(true);
    const r = await checkNewsNow(companyId);
    setChecking(false);
    if (!r.ok) return toast(r.error);
    setW(r.data.watch);
    if (r.data.added) await onFound(); // refreshes the company file and its table row (latest update)
    toast(
      r.data.added
        ? `Found ${r.data.added} material update${r.data.added === 1 ? "" : "s"}${r.data.alerted ? `; ${r.data.alerted} sent on WhatsApp` : ""}. See Updates.`
        : r.data.judged
          ? `Checked ${r.data.judged} new item${r.data.judged === 1 ? "" : "s"}; nothing material.`
          : "No new news or posts.",
    );
  };

  return (
    <section>
      <div className="inv-head">
        <h3>News watch</h3>
        {w && !editing && (
          <span className="acts">
            <button className="btn sm" type="button" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="btn sm" type="button" onClick={check} disabled={checking || !w.ai || !w.enabled} title={!w.ai ? "Needs the AI key" : undefined}>
              {checking ? "Checking… (up to a minute)" : "Check now"}
            </button>
          </span>
        )}
      </div>
      {!w ? (
        <p className="muted">Loading…</p>
      ) : editing ? (
        <WatchForm
          initial={w}
          onCancel={() => setEditing(false)}
          onSave={async (v) => {
            const r = await saveNewsWatch(companyId, v);
            if (!r.ok) {
              toast(r.error);
              return;
            }
            setW(r.data);
            setEditing(false);
            toast("News watch saved.");
          }}
        />
      ) : (
        <div className="nw">
          <p>
            {w.enabled ? "Searching news" : <span className="warn-text">Off: not searched</span>}
            {w.enabled && (
              <>
                {" for "}
                {w.names.map((n, i) => (
                  <span key={n}>
                    {i > 0 && ", "}
                    <strong>{n}</strong>
                  </span>
                ))}
                {w.linkedinUrl ? " and the company's LinkedIn posts" : ""}.
              </>
            )}
          </p>
          {w.isDefault && w.enabled && (
            <p className="hint warn-text">Using the dashboard name. Add the legal and brand names, website and LinkedIn page so news about other companies isn&rsquo;t picked up.</p>
          )}
          {!w.linkedinUrl && w.enabled && !w.isDefault && <p className="hint">No LinkedIn page set, so only news is searched.</p>}
          {w.linkedinUrl && !w.linkedin && <p className="hint warn-text">LinkedIn isn&rsquo;t connected (APIFY_TOKEN), so only news is searched.</p>}
          <p className="hint">
            {w.lastCheckedAt ? `Last checked ${fmtTime(w.lastCheckedAt)}` : "Not checked yet"} · {w.seen} item{w.seen === 1 ? "" : "s"} seen, {w.material} material.
            Checked at 9 am and 6 pm.
          </p>
        </div>
      )}
    </section>
  );
}

function WatchForm({
  initial,
  onCancel,
  onSave,
}: {
  initial: NewsWatchView;
  onCancel: () => void;
  onSave: (v: { names: string[]; website: string; linkedinUrl: string; enabled: boolean }) => Promise<void>;
}) {
  const [names, setNames] = useState(initial.names.join(", "));
  const [website, setWebsite] = useState(initial.website ?? "");
  const [linkedin, setLinkedin] = useState(initial.linkedinUrl ?? "");
  const [enabled, setEnabled] = useState(initial.enabled);
  const [saving, setSaving] = useState(false);
  const list = names
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  return (
    <form
      className="inv-form"
      aria-label="News watch"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        await onSave({ names: list, website, linkedinUrl: linkedin, enabled });
        setSaving(false);
      }}
    >
      <label className="field">
        <span>Names to search for, separated by commas</span>
        <input className="inp" value={names} onChange={(e) => setNames(e.target.value)} placeholder="e.g. Kimbal, Kimbal Technologies" />
        <span className="hint">Legal and brand names. Avoid plain words that also mean other things.</span>
      </label>
      <label className="field">
        <span>Website</span>
        <input className="inp" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="example.com" />
      </label>
      <label className="field">
        <span>LinkedIn company page</span>
        <input className="inp" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="linkedin.com/company/example" />
      </label>
      <label className="ck">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Watch this company
      </label>
      <div className="foot">
        <button className="btn-ghost sm" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn sm primary" type="submit" disabled={saving || !list.length}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
