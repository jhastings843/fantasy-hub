import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The button's door uses the page's own lock: no valid cookie, no request.

const request = vi.fn(async () => "2026-11-06T19:40:00.000Z");
vi.mock("@/lib/portfolio/store", () => ({ requestRefresh: () => request() }));
let cookie: string | undefined;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined) }) }));
const valid = vi.fn(async (_s: string, t: string | undefined) => t === "good");
vi.mock("@/lib/auth/session", () => ({ SESSION_COOKIE: "hh_session", validToken: (s: string, t: string | undefined) => valid(s, t) }));

import { POST } from "./route";

describe("POST /api/portfolio/refresh", () => {
  const before = process.env.HH_SESSION_SECRET;
  beforeEach(() => {
    request.mockClear();
    process.env.HH_SESSION_SECRET = "s";
  });
  afterEach(() => {
    if (before === undefined) delete process.env.HH_SESSION_SECRET;
    else process.env.HH_SESSION_SECRET = before;
  });

  it("401 with no cookie or a bad one", async () => {
    for (const c of [undefined, "bad"]) {
      cookie = c;
      expect((await POST()).status).toBe(401);
    }
    expect(request).not.toHaveBeenCalled();
  });

  it("401 when no session secret is set outside dev", async () => {
    delete process.env.HH_SESSION_SECRET;
    cookie = "good";
    expect((await POST()).status).toBe(401);
    expect(request).not.toHaveBeenCalled();
  });

  it("sets the flag for an unlocked device", async () => {
    cookie = "good";
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, requestedAt: "2026-11-06T19:40:00.000Z" });
  });
});
