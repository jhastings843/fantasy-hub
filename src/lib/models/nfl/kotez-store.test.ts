import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fakeRedis } from "../../../../test/fake-redis";

const store = { r: fakeRedis() };
vi.mock("@/lib/redis/client", () => ({ redis: new Proxy({}, { get: (_t, p) => (store.r as Record<string, unknown>)[p as string] }) }));

import { gradeKotez, loadKotez, type KotezSaved } from "./kotez-store";

const fx = (f: string) => readFileSync(`test/fixtures/models/kotez/${f}`, "utf8");
const POST = "https://dknetwork.draftkings.com/2026/10/26/tracking-the-leader-for-draftkings-king-of-the-end-zone-monday-10-26-26/";

const saved = (over: Partial<KotezSaved> = {}): KotezSaved => ({
  slug: "2026_07_DAL_PHI", game: "DAL at PHI", kickoff: "2026-10-27T00:15:00.000Z", espnId: "401", source: "dknetwork", savedAt: "2026-10-26T20:00:00.000Z",
  rows: [{ key: "georgepickens", name: "George Pickens", team: "DAL", longest: 0.06, anytime: 0.45, dk: 130, crowd: 0.031, value: 1.9 }],
  noTd: 0.01, result: { yards: 21, winners: [{ name: "George Pickens", team: "DAL", dst: false }] }, gradedAt: "2026-10-27T04:00:00.000Z", ...over,
});

describe("KOTEZ payout logging", () => {
  beforeEach(async () => {
    store.r = fakeRedis();
    await store.r.sadd("kotez:v1:2026:weeks", "7");
  });
  afterEach(() => vi.unstubAllGlobals());

  const stubDk = (post: string) =>
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(url.includes("draftkings-king-of/") ? fx("hub.html") : url === POST ? post : "", { status: url.includes("draftkings-king-of/") || url === POST ? 200 : 404 })));

  it("saves DK's payout on a graded promo game, with our share for the winner beside it", async () => {
    await store.r.hset("kotez:v1:2026:w7", { [saved().slug]: saved() });
    stubDk(fx("article-2026-10-26.html"));
    const out = await gradeKotez(2026, new Date("2026-10-27T18:30:00Z"));
    expect(out).toEqual(["KOTEZ payout DAL at PHI: $65 each, about 30,800 backers"]);
    const [x] = await loadKotez(2026);
    expect(x.payout).toMatchObject({ perBettor: 65, pool: 2_000_000, source: POST, est: { name: "George Pickens", share: 0.031, impliedEntrants: Math.round(30769 / 0.031) } });
  });

  it("no amount in the post yet: nothing saved, asked again next run", async () => {
    await store.r.hset("kotez:v1:2026:w7", { [saved().slug]: saved() });
    stubDk(fx("article-2026-10-19.html").replace("George Kittle", "George Pickens"));
    expect(await gradeKotez(2026, new Date("2026-10-27T18:30:00Z"))).toEqual([]);
    expect((await loadKotez(2026))[0].payout).toBeUndefined();
  });

  it("a post naming someone else is the wrong post", async () => {
    await store.r.hset("kotez:v1:2026:w7", { [saved().slug]: saved({ result: { yards: 16, winners: [{ name: "CeeDee Lamb", team: "DAL", dst: false }] } }) });
    stubDk(fx("article-2026-10-26.html"));
    expect(await gradeKotez(2026, new Date("2026-10-27T18:30:00Z"))).toEqual([]);
  });

  it("stops asking a week after kickoff", async () => {
    await store.r.hset("kotez:v1:2026:w7", { [saved().slug]: saved() });
    stubDk(fx("article-2026-10-26.html"));
    expect(await gradeKotez(2026, new Date("2026-11-04T18:30:00Z"))).toEqual([]);
  });
});
