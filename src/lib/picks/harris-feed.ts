// John Harris's own website feed, as sheet rows. Replaces reading his X
// images (from week 8 on he stopped posting the full sheet; Jack, 2026-11-06).
//
// His site (tangerine-palmier-8f729b.netlify.app) loads JSON from a Google
// Apps Script web app. tabs.picks has one row per game:
//   Date | Away | Home | Neutral | Spread | Opening Spread | Model Prediction |
//   Home Spread Confidence | Edge | ATS Pick | Trigger
// Signs, checked on weeks 6 to 10 and against the verified image reads of
// weeks 6 and 7 (harris-feed.test.ts):
//   Spread            the HOME team's line (-4.5 = home favored by 4.5)
//   Model Prediction  his line for the HOME team on the same scale
//                     (-3.6 = he has home winning by 3.6)
//   Edge              Spread - Model; positive favors the home side
// The image sheet's Average was his projected home margin, Spread the home
// line and Diff = Average + Spread. So Average = -Model, Spread = Spread and
// Diff = Edge, and the existing self-check (Average + Spread = Diff) holds
// on every row. No model reads anything: plain JSON.
//
// Pure except fetchHarrisFeed, which makes one GET per call.

import type { SheetRow } from "./harris-sheet";

export const HARRIS_FEED_URL =
  "https://script.google.com/macros/s/AKfycbw3S_kSEI0DMFLhKy8LHjy8jUWpJZUMZo5bazqmOyDbUvE9Rxik7D6za_axLVL7QqU5/exec";

export const HARRIS_SITE = "https://tangerine-palmier-8f729b.netlify.app/";

export interface FeedTable {
  headers: string[];
  rows: string[][];
}

export interface HarrisFeed {
  sport?: string;
  updated?: string;
  pickDates?: string[];
  tabs?: { picks?: FeedTable };
}

/** Two numbers each rounded to 0.1 can differ from their exact sum by up to 0.1. */
const ROUNDING = 0.1 + 1e-9;

const num = (s: string | undefined) => {
  if (s === undefined) return NaN;
  const t = String(s).trim().replace(/^\+/, "");
  return t === "" ? NaN : Number(t);
};

/** The week a picks table is for ("Week 7" -> 7), or null when rows disagree or none parse. */
export function feedWeek(table: FeedTable): number | null {
  const iDate = table.headers.findIndex((h) => /^date$|^week$/i.test(h.trim()));
  const weeks = new Set(table.rows.map((r) => Number(String(r[iDate] ?? "").match(/week\s*(\d+)/i)?.[1])).filter(Number.isFinite));
  return weeks.size === 1 ? [...weeks][0] : null;
}

/**
 * His picks table to the rows the image reader used to return. Columns are
 * found by header name, so a reordered sheet still reads. Rows missing a
 * number are kept with NaN so the self-check names them as problems.
 */
export function feedToSheet(table: FeedTable): SheetRow[] {
  const col = (re: RegExp) => table.headers.findIndex((h) => re.test(h.trim()));
  const iAway = col(/^away$/i);
  const iHome = col(/^home$/i);
  const iSpread = col(/^spread$/i);
  const iModel = col(/^model prediction$/i);
  const iEdge = col(/^edge$/i);
  if ([iAway, iHome, iSpread, iModel, iEdge].some((i) => i < 0)) throw new Error(`Harris feed is missing a column (headers: ${table.headers.join(", ")})`);
  return table.rows
    .filter((r) => (r[iAway] ?? "").trim() && (r[iHome] ?? "").trim())
    .map((r) => {
      const model = num(r[iModel]);
      const spread = num(r[iSpread]);
      const edge = num(r[iEdge]);
      const average = model === 0 ? 0 : -model;
      // Model and Edge are each rounded to 0.1 from his unrounded numbers, so
      // Spread - Model can miss Edge by 0.1 (4 of 58 rows in week 6). Within
      // that, the row is consistent and Diff is taken as Average + Spread;
      // beyond it, the printed Edge is kept so checkRow names the row.
      const off = Math.abs(spread - model - edge);
      const diff = off > 0.05 && off <= ROUNDING ? average + spread : edge;
      return { away: r[iAway].trim(), home: r[iHome].trim(), average, spread, diff };
    });
}

/** The picks table for one week ("Week 8"), straight from his feed. One request. */
export async function fetchHarrisFeed(week: number, url = HARRIS_FEED_URL): Promise<FeedTable> {
  const u = `${url}${url.includes("?") ? "&" : "?"}picks_date=${encodeURIComponent(`Week ${week}`)}`;
  const res = await fetch(u, { redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Harris feed answered ${res.status}`);
  const j = (await res.json()) as HarrisFeed;
  const table = j.tabs?.picks;
  if (!table?.headers || !Array.isArray(table.rows)) throw new Error("Harris feed sent no picks table");
  const got = feedWeek(table);
  if (got !== week) throw new Error(`Harris feed sent week ${got ?? "unknown"} when asked for week ${week}`);
  return table;
}
