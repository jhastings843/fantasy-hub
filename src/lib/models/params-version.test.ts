import { beforeEach, describe, expect, it, vi } from "vitest";

const r = { mget: vi.fn() };
vi.mock("@/lib/redis/client", () => ({ redis: new Proxy({}, { get: (_t, p) => (r as Record<string, unknown>)[p as string] }) }));

import { live, paramsHash, paramsProblem, paramsVersion, primeParams, resetParamsForTest } from "./params-store";

const T = 1e12;
const DEF = { a: 1, b: [2, 3] };
const P = live("nfl-props", DEF);
// Slot of nfl-props in MODEL_KEYS.
const at = (v: unknown) => [null, null, null, null, v, null, null, null, null];

describe("params version", () => {
  beforeEach(() => {
    resetParamsForTest();
    r.mget.mockReset();
  });

  it("no refit stored: default, hash of the JSON", async () => {
    r.mget.mockResolvedValue(at(null));
    await primeParams(T);
    expect(paramsVersion("nfl-props")).toEqual({ hash: paramsHash(DEF), source: "default" });
    expect(paramsProblem()).toBeNull();
  });

  it("a stored refit: live, hash of the merged settings", async () => {
    r.mget.mockResolvedValue(at({ params: { a: 5 }, at: "x", evidence: {} }));
    await primeParams(T);
    expect(P.a).toBe(5);
    const v = paramsVersion("nfl-props");
    expect(v).toEqual({ hash: paramsHash({ a: 5, b: [2, 3] }), source: "live" });
    expect(v.hash).not.toBe(paramsHash(DEF));
  });

  it("a failed load after a good one: stale, degraded, reported", async () => {
    r.mget.mockResolvedValueOnce(at({ params: { a: 5 }, at: "x", evidence: {} }));
    await primeParams(T);
    r.mget.mockRejectedValueOnce(new Error("upstash down"));
    await primeParams(T + 10 * 60_000);
    expect(P.a).toBe(5);
    expect(paramsVersion("nfl-props")).toMatchObject({ source: "stale", degraded: true });
    expect(paramsProblem()).toMatch(/did not load \(upstash down\).*last loaded values/);
  });

  it("a failed first load: default, degraded, reported; a good retry clears it", async () => {
    r.mget.mockRejectedValueOnce(new Error("timeout"));
    await primeParams(T);
    expect(paramsVersion("nfl-props")).toEqual({ hash: paramsHash(DEF), source: "default", degraded: true });
    expect(paramsProblem()).toMatch(/JSON defaults/);
    r.mget.mockResolvedValueOnce(at(null));
    await primeParams(T + 1);
    expect(paramsProblem()).toBeNull();
    expect(paramsVersion("nfl-props").degraded).toBeUndefined();
  });
});
