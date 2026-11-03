import { describe, expect, it } from "vitest";
import { applyFresh, freshDue, freshGames, freshKey, freshVerdict, pricedAttd, pricedProps, repriceAttd, repriceNba, repriceNfl, type FreshQuote } from "./fresh-core";
import { attdStakedBets, checkNote, limitProps, ourPropsStaked, pushable, stakedPush, type LiveEntry, type StakedBet } from "./staked-core";
import { ourNflMarkets } from "@/lib/models/nfl/market";
import { ourMarkets } from "@/lib/models/nba/market";
import type { OddsRead } from "@/lib/models/nfl/odds-api";
import type { LiveLine } from "@/lib/models/lines";
import type { NflParams, NflProjection } from "@/lib/models/nfl/props";
import type { NbaParams, Projection } from "@/lib/models/nba/props";
import NFL from "@/lib/models/nfl/params.json";
import NBA from "@/lib/models/nba/params.json";
import type { AttdRow } from "@/lib/models/nfl/anytime";

const P = NFL as NflParams;
const PB = NBA as NbaParams;
const kick = "2026-11-03T01:15:00.000Z"; // 8:15pm ET, Nov 2
const now = new Date("2026-11-03T00:10:00.000Z"); // 65 minutes before
const today = "2026-11-02";
const edge: LiveEntry[] = [{ id: "edge:all", label: "Every edge", status: "active", activatedAt: "2026-10-01T00:00:00.000Z" }];
const empty = { line: null, over: null, under: null };

/** Our NFL board for one prop: Chase receiving yards, mean 95, at DK's line and prices. */
function nflBoard(line: number, over: number, under: number) {
  const { markets, extra } = ourNflMarkets(
    new Map([["1", { type: "Total Receiving Yards (incl. overtime)", athlete: "1", current: { line, over: null, under: null }, dkOpen: empty } as LiveLine]]),
    new Map([["1", { mean: { rec_yds: 95 } } as NflProjection]]),
    new Map([["1", { name: "Ja'Marr Chase", team: "CIN" }]]),
    () => ({ over, under, source: "odds-api" as const }),
    P,
  );
  return { game: { season: 2026, week: 9, slug: "401", away: "CIN", home: "PIT", breakEven: null, favorites: [], markets }, capturedAt: "", firstSeenAt: "", first: {}, kickoff: kick, espnId: "401", extra, away: "CIN", home: "PIT" };
}
const read = (line: number, over: number, under: number): OddsRead => ({ at: now.toISOString(), props: { "jamarrchase|rec_yds": { line, over, under } }, firstTd: {} });
const quote = (r: OddsRead): FreshQuote => ({ ok: true, at: now.toISOString(), sport: "NFL", read: r, markets: ["player_reception_yds"] });

const stake = (boards: ReturnType<typeof nflBoard>[]) => ourPropsStaked({ section: "nfl-props-ours", sectionName: "NFL props", sport: "NFL", boards, entries: edge, now, today, href: "/props" });

/** The whole path: staked at the morning board, limited, then judged at the fresh read. */
function judge(fresh: OddsRead | null, q?: FreshQuote) {
  const base = nflBoard(70.5, -110, -110);
  const { bets } = limitProps(stake([base]));
  const boards = fresh ? [repriceNfl(base, fresh, P)] : [];
  const quotes = new Map<string, FreshQuote>();
  const qq = q ?? (fresh ? quote(fresh) : undefined);
  if (qq) quotes.set(freshKey(bets[0])!, qq);
  return applyFresh(bets, quotes, stake(boards), pricedProps("nfl-props-ours", boards))[0];
}

describe("freshDue", () => {
  it("opens 75 minutes out and stays open until 5 minutes out", () => {
    const at = (min: number) => new Date(Date.parse(kick) - min * 60_000);
    expect(freshDue(kick, at(76))).toBe(false);
    expect(freshDue(kick, at(75))).toBe(true);
    expect(freshDue(kick, at(60))).toBe(true);
    // First staked inside the 45-minute mark: read at once while lock is more than 5 minutes off.
    expect(freshDue(kick, at(30))).toBe(true);
    expect(freshDue(kick, at(5))).toBe(false);
    expect(freshDue(kick, at(-1))).toBe(false);
  });
});

describe("freshGames", () => {
  const b = (id: string, stat: string, k = kick, event = "401"): StakedBet => ({ id, section: "s", sectionName: "NFL props", sport: "NFL", game: "CIN at PIT", pick: id, market: stat, priceText: "-110 DraftKings", kickoff: k, slice: "x", stake: 1, href: "/", quote: { event, home: "PIT", away: "CIN", stat }, check: { state: "pending" } });
  it("one read per game, only the markets its staked props need", () => {
    const gs = freshGames([b("a", "rec_yds"), b("b", "rec"), b("c", "rec_yds"), b("d", "anytime")], now, new Set());
    expect(gs).toEqual([{ key: "NFL|401|2026-11-02", sport: "NFL", event: "401", home: "PIT", away: "CIN", kickoff: kick, markets: ["player_anytime_td", "player_reception_yds", "player_receptions"] }]);
  });
  it("skips games out of the window, already read, or with nothing pending", () => {
    expect(freshGames([b("a", "rec", "2026-11-03T03:00:00.000Z")], now, new Set())).toEqual([]);
    expect(freshGames([b("a", "rec")], now, new Set(["NFL|401|2026-11-02"]))).toEqual([]);
    expect(freshGames([{ ...b("a", "rec"), check: { state: "checked" } }], now, new Set())).toEqual([]);
  });
});

describe("re-judging our NFL props at the fresh read", () => {
  it("the morning bet is staked and waits for its check", () => {
    const b = judge(null);
    expect(b.pick).toBe("Ja'Marr Chase Over 70.5 rec yds");
    expect(b.check).toEqual({ state: "pending" });
    expect(pushable(b, now)).toBe(false);
    expect(checkNote(b)).toBe(" · check pending");
  });
  it("edge survives: pushed at the fresh price, with the time it was checked", () => {
    const b = judge(read(70.5, -120, -105));
    expect(b.check).toEqual({ state: "checked", at: now.toISOString() });
    expect(b.priceText).toBe("-120 DraftKings");
    expect(b.id).toBe("prop|NFL|CIN at PIT|Ja'Marr Chase Over 70.5 rec yds");
    expect(pushable(b, now)).toBe(true);
    expect(stakedPush(b, "https://x.app").message).toContain("(-120 DraftKings, checked 7:10pm)");
  });
  it("edge gone at a worse price: not pushed, says why", () => {
    const b = judge(read(70.5, -400, 300));
    expect(b.check).toEqual({ state: "gone", at: now.toISOString(), note: "edge gone at -400" });
    expect(pushable(b, now)).toBe(false);
  });
  it("line moved past our number: not pushed", () => {
    const b = judge(read(85.5, -110, -110));
    expect(b.check?.state).toBe("gone");
    expect(b.check?.note).toBe("line moved 70.5 to 85.5, no edge at -110");
    expect(pushable(b, now)).toBe(false);
  });
  it("a small line move that keeps the edge: pushed at the new line, same bet id", () => {
    const b = judge(read(72.5, -110, -110));
    expect(b.check?.state).toBe("checked");
    expect(b.pick).toBe("Ja'Marr Chase Over 72.5 rec yds");
    expect(b.line).toBe(72.5);
    expect(b.id).toBe("prop|NFL|CIN at PIT|Ja'Marr Chase Over 70.5 rec yds");
  });
  it("API failure or quota stop: no push, says so", () => {
    const b = judge(null, { ok: false, at: now.toISOString(), why: "quota stop: 449 credits used this month (stop 450)" });
    expect(b.check).toEqual({ state: "failed", at: now.toISOString(), note: "no fresh price (quota stop: 449 credits used this month (stop 450))" });
    expect(pushable(b, now)).toBe(false);
  });
  it("prop missing from the fresh read: no push", () => {
    const b = judge({ at: now.toISOString(), props: {}, firstTd: {} });
    expect(b.check?.state).toBe("failed");
    expect(b.check?.note).toBe("not in the fresh read");
  });
  it("a board saved before the mean was kept can't be re-priced, so it isn't confirmed", () => {
    const base = nflBoard(70.5, -110, -110);
    const old = { ...base, extra: Object.fromEntries(Object.entries(base.extra).map(([k, v]) => [k, { ...v, mean: undefined }])) };
    expect(repriceNfl(old, read(70.5, -110, -110), P).game.markets).toEqual([]);
  });
});

describe("freshVerdict", () => {
  const b: StakedBet = { id: "x", section: "s", sectionName: "s", sport: "NFL", game: "g", pick: "p", market: "rec", line: 5.5, priceText: "-110 DraftKings", kickoff: kick, slice: "x", stake: 1, href: "/" };
  it("no quote yet is pending", () => expect(freshVerdict(b, undefined, undefined, undefined).check).toEqual({ state: "pending" }));
  it("an unsupported prop section is pushed as before, marked not rechecked", () => {
    const [x] = applyFresh([b], new Map(), [], new Map());
    expect(x.check).toEqual({ state: "none" });
    expect(pushable(x, now)).toBe(true);
    expect(stakedPush(x, "https://x.app").message).toContain("this morning's price, not rechecked");
  });
});

describe("re-judging NBA props at a fresh ESPN read", () => {
  const line = (l: number, over: number, under: number): LiveLine => ({ type: "Total Rebounds", athlete: "9", current: { line: l, over, under }, dkOpen: empty });
  const board = (l: LiveLine) => {
    const { markets, extra } = ourMarkets(new Map([["9|Total Rebounds", l]]), new Map([["9", { min: 34, mean: { reb: 9.3 } } as Projection]]), new Map([["9", { name: "Big Man", team: "NYK" }]]), PB, new Map([["9", 20]]));
    return { game: { season: 2026, week: 2, slug: "501", away: "BOS", home: "NYK", breakEven: null, favorites: [], markets }, capturedAt: "", firstSeenAt: "", first: {}, kickoff: kick, espnId: "501", extra, away: "BOS", home: "NYK" };
  };
  const nba = (boards: ReturnType<typeof board>[]) => ourPropsStaked({ section: "nba-props-ours", sectionName: "NBA props", sport: "NBA", boards, entries: edge, now, today, cardGames: 3, href: "/" });
  it("re-prices through the model's own code: same prices keep the bet, a big move loses it", () => {
    const base = board(line(8.5, -110, -110));
    const [bet] = limitProps(nba([base])).bets;
    expect(bet?.side).toBe("Over");
    const run = (l: LiveLine) => {
      const rb = [repriceNba(base, new Map([["9|Total Rebounds", l]]), new Map(), PB)];
      const q: FreshQuote = { ok: true, at: now.toISOString(), sport: "NBA", lines: [], alts: [] };
      return applyFresh([bet], new Map([[freshKey(bet)!, q]]), nba(rb), pricedProps("nba-props-ours", rb))[0];
    };
    expect(run(line(8.5, -110, -110)).check?.state).toBe("checked");
    expect(run(line(12.5, -110, -110)).check?.state).toBe("gone");
  });
});

describe("re-judging Anytime TD at the fresh DK price", () => {
  const entries: LiveEntry[] = [{ id: "attd:edge5", label: "ATTD edge", status: "active", activatedAt: "2026-10-01T00:00:00.000Z" }];
  const boards = [{ game: { slug: "2026_09_CIN_PIT", away: "CIN", home: "PIT" } as never, kickoff: kick, espnId: "401", attd: { at: "", rows: [{ key: "jamarrchase", name: "Ja'Marr Chase", team: "CIN", anytime: 0.6, dk: 120 } as AttdRow] } }];
  it("the price is replaced by the fresh one, and rows the read lacks drop out", () => {
    const r = repriceAttd(boards[0], { at: "", props: {}, firstTd: {}, anytime: { jamarrchase: -300 } });
    expect(r.attd.rows[0].dk).toBe(-300);
    expect(repriceAttd(boards[0], { at: "", props: {}, firstTd: {} }).attd.rows).toEqual([]);
    expect(pricedAttd("nfl-attd-ours", [r]).get("nfl-attd-ours|2026_09_CIN_PIT|jamarrchase")).toEqual({ price: -300 });
  });
  it("staked at +120, kept at +110, gone at -300", () => {
    const at = (b: typeof boards) => attdStakedBets({ boards: b, entries, now, today, section: "nfl-attd-ours" });
    const [bet] = limitProps(at(boards)).bets;
    expect(bet.quote).toEqual({ event: "401", home: "PIT", away: "CIN", stat: "anytime" });
    const run = (price: number) => {
      const rb = [repriceAttd(boards[0], { at: "", props: {}, firstTd: {}, anytime: { jamarrchase: price } })];
      const q: FreshQuote = { ok: true, at: now.toISOString(), sport: "NFL", read: { at: "", props: {}, firstTd: {} }, markets: ["player_anytime_td"] };
      return applyFresh([bet], new Map([[freshKey(bet)!, q]]), at(rb), pricedAttd("nfl-attd-ours", rb))[0];
    };
    expect(run(110)).toMatchObject({ priceText: "+110 DraftKings", check: { state: "checked" } });
    expect(run(-300).check).toMatchObject({ state: "gone", note: "edge gone at -300" });
  });
});
