import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/redis/client", () => ({
  redis: {
    set: vi.fn(async (k: string, v: unknown, o?: { nx?: boolean }) => {
      if (o?.nx && store.has(k)) return null;
      store.set(k, v);
      return "OK";
    }),
    mget: vi.fn(async (...ks: string[]) => ks.map((k) => store.get(k) ?? null)),
  },
}));
vi.mock("@/lib/models/nfl/odds-api-store", () => ({ freshOddsRead: vi.fn() }));
vi.mock("@/lib/models/nba/store", () => ({ readNbaLines: vi.fn() }));

import { FK, loadFreshQuotes, takeFreshReads } from "./fresh";
import { freshOddsRead } from "@/lib/models/nfl/odds-api-store";
import type { StakedBet } from "./staked-core";

const kick = "2026-11-03T01:15:00.000Z";
const now = new Date("2026-11-03T00:10:00.000Z");
const bet = (id: string, stat: string): StakedBet => ({ id, section: "s", sectionName: "NFL props", sport: "NFL", game: "CIN at PIT", pick: id, market: stat, priceText: "-110 DraftKings", kickoff: kick, slice: "x", stake: 1, href: "/", quote: { event: "401", home: "PIT", away: "CIN", stat }, check: { state: "pending" } });
const key = "NFL|401|2026-11-02";

beforeEach(() => {
  store.clear();
  vi.mocked(freshOddsRead).mockReset();
});

describe("takeFreshReads", () => {
  it("one read per game per day, only the markets needed, credits logged", async () => {
    vi.mocked(freshOddsRead).mockResolvedValue({ read: { at: now.toISOString(), props: {}, firstTd: {}, cost: 2 } });
    const r = await takeFreshReads([bet("a", "rec_yds"), bet("b", "rec")], now);
    expect(r).toEqual({ read: 1, notes: ["CIN@PIT: fresh read, 2 markets, 2 credits"] });
    expect(vi.mocked(freshOddsRead).mock.calls[0][1]).toEqual(["player_reception_yds", "player_receptions"]);
    expect((await takeFreshReads([bet("a", "rec_yds")], now)).read).toBe(0);
    expect(freshOddsRead).toHaveBeenCalledTimes(1);
    expect((await loadFreshQuotes([key])).get(key)).toMatchObject({ ok: true, sport: "NFL" });
  });
  it("a failed read is saved as failed and never retried that day", async () => {
    vi.mocked(freshOddsRead).mockResolvedValue({ why: "The Odds API answered 500" });
    const r = await takeFreshReads([bet("a", "rec")], now);
    expect(r.notes).toEqual(["CIN@PIT: no fresh price, The Odds API answered 500"]);
    expect(store.get(FK.quote(key))).toMatchObject({ ok: false, why: "The Odds API answered 500" });
    await takeFreshReads([bet("a", "rec")], now);
    expect(freshOddsRead).toHaveBeenCalledTimes(1);
  });
  it("nothing read outside the window", async () => {
    expect(await takeFreshReads([bet("a", "rec")], new Date("2026-11-02T22:00:00.000Z"))).toEqual({ read: 0, notes: [] });
    expect(freshOddsRead).not.toHaveBeenCalled();
  });
});
