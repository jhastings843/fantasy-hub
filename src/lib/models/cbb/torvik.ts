// Readers for Bart Torvik's free T-Rank files (barttorvik.com). Pure.
//
//   {year}_team_results.json  one array per team; year is the season's end
//                             (2027 = 2026-27). Before a season tips it holds
//                             T-Rank's preseason ratings, then the live ones.
//   {year}_super_sked.json    one array per game: T-Rank's line at the time
//                             (column 54), the final and the possessions.
//
// Column positions were read off the files on 2026-11-02 (Duke's 2027 row:
// adjOE 120.7 at 4, adjDE 91.2 at 6, barthag .962 at 8, adjT 70.1 at 44).

import type { TrankTeam } from "./model";

const num = (v: unknown) => (typeof v === "number" ? v : Number(v));

export function readTorvikTeams(rows: unknown[][]): TrankTeam[] {
  const out: TrankTeam[] = [];
  for (const r of rows) {
    const t: TrankTeam = { rank: num(r[0]), name: String(r[1] ?? ""), conf: String(r[2] ?? ""), record: String(r[3] ?? ""), adjOE: num(r[4]), adjDE: num(r[6]), barthag: num(r[8]), adjT: num(r[44]) };
    if (t.name && [t.adjOE, t.adjDE, t.adjT].every((x) => Number.isFinite(x) && x > 40 && x < 160)) out.push(t);
  }
  return out;
}

export interface TorvikGame {
  /** YYYY-MM-DD. */
  date: string;
  /** Torvik names. Home is the second team named in "A at B"; neutral when "A vs. B". */
  home: string;
  away: string;
  neutral: boolean;
  /** T-Rank's projected points at the time, and the final. */
  pred: { home: number; away: number };
  score: { home: number; away: number } | null;
  poss: number | null;
}

/** "11/3/25" -> "2025-11-03". */
const isoOf = (s: string) => {
  const [m, d, y] = s.split("/").map(Number);
  return `${2000 + y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

export function readTorvikSked(rows: unknown[][]): TorvikGame[] {
  const out: TorvikGame[] = [];
  for (const r of rows) {
    const t1 = String(r[8] ?? "");
    const t2 = String(r[14] ?? "");
    const where = String(r[3] ?? "");
    const pre = Array.isArray(r[54]) ? (r[54] as unknown[]) : null;
    if (!t1 || !t2 || !pre) continue;
    const p1 = num(pre[3]);
    const p2 = num(pre[4]);
    if (!Number.isFinite(p1) || !Number.isFinite(p2)) continue;
    const neutral = / vs\.? /.test(where);
    // In "A at B" the first named (column 8) is the visitor; at a neutral site the order is arbitrary, keep it.
    const s1 = num(r[27]);
    const s2 = num(r[28]);
    const done = Number.isFinite(s1) && Number.isFinite(s2) && s1 + s2 > 0;
    const poss = num(r[25]);
    out.push({
      date: isoOf(String(r[1])),
      home: t2,
      away: t1,
      neutral,
      pred: { home: p2, away: p1 },
      score: done ? { home: s2, away: s1 } : null,
      poss: Number.isFinite(poss) && poss > 30 ? poss : null,
    });
  }
  return out;
}

/**
 * A name both ESPN's `location` and Torvik agree on once squeezed:
 * "Michigan St." and "Michigan State" -> "michiganstate"; "Saint Mary's" and
 * "St. Mary's" -> "saintmarys". The few that still differ are in ALIAS.
 */
export function squeeze(name: string): string {
  let s = name.normalize("NFD").replace(/[\u0300-\u036f\u02bb]/g, "").toLowerCase().replace(/&/g, "and").replace(/['’.()]/g, "").replace(/-/g, " ");
  s = s.replace(/\bst\b$/, "state").replace(/^st /, "saint ").replace(/\bst\s/g, "state ");
  s = s.replace(/\bstate state\b/, "state");
  return s.replace(/\s+/g, "");
}

/** Torvik squeezed name -> ESPN squeezed location, where the two still disagree (checked 2026-11-02 against every D1 name in the 2027 file: 356 of 365 matched before these). */
export const ALIAS: { [torvik: string]: string } = {
  penn: "pennsylvania",
  seattle: "seattleu",
  american: "americanuniversity",
  texasaandmcorpuschris: "texasaandmcorpuschristi",
  gramblingstate: "grambling",
  uscupstate: "southcarolinaupstate",
  neworleans: "lsuneworleans",
  miamifl: "miami",
  connecticut: "uconn",
  mississippi: "olemiss",
  mcneesestate: "mcneese",
  illinoischicago: "uic",
  samhoustonstate: "samhouston",
  fiu: "floridainternational",
  calbaptist: "californiabaptist",
  queens: "queensuniversity",
  liu: "longislanduniversity",
  appalachianstate: "appstate",
  southeasternlouisiana: "selouisiana",
  nichollsstate: "nicholls",
  iuindy: "iuindianapolis",
  nebraskaomaha: "omaha",
  umkc: "kansascity",
  albany: "ualbany",
  louisianamonroe: "ulmonroe",
  loyolamd: "loyolamaryland",
  tennesseemartin: "utmartin",
};

/** Torvik name -> ESPN team id, given ESPN's id -> location map. Unmatched names are returned too. */
export function matchTorvik(torvikNames: string[], espn: { [id: string]: string }): { map: Map<string, string>; unmatched: string[] } {
  const byKey = new Map<string, string>();
  for (const [id, loc] of Object.entries(espn)) byKey.set(squeeze(loc), id);
  const map = new Map<string, string>();
  const unmatched: string[] = [];
  for (const n of torvikNames) {
    const k = squeeze(n);
    const id = byKey.get(ALIAS[k] ?? k) ?? byKey.get(k);
    if (id) map.set(n, id);
    else unmatched.push(n);
  }
  return { map, unmatched };
}
