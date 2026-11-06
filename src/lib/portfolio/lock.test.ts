import { describe, expect, it } from "vitest";
import { makeToken } from "@/lib/auth/session";
import { canSeePortfolio } from "./lock";

// The Portfolio page holds real balances, so the lock fails closed.

const SECRET = "test-secret-not-real";
const NOW = 1_800_000_000_000;

describe("canSeePortfolio", () => {
  it("opens for a cookie this secret signed", async () => {
    const token = await makeToken(SECRET, NOW);
    expect(await canSeePortfolio({ secret: SECRET, token, nodeEnv: "production", now: NOW })).toBe(true);
  });

  it("stays locked with no cookie", async () => {
    expect(await canSeePortfolio({ secret: SECRET, token: undefined, nodeEnv: "production", now: NOW })).toBe(false);
  });

  it("stays locked for a cookie another secret signed", async () => {
    const token = await makeToken("some-other-secret", NOW);
    expect(await canSeePortfolio({ secret: SECRET, token, nodeEnv: "production", now: NOW })).toBe(false);
  });

  it("stays locked for a forged or garbled cookie", async () => {
    for (const token of ["", "abc", `${NOW}.`, `${NOW}.not-a-real-signature`, "NaN.xyz"]) {
      expect(await canSeePortfolio({ secret: SECRET, token, nodeEnv: "production", now: NOW })).toBe(false);
    }
  });

  it("stays locked for an expired cookie", async () => {
    const token = await makeToken(SECRET, NOW - 181 * 86_400_000);
    expect(await canSeePortfolio({ secret: SECRET, token, nodeEnv: "production", now: NOW })).toBe(false);
  });

  it("stays locked when HH_SESSION_SECRET is unset in production and preview", async () => {
    const token = await makeToken(SECRET, NOW);
    expect(await canSeePortfolio({ secret: undefined, token, nodeEnv: "production", now: NOW })).toBe(false);
    expect(await canSeePortfolio({ secret: "", token, nodeEnv: "production", now: NOW })).toBe(false);
    expect(await canSeePortfolio({ secret: undefined, token: undefined, nodeEnv: "test", now: NOW })).toBe(false);
    expect(await canSeePortfolio({ secret: undefined, token: undefined, nodeEnv: undefined, now: NOW })).toBe(false);
  });

  it("opens in local dev only when no secret is set at all (matches proxy.ts)", async () => {
    expect(await canSeePortfolio({ secret: undefined, token: undefined, nodeEnv: "development", now: NOW })).toBe(true);
    // With a secret set, dev still needs the cookie.
    expect(await canSeePortfolio({ secret: SECRET, token: undefined, nodeEnv: "development", now: NOW })).toBe(false);
  });
});
