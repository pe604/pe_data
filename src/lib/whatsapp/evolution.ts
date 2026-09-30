import "server-only";
import { env } from "@/lib/env";

// Minimal Evolution API v2 client (SPEC §14). Never log message contents.

export interface EvoKey {
  id: string;
  fromMe?: boolean;
  remoteJid?: string;
  participant?: string;
  participantAlt?: string;
}

export interface EvoRecord {
  key: EvoKey;
  pushName?: string | null;
  messageType?: string;
  messageTimestamp: number;
  message?: Record<string, unknown>;
}

export interface DocInfo {
  fileName: string | null;
  mimetype: string | null;
  sizeBytes: number | null;
  caption: string | null;
}

const base = () => env.EVOLUTION_API_URL.replace(/\/+$/, "");
const inst = () => encodeURIComponent(env.EVOLUTION_INSTANCE);

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
  const res = await fetch(base() + path, {
    method,
    headers: { apikey: env.EVOLUTION_API_KEY, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw Object.assign(new Error("evolution_http"), { status: res.status, path: path.split("/").slice(0, 3).join("/") });
  return (await res.json()) as T;
}

/** One page of the group's messages, newest first. */
export async function groupMessages(page: number, pageSize = 50): Promise<EvoRecord[]> {
  const r = await call<{ messages?: { records?: EvoRecord[] } }>("POST", `/chat/findMessages/${inst()}`, {
    where: { key: { remoteJid: env.EVOLUTION_Receiver } },
    page,
    offset: pageSize,
  });
  return (r.messages?.records ?? []).map((x) => ({ ...x, messageTimestamp: Number(x.messageTimestamp) }));
}

export function documentInfo(rec: EvoRecord): DocInfo | null {
  const m = rec.message ?? {};
  const doc = (m.documentMessage ??
    (m.documentWithCaptionMessage as { message?: { documentMessage?: unknown } } | undefined)?.message?.documentMessage) as
    | { fileName?: string; title?: string; mimetype?: string; caption?: string; fileLength?: number | { low: number; high: number } }
    | undefined;
  if (!doc) return null;
  const len = doc.fileLength;
  const sizeBytes = typeof len === "number" ? len : len ? len.low + len.high * 2 ** 32 : null;
  return { fileName: doc.fileName ?? doc.title ?? null, mimetype: doc.mimetype ?? null, sizeBytes, caption: doc.caption ?? null };
}

export async function downloadMedia(messageId: string): Promise<Buffer> {
  const r = await call<{ base64?: string }>(
    "POST",
    `/chat/getBase64FromMediaMessage/${inst()}`,
    { message: { key: { id: messageId } }, convertToMp4: false },
    180_000,
  );
  if (!r.base64) throw new Error("evolution_no_media");
  return Buffer.from(r.base64, "base64");
}

export async function sendGroupText(text: string): Promise<void> {
  await call("POST", `/message/sendText/${inst()}`, { number: env.EVOLUTION_Receiver, text });
}
