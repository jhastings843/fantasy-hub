import { describe, expect, it } from "vitest";
import { buildTodayEmail, todayPush, type TodayLeague } from "./email";

const r = (league: "nfl" | "cfb") =>
  ({
    league,
    week: 6,
    names: { TB: "TB", DAL: "DAL" },
    boardUpdated: { sam: true, david: true },
    pem: [],
    reference: { games: 15, priced: 15, source: "DraftKings via ESPN", stale: false },
    errors: [],
  }) as never;
const diff = (over: Record<string, unknown> = {}) =>
  ({ week: 6, added: [], addedTotals: [], off: [], totalsOff: [], stillOn: [], totalsStillOn: [], pageOnly: [], kickedOff: 0, noQuote: 0, gone: 0, ...over }) as never;
const tb = { home: "DAL", away: "TB", side: "away", homeLine: -8.5, stake: 2, price: -105, tier: "t1", ref: { kickoff: "2026-10-16T00:15:00Z" } };

describe("today's bets email and push", () => {
  const leagues: TodayLeague[] = [{ r: r("nfl"), diff: diff({ added: [tb] }) }];
  it("push: count and units in the title, one line per bet with line, stake, price and time", () => {
    const p = todayPush({ date: "2026-10-15", leagues, appUrl: "https://x" });
    expect(p.title).toBe("Today's bets: 1 · 2u");
    expect(p.message).toBe("NFL TB +8.5 · 2u (-105) · 8:15 PM");
    expect(p.url).toBe("https://x/picks");
  });
  it("push: a sent bet that is off says so", () => {
    const off = [{ r: r("cfb"), diff: diff({ off: [{ sent: { home: "A", away: "B", side: "home", homeLine: 3 }, reason: "Both models now sit on the other side" }] }) }];
    const p = todayPush({ date: "2026-10-17", leagues: off as TodayLeague[], appUrl: "https://x" });
    expect(p.title).toBe("Picks: a sent bet is off");
    expect(p.message).toBe("OFF CFB A: Both models now sit on the other side");
  });
  it("email: subject carries the count, units and date; no em dashes", () => {
    const e = buildTodayEmail({ date: "2026-10-15", leagues, appUrl: "https://x", generatedAt: "2026-10-15T13:00:00Z" });
    expect(e.subject).toBe("Today's bets: 1 (2u) · Thu, Oct 15");
    expect(e.html).toContain("TB +8.5 (-105)");
    expect(e.html).not.toContain("—");
  });
});

describe("late-add email", () => {
  it("says late add in the subject, heading and push", () => {
    const leagues: TodayLeague[] = [{ r: r("cfb"), diff: diff({ added: [tb] }) }];
    const e = buildTodayEmail({ date: "2026-10-31", leagues, appUrl: "https://x", generatedAt: "2026-10-31T15:30:00Z", late: true });
    expect(e.subject).toBe("Late add: 1 (2u) · Sat, Oct 31");
    expect(e.html).toContain("Late add: qualified after the 9am email");
    expect(e.html).toContain("11:30 AM ET");
    expect(todayPush({ date: "2026-10-31", leagues, appUrl: "https://x", late: true }).title).toBe("Late add: 1 · 2u");
  });
});

describe("staked props and NBA bets in the email", () => {
  const leagues: TodayLeague[] = [{ r: r("nfl"), diff: diff({ added: [tb] }) }];
  const prop = { id: "p", section: "nba-props-ours", sectionName: "NBA props", sport: "NBA" as const, game: "BOS at NYK", player: "Jalen Brunson", pick: "Jalen Brunson Under 27.5 pts", market: "pts", priceText: "-110 DraftKings", price: -110, kickoff: "2026-10-16T00:30:00Z", slice: "Edges on the under", stake: 1, href: "/props?m=nba" };
  it("none staked: the email is byte for byte what it was", () => {
    const a = buildTodayEmail({ date: "2026-10-15", leagues, appUrl: "https://x", generatedAt: "2026-10-15T13:00:00Z" });
    const b = buildTodayEmail({ date: "2026-10-15", leagues, appUrl: "https://x", generatedAt: "2026-10-15T13:00:00Z", staked: [] });
    expect(b).toEqual(a);
    expect(a.html).not.toContain("Props and NBA");
  });
  it("adds a card and counts them in the subject", () => {
    const e = buildTodayEmail({ date: "2026-10-15", leagues, appUrl: "https://x", generatedAt: "2026-10-15T13:00:00Z", staked: [prop] });
    expect(e.subject).toBe("Today's bets: 2 (3u) · Thu, Oct 15");
    expect(e.html).toContain("Props and NBA · staked");
    expect(e.html).toContain("Jalen Brunson Under 27.5 pts (-110 DraftKings)");
    expect(e.html).toContain("Edges on the under");
    expect(e.html).not.toContain("—");
  });
  it("a props-only day is still today's bets, and a props-only late add says so", () => {
    expect(buildTodayEmail({ date: "2026-10-15", leagues: [], appUrl: "https://x", generatedAt: "2026-10-15T13:00:00Z", staked: [prop] }).subject).toBe("Today's bets: 1 (1u) · Thu, Oct 15");
    expect(buildTodayEmail({ date: "2026-10-15", leagues: [], appUrl: "https://x", generatedAt: "2026-10-15T18:00:00Z", late: true, staked: [prop] }).subject).toBe("Late add: 1 (1u) · Thu, Oct 15");
  });
});
