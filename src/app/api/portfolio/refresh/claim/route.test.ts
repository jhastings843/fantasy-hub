import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Mac's poll door fails closed: no secret, wrong header, nothing claimed.

const claim = vi.fn(async (): Promise<string | null> => "2026-11-06T19:40:00.000Z");
vi.mock("@/lib/portfolio/store", () => ({ claimRefresh: () => claim() }));

import { POST } from "./route";

const SECRET = "test-ingest-secret";
const req = (auth?: string) =>
  new Request("http://localhost/api/portfolio/refresh/claim", { method: "POST", headers: auth ? { authorization: auth } : {} });

describe("POST /api/portfolio/refresh/claim", () => {
  const before = process.env.PORTFOLIO_INGEST_SECRET;
  beforeEach(() => {
    claim.mockClear();
    process.env.PORTFOLIO_INGEST_SECRET = SECRET;
  });
  afterEach(() => {
    if (before === undefined) delete process.env.PORTFOLIO_INGEST_SECRET;
    else process.env.PORTFOLIO_INGEST_SECRET = before;
  });

  it("401 without the right secret, and claims nothing", async () => {
    for (const auth of [undefined, "Bearer wrong", SECRET, `Bearer ${SECRET}x`]) {
      expect((await POST(req(auth))).status).toBe(401);
    }
    expect(claim).not.toHaveBeenCalled();
  });

  it("401 when no secret is configured", async () => {
    delete process.env.PORTFOLIO_INGEST_SECRET;
    expect((await POST(req(`Bearer ${SECRET}`))).status).toBe(401);
    expect(claim).not.toHaveBeenCalled();
  });

  it("returns and clears a pending request", async () => {
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(await res.json()).toEqual({ ok: true, requested: true, requestedAt: "2026-11-06T19:40:00.000Z" });
  });

  it("says nothing is pending", async () => {
    claim.mockResolvedValueOnce(null);
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(await res.json()).toEqual({ ok: true, requested: false, requestedAt: null });
  });
});
