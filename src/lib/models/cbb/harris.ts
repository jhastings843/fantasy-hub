// John Harris's college basketball model, as an outside source for our CBB
// section (Jack, 2026-11-06). Tracked only: his numbers feed a few learner
// slices (learn.ts, "cbb:harris*") on the shared engine, judged by the same
// CBB gate as every other slice. Nothing is staked.
//
// His site loads JSON from a Google Apps Script web app (HARRIS_CBB_URL), one
// GET per day with picks_date=YYYY-MM-DD. tabs.picks has one row per game:
//   Date | Away | Home | Neutral | Spread | Model Prediction | Confidence |
//   Edge | ATS Pick | Trigger | Start (past days only)
// Signs, checked on every row of Nov 3 to 7 (harris.test.ts):
//   Spread            the HOME team's line (-25.5 = home favored by 25.5)
//   Model Prediction  his line for the HOME team on the same scale; he picks
//                     home when Model < Spread (he has home stronger)
//   Confidence        his chance the home side covers (> 0.5 when he picks home)
//   ATS Pick          "<team> <its line>"
//   Edge              |Model - Spread|, but its SIGN is not stable: Nov 3, 5,
//                     6 and 7 print Model - Spread (negative favors home, the
//                     opposite of his football feed), Nov 4 prints Spread -
//                     Model (positive favors home, like football). So nothing
//                     reads Edge's sign: the side comes from Model vs Spread.
// There is no Opening Spread column (football has one).
//
// Pure except fetchHarrisCbb, which makes one GET per call.

import { ALIAS, squeeze } from "./torvik";

export const HARRIS_CBB_URL =
  "https://script.google.com/macros/s/AKfycbyPMR2wVlHml_fR2_f9HAr07fERfSpVHcn7dap5cCjt5QO6BGmEOTcJ-sswImoOt57hoA/exec";

export interface CbbFeedTable {
  headers: string[];
  rows: string[][];
}

/** One game on his sheet, his orientation, plus the game it matched on our ESPN board. */
export interface HarrisCbbRow {
  away: string;
  home: string;
  neutral: boolean;
  /** His home line, his model's home line, his home-cover chance, his printed Edge (sign unreliable, see above). Null when blank. */
  spread: number | null;
  model: number | null;
  conf: number | null;
  edge: number | null;
  /** The side his ATS Pick names. */
  pick: "home" | "away" | null;
  trigger: boolean;
  /** Matched ESPN event and team ids (his home is `homeId`, whatever ESPN calls home). */
  event?: string;
  homeId?: string;
  awayId?: string;
  tip?: string;
  /** His numbers on the last read before tip: the only ones a slice may use. */
  pre?: { at: string; model: number; spread: number | null; trigger: boolean };
}

export interface HarrisCbbDay {
  season: number;
  /** YYYY-MM-DD, his Date column (Eastern). */
  date: string;
  rows: HarrisCbbRow[];
  /** Every row matched a game on our board for that date. */
  verified: boolean;
  problems: string[];
  /** Rows he never priced (no Spread) that are not on our board: left out, not a problem (Nov 3 listed Incarnate Word at Tulsa, a game ESPN never had). */
  unpriced?: string[];
  /** Rows left out because his own numbers don't add up (a sheet typo). One bad row no longer fails the day. */
  setAside?: string[];
  at: string;
}

/** What a slice reads for one game: his last pregame numbers, keyed by ESPN event (Redis hash HARRIS_PRE). */
export interface HarrisPre {
  /** The team his Model Prediction is the line for. */
  homeId: string;
  model: number;
  spread: number | null;
  trigger: boolean;
  at: string;
}

export const HARRIS_DAY = (season: number, date: string) => `models:v1:cbb:${season}:harris:day:${date}`;
export const HARRIS_DAYS = (season: number) => `models:v1:cbb:${season}:harris:days`;
export const HARRIS_PRE = (season: number) => `models:v1:cbb:${season}:harris:pre`;

/** The pregame numbers of every matched row read before tip. */
export function preOf(rows: HarrisCbbRow[]): { [event: string]: HarrisPre } {
  const out: { [event: string]: HarrisPre } = {};
  for (const r of rows) if (r.event && r.homeId && r.pre) out[r.event] = { homeId: r.homeId, ...r.pre };
  return out;
}

/** A board game, the fields matching needs. */
export interface BoardTeams {
  id: string;
  tip: string;
  home: { id: string; name: string; short: string };
  away: { id: string; name: string; short: string };
}

/** His squeezed name -> ESPN squeezed location, where squeezing alone does not agree (checked on Nov 3, 6 and 7: 118 of 119 games matched before these). */
export const HARRIS_ALIAS: { [harris: string]: string } = {
  saintthomasminnesota: "saintthomas",
};

/** "San JosÃ© State" (UTF-8 read as Latin-1 on his side) -> "San José State". */
export function fixText(s: string): string {
  if (!/[ÃÂ][\u0080-¿]/.test(s)) return s;
  try {
    const bytes = Uint8Array.from([...s].map((ch) => ch.charCodeAt(0) & 0xff));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return s;
  }
}

export const nameKey = (name: string) => {
  const k = squeeze(fixText(name));
  return HARRIS_ALIAS[k] ?? ALIAS[k] ?? k;
};

const num = (s: string | undefined) => {
  const t = String(s ?? "").trim().replace(/^\+/, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** His picks table to rows, columns found by header name. Rows without both teams are dropped. */
export function feedRows(table: CbbFeedTable): HarrisCbbRow[] {
  const col = (re: RegExp) => table.headers.findIndex((h) => re.test(h.trim()));
  const i = {
    away: col(/^away$/i),
    home: col(/^home$/i),
    neutral: col(/^neutral$/i),
    spread: col(/^spread$/i),
    model: col(/^model prediction$/i),
    conf: col(/^confidence$/i),
    edge: col(/^edge$/i),
    pick: col(/^ats pick$/i),
    trigger: col(/^trigger$/i),
  };
  if ([i.away, i.home, i.spread, i.model, i.edge].some((x) => x < 0)) throw new Error(`Harris CBB feed is missing a column (headers: ${table.headers.join(", ")})`);
  return table.rows
    .filter((r) => (r[i.away] ?? "").trim() && (r[i.home] ?? "").trim())
    .map((r) => {
      const away = fixText(r[i.away].trim());
      const home = fixText(r[i.home].trim());
      const p = fixText((r[i.pick] ?? "").trim());
      const pick = p.startsWith(`${home} `) ? "home" : p.startsWith(`${away} `) ? "away" : null;
      return {
        away,
        home,
        neutral: /^y/i.test(r[i.neutral] ?? ""),
        spread: num(r[i.spread]),
        model: num(r[i.model]),
        conf: i.conf >= 0 ? num(r[i.conf]) : null,
        edge: num(r[i.edge]),
        pick,
        trigger: /^y/i.test(r[i.trigger] ?? ""),
      };
    });
}

/** The side his numbers favor: home when his home line is shorter than the market's. */
export const modelSide = (r: Pick<HarrisCbbRow, "model" | "spread">): "home" | "away" | null =>
  r.model === null || r.spread === null || r.model === r.spread ? null : r.model < r.spread ? "home" : "away";

/**
 * A row's own logic: the ATS Pick on the side his Model and Spread favor. Null when fine.
 * His Edge column is NOT checked (Jack, 2026-11-06): nothing here reads it, and
 * after Nov 6's games his sheet printed Edge = Model on every row, which threw
 * out a whole day of good Model and Spread numbers.
 */
export function checkCbbRow(r: HarrisCbbRow): string | null {
  if (r.spread === null || r.model === null) return null;
  const side = modelSide(r);
  if (side && r.pick && side !== r.pick) return `${r.away} at ${r.home}: Model ${r.model} vs Spread ${r.spread} favors ${side}, ATS Pick says ${r.pick}`;
  return null;
}

/**
 * His rows matched to the day's board by team name, either orientation (ESPN
 * can call either team home at a neutral site). Matched rows get the event
 * and ids; every unmatched name and failed check is a problem.
 */
export function matchRows(rows: HarrisCbbRow[], games: BoardTeams[]): { rows: HarrisCbbRow[]; problems: string[]; unmatched: string[]; unpriced: string[]; setAside: string[] } {
  const keys = (t: BoardTeams["home"]) => new Set([squeeze(t.name), squeeze(t.short)]);
  const board = games.map((g) => ({ g, h: keys(g.home), a: keys(g.away) }));
  const named = new Set(board.flatMap((b) => [...b.h, ...b.a]));
  const problems: string[] = [];
  const unpriced: string[] = [];
  // A row whose own numbers don't add up (a typo in his sheet, e.g. Nov 6 Youngstown State at Ohio State) is left
  // out on its own; it no longer fails the whole day, which used to hold back every other game and page Jack.
  const setAside: string[] = [];
  const unmatched = new Set<string>();
  const used = new Set<string>();
  const out = rows.map((r) => {
    const hk = nameKey(r.home);
    const ak = nameKey(r.away);
    const hit = board.find((b) => !used.has(b.g.id) && ((b.h.has(hk) && b.a.has(ak)) || (b.h.has(ak) && b.a.has(hk))));
    const bad = checkCbbRow(r);
    if (bad) {
      setAside.push(bad);
      return { ...r, setAside: true } as HarrisCbbRow & { setAside?: boolean };
    }
    if (!hit) {
      if (r.spread === null) {
        unpriced.push(`${r.away} at ${r.home}`);
        return r;
      }
      problems.push(`${r.away} at ${r.home}: no game on our board`);
      for (const [n, k] of [[r.away, ak], [r.home, hk]]) if (!named.has(k)) unmatched.add(n);
      return r;
    }
    used.add(hit.g.id);
    const flipped = hit.h.has(ak) && hit.a.has(hk) && !(hit.h.has(hk) && hit.a.has(ak));
    return { ...r, event: hit.g.id, homeId: flipped ? hit.g.away.id : hit.g.home.id, awayId: flipped ? hit.g.home.id : hit.g.away.id, tip: hit.g.tip };
  });
  const kept = out.filter((r) => !(r as { setAside?: boolean }).setAside && (r.event || r.spread !== null));
  return { rows: kept, problems, unmatched: [...unmatched], unpriced, setAside };
}

/**
 * A fresh read merged onto the stored one. `pre` (the numbers a slice uses)
 * moves only on a read before tip, so a read after the game can never change
 * what the slice saw.
 */
export function mergeDay(prior: HarrisCbbRow[] | undefined, fresh: HarrisCbbRow[], at: string): HarrisCbbRow[] {
  const old = new Map((prior ?? []).filter((r) => r.event).map((r) => [r.event!, r]));
  const out = fresh.map((r) => {
    const was = r.event ? old.get(r.event) : undefined;
    if (r.event) old.delete(r.event);
    const before = !!r.tip && at < r.tip && r.model !== null;
    const pre = before ? { at, model: r.model!, spread: r.spread, trigger: r.trigger } : was?.pre;
    return pre ? { ...r, pre } : r;
  });
  // A game he dropped from the sheet keeps what was read of it before tip.
  for (const r of old.values()) if (r.pre) out.push(r);
  return out;
}

/** His feed is a Google Apps Script: 24-42 s on a cold read, 1-3 s warm (timed 2026-11-12). Read after the pulse answers (harris-store.ts), so it gets 55 s. */
export const HARRIS_CBB_SLOW_MS = 55_000;

/** One day's picks table from his feed. One request. Throws HarrisCbbSlow past timeoutMs. */
export async function fetchHarrisCbb(date: string, url = HARRIS_CBB_URL, timeoutMs = 60_000): Promise<CbbFeedTable> {
  const res = await fetch(`${url}?picks_date=${encodeURIComponent(date)}`, { redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) }).catch((e) => {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw new HarrisCbbSlow(date, timeoutMs);
    throw e;
  });
  if (!res.ok) throw new Error(`Harris CBB feed answered ${res.status}`);
  const j = (await res.json()) as { tabs?: { picks?: CbbFeedTable } };
  const table = j.tabs?.picks;
  if (!table?.headers || !Array.isArray(table.rows)) throw new Error("Harris CBB feed sent no picks table");
  const iDate = table.headers.findIndex((h) => /^date$/i.test(h.trim()));
  const other = table.rows.find((r) => (r[iDate] ?? "").trim() !== date);
  if (other) throw new Error(`Harris CBB feed sent ${other[iDate]} when asked for ${date}`);
  return table;
}

/** His feed did not answer in time (usually a cold start); the next pulse retries. */
export class HarrisCbbSlow extends Error {
  constructor(date: string, ms: number) {
    super(`his feed took over ${Math.round(ms / 1000)}s for ${date}`);
    this.name = "HarrisCbbSlow";
  }
}

/** Usable days for the Learning page: verified days of days on file. */
export function usableDays(days: { date: string; verified: boolean }[]): { usable: number; total: number; missing: string[] } {
  const missing = days.filter((d) => !d.verified).map((d) => d.date).sort();
  return { usable: days.length - missing.length, total: days.length, missing };
}
