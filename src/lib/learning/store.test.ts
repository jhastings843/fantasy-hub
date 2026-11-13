import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRedis } from "../../../test/fake-redis";

const store: { r: ReturnType<typeof fakeRedis> } = { r: fakeRedis() };
vi.mock("server-only", () => ({}));
vi.mock("@/lib/redis/client", () => ({ redis: new Proxy({}, { get: (_t, p) => (store.r as Record<string, unknown>)[p as string] }) }));
vi.mock("@/lib/notify/golive", () => ({ notifyJournal: async () => {} }));

import { evidence, liveBets, PROPS_GATE, type Bet, type Candidate, type Gate } from "./engine";
import { loadSection, reviewIfDue } from "./store";

// Carry-over (Jack, 2026-11-12): a slice keeps its record when the season rolls over.
const G: Gate = { ...PROPS_GATE, minGames: 4, minWeeks: 2, minBets: 4 };
const bet = (season: number, i: number, net: number): Bet => ({ game: `${season}-g${i}`, week: 5 + (i % 3), at: `${season}-10-${String(10 + i).padStart(2, "0")}T17:00:00.000Z`, net, key: `${season}-g${i}-a` });
const cand = (bets: Bet[]): Candidate => ({ id: "a", label: "A", bets });

beforeEach(() => {
  store.r = fakeRedis();
});

describe("carry-over across seasons", () => {
  it("a new season starts from last season's entries and counts last season's bets", async () => {
    // Season 2026: register on Oct 1, then a review sees 6 bets.
    await reviewIfDue("t", 2026, 1, G, [cand([])], new Date("2026-10-01T12:00:00Z"));
    const s26 = Array.from({ length: 6 }, (_, i) => bet(2026, i, 0.9));
    await reviewIfDue("t", 2026, 9, G, [cand(s26)], new Date("2026-10-20T12:00:00Z"));
    const reg = (await loadSection("t", 2026)).entries.a.registeredAt;

    // Season 2027 has no state yet: it inherits the entry with the same clock.
    const s27 = await loadSection("t", 2027);
    expect(s27.entries.a.registeredAt).toBe(reg);
    expect(s27.carried?.a).toHaveLength(6);

    // Evidence from the 2027 view counts both seasons' games, and weeks never collide.
    const s27bets = Array.from({ length: 3 }, (_, i) => bet(2027, i, 0.9));
    const merged = evidence(G, { ...cand(s27bets), bets: [...(s27.carried?.a ?? []), ...s27bets] }, reg);
    expect(merged.games).toBe(9);
    expect(merged.weeks).toBe(6);
  });

  it("carried bets never count as live bets this season", async () => {
    const st = await loadSection("t", 2027);
    const carried = [bet(2026, 1, 0.9)].map((b) => ({ ...b, carried: true }));
    const s = { ...st, carried: { a: carried }, entries: { a: { id: "a", label: "A", status: "active" as const, registeredAt: "2026-01-01T00:00:00.000Z", registeredWeek: 1, activatedAt: "2026-01-01T00:00:00.000Z" } } };
    expect(liveBets(s, [cand([bet(2027, 2, 0.9)])]).map((b) => b.game)).toEqual(["2027-g2"]);
  });

  it("the saved state never holds the carried bets", async () => {
    await reviewIfDue("t", 2026, 1, G, [cand([])], new Date("2026-10-01T12:00:00Z"));
    await reviewIfDue("t", 2026, 9, G, [cand([bet(2026, 1, 0.9)])], new Date("2026-10-20T12:00:00Z"));
    await reviewIfDue("t", 2027, 1, G, [cand([])], new Date("2027-10-01T12:00:00Z"));
    const raw = await store.r.get<Record<string, unknown>>("learn:v1:t:2027:state");
    expect(raw && "carried" in raw).toBe(false);
    // And 2027's own save chains the 2026 bet forward for 2028.
    const s28 = await loadSection("t", 2028);
    expect(s28.carried?.a?.map((b) => b.game)).toEqual(["2026-g1"]);
  });
});
