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
    exists: vi.fn(async (k: string) => (store.has(k) ? 1 : 0)),
  },
}));
const sent: { title: string }[] = [];
vi.mock("./pushover", () => ({ push: vi.fn(async (p: { title: string }) => (sent.push(p), { pushed: true })) }));
vi.mock("@/lib/props/staked", () => ({ stakedToday: vi.fn() }));

import { markEmailed, pushStakedBets, unsentStaked } from "./staked";
import { stakedToday } from "@/lib/props/staked";
import type { StakedBet } from "@/lib/props/staked-core";

const now = new Date("2026-11-02T20:00:00.000Z");
const bet = (id: string, kickoff: string): StakedBet => ({ id, section: "s", sectionName: "NBA props", sport: "NBA", game: "BOS at NYK", pick: "X Under 1.5 reb", market: "reb", priceText: "-110 DraftKings", kickoff, slice: "S", stake: 1, href: "/props" });

beforeEach(() => {
  store.clear();
  sent.length = 0;
});

describe("pushStakedBets", () => {
  it("pushes each bet once across reruns", async () => {
    const bets = [bet("a", "2026-11-03T00:30:00.000Z"), bet("b", "2026-11-03T01:00:00.000Z")];
    expect(await pushStakedBets(bets, now)).toEqual({ pushed: 2, skipped: 0 });
    expect(await pushStakedBets(bets, now)).toEqual({ pushed: 0, skipped: 0 });
    expect(sent).toHaveLength(2);
    expect([...store.keys()]).toEqual(["notify:v1:staked:a", "notify:v1:staked:b"]);
  });
  it("email: only bets not emailed before, with the lead the caller asks", async () => {
    const a = bet("a", "2026-11-03T00:30:00.000Z");
    const soon = bet("soon", "2026-11-02T20:30:00.000Z");
    vi.mocked(stakedToday).mockResolvedValue({ bets: [a, soon], problems: [] });
    expect((await unsentStaked(now)).map((b) => b.id)).toEqual(["a", "soon"]);
    expect((await unsentStaked(now, 60 * 60_000)).map((b) => b.id)).toEqual(["a"]);
    await markEmailed([a], now);
    expect((await unsentStaked(now)).map((b) => b.id)).toEqual(["soon"]);
  });
  it("email: a failed read means none, never a thrown send", async () => {
    vi.mocked(stakedToday).mockRejectedValue(new Error("redis down"));
    expect(await unsentStaked(now)).toEqual([]);
  });
  it("never pushes inside 5 minutes of lock, and doesn't claim it", async () => {
    expect(await pushStakedBets([bet("c", "2026-11-02T20:04:00.000Z")], now)).toEqual({ pushed: 0, skipped: 1 });
    expect(store.size).toBe(0);
  });
});
