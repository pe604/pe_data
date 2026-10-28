"use client";

import type { BuiltResult } from "@/lib/domain/resultFormat";

// The result in the Niveshaay style (SPEC §15.12): title band with logo, navy header row, green key rows.
// `builder` marks missing figures and shows how worked-out figures were made; the output (phase C) leaves them out.

export function ResultPreview({ result, builder = false }: { result: BuiltResult; builder?: boolean }) {
  return (
    <div className="rs" aria-label={`Result preview: ${result.title}`}>
      <div className="rs-band">
        <div className="rs-title">{result.title}</div>
        {/* eslint-disable-next-line @next/next/no-img-element -- a fixed small logo, also used in the PNG output */}
        <img
          className="rs-logo"
          src="/result-logo.png"
          alt="Niveshaay"
          onError={(e) => {
            // Logo file not deployed: leave the band with the title only.
            e.currentTarget.style.display = "none";
          }}
        />
      </div>
      <table className="rs-table">
        {result.tables.map((t) => (
          <tbody key={t.id}>
            <tr className="rs-head">
              <th scope="col">{t.caption}</th>
              {result.headers.map((h, i) => (
                <th key={i} scope="col" className={result.change[i] ? "rs-chg" : undefined}>
                  {h}
                </th>
              ))}
            </tr>
            {t.rows.map((r) => (
              <tr key={r.id} className={`rs-row ${r.style}${r.pct ? " pct" : ""}${r.heading ? " heading" : ""}`}>
                <th scope="row" className="rs-label" title={builder ? r.problem : undefined}>
                  {r.label}
                  {builder && r.problem && <span className="rs-problem"> ⚠</span>}
                </th>
                {r.cells.map((c, i) => (
                  <td
                    key={i}
                    className={"rs-v" + (builder && c.missing ? " rs-missing" : "") + (builder && c.how ? " rs-derived" : "")}
                    title={builder ? (c.how ?? (c.missing ? "No figure for this period" : undefined)) : undefined}
                  >
                    {c.text || (builder && c.missing ? "–" : "")}
                  </td>
                ))}
              </tr>
            ))}
            {/* spacer between tables */}
            <tr className="rs-gap" aria-hidden="true">
              <td colSpan={1 + result.headers.length} />
            </tr>
          </tbody>
        ))}
      </table>
      {result.notes.length > 0 && (
        <div className="rs-notes">
          {result.notes.map((n, i) => (
            <p key={i}>{n}</p>
          ))}
        </div>
      )}
    </div>
  );
}
