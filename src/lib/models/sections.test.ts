import { describe, expect, it } from "vitest";
import { attdCandidates, attdStaked, kotcStakedTop, lottoCandidates, rungStaked, taggedProp, ticketStaked } from "./sections";
import type { Rung } from "./nba/lotto";

describe("Anytime TD slices", () => {
  it("bets each player whose chance beats DK's break-even, void when he didn't play", () => {
    const row = (key: string, anytime: number, dk?: number) => ({ id: key, name: key, team: "KC", key, m: 0, anytime, two: 0, ...(dk !== undefined ? { dk } : {}) });
    const games = [{ slug: "g1", week: 7, at: "2026-10-26T00:00:00Z", rows: [row("a", 0.5, 150), row("b", 0.3, 300), row("c", 0.5, 150), row("d", 0.5)], result: { a: 1, b: 0, c: null, d: 2 } }];
    const c = Object.fromEntries(attdCandidates(games).map((x) => [x.id, x]));
    expect(c["attd:value"].bets.map((b) => b.net)).toEqual([1.5, -1]); // a won at +150, b (30% vs 25%) lost; c void, d unpriced
    expect(c["attd:edge10"].bets).toHaveLength(1); // a: 50% vs 40%
    expect(c["attd:short"].bets).toHaveLength(0);
    expect(c["attd:long"].parent).toBe("attd:value");
  });

  it("judges Venom like PEM: our value bets he picks and the ones he doesn't, on weeks his board is in", () => {
    const row = (key: string, anytime: number, dk?: number) => ({ id: key, name: key, team: "KC", key, m: 0, anytime, two: 0, ...(dk !== undefined ? { dk } : {}) });
    const games = [
      { slug: "g1", week: 9, at: "2026-11-02T00:00:00Z", rows: [row("a", 0.5, 150), row("b", 0.3, 300)], result: { a: 1, b: 0 } },
      { slug: "g2", week: 10, at: "2026-11-09T00:00:00Z", rows: [row("e", 0.5, 150)], result: { e: 1 } },
    ];
    const c = Object.fromEntries(attdCandidates(games, new Map([[9, new Set(["a"])]])).map((x) => [x.id, x]));
    expect(c["attd:venom"].bets.map((b) => b.key)).toEqual(["g1|a"]);
    expect(c["attd:novenom"].bets.map((b) => b.key)).toEqual(["g1|b"]);
    expect(c["attd:venom"].parent).toBe("attd:value");
    // Without his boards there are no Venom slices at all.
    expect(attdCandidates(games).some((x) => x.id === "attd:venom")).toBe(false);
  });
});

describe("Lotto slices", () => {
  it("grades rungs by slice and the ticket at its stake", () => {
    const rung = (game: string, over: number, ev: number, hit: boolean, stat = "pts"): Rung =>
      ({ line: 19.5, over, ours: 0.3, raw: 0.3, date: "2026-10-27", at: "2026-10-27T23:00:00Z", game, matchup: "A@B", id: `${stat}|x`, player: "x", stat, ev, hit, actual: 0 }) as Rung;
    const rungs = [rung("g1", 400, 0.2, true), rung("g2", 800, 0.1, false, "reb"), rung("g3", 300, -0.1, true)];
    const ticket = { date: "2026-10-27", legs: [], price: 22676, chance: 0.01, book: 0.004, outcome: "L" as const };
    const c = Object.fromEntries(lottoCandidates(rungs, [ticket], 2026).map((x) => [x.id, x]));
    expect(c["lotto:value"].bets.map((b) => b.net)).toEqual([4, -1]);
    expect(c["lotto:long"].bets).toHaveLength(1);
    expect(c["lotto:reb"].bets).toHaveLength(1);
    expect(c["lotto:ticket"].bets[0].net).toBeCloseTo(-0.1, 6);
  });
});

describe("King of the Court tagged prop", () => {
  it("takes the biggest qualifying edge and its graded net", () => {
    const market = (id: string, gap: number, price: number) => ({ id, player: "Jokic", clears: true, side: "over", gap, books: [{ over: price, under: -110 }] });
    const board = {
      game: { markets: [market("pts|Jokic", 0.08, -150), market("ast|Jokic", 0.12, -250), market("reb|Jokic", 0.05, -110)] },
      extra: { "pts|Jokic": { games: 5 }, "ast|Jokic": { games: 5 }, "reb|Jokic": { games: 5 } },
      result: { markets: [{ id: "pts|Jokic", play: { net: 0.667 } }] },
    } as never;
    expect(taggedProp([board], "Jokic")).toEqual({ id: "pts|Jokic", net: 0.667 }); // -250 does not qualify
    expect(taggedProp([board], "Embiid")).toBeNull();
  });
});

describe("Live slices mark bets", () => {
  const entry = (id: string, status: "active" | "collecting" | "rolled-back", activatedAt?: string) =>
    ({ id, label: id, status, registeredAt: "2026-10-01T00:00:00Z", registeredWeek: 1, ...(activatedAt ? { activatedAt } : {}) }) as never;
  const live = "2026-10-27T12:00:00Z";

  it("Anytime TD: only a live slice that keeps the player, on games after it went live", () => {
    const es = [entry("attd:edge10", "active", live), entry("attd:value", "collecting")];
    expect(attdStaked(es, "2026-10-28T17:00:00Z", 0.5, 150)).toBe(true); // 50% vs 40%
    expect(attdStaked(es, "2026-10-28T17:00:00Z", 0.45, 150)).toBe(false); // 5 points only
    expect(attdStaked(es, "2026-10-26T17:00:00Z", 0.5, 150)).toBe(false); // kicked off before it went live
    expect(attdStaked([entry("attd:edge10", "rolled-back", live)], "2026-10-28T17:00:00Z", 0.5, 150)).toBe(false);
  });

  it("Lottos: rung slices and the ticket", () => {
    const rung = { over: 800, ev: 0.2, stat: "reb", at: "2026-10-28T23:00:00Z" } as never;
    expect(rungStaked([entry("lotto:long", "active", live)], rung)).toBe(true);
    expect(rungStaked([entry("lotto:pts", "active", live)], rung)).toBe(false);
    expect(ticketStaked([entry("lotto:ticket", "active", live)], "2026-10-28T23:00:00Z")).toBe(true);
    expect(ticketStaked([entry("lotto:value", "active", live)], "2026-10-28T23:00:00Z")).toBe(false);
  });

  it("King of the Court: the widest live top-N, 0 when none", () => {
    const es = [entry("kotc:top3", "active", live), entry("kotc:fav", "active", live), entry("kotc:top10", "collecting")];
    expect(kotcStakedTop(es, "2026-10-28T23:00:00Z")).toBe(3);
    expect(kotcStakedTop(es, "2026-10-26T23:00:00Z")).toBe(0);
  });
});
