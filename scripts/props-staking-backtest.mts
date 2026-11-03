// Every graded prop bet so far, staked each way (src/lib/props/staking.ts):
// flat 1u, to win 1u, quarter Kelly, quarter Kelly shrunk, and by edge. Per
// section, on its widest slice (every edge) and its best slice by flat units,
// plus all sections together. Uses the same candidate builders the learner
// and the Results page use, at the saved price and our saved chance. Reads
// Redis only: every write method is replaced with one that throws.
//
//   npx tsx --tsconfig scripts/tsconfig.json --env-file=../../../.env.local scripts/props-staking-backtest.mts
//   (from the main checkout: --env-file=.env.local)
import { getRedis } from "../src/lib/redis/client";
import type { Bet, Candidate } from "../src/lib/learning/engine";
import { SCHEME, SCHEME_IDS, decideScheme, schemeStats, sizable, stakingBase, switchTest } from "../src/lib/props/staking";
import { ourPropCandidates, ourFtdCandidates, fbCandidates, OUR_SECTION } from "../src/lib/models/learn";
import { attdCandidates, kotcCandidates, lottoCandidates, SECTIONS } from "../src/lib/models/sections";
import { allBoards, fbGraded, gradedList } from "../src/lib/models/nba/store";
import { nflGradedList } from "../src/lib/models/nfl/store";
import { attdGraded, getOurFtdView } from "../src/lib/models/nfl/ftd-store";
import { getKotcNights } from "../src/lib/models/nba/kotc-store";
import { rungsOf, tickets } from "../src/lib/models/nba/lotto";
import { getFirstTdView } from "../src/lib/firsttd/store";
import { ftdCandidates, FTD_SECTION } from "../src/lib/firsttd/learn";
import { primeParams } from "../src/lib/models/params-store";
import { nbaSeasonOfDate } from "../src/lib/props/parse";

const WRITES = ["set", "hset", "hsetnx", "hdel", "del", "rpush", "lpush", "sadd", "srem", "expire", "getset", "incr", "incrby", "zadd", "zrem", "mset", "setnx", "lpop", "rpop", "pexpire", "eval", "evalsha"];
const client = getRedis() as unknown as { [k: string]: unknown };
for (const m of WRITES) Object.defineProperty(client, m, { value: () => { throw new Error(`read-only backtest: refused ${m}`); } });

const now = new Date();
const nfl = now.getUTCMonth() < 7 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
const nba = nbaSeasonOfDate(now);
await primeParams();

const [nbaGraded, nflGraded, fbList, nbaAll, kotcNights, attd, ourFtd, samFtd] = await Promise.all([
  gradedList(nba),
  nflGradedList(nfl),
  fbGraded(nba),
  allBoards(nba),
  getKotcNights(nba),
  attdGraded(nfl),
  getOurFtdView(nfl),
  getFirstTdView(nfl),
]);
const rungs = rungsOf(nbaAll);

const sections: [string, string, Candidate[]][] = [
  [OUR_SECTION.nflProps, "NFL props", ourPropCandidates(nflGraded, ["pass_yds", "rush_yds", "rec_yds", "rec"])],
  [OUR_SECTION.nbaProps, "NBA props", ourPropCandidates(nbaGraded, ["pts", "reb", "ast", "threes"])],
  [OUR_SECTION.nflFirstTd, "NFL First TD", ourFtdCandidates(ourFtd.graded)],
  [FTD_SECTION, "NFL First TD (Sam, Kalshi)", ftdCandidates(samFtd.graded)],
  [SECTIONS.nflAttd, "NFL Anytime TD", attdCandidates(attd)],
  [OUR_SECTION.nbaFirstBasket, "NBA First Basket", fbCandidates(fbList)],
  [SECTIONS.nbaLotto, "NBA lottos", lottoCandidates(rungs, tickets(rungs), nba)],
  [SECTIONS.nbaKotc, "King of the Court", kotcCandidates(kotcNights, nbaAll, nba)],
];

const f = (x: number, d = 2) => (x >= 0 ? "+" : "") + x.toFixed(d);
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

function table(title: string, bets: Bet[]) {
  const sized = bets.filter(sizable);
  const weeks = new Set(sized.map((b) => b.week)).size;
  console.log(`\n${title}  (${sized.length} sized bets, ${bets.length - sized.length} without a saved chance, ${weeks} weeks)`);
  console.log("scheme                  bets   units   risked    ROI   drawdn  log-growth  bankroll  t vs flat");
  for (const id of SCHEME_IDS) {
    const r = schemeStats(bets, id);
    const t = id === "flat" ? "" : switchTest(bets, id).t.toFixed(2);
    console.log(`${SCHEME[id].label.padEnd(22)} ${String(r.bets).padStart(5)} ${f(r.units, 1).padStart(7)} ${r.risked.toFixed(1).padStart(8)} ${pct(r.roi).padStart(7)} ${r.drawdown.toFixed(1).padStart(7)} ${f(r.logGrowth, 4).padStart(11)} ${pct(Math.exp(r.logGrowth) - 1).padStart(9)} ${t.padStart(10)}`);
  }
  const d = decideScheme(bets, "flat");
  console.log(`switch rule today: ${d.scheme}${d.changed ? " (would switch)" : ""}. ${d.why}`);
}

const all: Bet[] = [];
for (const [id, name, cands] of sections) {
  const base = stakingBase(cands);
  if (!base) {
    console.log(`\n== ${name} (${id}): no slice with a saved chance and price; skipped`);
    continue;
  }
  console.log(`\n== ${name} (${id})`);
  table(`widest slice: ${base.label} [${base.id}]`, base.bets);
  all.push(...base.bets.map((b) => ({ ...b, game: `${id}|${b.game}` })));
  const best = cands
    .filter((c) => c.id !== base.id && c.bets.filter(sizable).length >= 30)
    .map((c) => ({ c, u: schemeStats(c.bets, "flat").units }))
    .sort((a, b) => b.u - a.u)[0];
  if (best) table(`best slice by flat units: ${best.c.label} [${best.c.id}]`, best.c.bets);
}
table("\n== ALL SECTIONS (widest slices together)", all);
console.log("\nSkipped (no saved chance in the stored record): NFL props (Sam and David), NBA props (Sam), David's own board. Sam's NFL gap and NBA projection share are not win chances.");
