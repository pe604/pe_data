import type { BuiltResult } from "@/lib/domain/resultFormat";

// The result as a PNG (SPEC §15.12, phase C), drawn on a canvas in the browser at 2× from the same data as the
// preview, in the same look (colours match the .rs styles in globals.css). No builder marks.

const C = { band: "#DAE1F3", navy: "#1F4E78", dark: "#395324", light: "#C6E0B3", white: "#FFFFFF", ink: "#000000", rule: "#7F7F7F", note: "#404040" };
const SCALE = 2;
const PAD = 8;
const ROW = 30;
const HEAD = 32;
const GAP = 22;
const BAND = 84;
const LOGO_H = 60;
const SIZE = 15;
const NOTE_SIZE = 12.5;
const NOTE_LINE = 17;

function loadLogo(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = "/result-logo.png";
  });
}

/** Splits a note into lines that fit `width`. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** Draws the result; `family` is the preview's font family (so the image matches it). */
export async function resultPng(r: BuiltResult, family: string): Promise<Blob> {
  await document.fonts.ready;
  const logo = await loadLogo();
  const font = (opts: { bold?: boolean; italic?: boolean; size?: number }) => `${opts.italic ? "italic " : ""}${opts.bold ? "700 " : "400 "}${opts.size ?? SIZE}px ${family}`;

  // Measure on a scratch canvas.
  const m = document.createElement("canvas").getContext("2d");
  if (!m) throw new Error("no canvas");
  const width = (text: string, f: string) => {
    m.font = f;
    return m.measureText(text).width;
  };
  const cols = r.headers.length;
  let labelW = 220;
  for (const t of r.tables) {
    labelW = Math.max(labelW, width(t.caption, font({ bold: true })) + 2 * PAD);
    for (const row of t.rows) labelW = Math.max(labelW, width(row.label, font({ bold: row.style === "key", italic: row.style === "sub" })) + 2 * PAD + (row.style === "sub" ? 14 : 0));
  }
  const colW = r.headers.map((h, i) => {
    let w = Math.max(86, width(h, font({ bold: true })) + 2 * PAD);
    for (const t of r.tables) for (const row of t.rows) w = Math.max(w, width(row.cells[i]?.text ?? "", font({ bold: true })) + 2 * PAD);
    return Math.ceil(w);
  });
  const logoW = logo ? (LOGO_H * logo.naturalWidth) / logo.naturalHeight : 0;
  const titleW = width(r.title, font({ bold: true, size: 26 }));
  let total = labelW + colW.reduce((a, b) => a + b, 0);
  const minBand = titleW + 2 * (logoW + 24);
  if (total < minBand) {
    labelW += minBand - total;
    total = minBand;
  }
  labelW = Math.ceil(labelW);
  total = Math.ceil(labelW + colW.reduce((a, b) => a + b, 0));
  m.font = font({ italic: true, size: NOTE_SIZE });
  const noteLines = r.notes.flatMap((n) => wrap(m, n, total - 2 * PAD));
  const tablesH = r.tables.reduce((h, t, i) => h + HEAD + t.rows.length * ROW + (i > 0 ? GAP : 0), 0);
  const height = BAND + tablesH + (noteLines.length ? noteLines.length * NOTE_LINE + 2 * PAD : 0);

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((total + 2) * SCALE);
  canvas.height = Math.ceil((height + 2) * SCALE);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.scale(SCALE, SCALE);
  ctx.translate(1, 1);
  ctx.fillStyle = C.white;
  ctx.fillRect(-1, -1, total + 2, height + 2);
  ctx.textBaseline = "middle";

  // Title band.
  ctx.fillStyle = C.band;
  ctx.fillRect(0, 0, total, BAND);
  ctx.fillStyle = C.ink;
  ctx.font = font({ bold: true, size: 26 });
  ctx.textAlign = "center";
  // Centred, but moved left when a long title would run into the logo.
  ctx.fillText(r.title, Math.max(titleW / 2 + PAD, Math.min(total / 2, total - 12 - logoW - 24 - titleW / 2)), BAND / 2);
  if (logo) ctx.drawImage(logo, total - 12 - logoW, (BAND - LOGO_H) / 2, logoW, LOGO_H);
  ctx.fillRect(0, BAND - 2, total, 2);

  const cell = (x: number, y: number, w: number, h: number, bg: string, text: string, f: string, color: string, align: "left" | "right" | "center", indent = 0) => {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = C.rule;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (!text) return;
    ctx.fillStyle = color;
    ctx.font = f;
    ctx.textAlign = align;
    const tx = align === "left" ? x + PAD + indent : align === "right" ? x + w - PAD : x + w / 2;
    ctx.fillText(text, tx, y + h / 2 + 1);
  };

  let y = BAND;
  r.tables.forEach((t, ti) => {
    if (ti > 0) y += GAP;
    let x = 0;
    cell(x, y, labelW, HEAD, C.navy, t.caption, font({ bold: true }), C.white, "left");
    x += labelW;
    r.headers.forEach((h, i) => {
      cell(x, y, colW[i], HEAD, C.navy, h, font({ bold: true }), C.white, "center");
      x += colW[i];
    });
    y += HEAD;
    for (const row of t.rows) {
      const key = row.style === "key";
      const sub = row.style === "sub";
      x = 0;
      cell(x, y, labelW, ROW, key ? C.dark : C.light, row.label, font({ bold: key, italic: sub }), key ? C.white : C.ink, "left", sub ? 14 : 0);
      x += labelW;
      for (let i = 0; i < cols; i++) {
        const bg = key && !row.pct ? C.light : C.white;
        cell(x, y, colW[i], ROW, bg, row.cells[i]?.text ?? "", font({ bold: key && row.pct, italic: sub }), C.ink, "right");
        x += colW[i];
      }
      y += ROW;
    }
  });

  if (noteLines.length) {
    ctx.fillStyle = C.note;
    ctx.font = font({ italic: true, size: NOTE_SIZE });
    ctx.textAlign = "left";
    y += PAD;
    for (const l of noteLines) {
      ctx.fillText(l, PAD, y + NOTE_LINE / 2);
      y += NOTE_LINE;
    }
  }
  ctx.strokeStyle = C.rule;
  ctx.strokeRect(-0.5, -0.5, total + 1, height + 1);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png"));
}
