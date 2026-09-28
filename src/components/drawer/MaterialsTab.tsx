"use client";

import { useRef, useState } from "react";
import { removeFile, setFileKind } from "@/actions/files";
import { FILE_KIND_LABELS, FILE_KINDS, type FileKind } from "@/lib/domain/constants";
import { fmtTime } from "@/lib/domain/dates";
import type { CompanyDetail, FileItem } from "@/lib/domain/types";
import { useStore } from "../store";
import { downloadUrl } from "../ui/download";
import { ConfirmModal, Modal, ModalHead, Popover } from "../ui/overlay";
import { uploadFile } from "../ui/upload";

const extOf = (n: string) => /\.([a-z0-9]+)$/i.exec(n)?.[1]?.toLowerCase() ?? "";
const MB = 1048576;
export const fmtSize = (b: number) => (b < 1024 ? b + " B" : b < MB ? Math.round(b / 1024) + " KB" : (b / MB).toFixed(1) + " MB");

/** Guess a better kind than the selector's default, as the prototype did. */
function guessKind(name: string, chosen: FileKind): FileKind {
  const ext = extOf(name);
  if (chosen !== "OTHER") return chosen;
  if ((ext === "pdf" || ext === "pptx") && /deck|pitch|\bim\b|memorandum|presentation|teaser/i.test(name)) return "DECK";
  if (ext === "xlsx" || ext === "xls" || ext === "xlsm") return "MODEL";
  return chosen;
}

export function MaterialsTab({ detail, reload }: { detail: CompanyDetail; reload: () => Promise<void> }) {
  const { toast, maxUploadMb } = useStore();
  const [kind, setKind] = useState<FileKind>("OTHER");
  const [over, setOver] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [view, setView] = useState<FileItem | null>(null);
  const [confirmRm, setConfirmRm] = useState<FileItem | null>(null);
  const [kindPop, setKindPop] = useState<{ f: FileItem; el: HTMLElement } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const cid = detail.row.id;
  const files = detail.files;

  const uploadMany = async (list: File[]) => {
    for (const file of list) {
      if (file.size > maxUploadMb * MB) {
        toast(`${file.name} is over ${maxUploadMb} MB. Compress it and try again.`);
        continue;
      }
      setUploading(file.name);
      const k = guessKind(file.name, kind);
      const r = await uploadFile(file, { kind: k, companyId: cid });
      if (!r.ok) toast(r.error);
      else toast(`${file.name} uploaded.` + (r.jobId ? " Writing a new summary." : ""));
    }
    setUploading(null);
    await reload(); // also refreshes the row's file count
  };

  return (
    <>
      <div
        className={"upl" + (over ? " over" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const fs = [...e.dataTransfer.files];
          if (fs.length) void uploadMany(fs);
        }}
      >
        <span className="txt">
          {uploading ? `Uploading ${uploading}…` : "Drop files here or choose them. A new deck (PDF or .pptx) also refreshes the summary."}
        </span>
        <select className="sel" aria-label="File type" value={kind} onChange={(e) => setKind(e.target.value as FileKind)}>
          {FILE_KINDS.map((k) => (
            <option key={k} value={k}>
              {FILE_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <button className="btn primary sm" type="button" onClick={() => input.current?.click()} disabled={!!uploading}>
          Upload files
        </button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const fs = [...(e.target.files ?? [])];
            e.target.value = "";
            if (fs.length) void uploadMany(fs);
          }}
        />
      </div>
      {!files.length ? (
        <p className="muted" style={{ marginTop: 20 }}>
          No materials yet.
        </p>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span className="hint">
              {files.length} file{files.length > 1 ? "s" : ""}
            </span>
            <button className="btn sm" type="button" onClick={() => downloadUrl(`/api/companies/${cid}/download-all`)}>
              Download all
            </button>
          </div>
          <ul className="files">
            {files.map((f) => {
              const ext = extOf(f.originalName);
              const canView = f.mime === "application/pdf" || f.mime.startsWith("image/");
              return (
                <li key={f.id}>
                  <span className={"ext " + ext}>{(ext || "file").toUpperCase().slice(0, 4)}</span>
                  <div className="fmeta">
                    <div className="fname" title={f.originalName}>
                      {f.originalName}
                    </div>
                    <div className="fsub">
                      <span className="kind">{FILE_KIND_LABELS[f.kind]}</span>
                      {fmtSize(f.sizeBytes)}, uploaded by {f.uploadedBy} on {fmtTime(f.uploadedAt)}
                    </div>
                  </div>
                  <div className="factions">
                    {canView && (
                      <button className="btn-ghost sm" type="button" onClick={() => setView(f)}>
                        View
                      </button>
                    )}
                    <button className="btn-ghost sm" type="button" onClick={() => downloadUrl(`/api/files/${f.id}?download=1`)}>
                      Download
                    </button>
                    <button
                      className="btn-ghost sm"
                      type="button"
                      title="Change file type"
                      onClick={(e) => {
                        const el = e.currentTarget;
                        setKindPop((p) => (p?.f.id === f.id ? null : { f, el }));
                      }}
                    >
                      Type
                    </button>
                    <button className="btn-ghost sm danger-text" type="button" onClick={() => setConfirmRm(f)}>
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {kindPop && (
        <Popover anchor={kindPop.el} onClose={() => setKindPop(null)} width={180} label="File type">
          <h4>File type</h4>
          {FILE_KINDS.map((k) => (
            <label className="ck" key={k}>
              <input
                type="radio"
                name="kd"
                checked={kindPop.f.kind === k}
                onChange={async () => {
                  const f = kindPop.f;
                  setKindPop(null);
                  const r = await setFileKind(f.id, k);
                  if (!r.ok) toast(r.error);
                  void reload();
                }}
              />
              {FILE_KIND_LABELS[k]}
            </label>
          ))}
        </Popover>
      )}

      {confirmRm && (
        <ConfirmModal
          title={`Remove ${confirmRm.originalName}?`}
          text="The file is deleted for everyone and cannot be recovered."
          okLabel="Remove file"
          danger
          onCancel={() => setConfirmRm(null)}
          onOk={async () => {
            const f = confirmRm;
            setConfirmRm(null);
            const r = await removeFile(f.id);
            if (!r.ok) toast(r.error);
            else toast(`${f.originalName} removed.`);
            void reload();
          }}
        />
      )}

      {view && (
        <Modal size="full" onClose={() => setView(null)}>
          <ModalHead title={view.originalName} onClose={() => setView(null)} />
          <div className="viewer">
            {view.mime === "application/pdf" ? (
              <iframe className="pdf-frame" src={`/api/files/${view.id}`} title={view.originalName} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/files/${view.id}`} alt={view.originalName} />
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
