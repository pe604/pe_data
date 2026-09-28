// Renders summary markdown to HTML. Ported from the prototype's renderMd.
// Safe for user-edited markdown: every piece of text is escaped and only our own tags are emitted.

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const inl = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

function mdTable(rows: string[]): string {
  const cells = (r: string) =>
    r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((x) => x.trim());
  const data = rows.map(cells).filter((r) => !r.every((x) => /^:?-{2,}:?$/.test(x) || x === ""));
  if (!data.length) return "";
  const isNum = (v: string) => /^[\s(₹$-]*[\d.,]+%?\)?\s*[A-Za-z]*$/.test(v) || v === "–";
  const [head, ...body] = data;
  return (
    '<div class="tw"><table><thead><tr>' +
    head.map((h, i) => "<th" + (i ? ' class="num"' : "") + ">" + inl(h) + "</th>").join("") +
    "</tr></thead><tbody>" +
    body
      .map((r) => "<tr>" + r.map((v, i) => "<td" + (i && isNum(v) ? ' class="num"' : "") + ">" + inl(v) + "</td>").join("") + "</tr>")
      .join("") +
    "</tbody></table></div>"
  );
}

export function renderMarkdown(md: string): string {
  const L = (md || "").split("\n");
  let h = "";
  let i = 0;
  let sec = "";
  const isBul = (l: string) => /^\s*[-•*]\s+/.test(l);
  const isTab = (l: string) => /^\s*\|/.test(l);
  const isHead = (l: string) => /^#{1,4}\s+/.test(l);
  const isPair = (l: string) => /^[A-Za-z][^:|]{0,22}:\s+\S/.test(l);
  while (i < L.length) {
    const l = L[i];
    if (isHead(l)) {
      sec = l.replace(/^#{1,4}\s+/, "").trim();
      h += "<h3>" + inl(sec) + "</h3>";
      i++;
      continue;
    }
    if (isBul(l)) {
      const it: string[] = [];
      while (i < L.length && isBul(L[i])) it.push(L[i++].replace(/^\s*[-•*]\s+/, ""));
      h += "<ul>" + it.map((x) => "<li>" + inl(x) + "</li>").join("") + "</ul>";
      continue;
    }
    if (isTab(l)) {
      const r: string[] = [];
      while (i < L.length && isTab(L[i])) r.push(L[i++]);
      h += mdTable(r);
      continue;
    }
    if (sec.toLowerCase() === "snapshot" && isPair(l)) {
      const pr: [string, string][] = [];
      while (i < L.length && isPair(L[i])) {
        const k = L[i].indexOf(":");
        pr.push([L[i].slice(0, k), L[i].slice(k + 1).trim()]);
        i++;
      }
      h += '<dl class="snap">' + pr.map(([k, v]) => "<div><dt>" + inl(k) + "</dt><dd>" + inl(v) + "</dd></div>").join("") + "</dl>";
      continue;
    }
    if (!l.trim()) {
      i++;
      continue;
    }
    const p: string[] = [];
    while (i < L.length && L[i].trim() && !isHead(L[i]) && !isBul(L[i]) && !isTab(L[i])) p.push(L[i++]);
    h += "<p>" + inl(p.join(" ")) + "</p>";
  }
  return h;
}
