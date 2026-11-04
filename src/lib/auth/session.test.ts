import { describe, expect, it } from "vitest";
import { SESSION_DAYS, makeToken, sameString, validToken } from "./session";

describe("device session", () => {
  const secret = "test-secret-not-real";
  it("accepts a token it signed", async () => {
    expect(await validToken(secret, await makeToken(secret, 1_000_000), 1_000_500)).toBe(true);
  });
  it("fails closed: no secret, no token, wrong secret, tampered or expired token", async () => {
    const t = await makeToken(secret, 1_000_000);
    expect(await validToken(undefined, t, 1_000_500)).toBe(false);
    expect(await validToken(secret, undefined, 1_000_500)).toBe(false);
    expect(await validToken("other", t, 1_000_500)).toBe(false);
    expect(await validToken(secret, t.replace(/^\d+/, "1000001"), 1_000_500)).toBe(false);
    expect(await validToken(secret, t, 1_000_000 + SESSION_DAYS * 86_400_000 + 1)).toBe(false);
    expect(await validToken(secret, "garbage", 1_000_500)).toBe(false);
  });
  it("compares strings exactly", () => {
    expect(sameString("abc", "abc")).toBe(true);
    expect(sameString("abc", "abd")).toBe(false);
    expect(sameString("abc", "abcd")).toBe(false);
  });
});
