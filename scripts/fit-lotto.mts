// Fit the lotto market check (Jack, 2026-11-04: "how would you fix lottos").
// Long rungs had no market check: ours == raw. This fits two numbers on the
// EARLIER nights and reports how they do on the LATER nights it never saw:
//   hold: DK's margin on long-shot ladder prices (fair = implied(price) / hold)
//   w:    how much of our raw model to keep against that fair chance (blend)
// Then it compares, on the held-out nights: raw vs DK fair vs blended (log loss,
// calibration) and the betting record of each edge rule, one rung per
// player-stat-night.
//
//   npx tsx --tsconfig scripts/tsconfig.json --env-file=.env.local scripts/fit-lotto.mts
import { allBoards } from "../src/lib/models/nba/store";
import { rungsOf, type Rung } from "../src/lib/models/nba/lotto";
import { blend } from "../src/lib/models/nba/market";
import { implied, payout } from "../src/lib/props/parse";

const rungs = rungsOf(await allBoards(2026)).filter((r) => r.hit === true || r.hit === false);
const nights = [...new Set(rungs.map((r) => r.date))].sort();
const cut = nights[Math.max(1, Math.round(nights.length * 0.6)) - 1];
const train = rungs.filter((r) => r.date <= cut);
const test = rungs.filter((r) => r.date > cut);
const y = (r: Rung) => (r.hit === true ? 1 : 0);
const clip = (p: number) => Math.min(0.999, Math.max(0.001, p));
const ll = (xs: Rung[], f: (r: Rung) => number) => -xs.reduce((a, r) => a + (y(r) ? Math.log(clip(f(r))) : Math.log(1 - clip(f(r)))), 0) / xs.length;

// hold: the factor that makes DK's de-vigged chance match the hit rate on train.
const hold = train.reduce((a, r) => a + implied(r.over), 0) / train.reduce((a, r) => a + y(r), 0);
const fair = (r: Rung) => Math.min(0.99, implied(r.over) / hold);
// w: grid search on train log loss.
let best = { w: 1, ll: Infinity };
for (let w = 0; w <= 1.0001; w += 0.05) {
  const v = ll(train, (r) => blend(r.raw, fair(r), w));
  if (v < best.ll) best = { w: Math.round(w * 100) / 100, ll: v };
}
const checked = (r: Rung) => blend(r.raw, fair(r), best.w);

console.log(`nights ${nights.length}: train ${nights.filter((n) => n <= cut).length} (to ${cut}, ${train.length} rungs), test ${nights.filter((n) => n > cut).length} (${test.length} rungs)`);
console.log(`fitted hold ${hold.toFixed(3)}, w ${best.w} (train log loss ${best.ll.toFixed(4)})`);
console.log("\nHeld-out log loss (lower is better):");
console.log("  raw model  ", ll(test, (r) => r.raw).toFixed(4));
console.log("  DK de-vig  ", ll(test, fair).toFixed(4));
console.log("  blended    ", ll(test, checked).toFixed(4));
const sum = (xs: Rung[], f: (r: Rung) => number) => xs.reduce((a, r) => a + f(r), 0);
console.log(`\nHeld-out expected hits vs actual ${sum(test, y)}: raw ${sum(test, (r) => r.raw).toFixed(1)}, DK fair ${sum(test, fair).toFixed(1)}, blended ${sum(test, checked).toFixed(1)}`);

// Betting rule on held-out nights: value at a chance, best rung per player-stat-night.
const dec = (a: number) => 1 + payout(a);
const record = (xs: Rung[], p: (r: Rung) => number, onePer: boolean) => {
  let pick = xs.filter((r) => p(r) * dec(r.over) - 1 > 0);
  if (onePer) {
    const m = new Map<string, Rung>();
    for (const r of pick) { const k = r.date + r.id; const c = m.get(k); if (!c || p(r) * dec(r.over) > p(c) * dec(c.over)) m.set(k, r); }
    pick = [...m.values()];
  }
  const net = sum(pick, (r) => (r.hit === true ? payout(r.over) : -1));
  return `${pick.length} bets, ${sum(pick, y)} hits, ${net >= 0 ? "+" : ""}${net.toFixed(1)}u (${pick.length ? ((net / pick.length) * 100).toFixed(1) : "0"}% per bet)`;
};
console.log("\nHeld-out betting record, 1u each:");
console.log("  today's rule (raw, every rung)        ", record(test, (r) => r.raw, false));
console.log("  raw, one per player-stat-night        ", record(test, (r) => r.raw, true));
console.log("  blended, every rung                   ", record(test, checked, false));
console.log("  blended, one per player-stat-night    ", record(test, checked, true));
console.log("  blended, one per, no rebounds         ", record(test.filter((r) => r.stat !== "reb"), checked, true));
console.log("\nHeld-out calibration, blended, by its chance:");
for (const [lo, hi] of [[0, 0.05], [0.05, 0.1], [0.1, 0.2], [0.2, 1]]) {
  const b = test.filter((r) => checked(r) >= lo && checked(r) < hi);
  console.log(`  ${lo}-${hi}`.padEnd(12), `${b.length} rungs, hit ${b.length ? ((sum(b, y) / b.length) * 100).toFixed(1) : "-"}%, said ${b.length ? ((sum(b, checked) / b.length) * 100).toFixed(1) : "-"}%`);
}
