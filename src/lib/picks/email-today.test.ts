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
