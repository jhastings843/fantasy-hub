// Rehearsal of the strategy review's full cycle, in memory (touches nothing):
//   ingest -> settle -> evaluate -> decide -> validate -> activate -> rollback,
// plus a validation-failure retain. Prints each step.
//
//   npx tsx scripts/picks-rehearsal.mts
import { runReview, type ReviewInputs } from "../src/lib/picks/learning/review";
import { memoryStore } from "../src/lib/picks/learning/memory-store";
import type { ForecastSnapshot } from "../src/lib/picks/forecasts";

function week(w: number, at: string, small: (i: number) => boolean, big: (i: number) => boolean) {
  const snaps: ForecastSnapshot[] = [];
  const finals = new Map<string, { home: number; away: number }>();
  for (let i = 0; i < 12; i++) {
    const line = i < 8 ? 2.5 : 8.5;
    const home = `H${w}-${i}`;
    const away = `A${w}-${i}`;
    snaps.push({ at, week: w, home, away, sam: { market: line, model: line - 3 }, david: { market: line, model: line - 2 }, ref: { line, source: "rehearsal", fetchedAt: at, homePrice: -110, awayPrice: -110, kickoff: new Date(Date.parse(at) + 4 * 864e5).toISOString() } });
    finals.set(`${w}:${away}@${home}`, (i < 8 ? small(i) : big(i)) ? { home: 20, away: 21 } : { home: 3, away: 30 });
  }
  return { snaps, finals };
}
const inputs = (weeks: ReturnType<typeof week>[], now: string, badReplay = false): ReviewInputs => ({
  now: new Date(now),
  forecasts: [{ league: "nfl", snaps: weeks.flatMap((x) => x.snaps) }],
  finals: [{ league: "nfl", map: new Map(weeks.flatMap((x) => [...x.finals])) }],
  closes: [{ league: "nfl", map: new Map() }],
  issued: [],
  ruleTest: { nfl: { side: "dog" } },
  replay: async () => [{ league: "nfl", stakes: badReplay ? [9, 9] : [1.5, 1], weeklyRoom: 15, unpricedStakes: 0 }],
  history: async () => "frozen",
});
const at = (k: number) => new Date(Date.parse("2026-10-13T21:00:00Z") + k * 7 * 864e5).toISOString();
const show = (label: string, r: Awaited<ReturnType<typeof runReview>>) =>
  console.log(`\n== ${label}\n${r.journal.map((j) => `  [${j.kind}] ${j.title}\n      ${j.why}`).join("\n")}`);

const store = memoryStore();
show("1. register (no evidence yet)", await runReview(store, inputs([], "2026-10-09T11:00:00Z")));
const good = [6, 7, 8, 9].map((w, k) => week(w, at(k), (i) => i !== 3, (i) => i === 9));
show("2. ingest + settle 4 weeks; small dogs 7/8, big dogs 1/4 -> evaluate, decide, validate, activate", await runReview(store, inputs(good, "2026-11-11T11:00:00Z")));
const bad = [10, 11].map((w, k) => week(w, at(5 + k), () => false, () => true));
show("3. the refinement collapses after activation -> predeclared rollback", await runReview(store, inputs([...good, ...bad], "2026-12-01T11:00:00Z")));
const s2 = memoryStore();
await runReview(s2, inputs([], "2026-10-09T11:00:00Z"));
show("4. same evidence, but the replay breaks the weekly cap -> retained", await runReview(s2, inputs(good, "2026-11-11T11:00:00Z", true)));
console.log(`\nactive after rehearsal: ${(await store.active()).id}; versions kept: ${store.dump().versions.map((v) => v.id).join(", ")}`);
