import "server-only";
import { parseCsv } from "./data";
import { Ratings, residual, toSpreadGame, type Features, type SpreadGame, type SpreadParams } from "./spread";
import type { ModelLine } from "@/lib/picks/parse";
import PARAMS from "./spread-params.json";

// Our NFL spread model, live (tracked only, Jack 2026-10-21: forward-test
// it at early-week prices). For this week's games at the reference line
// (DraftKings, home spread), our line = the reference line moved by the
// predicted residual. Ratings come from nflverse's games file, every final
// before now; nflverse's codes match the Picks abbreviations.

const P = PARAMS as SpreadParams;
const GAMES = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";

let cache: { at: number; games: SpreadGame[] } | null = null;

async function games(): Promise<SpreadGame[]> {
  if (cache && Date.now() - cache.at < 3 * 3_600_000) return cache.games;
  const res = await fetch(GAMES, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`nflverse games answered ${res.status}`);
  const [head, ...body] = parseCsv(await res.text());
  const out = body.map((r) => toSpreadGame(Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])))).filter((g): g is SpreadGame => g !== null);
  cache = { at: Date.now(), games: out };
  return out;
}

/** Our line and the features behind it (nflverse margin terms), so the tracker can test single signals too. */
export type OurLine = ModelLine & { x: Features };

/** Our line per game, keyed `${home}|${away}`. `line` is the home spread (negative = home favored). */
export async function ourSpreadLines(season: number, want: { home: string; away: string; line: number }[]): Promise<Map<string, OurLine>> {
  const all = await games();
  const r = new Ratings(P.rating);
  for (const g of [...all].sort((a, b) => a.gameday.localeCompare(b.gameday) || a.id.localeCompare(b.id))) if (g.homeScore !== null) r.add(g);
  const out = new Map<string, OurLine>();
  for (const w of want) {
    const g = all.find((x) => x.season === season && x.home === w.home && x.away === w.away && x.homeScore === null);
    if (!g) continue;
    // nflverse margins: positive favors home, the opposite sign of a spread.
    const x = r.features(g, -w.line);
    const res = residual(x, P);
    const r2 = (v: number) => Math.round(v * 100) / 100;
    out.set(`${w.home}|${w.away}`, { market: w.line, model: r2(w.line - res), x: { gap: r2(x.gap), move: r2(x.move), cover: r2(x.cover), rest: x.rest, qb: x.qb } });
  }
  return out;
}
