import { describe, expect, it } from "vitest";
import type { GradedPropsGame } from "@/lib/props/trends";
import { ourPropCandidates } from "./learn";
import { davidNbaFor, parseDavidNba } from "@/lib/props/david-nba";

const bet = (side: "over" | "under", net: number) => ({ side, line: 20.5, price: -110, book: "dk", outcome: net > 0 ? "W" : "L", net, breakEven: 0.524 });
const market = (id: string, line: number) => ({ id, stat: "pts", player: id, line, gap: 0.04 });
// A: our edge over, David over 25 vs 20.5 (agrees, 22% off). B: our edge over, David under (against).
// C: no edge, our lean under, David under by 2% (both lean the same, not far). D: no David number.
const game = {
  week: 2,
  slug: "g1",
  kickoff: "2026-11-02T23:30:00Z",
  david: { A: 25, B: 18, C: 20 },
  game: { markets: [market("A", 20.5), market("B", 20.5), market("C", 20.5), market("D", 20.5)] },
  result: {
    markets: [
      { id: "A", actual: 27, play: bet("over", 0.91), lean: bet("over", 0.91), david: bet("over", 0.91) },
      { id: "B", actual: 15, play: bet("over", -1), lean: bet("over", -1), david: bet("under", 0.91) },
      { id: "C", actual: 22, play: null, lean: bet("under", -1), david: bet("under", -1) },
      { id: "D", actual: 22, play: bet("over", 0.91), lean: bet("over", 0.91) },
    ],
  },
} as unknown as GradedPropsGame;

describe("David on our prop learners", () => {
  const c = Object.fromEntries(ourPropCandidates([game], ["pts"]).map((x) => [x.id, x]));
  const keys = (id: string) => c[id].bets.map((b) => b.key);
  it("splits our edges by whether David agrees", () => {
    expect(keys("david:agree")).toEqual(["2|g1|A|over"]);
    expect(keys("david:against")).toEqual(["2|g1|B|over"]);
    expect(c["david:agree"].parent).toBe("edge:all");
  });
  it("grades his own side on every prop we price, and its narrower cuts", () => {
    expect(keys("david:side")).toEqual(["2|g1|A|over", "2|g1|B|under", "2|g1|C|under"]);
    expect(c["david:side"].parent).toBeUndefined();
    expect(keys("david:far")).toEqual(["2|g1|A|over", "2|g1|B|under"]);
    expect(keys("david:both")).toEqual(["2|g1|A|over", "2|g1|C|under"]);
    expect(c["david:far"].parent).toBe("david:side");
  });
});

describe("David's NBA board", () => {
  const html = (slate: object) => `<script>self.__next_f.rsc.push(${JSON.stringify(JSON.stringify({ slate }))})</script>`;
  const slate = {
    date: "2026-11-02",
    updatedAt: "2026-11-02T13:53:29Z",
    players: [
      { name: "Kenrich Williams", team: "OKC", gameId: "401909907", markets: { points: { mean: 6.135, lower: 1, upper: 13, quote: { line: 7.5, overOdds: -129, underOdds: 101, modelStale: false } }, steals: { mean: 1 }, assists: { mean: 1.1, quote: { modelStale: true } } } },
    ],
  };
  it("reads projections per stat, skipping unknown stats and ones his page marks out of date", () => {
    const s = parseDavidNba(html(slate));
    expect(s?.props).toEqual([{ gameId: "401909907", player: "Kenrich Williams", team: "OKC", stat: "pts", projection: 6.1, lower: 1, upper: 13, line: 7.5, over: -129, under: 101 }]);
  });
  it("matches our markets by game, player and stat", () => {
    const s = parseDavidNba(html(slate));
    expect(davidNbaFor(s, "401909907", [{ id: "m1", player: "Kenrich Williams", stat: "pts" }, { id: "m2", player: "Kenrich Williams", stat: "reb" }])).toEqual({ m1: 6.1 });
    expect(davidNbaFor(s, "999", [{ id: "m1", player: "Kenrich Williams", stat: "pts" }])).toEqual({});
  });
});
