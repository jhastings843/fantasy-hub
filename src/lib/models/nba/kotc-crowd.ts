// King of the Court: where the crowd's money is going tonight (Jack,
// 2026-10-28: "chance + live crowd"). DraftKings never shows how many people
// tagged each player, but DraftKings Network's Most Bet Player Props page
// ranks NBA props by handle (top 50, refreshed every five minutes, no login).
// On a promo night much of that handle is King of the Court tags, so a player
// high on the list is likely over-backed and pays less if he is king.
//
// Each player's heat is the sum, over the rows that name him, of
// 1 - (rank - 1) / 50: the top row adds 1, the 50th adds 0.02. His backers
// are the crowd fit's (exp(a) x chance^b) times 1 + heat, at most 5x. That
// multiplier is a guess (estimate): past nights ran 0.2x to 5.6x the fit, and
// each night's list is logged on the saved night so it can be fit once a few
// weeks of paid nights exist. Parsing is pure; fetchMostBet does the read.
import { nameKey } from "@/lib/props/grade";

export const MOST_BET_URL = "https://dknetwork.draftkings.com/draftkings-sportsbook-player-props/?tb_eg=42648&tb_edate=today&tb_view=2";
/** Ceiling on the crowd multiplier. */
export const HEAT_CAP = 5;

export interface MostBetRow {
  rank: number;
  event: string;
  market: string;
  line: string;
}

export interface KotcCrowd {
  at: string;
  rows: MostBetRow[];
}

const text = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&#8722;|&minus;/g, "−")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&#8217;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The Most Bet table's rows, ranked from 1, header skipped. */
export function parseMostBet(html: string): MostBetRow[] {
  const table = html.match(/<table[^>]*tb_pp_table[\s\S]*?<\/table>/)?.[0];
  if (!table) return [];
  const out: MostBetRow[] = [];
  for (const tr of table.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    if (/<th[\s>]/.test(tr)) continue;
    const c = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
    if (c.length < 4) continue;
    out.push({ rank: out.length + 1, event: c[0], market: c[2], line: c[3] });
  }
  return out;
}

/** A player's heat on the list: 0 when no row names him. */
export function heatOf(rows: MostBetRow[], player: string): number {
  const k = nameKey(player);
  if (!k) return 0;
  const n = Math.max(rows.length, 1);
  return rows.reduce((a, r) => (nameKey(r.market).includes(k) || nameKey(r.line) === k ? a + 1 - (r.rank - 1) / n : a), 0);
}

/** How many times the crowd fit's backers he likely has (estimate). */
export const crowdMultiplier = (heat: number) => Math.min(HEAT_CAP, 1 + heat);

export async function fetchMostBet(now = new Date()): Promise<KotcCrowd> {
  const res = await fetch(MOST_BET_URL, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0 (fantasy-hub KOTC)" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`DK Network most-bet props answered ${res.status}`);
  const rows = parseMostBet(await res.text());
  if (!rows.length) throw new Error("DK Network most-bet props: no table rows");
  return { at: now.toISOString(), rows };
}
