// Sam's college basketball page (samthemodelman.smmodel.workers.dev/cbb/,
// live 2026-11-25 after "coming soon" since Nov 2) as an outside source for our
// CBB section, on equal footing with John Harris and David Sasser (Jack: "make
// sure sam is now being tracked as a part of cbb"). Tracked only: his numbers
// feed learner slices (learn.ts, "cbb:sam*") on the shared engine, judged by
// the same CBB gate as every other slice. Nothing is staked.
//
// The page lists TODAY's games (Eastern). Each <article class="game"> card
// reads (checked on all 41 cards of Nov 25):
//   when: "11:00 AM ET · Neutral court" (or the home team's name)
//   teams: first .team is the road side, second is home; each has .nm and
//          .pts (his projected points)
//   mkt:   "Vegas line | Ohio Bobcats -3.5", "Model line | Ohio Bobcats -0.4"
//   pick:  "Rice Owls +3.5  (3.1)"  (side at the Vegas line, gap in points)
//   link:  game/<ESPN event id>.html
// The Vegas line is the first line his model saw, not ours, so every slice
// grades at OUR saved DraftKings line, the same as Harris and David. His total
// is the sum of his projected points (he shows no market total).
//
// Rows are shaped like Harris's so matchRows (team names to the ESPN board,
// either orientation) is shared; the ESPN id in his link must agree with the
// match or the row is a problem. Pure except fetchSamCbb.

import type { HarrisCbbRow } from "./harris";
import type { DavidPre } from "./david";

export const SAM_CBB_URL = "https://samthemodelman.smmodel.workers.dev/cbb/";

export interface SamCbbRow extends HarrisCbbRow {
  /** His projected total (sum of his two projected scores). */
  total: number | null;
  /** The ESPN event his card links to. */
  samEvent?: string;
  pre?: HarrisCbbRow["pre"] & { total?: number | null };
}

export interface SamCbbDay {
  season: number;
  date: string;
  rows: SamCbbRow[];
  verified: boolean;
  problems: string[];
  setAside?: string[];
  /** His page's "UPDATED ..." stamp, as printed. */
  updated?: string;
  at: string;
}

/** What a slice reads for one game: same shape as David's (homeId's line, his total). */
export type SamPre = DavidPre;

export const SAM_DAY = (season: number, date: string) => `models:v1:cbb:${season}:sam:day:${date}`;
export const SAM_DAYS = (season: number) => `models:v1:cbb:${season}:sam:days`;
export const SAM_PRE = (season: number) => `models:v1:cbb:${season}:sam:pre`;

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const text = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

const num = (s: string | undefined) => {
  const t = String(s ?? "").replace(/−/g, "-").replace(/^\+/, "").trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

/** "Ohio Bobcats -3.5" -> team, line. "PK"/"Pick"/"EVEN" is 0. */
function teamLine(s: string): { team: string; line: number } | null {
  const m = /^(.*\S)\s+([+\-−]?\d+(?:\.\d+)?|PK|Pick|EVEN)$/i.exec(s.trim());
  if (!m) return null;
  const line = /^(pk|pick|even)$/i.test(m[2]) ? 0 : num(m[2]);
  return line === null ? null : { team: m[1].trim(), line };
}

function homeLine(tl: { team: string; line: number } | null, away: string, home: string): number | null {
  if (!tl) return null;
  if (tl.team === home) return tl.line;
  if (tl.team === away) return -tl.line || 0;
  return null;
}

const labelled = (card: string, label: string) => {
  const re = new RegExp(`<span class="lbl">${label}</span>\\s*<span class="val[^"]*">([^<]*)</span>`, "i");
  return re.exec(card)?.[1] ? decode(re.exec(card)![1]).trim() : null;
};

/** Every game card on his page. Throws when the page has cards but none read (he changed the layout). */
export function parseSamCbb(html: string): { updated: string | null; rows: SamCbbRow[]; unread: number } {
  const cards = [...html.matchAll(/<article class="game"[\s\S]*?<\/article>/g)].map((m) => m[0]);
  const updated = /<div class="stamp">([^<]*)<\/div>/.exec(html)?.[1]?.trim() ?? null;
  const rows: SamCbbRow[] = [];
  let unread = 0;
  for (const card of cards) {
    const teams = [...card.matchAll(/<div class="team[^"]*">[\s\S]*?<span class="nm">([^<]*)<\/span>[\s\S]*?<div class="pts">([^<]*)<\/div>/g)];
    const when = /<div class="when">([\s\S]*?)<\/div>/.exec(card)?.[1];
    const vegas = labelled(card, "Vegas line");
    const modelTxt = labelled(card, "Model line");
    const pickTxt = /<span class="pickval">([^<]*)<\/span>/.exec(card)?.[1];
    const ev = /href="game\/(\d+)\.html"/.exec(card)?.[1];
    if (teams.length !== 2 || !modelTxt) {
      unread++;
      continue;
    }
    const away = decode(teams[0][1]).trim();
    const home = decode(teams[1][1]).trim();
    const model = homeLine(teamLine(modelTxt), away, home);
    if (model === null) {
      unread++;
      continue;
    }
    const pa = num(teams[0][2]);
    const ph = num(teams[1][2]);
    const pm = pickTxt ? /^(.*\S)\s+\(([\d.]+)\)\s*$/.exec(decode(pickTxt).trim()) : null;
    const pickTl = pm ? teamLine(pm[1]) : null;
    rows.push({
      away,
      home,
      neutral: /neutral/i.test(when ? text(when) : ""),
      spread: vegas ? homeLine(teamLine(vegas), away, home) : null,
      model,
      conf: null,
      edge: pm ? num(pm[2]) : null,
      pick: pickTl ? (pickTl.team === home ? "home" : pickTl.team === away ? "away" : null) : null,
      trigger: false,
      total: pa !== null && ph !== null ? Math.round((pa + ph) * 10) / 10 : null,
      ...(ev ? { samEvent: ev } : {}),
    });
  }
  if (cards.length && !rows.length) throw new Error(`Sam's CBB page has ${cards.length} game cards but none read: his layout changed`);
  return { updated, rows, unread };
}

/** A board game's teams, enough to match his cards (ESPN `name` is the school, e.g. "Ohio"). */
export interface SamBoardGame {
  id: string;
  tip: string;
  home: { id: string; name: string };
  away: { id: string; name: string };
}

/** His full name ("Ohio Bobcats") is the ESPN school plus mascot: a match is the name or the name and a space. */
const isTeam = (his: string, school: string) => his === school || his.startsWith(`${school} `);

/**
 * His cards matched to the ESPN board by the event id each card links, then
 * oriented by name (his second team is his home; ESPN may call the other team
 * home at a neutral site). A card whose id is not on the board, or whose names
 * fit neither way round, is a problem.
 */
export function matchSamRows(rows: SamCbbRow[], games: SamBoardGame[]): { rows: SamCbbRow[]; problems: string[] } {
  const by = new Map(games.map((g) => [g.id, g]));
  const problems: string[] = [];
  const out = rows.map((r) => {
    const g = r.samEvent ? by.get(r.samEvent) : undefined;
    if (!g) {
      problems.push(`${r.away} at ${r.home}: ${r.samEvent ? `ESPN ${r.samEvent} not on our board` : "no ESPN link on his card"}`);
      return r;
    }
    const straight = isTeam(r.home, g.home.name) && isTeam(r.away, g.away.name);
    const flipped = isTeam(r.home, g.away.name) && isTeam(r.away, g.home.name);
    // Both fit only when one school name starts the other's ("Ohio" / "Ohio State"): the way round that uses more of the school names wins.
    const flip = straight && flipped ? g.away.name.length > g.home.name.length && r.home.startsWith(`${g.away.name} `) : flipped;
    if (!straight && !flipped) {
      problems.push(`${r.away} at ${r.home}: names don't fit ESPN ${g.id} (${g.away.name} at ${g.home.name})`);
      return r;
    }
    return { ...r, event: g.id, homeId: flip ? g.away.id : g.home.id, awayId: flip ? g.home.id : g.away.id, tip: g.tip };
  });
  return { rows: out, problems };
}

/** A fresh read merged onto the stored one; `pre` moves only on a read before tip. */
export function mergeSam(prior: SamCbbRow[] | undefined, fresh: SamCbbRow[], at: string): SamCbbRow[] {
  const old = new Map((prior ?? []).filter((r) => r.event).map((r) => [r.event!, r]));
  const out = fresh.map((r) => {
    const was = r.event ? old.get(r.event) : undefined;
    if (r.event) old.delete(r.event);
    const before = !!r.tip && at < r.tip && r.model !== null;
    const pre = before ? { at, model: r.model!, spread: r.spread, trigger: false, total: r.total } : was?.pre;
    return pre ? { ...r, pre } : r;
  });
  // A game he drops keeps what was read of it before tip.
  for (const r of old.values()) if (r.pre) out.push(r);
  return out;
}

export function samPreOf(rows: SamCbbRow[]): { [event: string]: SamPre } {
  const out: { [event: string]: SamPre } = {};
  for (const r of rows)
    if (r.event && r.homeId && r.pre) out[r.event] = { homeId: r.homeId, model: r.pre.model, total: r.pre.total ?? null, spread: r.pre.spread, postedTotal: null, at: r.pre.at };
  return out;
}

/** His page, one request. */
export async function fetchSamCbb(url = SAM_CBB_URL, timeoutMs = 12_000): Promise<string> {
  const res = await fetch(url, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0 (hobby-hub)" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Sam's CBB page answered ${res.status}`);
  return res.text();
}
