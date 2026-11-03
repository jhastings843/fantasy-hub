import { describe, expect, it } from "vitest";
import type { PropMarket, PropsGame } from "./parse";
import type { StoredProps } from "./store";
import type { NbaTracked } from "@/lib/picks/nba-track";
import type { Rung, Ticket } from "@/lib/models/nba/lotto";
import { attdStakedBets, fbStaked, liveKeeping, lottoStaked, nbaPicksStaked, openToday, ourPropsStaked, pushable, stakedPush, tidy, type LiveEntry, type StakedBet } from "./staked-core";

// Monday Nov 2, 2026: 3pm ET is 20:00Z; tonight's tip 7:30pm ET is 00:30Z on the 3rd.
const now = new Date("2026-11-02T20:00:00.000Z");
const today = "2026-11-02";
const tip = "2026-11-03T00:30:00.000Z";
const went = "2026-10-20T12:00:00.000Z";

const market = (over: Partial<PropMarket> = {}): PropMarket => ({
  id: "pts|Jalen Brunson",
  stat: "pts",
  statLabel: "Points",
  player: "Jalen Brunson",
  team: "NYK",
  model: 25.1,
  line: 27.5,
  gap: 0.07,
  clears: true,
  weight: 1,
  books: [{ book: "DraftKings", line: 27.5, over: -110, under: -110, win: true }],
  consensus: 27.5,
  side: "under",
  lean: "under",
  ...over,
});
const game = (markets: PropMarket[]): PropsGame => ({ season: 2026, week: 3, slug: "401", away: "BOS", home: "NYK", breakEven: null, favorites: [], markets });
const board = (markets: PropMarket[], extra: Partial<StoredProps> = {}) => ({
  game: game(markets),
  capturedAt: now.toISOString(),
  firstSeenAt: now.toISOString(),
  first: {},
  kickoff: tip,
  espnId: "401",
  away: "BOS",
  home: "NYK",
  extra: { "pts|Jalen Brunson": { games: 5 } },
  ...extra,
});
const entry = (id: string, over: Partial<LiveEntry> = {}): LiveEntry => ({ id, label: `Slice ${id}`, status: "active", activatedAt: went, ...over });
const ours = (entries: LiveEntry[], boards = [board([market()])], cardGames?: number) =>
  ourPropsStaked({ section: "nba-props-ours", sectionName: "NBA props", sport: "NBA", boards, entries, now, today, cardGames, href: "/props?m=nba" });

describe("openToday", () => {
  it("keeps games today that haven't started", () => {
    expect(openToday(tip, now, today)).toBe(true);
    expect(openToday("2026-11-02T19:00:00.000Z", now, today)).toBe(false); // started
    expect(openToday("2026-11-04T00:30:00.000Z", now, today)).toBe(false); // tomorrow ET
    expect(openToday(undefined, now, today)).toBe(false);
  });
});

describe("liveKeeping", () => {
  it("names live slices that keep the play; paused, collecting and later-activated ones don't count", () => {
    const es = [entry("a"), entry("b", { status: "paused" }), entry("c", { status: "collecting", activatedAt: undefined }), entry("d", { activatedAt: "2026-11-03T01:00:00.000Z" })];
    expect(liveKeeping(es, tip, () => true)).toEqual(["Slice a"]);
  });
  it("a learner combination needs both of its slices", () => {
    const es = [entry("gen:edge:all&edge:under")];
    expect(liveKeeping(es, tip, (id) => id === "edge:all" || id === "edge:under")).toHaveLength(1);
    expect(liveKeeping(es, tip, (id) => id === "edge:all")).toHaveLength(0);
  });
});

describe("ourPropsStaked", () => {
  it("bets the edge a live slice keeps, at the playing book's price", () => {
    const [b, ...rest] = ours([entry("edge:under"), entry("edge:pts")]);
    expect(rest).toHaveLength(0);
    expect(b).toMatchObject({ pick: "Jalen Brunson Under 27.5 pts", price: -110, book: "DraftKings", stake: 1, game: "BOS at NYK", kickoff: tip, slice: "Slice edge:under; Slice edge:pts" });
    expect(b.id).toBe("nba-props-ours|401|pts|Jalen Brunson|under");
  });
  it("nothing when no slice keeps it, the slice is paused, or the game started", () => {
    expect(ours([entry("edge:over")])).toEqual([]);
    expect(ours([entry("edge:under", { status: "paused" })])).toEqual([]);
    expect(ours([entry("edge:under")], [board([market()], { kickoff: "2026-11-02T19:00:00.000Z" })])).toEqual([]);
    expect(ours([])).toEqual([]);
  });
  it("NBA keeps to carded props (3+ games)", () => {
    expect(ours([entry("edge:all")], [board([market()], { extra: { "pts|Jalen Brunson": { games: 2 } } } as never)], 3)).toEqual([]);
    expect(ours([entry("edge:all")], undefined, 3)).toHaveLength(1);
  });
  it("lean and David slices take their own side", () => {
    const m = market({ clears: false, lean: "over" });
    expect(ours([entry("lean:all")], [board([m])])[0].side).toBe("Over");
    expect(ours([entry("edge:all")], [board([m])])).toEqual([]);
    expect(ours([entry("david:side")], [board([m], { david: { "pts|Jalen Brunson": 30 } })])[0].side).toBe("Over");
  });
});

describe("fbStaked", () => {
  it("bets an edge a live First Basket slice keeps", () => {
    const fb = { home: "NYK", away: "BOS", tip: 0.55, first: 0.5, jumpers: {}, starters: "dk" as const, players: [{ id: "p1", name: "Karl-Anthony Towns", team: "NYK", p: 0.2, price: 450, fair: 0.15, edge: true }, { id: "p2", name: "Jayson Tatum", team: "BOS", p: 0.1, price: 500, fair: 0.14, edge: false }] };
    const bets = fbStaked({ boards: [{ ...board([]), fb }], entries: [entry("fb:tip")], now, today, section: "nba-firstbasket-ours" });
    expect(bets.map((b) => b.pick)).toEqual(["Karl-Anthony Towns (NYK) first basket"]);
    expect(bets[0].priceText).toBe("+450 DraftKings");
  });
});

describe("attdStakedBets", () => {
  it("uses the Anytime TD page's own test", () => {
    const g = { game: { slug: "2026_09_DAL_GB", away: "DAL", home: "GB" } as never, kickoff: tip, attd: { rows: [{ id: "1", key: "jjacobs", name: "Josh Jacobs", team: "GB", m: 0.8, anytime: 0.55, two: 0.2, dk: -110 }, { id: "2", key: "x", name: "Long Shot", team: "GB", m: 0.1, anytime: 0.1, two: 0.01, dk: 900 }] } };
    const bets = attdStakedBets({ boards: [g], entries: [entry("attd:value")], now, today, section: "nfl-attd-ours" });
    expect(bets.map((b) => b.player)).toEqual(["Josh Jacobs"]);
  });
});

describe("lottoStaked", () => {
  const rung = (over: Partial<Rung> = {}): Rung => ({ line: 35, over: 450, ours: 0.25, raw: 0.25, date: today, at: tip, game: "401", matchup: "BOS@NYK", id: "pts|Jalen Brunson", player: "Jalen Brunson", stat: "pts", ev: 0.4, hit: null, actual: null, ...over });
  it("live rung slices and the ticket at its own stake", () => {
    const t: Ticket = { date: today, legs: [rung()], price: 18000, chance: 0.01, book: 0.005, outcome: null };
    const bets = lottoStaked({ rungs: [rung(), rung({ ev: -0.1, line: 30 })], ticket: t, entries: [entry("lotto:value"), entry("lotto:ticket")], now, today, section: "nba-lotto-ours" });
    expect(bets.map((b) => [b.pick, b.stake])).toEqual([
      ["Jalen Brunson 35+ pts", 1],
      ["Jalen Brunson 35+ pts", 0.1],
    ]);
  });
});

describe("nbaPicksStaked", () => {
  const g: NbaTracked = { id: "401", day: "20261102", week: 3, tip, home: "NYK", away: "BOS", stake: 1.5, first: { at: went, model: -6, line: -3, homePrice: -110, awayPrice: -110 }, last: { at: went, model: -6, line: -3, homePrice: -108, awayPrice: -112 } };
  it("the staked spread bet, only while the gate is live", () => {
    const [b] = nbaPicksStaked({ games: [g], live: true, now, today });
    expect(b).toMatchObject({ pick: "NYK -3", stake: 1.5, price: -108, sectionName: "NBA picks" });
    expect(nbaPicksStaked({ games: [g], live: false, now, today })).toEqual([]);
    expect(nbaPicksStaked({ games: [{ ...g, stake: undefined }], live: true, now, today })).toEqual([]);
  });
});

describe("pushes", () => {
  const b = { id: "x", kickoff: tip, stake: 1, pick: "Jalen Brunson Under 27.5 pts", priceText: "-110 DraftKings", game: "BOS at NYK", slice: "Edges on the under", sectionName: "NBA props", href: "/props?m=nba" } as StakedBet;
  it("no push inside 5 minutes of lock", () => {
    expect(pushable(b, now)).toBe(true);
    expect(pushable(b, new Date(Date.parse(tip) - 4 * 60_000))).toBe(false);
  });
  it("plain copy with units and no em dashes", () => {
    const p = stakedPush(b, "https://x.app");
    expect(p.title).toBe("NBA props: 1u bet");
    expect(p.message).toBe("Jalen Brunson Under 27.5 pts · 1u (-110 DraftKings) · BOS at NYK, 7:30 PM ET\nEdges on the under");
    expect(p.message).not.toMatch(/—/);
    expect(p.url).toBe("https://x.app/props?m=nba");
  });
  it("tidy drops repeats and sorts by start", () => {
    expect(tidy([{ ...b, id: "2", kickoff: "2026-11-03T02:00:00Z" }, b, b]).map((x) => x.id)).toEqual(["x", "2"]);
  });
});

import { limitProps, PROPS_GAME_MAX } from "./staked-core";
describe("limitProps", () => {
  const bet = (pick: string, game = "DAL at GB", extra: object = {}) => ({ id: pick, section: "s", sectionName: "NFL props", sport: "NFL", game, pick, market: "rec yds", priceText: "-110 DraftKings", price: -110, kickoff: "2026-11-08T18:00:00Z", slice: "a", stake: 1, href: "/props", ...extra }) as never;
  it("drops unpriced bets, merges the same prop from two sections, caps per game", () => {
    const r = limitProps([bet("A over 50.5"), { ...(bet("A over 50.5") as object), id: "x", slice: "b" } as never, bet("B over 3.5", "DAL at GB", { priceText: "no price saved" }), bet("C"), bet("D"), bet("E")]);
    expect(r.bets.map((b) => b.pick)).toEqual(["A over 50.5", "C", "D"]);
    expect(r.bets[0].slice).toBe("a; b");
    expect(r.cut).toHaveLength(2);
    expect(PROPS_GAME_MAX).toBe(3);
  });
  it("stops at the day's unit limit", () => {
    const many = Array.from({ length: 12 }, (_, i) => bet(`P${i}`, `G${i}`));
    expect(limitProps(many).bets).toHaveLength(10);
  });
});
