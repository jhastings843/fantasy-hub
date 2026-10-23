"use client";

import { useId, useState } from "react";
import s from "./picks.module.css";

// Type a team or player, see this week's verdict in every market at once.
// The server flattens the week into entries (picks/search.ts, props/search.ts)
// using the same status logic the cards use, so the box and the cards cannot
// disagree; this only filters and draws them.

export interface SearchRow {
  /** "Spread", "Sam", "First TD"... */
  market: string;
  text: string;
  /** bet: a stake; lean: a call short of a bet; pass: nothing; W/L/P: graded. */
  tone: "bet" | "lean" | "pass" | "W" | "L" | "P";
  result?: "W" | "L" | "P";
}

export interface SearchEntry {
  key: string;
  title: string;
  meta: string;
  /** Lowercased names, abbreviations and teams to match against. */
  terms: string;
  /** Lower sorts first: bets, then open calls, then finished. */
  rank: number;
  rows: SearchRow[];
  /** The page it comes from (the header search links there). */
  href?: string;
}

const LIMIT = 12;
const fold = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[.'\u2019]/g, "");

/** Entries matching every word of the query: names in the title first, then bets, open calls, finished. */
export function searchEntries(entries: SearchEntry[], q: string): SearchEntry[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const inTitle = (e: SearchEntry) => (words.every((w) => fold(e.title).includes(w)) ? 0 : 1);
  return entries
    .filter((e) => {
      const hay = fold(`${e.title} ${e.terms}`);
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => inTitle(a) - inTitle(b) || a.rank - b.rank || a.title.localeCompare(b.title));
}

export default function WeekSearch({ entries, label, placeholder }: { entries: SearchEntry[]; label: string; placeholder: string }) {
  const [q, setQ] = useState("");
  const id = useId();
  const words = fold(q).split(/\s+/).filter(Boolean);
  const hits = searchEntries(entries, q);
  return (
    <div className={s.search} role="search">
      <label htmlFor={id} className={s.searchLabel}>
        {label}
      </label>
      <div className={s.searchBox}>
        <input
          id={id}
          type="search"
          className={s.searchInput}
          placeholder={placeholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
        />
        {q && (
          <button type="button" className={s.searchClear} onClick={() => setQ("")} aria-label="Clear search">
            ×
          </button>
        )}
      </div>
      {words.length > 0 && (
        <div className={s.searchResults} aria-live="polite">
          {hits.length === 0 ? (
            <p className={s.searchNone}>{`Nothing this week matches “${q.trim()}”.`}</p>
          ) : (
            <>
              <ul className={s.searchList}>
                {hits.slice(0, LIMIT).map((e) => (
                  <li key={e.key} className={s.searchHit}>
                    <div className={s.searchHead}>
                      <b>{e.title}</b>
                      <span className={s.dim}>{e.meta}</span>
                    </div>
                    <ul className={s.searchRows}>
                      {e.rows.map((r, i) => (
                        <li key={i} className={`${s.searchRow} ${s[`tone_${r.tone}`] ?? ""}`}>
                          <span className={s.searchMk}>{r.market}</span>
                          <span className={s.searchTx}>{r.text}</span>
                          {r.result && <span className={`${s.resChip} ${r.result === "W" ? s.resW : r.result === "L" ? s.resL : s.resP}`}>{r.result}</span>}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              {hits.length > LIMIT && <p className={s.searchNone}>{`${hits.length - LIMIT} more. Keep typing to narrow it.`}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
