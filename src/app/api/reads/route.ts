import { requireRole } from "@/lib/auth/session";
import { errorResponse } from "@/lib/server/http";
import { loadReads } from "@/lib/server/read";

export const runtime = "nodejs";

/** At most 512 KB of JSON, and 50 reads, per request (SPEC §17.11). */
const MAX_BODY = 512 * 1024;
const MAX_READS = 50;

/** The Origin must be this app's own: the host the request came to (directly or through the proxy). */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const own = [req.headers.get("host"), req.headers.get("x-forwarded-host")?.split(",")[0]]
    .map((h) => h?.trim().toLowerCase())
    .filter((h): h is string => !!h);
  return own.includes(host);
}

/**
 * Loads analyst reads (SPEC §17.11): a JSON body holding one read or a list of up to 50. Returns one result per read,
 * `{ company, ok, id }` or `{ company, ok: false, reasons }`. Never echoes a read back and never logs one.
 */
export async function POST(req: Request) {
  try {
    const me = await requireRole();
    if (!sameOrigin(req)) return Response.json({ error: "Reads can only be loaded from the dashboard itself." }, { status: 403 });
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return Response.json({ error: "Send the read as JSON (Content-Type: application/json)." }, { status: 415 });
    }
    const len = Number(req.headers.get("content-length"));
    if (Number.isFinite(len) && len > MAX_BODY) return Response.json({ error: "That is over 512 KB. Send fewer reads at a time." }, { status: 413 });
    const text = await req.text();
    if (new TextEncoder().encode(text).length > MAX_BODY) return Response.json({ error: "That is over 512 KB. Send fewer reads at a time." }, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return Response.json({ error: "That is not valid JSON." }, { status: 400 });
    }
    const list = Array.isArray(body) ? body : [body];
    if (!list.length) return Response.json({ error: "No reads in the request." }, { status: 400 });
    if (list.length > MAX_READS) return Response.json({ error: `At most ${MAX_READS} reads at a time.` }, { status: 413 });
    const results = await loadReads(list, me.id);
    return Response.json({ results });
  } catch (e) {
    return errorResponse(e);
  }
}
