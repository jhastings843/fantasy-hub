// Walk-forward fit and test of the First Basket model (src/lib/models/nba/firstbasket.ts).
//
// Tables start from all of 2024-25; then every 2025-26 game is forecast from
// the tables as they stood before its tip, and folded in after. Starters are
// the game's actual starters (DK voids anyone else, and lineups are out about
// 30 minutes before tip). Constants are fit on games before 2026-01-15 and
// judged on the rest.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/fit-first-basket.mts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { NbaGame } from "../src/lib/models/nba/box";
import { emptyTables, firstBasketOf, foldFb, forecast, type FbParams, type FbTables } from "../src/lib/models/nba/firstbasket";

const load = (s: number): NbaGame[] =>
  readdirSync(`.cache/nba/${s}`)
    .map((f) => JSON.parse(readFileSync(`.cache/nba/${s}/${f}`, "utf8")) as NbaGame)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
const SPLIT = "2026-01-15";
const prior = load(2024);
const season = load(2025).filter((g) => g.jump && firstBasketOf(g));

const team = (g: NbaGame, t: string) => ({ team: t, starters: g.players.filter((p) => p.team === t && p.starter).map((p) => ({ id: p.id, pos: p.pos })) });

/** Log loss of the scorer and of the tip, over a range of games. */
function score(p: FbParams, from: string, to: string) {
  const t: FbTables = emptyTables();
  for (const g of prior) foldFb(t, g);
  let scorer = 0, tip = 0, n = 0, hit = 0, uniform = 0;
  const cal: { p: number; y: number }[] = [];
  for (const g of season) {
    if (g.date >= from && g.date < to) {
      const f = forecast(t, team(g, g.home), team(g, g.away), p);
      const fb = firstBasketOf(g)!;
      const pp = f.players.find((x) => x.id === fb.player)?.p ?? 0;
      scorer -= Math.log(Math.max(pp, 1e-4));
      uniform -= Math.log(1 / f.players.length);
      const homeWon = g.jump!.team === g.home;
      tip -= Math.log(homeWon ? f.tip : 1 - f.tip);
      if ((f.tip > 0.5) === homeWon) hit++;
      for (const x of f.players) cal.push({ p: x.p, y: x.id === fb.player ? 1 : 0 });
      n++;
    }
    foldFb(t, g);
  }
  return { scorer: scorer / n, tip: tip / n, n, tipHit: hit / n, uniform: uniform / n, cal };
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
writeFileSync("src/lib/models/nba/fb-params.json", JSON.stringify(P, null, 2) + "\n");
writeFileSync(".cache/fit-first-basket.txt", log.join("\n") + "\n");
