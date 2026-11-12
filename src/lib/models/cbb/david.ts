// David Sasser's college basketball page (davidsasser.com/cbb, live Nov 12
// 2026) as an outside source for our CBB section, on equal footing with John
// Harris (Jack: "make sure he is being tracked and looked at across all 4
// sports"). Tracked only: his numbers feed learner slices (learn.ts,
// "cbb:david*") on the shared engine, judged by the same CBB gate as every
// other slice. Nothing is staked.
//
// The page lists TODAY's games only (no archive, no tomorrow), so a pregame
// copy has to be saved before tip or it is gone. Each <article> card reads,
// as text (checked on all 24 cards of Nov 12):
//   "2:00 PM CT | Neutral site | Kansas City vs. George Mason | ...
//    Model spread | George Mason −15.0 | Projected total | 142.1 |
//    Consensus spread | George Mason −15.5 | Consensus total | 141.5 |
//    Spread pick · ATS | Kansas City +15.5 | 0.5 pt model edge | ..."
// "A at B" or "A vs. B" (neutral): B is his home side. Both spreads name a
// team and its line (minus sign is U+2212). The consensus line is an average
// across books (fractions like 8.3), so every slice grades at OUR saved
// DraftKings line instead, the same as Harris. <time dateTime> on the card is
// the tip (UTC); the page's own <time dateTime="YYYY-MM-DD"> is his date.
//
// The rows are shaped like Harris's so matchRows (team names to the ESPN
// board, either orientation) is shared. Pure except fetchDavidCbb.

import { checkCbbRow, type HarrisCbbRow } from "./harris";

export const DAVID_CBB_URL = "https://davidsasser.com/cbb";

export interface DavidCbbRow extends HarrisCbbRow {
  /** His projected total and the consensus total he shows. */
  total: number | null;
  postedTotal: number | null;
  /** Tip as printed on his card (UTC ISO). */
  davidTip?: string;
  pre?: HarrisCbbRow["pre"] & { total?: number | null };
}

export interface DavidCbbDay {
  season: number;
  date: string;
  rows: DavidCbbRow[];
  verified: boolean;
  problems: string[];
  setAside?: string[];
  /** His page's "updated" stamp, when shown. */
  updated?: string;
  at: string;
}

/** What a slice reads for one game: his last pregame numbers, keyed by ESPN event. */
export interface DavidPre {
  /** The team his model line is for. */
  homeId: string;
  /** His line for homeId (negative = favored), his projected total. */
  model: number;
  total: number | null;
  /** The consensus line and total he showed (record only). */
  spread: number | null;
  postedTotal: number | null;
  at: string;
}

export const DAVID_DAY = (season: number, date: string) => `models:v1:cbb:${season}:david:day:${date}`;
export const DAVID_DAYS = (season: number) => `models:v1:cbb:${season}:david:days`;
export const DAVID_PRE = (season: number) => `models:v1:cbb:${season}:david:pre`;

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** A card's text as "|"-separated pieces, whitespace-only pieces dropped. */
function pieces(card: string): string[] {
  return decode(card.replace(/<[^>]+>/g, "|"))
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
}

const num = (s: string | undefined) => {
  const t = String(s ?? "").replace(/−/g, "-").replace(/^\+/, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
};

/** "George Mason −15.0" or ["George Mason", "−15.5"] -> team, line. "PK"/"Pick" is 0. */
function teamLine(team: string, rest?: string): { team: string; line: number } | null {
  const joined = rest === undefined ? team : `${team} ${rest}`;
  const m = /^(.*\S)\s+([+\-−]?\d+(?:\.\d+)?|PK|Pick|EVEN)$/i.exec(joined.trim());
  if (!m) return null;
  const line = /^(pk|pick|even)$/i.test(m[2]) ? 0 : num(m[2]);
  return line === null ? null : { team: m[1].trim(), line };
}

/** One team's line turned into the HOME (his second-named) team's line. Null when the name is neither team. */
function homeLine(tl: { team: string; line: number } | null, away: string, home: string): number | null {
  if (!tl) return null;
  if (tl.team === home) return tl.line;
  if (tl.team === away) return -tl.line || 0;
  return null;
}

/** Every game card on his page. Throws when the page has cards but none read (he changed the layout). */
export function parseDavidCbb(html: string): { date: string | null; updated: string | null; rows: DavidCbbRow[]; unread: number } {
  const cards = [...html.matchAll(/<article\b[\s\S]*?<\/article>/g)].map((m) => m[0]);
  const date = /<time[^>]*dateTime="(\d{4}-\d{2}-\d{2})"/.exec(html)?.[1] ?? null;
  // The page's "updated" stamp is the one full timestamp above the first card.
  const head = html.indexOf("<article") > 0 ? html.slice(0, html.indexOf("<article")) : "";
  const updated = /<time[^>]*dateTime="(\d{4}-\d{2}-\d{2}T[^"]+)"/.exec(head)?.[1] ?? null;
  const rows: DavidCbbRow[] = [];
  let unread = 0;
  for (const card of cards) {
    const p = pieces(card);
    const tip = /<time[^>]*dateTime="([^"]+T[^"]+)"/.exec(card)?.[1];
    const ti = p.findIndex((x) => /^.+ (at|vs\.) .+$/.test(x) && p[p.indexOf(x) + 1] === "Projected score");
    const at = ti >= 0 ? /^(.+?) (at|vs\.) (.+)$/.exec(p[ti]) : null;
    const after = (label: string) => p.findIndex((x) => x === label);
    // "Consensus" and "spread" print as two pieces; find the pair.
    const pair = (a: string, b: string) => p.findIndex((x, i) => x === a && p[i + 1] === b);
    const iModel = after("Model spread");
    const iTotal = after("Projected total");
    const iCs = pair("Consensus", "spread");
    const iCt = pair("Consensus", "total");
    const iPick = p.findIndex((x) => /^Spread pick$/i.test(x));
    if (!at || iModel < 0) {
      unread++;
      continue;
    }
    const away = at[1].trim();
    const home = at[3].trim();
    const model = homeLine(teamLine(p[iModel + 1] ?? ""), away, home);
    const spread = iCs >= 0 ? homeLine(teamLine(p[iCs + 2] ?? "", p[iCs + 3]), away, home) : null;
    const pickTl = iPick >= 0 ? teamLine(p[iPick + 2] ?? "", p[iPick + 3]) : null;
    const edge = iPick >= 0 ? num(p[iPick + 4]) : null;
    if (model === null) {
      unread++;
      continue;
    }
    rows.push({
      away,
      home,
      neutral: at[2] === "vs." || p.includes("Neutral site"),
      spread,
      model,
      conf: null,
      edge,
      pick: pickTl ? (pickTl.team === home ? "home" : pickTl.team === away ? "away" : null) : null,
      trigger: false,
      total: iTotal >= 0 ? num(p[iTotal + 1]) : null,
      postedTotal: iCt >= 0 ? num(p[iCt + 2]) : null,
      ...(tip ? { davidTip: tip } : {}),
    });
  }
  if (cards.length && !rows.length) throw new Error(`David's CBB page has ${cards.length} game cards but none read: his layout changed`);
  return { date, updated, rows, unread };
}

/** A card's own logic (his pick on the side his model and the consensus favor), shared with Harris. */
export const checkDavidRow = (r: DavidCbbRow) => checkCbbRow(r);

/** A fresh read merged onto the stored one; `pre` moves only on a read before tip. */
export function mergeDavid(prior: DavidCbbRow[] | undefined, fresh: DavidCbbRow[], at: string): DavidCbbRow[] {
  const old = new Map((prior ?? []).filter((r) => r.event).map((r) => [r.event!, r]));
  const out = fresh.map((r) => {
    const was = r.event ? old.get(r.event) : undefined;
    if (r.event) old.delete(r.event);
    const before = !!r.tip && at < r.tip && r.model !== null;
    const pre = before ? { at, model: r.model!, spread: r.spread, trigger: false, total: r.total } : was?.pre;
    return pre ? { ...r, pre } : r;
  });
  // He drops a game once it tips: keep what was read of it before.
  for (const r of old.values()) if (r.pre) out.push(r);
  return out;
}

export function davidPreOf(rows: DavidCbbRow[]): { [event: string]: DavidPre } {
  const out: { [event: string]: DavidPre } = {};
  for (const r of rows)
    if (r.event && r.homeId && r.pre) out[r.event] = { homeId: r.homeId, model: r.pre.model, total: r.pre.total ?? null, spread: r.pre.spread, postedTotal: r.postedTotal, at: r.pre.at };
  return out;
}

/** His page, one request. */
export async function fetchDavidCbb(url = DAVID_CBB_URL, timeoutMs = 12_000): Promise<string> {
  const res = await fetch(url, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0 (hobby-hub)" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`David's CBB page answered ${res.status}`);
  return res.text();
}
