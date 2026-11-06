import { beforeEach, describe, expect, it, vi } from "vitest";

// {feed:true, week:0} used to be refused: `!body.week` read week 0 as missing.

const ingestHarrisFeed = vi.fn(async (_season: number, week: number) => ({ season: 2026, week, rows: [{}, {}], picks: [], verified: true, problems: [], source: "site", at: "x" }));
vi.mock("@/lib/picks/harris", () => ({ ingestHarrisFeed: (s: number, w: number) => ingestHarrisFeed(s, w), ingestHarris: vi.fn(), harrisNow: vi.fn(), harrisWeeks: vi.fn() }));
vi.mock("@/lib/picks/harris-sheet", () => ({ isContestPost: () => false }));
vi.mock("@/lib/picks/harris-track", () => ({ harrisSummary: () => "" }));
vi.mock("@/lib/models/cbb/harris-store", () => ({ ingestHarrisCbb: vi.fn() }));

const post = async (body: unknown) => {
  const { POST } = await import("./route");
  return POST(new Request("http://x/api/picks/harris", { method: "POST", headers: { authorization: "Bearer s3cret" }, body: JSON.stringify(body) }));
};

describe("POST /api/picks/harris feed", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
    ingestHarrisFeed.mockClear();
  });
  it("reads week 0", async () => {
    const r = await post({ feed: true, week: 0, season: 2026 });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, week: 0, games: 2 });
    expect(ingestHarrisFeed).toHaveBeenCalledWith(2026, 0);
  });
  it("still refuses a missing week", async () => {
    const r = await post({ feed: true });
    expect(r.status).toBe(400);
    expect(ingestHarrisFeed).not.toHaveBeenCalled();
  });
});
