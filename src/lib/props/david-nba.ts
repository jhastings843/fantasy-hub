// David Sasser's NBA player props (davidsasser.com/nba, new with his Oct 28
// rebuild): his projected points, rebounds, assists and threes for every
// player on the night's slate, an 80% range, and DraftKings' line and prices.
// The slate rides in the page's RSC payload as {"slate": {...}}, like his NFL
// board. We keep only his number per player and stat: our NBA copies save it
// pregame and the grader grades his side at the same DraftKings line and price
// as ours (lib/props/grade.ts alts.david), so he is judged like for like.

import { objectAt, rscText } from "@/lib/rsc";
import { nameKey } from "./grade";
import type { NbaStat } from "./parse";

export const DAVID_NBA_URL = "https://davidsasser.com/nba";

const STAT: { [k: string]: NbaStat } = { points: "pts", rebounds: "reb", assists: "ast", threes: "threes" };

export interface DavidNbaProp {
  /** ESPN event id, the same id our NBA copies are saved under. */
  gameId: string;
  player: string;
  team: string;
  stat: NbaStat;
  projection: number;
  lower: number | null;
  upper: number | null;
  /** DraftKings' line and prices as his page showed them. */
  line: number | null;
  over: number | null;
  under: number | null;
}

export interface DavidNbaSlate {
  date: string;
  updatedAt: string;
  props: DavidNbaProp[];
}

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Read the slate out of the page's RSC payload. Null when it isn't there. */
export function parseDavidNba(html: string): DavidNbaSlate | null {
  const rsc = rscText(html);
  const at = rsc.indexOf('{"slate":');
  const raw = at >= 0 ? objectAt(rsc, at) : null;
  if (!raw) return null;
  type Q = { line?: unknown; overOdds?: unknown; underOdds?: unknown; modelStale?: unknown };
  type M = { mean?: unknown; lower?: unknown; upper?: unknown; quote?: Q | null };
  const sl = (JSON.parse(raw) as { slate?: { date?: string; updatedAt?: string; players?: { name?: string; team?: string; gameId?: string; markets?: { [k: string]: M } }[] } }).slate;
  if (!sl?.date || !Array.isArray(sl.players)) return null;
  const props: DavidNbaProp[] = [];
  for (const p of sl.players) {
    if (!p.name || !p.gameId) continue;
    for (const [k, m] of Object.entries(p.markets ?? {})) {
      const stat = STAT[k];
      const mean = num(m?.mean);
      // A projection his own page flags as out of date is left out.
      if (!stat || mean === null || m.quote?.modelStale === true) continue;
      props.push({
        gameId: String(p.gameId),
        player: String(p.name),
        team: String(p.team ?? ""),
        stat,
        projection: r1(mean),
        lower: num(m.lower),
        upper: num(m.upper),
        line: num(m.quote?.line),
        over: num(m.quote?.overOdds),
        under: num(m.quote?.underOdds),
      });
    }
  }
  return { date: sl.date, updatedAt: String(sl.updatedAt ?? ""), props };
}

export async function fetchDavidNba(): Promise<DavidNbaSlate> {
  const res = await fetch(DAVID_NBA_URL, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0 (fantasy-hub props tracker)" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`David's NBA page answered ${res.status}`);
  const s = parseDavidNba(await res.text());
  if (!s) throw new Error("David's NBA page did not read");
  return s;
}

/** His projection for each of our markets in a game ({market id: projection}), matched by player name and stat. */
export function davidNbaFor(slate: DavidNbaSlate | null, gameId: string, markets: { id: string; player: string; stat: string | null }[]): { [id: string]: number } {
  if (!slate) return {};
  const by = new Map(slate.props.filter((p) => p.gameId === gameId).map((p) => [`${nameKey(p.player)}|${p.stat}`, p.projection]));
  const out: { [id: string]: number } = {};
  for (const m of markets) {
    const v = m.stat ? by.get(`${nameKey(m.player)}|${m.stat}`) : undefined;
    if (v !== undefined) out[m.id] = v;
  }
  return out;
}
