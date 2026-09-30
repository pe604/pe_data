// WhatsApp intake helpers (SPEC §14). Pure: unit-tested in tests/unit/whatsapp.test.ts.
import { levenshtein, norm, titleCase } from "./names";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** PDF or PPTX, by mimetype or extension. Returns the extension, or null if it isn't a deck. */
export function deckExtension(fileName: string | null | undefined, mime: string | null | undefined): "pdf" | "pptx" | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName ?? "")?.[1]?.toLowerCase();
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (ext === "pptx" || mime === PPTX_MIME) return "pptx";
  return null;
}

/** Ensures the file name ends in the deck extension. */
export function deckFileName(fileName: string | null | undefined, ext: "pdf" | "pptx"): string {
  const base = (fileName ?? "").replace(/[\\/]/g, "_").trim() || "Deck";
  return base.toLowerCase().endsWith("." + ext) ? base : `${base}.${ext}`;
}

/** Digits of the phone number in a WhatsApp JID ("919812345678@s.whatsapp.net"), or null for @lid / groups. */
export function phoneFromJid(jid: string | null | undefined): string | null {
  if (!jid || !/@s\.whatsapp\.net$/.test(jid)) return null;
  const d = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
  return d.length >= 8 ? d : null;
}

/** "Raghav K 🙂" → "Raghav K". Keeps letters, spaces, dots, apostrophes and hyphens. */
export function cleanDisplayName(pushName: string | null | undefined): string {
  const s = String(pushName ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{M}\s.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s ? titleCase(s) : "Unknown sender";
}

const firstName = (n: string) => norm(n.split(/\s+/)[0]);

/** Exact (normalised) match, then a unique first-name match, then Levenshtein ≤1 for 5+ characters. */
export function matchTeamName(name: string, team: string[]): string | null {
  const n = norm(name);
  if (!n) return null;
  const exact = team.find((t) => norm(t) === n);
  if (exact) return exact;
  const byFirst = team.filter((t) => firstName(t) === n || firstName(t) === firstName(name));
  if (byFirst.length === 1) return byFirst[0];
  if (n.length >= 5) {
    const near = team.filter((t) => levenshtein(norm(t), n) <= 1 || levenshtein(firstName(t), n) <= 1);
    if (near.length === 1) return near[0];
  }
  return null;
}

// Words that follow "from"/"via" but aren't a person (e.g. "via email", "from the founder").
const NOT_A_PERSON = new Set([
  "the", "a", "an", "our", "their", "his", "her", "my", "this", "that", "these", "those", "them", "him", "me", "us",
  "founder", "founders", "company", "management", "deck", "bank", "banker", "bankers", "whatsapp", "email", "mail",
  "linkedin", "group", "network", "fund", "team", "client", "promoter", "promoters", "fy", "last", "next", "today",
  "yesterday", "tomorrow", "inbound", "outbound",
]);

const VIA_RE =
  /(?:^|[\s,.(\-–:])(?:from\s*\/\s*via|via\s*\/\s*from|referred\s+by|ref(?:erred)?\s*(?:by)?|from|via|through|thru)\s*[:\-–]?\s+([^\n,.;:()!?\/|]+)/i;

/**
 * The person a deck came through, from a caption or message ("from/Via arvind sir", "via: Keyur").
 * Returns a team member's name when it matches one, otherwise the name in Title Case, or null.
 */
export function parseVia(text: string | null | undefined, team: string[]): string | null {
  const m = VIA_RE.exec(String(text ?? ""));
  if (!m) return null;
  const words = m[1]
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}]+|[^\p{L}.']+$/gu, ""))
    .filter(Boolean)
    .slice(0, 4);
  if (!words.length) return null;
  if (NOT_A_PERSON.has(words[0].toLowerCase())) return null;
  // Longest phrase that matches a team member wins ("arvind sir" before "arvind").
  for (let k = Math.min(3, words.length); k >= 1; k--) {
    const hit = matchTeamName(words.slice(0, k).join(" "), team);
    if (hit) return hit;
  }
  // Not on the team: keep a short name, stopping at common filler words.
  const name: string[] = [];
  for (const w of words.slice(0, 3)) {
    if (NOT_A_PERSON.has(w.toLowerCase()) || /^(for|about|regarding|re|on|in|at|to|and|is|has|who|sent)$/i.test(w)) break;
    name.push(w);
  }
  if (!name.length || !/\p{L}{2,}/u.test(name.join(""))) return null;
  return titleCase(name.join(" "));
}

/** Text of a WhatsApp message record: plain text, extended text or a document caption. */
export function messageText(message: unknown): string {
  const m = (message ?? {}) as Record<string, Record<string, unknown> | string | undefined>;
  const ext = m.extendedTextMessage as { text?: string } | undefined;
  const doc = m.documentMessage as { caption?: string } | undefined;
  const wrapped = (m.documentWithCaptionMessage as { message?: { documentMessage?: { caption?: string } } } | undefined)
    ?.message?.documentMessage;
  return String((typeof m.conversation === "string" ? m.conversation : "") || ext?.text || doc?.caption || wrapped?.caption || "");
}
