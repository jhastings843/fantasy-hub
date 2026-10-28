// Walk-forward fit and test of the First Basket model (src/lib/models/nba/firstbasket.ts).
//
// Tables start from all of 2024-25; then every 2025-26 game is forecast from
// the tables as they stood before its tip, and folded in after. Starters are
// the game's actual starters (DK voids anyone else, and lineups are out about
// 30 minutes before tip). Constants are fit on games before 2026-01-15 and
// judged on the rest.
//
// Then three borrowed ideas, each fit on the same train games and kept only
// when it lowers the test scorer log loss by more than twice the standard
// error of the paired per-game difference. The cache keeps every shot up to
// the first make, so "opening attempts" are those shots; it has no full
// first-quarter shot log and no shot locations.
//   1. Shrink target: blend field-goal share with opening-attempt share (wAtt, kAtt).
//   2. Shot quality: weight opening attempts by the player's make rate on them (kQ).
//   3. Opponent opening defense: how often a team's opponent scores first after
//      the team loses the tip, shrunk to the league (kDef).
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/fit-first-basket.mts
//   ... scripts/fit-first-basket.mts --refit [--dry]   weekly refit (scripts/refit/common.mts):
//   latest season with 300+ games, test = its last 28 days; refits kTip, beta,
//   kShare on the rest (no candidates) and stores them only if the per-game
//   scorer log loss beats the live settings by 2+ SE.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import DEFAULTS from "../src/lib/models/nba/fb-params.json";
import { REFIT, latestSeason, liveParams, paired, submit, windowStart } from "./refit/common.mjs";
import type { NbaGame } from "../src/lib/models/nba/box";
import { emptyTables, firstBasketOf, foldFb, forecast, type FbParams, type FbTables } from "../src/lib/models/nba/firstbasket";

const load = (s: number): NbaGame[] =>
  readdirSync(`.cache/nba/${s}`)
    .map((f) => JSON.parse(readFileSync(`.cache/nba/${s}/${f}`, "utf8")) as NbaGame)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
const SEASON = REFIT ? latestSeason(Object.fromEntries(readdirSync(".cache/nba").map((d) => [Number(d), readdirSync(`.cache/nba/${d}`).length])), 300) : 2025;
const prior = load(SEASON - 1);
const season = load(SEASON).filter((g) => g.jump && firstBasketOf(g));
const SPLIT = REFIT ? windowStart(season.map((g) => g.date), 28) : "2026-01-15";

const team = (g: NbaGame, t: string) => ({ team: t, starters: g.players.filter((p) => p.team === t && p.starter).map((p) => ({ id: p.id, pos: p.pos })) });

/** Log loss of the scorer and of the tip, over a range of games. */
function score(p: FbParams, from: string, to: string) {
  const t: FbTables = emptyTables();
  for (const g of prior) foldFb(t, g);
  let scorer = 0, tip = 0, n = 0, hit = 0, uniform = 0, teamLoss = 0;
  const per: number[] = [];
  const cal: { p: number; y: number }[] = [];
  for (const g of season) {
    if (g.date >= from && g.date < to) {
      const f = forecast(t, team(g, g.home), team(g, g.away), p);
      const fb = firstBasketOf(g)!;
      const pp = f.players.find((x) => x.id === fb.player)?.p ?? 0;
      scorer -= Math.log(Math.max(pp, 1e-4));
      per.push(-Math.log(Math.max(pp, 1e-4)));
      teamLoss -= Math.log(fb.team === g.home ? f.first : 1 - f.first);
      uniform -= Math.log(1 / f.players.length);
      const homeWon = g.jump!.team === g.home;
      tip -= Math.log(homeWon ? f.tip : 1 - f.tip);
      if ((f.tip > 0.5) === homeWon) hit++;
      for (const x of f.players) cal.push({ p: x.p, y: x.id === fb.player ? 1 : 0 });
      n++;
    }
    foldFb(t, g);
  }
  return { scorer: scorer / n, tip: tip / n, n, tipHit: hit / n, uniform: uniform / n, cal, per, team: teamLoss / n };
}

const log: string[] = [];
const say = (s: string) => {
  console.log(s);
  log.push(s);
};
let P: FbParams = { kTip: 10, beta: 1, kShare: 10 };
// Tip first (its own log loss), then the shares (scorer log loss).
let best = { e: Infinity, p: P };
for (const kTip of [0.5, 2, 5, 10, 20, 40, 80])
  for (const beta of [0.25, 0.5, 0.75, 1, 1.25, 1.5]) {
    const e = score({ ...P, kTip, beta }, "0", SPLIT).tip;
    if (e < best.e) best = { e, p: { ...P, kTip, beta } };
  }
P = best.p;
say(`tip: kTip ${P.kTip}, beta ${P.beta} (train tip log loss ${best.e.toFixed(4)}, coin flip ${Math.log(2).toFixed(4)})`);
best = { e: Infinity, p: P };
for (const kShare of [0, 1, 2, 5, 10, 20, 50, 100, 1000]) {
  const e = score({ ...P, kShare }, "0", SPLIT).scorer;
  if (e < best.e) best = { e, p: { ...P, kShare } };
}
P = best.p;
say(`shares: kShare ${P.kShare} (train scorer log loss ${best.e.toFixed(4)})`);

if (REFIT) {
  const live = await liveParams("nba-fb", DEFAULTS as FbParams);
  const a = score(live, SPLIT, "9");
  const b = score(P, SPLIT, "9");
  await submit("nba-fb", DEFAULTS as FbParams, P, paired(a.per, b.per, `scorer log loss per game, ${SEASON} from ${SPLIT}; refit ${JSON.stringify(P)}`));
  process.exit(0);
}

const t = score(P, SPLIT, "9");
const fgOnly = score({ ...P, kShare: 1e9 }, SPLIT, "9");
say(`\nTEST (${t.n} games from ${SPLIT})`);
say(`tip: log loss ${t.tip.toFixed(4)} vs coin flip ${Math.log(2).toFixed(4)}; picked the tip winner ${(t.tipHit * 100).toFixed(1)}%`);
say(`scorer: log loss ${t.scorer.toFixed(4)} vs ten starters even ${t.uniform.toFixed(4)} vs field-goal share only ${fgOnly.scorer.toFixed(4)}`);
say("calibration per player (P bins: predicted vs happened, n)");
for (const [lo, hi] of [[0, 0.06], [0.06, 0.09], [0.09, 0.12], [0.12, 0.16], [0.16, 0.22], [0.22, 1]]) {
  const b = t.cal.filter((c) => c.p >= lo && c.p < hi);
  if (b.length) say(`  ${lo.toFixed(2)}-${Math.min(hi, 1).toFixed(2)}: ${(b.reduce((a, c) => a + c.p, 0) / b.length).toFixed(3)} vs ${(b.reduce((a, c) => a + c.y, 0) / b.length).toFixed(3)}, n ${b.length}`);
}
// The candidates, each fit on train against the base just fit, judged on test.
const base = P;
const baseTest = t;
say(`\nCANDIDATES (test scorer log loss, base ${baseTest.scorer.toFixed(4)}; team-first log loss base ${baseTest.team.toFixed(4)})`);
function trial(name: string, grid: Partial<FbParams>[]) {
  let b = { e: score(base, "0", SPLIT).scorer, q: {} as Partial<FbParams> };
  const e0 = b.e;
  for (const q of grid) {
    const e = score({ ...base, ...q }, "0", SPLIT).scorer;
    if (e < b.e) b = { e, q };
  }
  // Refit kShare with the candidate on, since a better target can carry less shrinkage.
  let kb = { e: b.e, k: base.kShare };
  if (Object.keys(b.q).length)
    for (const kShare of [5, 10, 20, 50, 100, 200, 500, 1000]) {
      const e = score({ ...base, ...b.q, kShare }, "0", SPLIT).scorer;
      if (e < kb.e) kb = { e, k: kShare };
    }
  const cand = { ...base, ...b.q, kShare: kb.k };
  const te = score(cand, SPLIT, "9");
  const d = te.per.map((x, i) => x - baseTest.per[i]);
  const m = d.reduce((a, x) => a + x, 0) / d.length;
  const se = Math.sqrt(d.reduce((a, x) => a + (x - m) ** 2, 0) / (d.length - 1) / d.length);
  const keep = Object.keys(b.q).length > 0 && m < -2 * se;
  say(`${name}: fit ${JSON.stringify({ ...b.q, kShare: kb.k })}; train ${e0.toFixed(4)} -> ${kb.e.toFixed(4)}; test ${baseTest.scorer.toFixed(4)} -> ${te.scorer.toFixed(4)} (diff ${m.toFixed(4)}, se ${se.toFixed(4)}); team-first ${te.team.toFixed(4)}; ${keep ? "KEPT" : "off"}`);
  return keep ? cand : null;
}
const c1 = trial(
  "1 opening-attempt share",
  [0.1, 0.25, 0.5, 0.75, 1].flatMap((wAtt) => [undefined, 5, 20, 50, 100].map((kAtt) => (kAtt === undefined ? { wAtt } : { wAtt, kAtt }))),
);
const c2 = trial(
  "2 make-rate weighted",
  [0.1, 0.25, 0.5, 0.75, 1].flatMap((wAtt) => [undefined, 20, 50].flatMap((kAtt) => [2, 5, 10, 20, 50].map((kQ) => ({ wAtt, kQ, ...(kAtt === undefined ? {} : { kAtt }) })))),
);
const c3 = trial("3 opponent opening defense", [5, 10, 20, 50, 100, 200, 400].map((kDef) => ({ kDef })));
for (const c of [c1, c2, c3]) if (c) P = { ...P, ...c };
if (P !== base) {
  const fin = score(P, SPLIT, "9");
  say(`combined kept: ${JSON.stringify(P)}; test scorer ${fin.scorer.toFixed(4)}, team-first ${fin.team.toFixed(4)}`);
}
writeFileSync("src/lib/models/nba/fb-params.json", JSON.stringify(P, null, 2) + "\n");
writeFileSync(".cache/fit-first-basket.txt", log.join("\n") + "\n");
