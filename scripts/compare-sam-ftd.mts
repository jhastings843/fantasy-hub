// Our First TD model against Sam's saved first TD games (2026, before his
// paywall) and Kalshi's saved prices: the chance each gave to what happened
// (the scorer, his team's "any other", or "none"), as log loss. Ours is
// built as in the fit: nflverse weeks before the game, the nflverse line.
//
//   npx tsx --tsconfig scripts/tsconfig.json --env-file=.env.local scripts/compare-sam-ftd.mts
import { readFileSync } from "node:fs";
import { Redis } from "@upstash/redis";
import { readGames, readStats } from "../src/lib/models/nfl/data";
import { addTotals, ftdGame, impliedPoints, tdTotals, type FtdParams, type TdLine } from "../src/lib/models/nfl/firsttd";
import { grade } from "../src/lib/firsttd/grade";
import { kalshiFor } from "../src/lib/firsttd/trends";
import type { StoredWeek } from "../src/lib/firsttd/store";

const P = JSON.parse(readFileSync("src/lib/models/nfl/ftd-params.json", "utf8")) as FtdParams;
const prev = tdTotals(readStats(readFileSync(".cache/nfl/stats_player_week_2025.csv", "utf8")));
const rows = readStats(readFileSync(".cache/nfl/stats_player_week_2026.csv", "utf8"));
const games = new Map(readGames(readFileSync(".cache/nfl/games.csv", "utf8")).map((g) => [g.game, g]));
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! });
let n = 0, ours = 0, sam = 0, kal = 0, kn = 0, kOurs = 0;
for (const week of (await redis.smembers("ftd:v1:2026:weeks")).map(Number)) {
  const w = await redis.get<StoredWeek>(`ftd:v1:2026:w${week}`);
  for (const [slug, sg] of Object.entries(w?.games ?? {})) {
    const meta = games.get(slug);
    if (!sg.result || !meta || meta.total === null || meta.homeMargin === null) continue;
    const before = rows.filter((r) => r.week < meta.week);
    const cur = tdTotals(before);
    const played = new Set(rows.filter((r) => r.game === slug).map((r) => r.id));
    const lists: { [t: string]: TdLine[] } = {};
    for (const t of [meta.home, meta.away]) {
      const wk = [...new Set(before.filter((r) => r.team === t).map((r) => r.week))].sort((a, b) => a - b).slice(-3);
      lists[t] = [...new Set(before.filter((r) => r.team === t && wk.includes(r.week)).map((r) => r.id))].filter((id) => played.has(id)).flatMap((id) => {
        const x = addTotals(prev.get(id), cur.get(id));
        return x ? [{ ...x, team: t }] : [];
      });
    }
    const pts = impliedPoints(meta.total, meta.homeMargin);
    const g = ftdGame({ season: 2026, week: meta.week, slug, away: meta.away, home: meta.home, when: "" }, pts.home, pts.away, lists, P);
    const r = grade(g, sg.result.first);
    n++;
    ours -= Math.log(Math.max(r.pOutcome, 1e-4));
    sam -= Math.log(Math.max(sg.result.pOutcome, 1e-4));
    // Kalshi: the scorer's last price, scaled by the sum of every player's (its overround), when he had a market.
    if (sg.kalshi && sg.result.first.kind === "offense") {
      const k = kalshiFor(sg.kalshi, sg.game.teams.flatMap((t) => t.players).find((p) => p.key === sg.result!.key)?.name ?? "");
      const total = sg.kalshi.players.reduce((a, x) => a + (x.last ?? x.ask ?? 0), 0);
      const px = k ? (k.last ?? k.ask) : null;
      if (px && total) {
        kn++;
        kal -= Math.log(px / total);
        kOurs -= Math.log(Math.max(r.pOutcome, 1e-4));
      }
    }
  }
}
console.log(`${n} games: log loss ours ${(ours / n).toFixed(3)}, Sam ${(sam / n).toFixed(3)}; on the ${kn} with a Kalshi price for the scorer: Kalshi (overround removed) ${(kal / kn).toFixed(3)}, ours ${(kOurs / kn).toFixed(3)}`);
