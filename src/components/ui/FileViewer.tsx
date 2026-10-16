"use client";

import { downloadUrl } from "./download";
import { Modal, ModalHead } from "./overlay";

// View (PDF/image) and download links for stored files, served only through /api/files/[id].

export type ViewableFile = { id: string; name: string; mime: string };

export const canView = (f: { mime: string }) => f.mime === "application/pdf" || f.mime.startsWith("image/");
export const downloadFile = (id: string) => downloadUrl(`/api/files/${id}?download=1`);

export function FileViewer({ file, onClose }: { file: ViewableFile; onClose: () => void }) {
  return (
    <Modal size="full" onClose={onClose}>
      <ModalHead title={file.name} onClose={onClose} />
      <div className="viewer">
        {file.mime === "application/pdf" ? (
          <iframe className="pdf-frame" src={`/api/files/${file.id}`} title={file.name} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/files/${file.id}`} alt={file.name} />
        )}
      </div>
    </Modal>
  );
}
