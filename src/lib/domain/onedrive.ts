// OneDrive link validation (SPEC §6.4). Used on both client (popover) and server (write + render).

export type LinkCheck =
  | { ok: false; msg: string }
  | { ok: true; url: string; warn: string | null };

const ONEDRIVE_HOST = /(^|\.)(sharepoint\.com|onedrive\.live\.com|1drv\.ms|onedrive\.com)$/i;

export function checkLink(v: string | null | undefined): LinkCheck {
  let u: URL;
  try {
    u = new URL(String(v ?? "").trim());
  } catch {
    return { ok: false, msg: "Paste the full link, starting with https://" };
  }
  if (!/^https?:$/.test(u.protocol)) {
    return { ok: false, msg: "Only web links starting with https:// can be saved." };
  }
  return {
    ok: true,
    url: u.href,
    warn: ONEDRIVE_HOST.test(u.hostname)
      ? null
      : "This does not look like a OneDrive or SharePoint link. Save it anyway?",
  };
}

/** Returns the URL only if it is http(s); otherwise null. Use before rendering any href. */
export function safeHref(v: string | null | undefined): string | null {
  const r = checkLink(v);
  return r.ok ? r.url : null;
}
