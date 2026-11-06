import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixture } from "@/lib/portfolio/fixture";

// The ingest door fails closed: no secret set, wrong header or a bad body, and
// nothing is saved.

const save = vi.fn(async () => {});
vi.mock("@/lib/portfolio/store", () => ({ savePortfolio: (...a: unknown[]) => save(...(a as [])) }));

import { POST } from "./route";

const SECRET = "test-ingest-secret";
const req = (body: unknown, auth?: string) =>
  new Request("http://localhost/api/portfolio/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("POST /api/portfolio/ingest", () => {
  const before = process.env.PORTFOLIO_INGEST_SECRET;
  beforeEach(() => {
    save.mockClear();
    process.env.PORTFOLIO_INGEST_SECRET = SECRET;
  });
  afterEach(() => {
    if (before === undefined) delete process.env.PORTFOLIO_INGEST_SECRET;
    else process.env.PORTFOLIO_INGEST_SECRET = before;
  });

  it("401 with no Authorization header", async () => {
    const res = await POST(req(fixture()));
    expect(res.status).toBe(401);
    expect(save).not.toHaveBeenCalled();
  });

  it("401 with the wrong secret", async () => {
    for (const auth of [`Bearer wrong`, SECRET, `bearer ${SECRET}`, `Bearer ${SECRET}x`]) {
      const res = await POST(req(fixture(), auth));
      expect(res.status).toBe(401);
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("401 when PORTFOLIO_INGEST_SECRET is unset, even for 'Bearer undefined' or an empty bearer", async () => {
    delete process.env.PORTFOLIO_INGEST_SECRET;
    for (const auth of [undefined, "Bearer undefined", "Bearer ", "Bearer"]) {
      const res = await POST(req(fixture(), auth));
      expect(res.status).toBe(401);
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("400 on a body that is not a version 1 snapshot", async () => {
    for (const body of ["not json", { version: 2 }, { ...fixture(), holdings: "none" }, {}]) {
      const res = await POST(req(body, `Bearer ${SECRET}`));
      expect(res.status).toBe(400);
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("saves a valid snapshot and answers ok with asOf", async () => {
    const s = fixture();
    const res = await POST(req(s, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, asOf: s.asOf });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("has no GET handler", async () => {
    const mod = await import("./route");
    expect("GET" in mod).toBe(false);
  });
});
