import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRedis } from "../../../test/fake-redis";

const store = { r: fakeRedis() };
vi.mock("@/lib/redis/client", () => ({ redis: new Proxy({}, { get: (_t, p) => (store.r as Record<string, unknown>)[p as string] }) }));

import { issueAndSend } from "./issue-send";
import { getIssued, loadIssued } from "./issued-store";
import { alreadySent } from "@/lib/email/sent-log";
import type { IssuedRecord } from "./issued";

const rec: IssuedRecord = {
  league: "nfl", season: 2026, week: 6, slot: "tue", issuedAt: "2026-10-13T21:30:00Z", provenance: "issued", subject: "s", ruleVersion: "v",
  rule: null, second: null, suMethod: { id: "avg", label: "a" }, su: [], unverified: [],
  plays: [{ home: "H", away: "A", tier: "t1", side: "home", homeLine: 3, play: "H +3", basis: "reference", shownInEmail: true, units: 1, price: -110 }],
};
const base = { logId: "picks", season: "2026", week: 6, subject: "Week 6 picks", html: "<p>card v1</p>", idempotencyKey: "picks:2026:w6", records: [rec] };

describe("durable issuance", () => {
  beforeEach(() => {
    store.r = fakeRedis();
  });

  it("records intent before sending, then confirms and logs", async () => {
    const send = vi.fn(async () => {
      // At the moment of sending, the bet is already on file as pending.
      expect((await getIssued("nfl", 2026, 6))?.status).toBe("pending");
      return { sent: true as const, id: "e1" };
    });
    const out = await issueAndSend({ ...base, send });
    expect(out.outcome).toBe("sent");
    expect(await getIssued("nfl", 2026, 6)).toMatchObject({ status: "sent", emailId: "e1", idempotencyKey: "picks:2026:w6" });
    expect(await alreadySent("picks", "2026", 6)).toMatchObject({ messageId: "e1" });
  });

  it("a crash after sending is reconciled by resending the stored card under the same key", async () => {
    // Run 1: the email goes, then the process dies before confirming.
    const first = vi.fn(async () => {
      throw new Error("function timed out");
    });
    const out1 = await issueAndSend({ ...base, send: first });
    expect(out1.outcome).toBe("failed");
    expect((await getIssued("nfl", 2026, 6))?.status).toBe("pending");
    expect(await alreadySent("picks", "2026", 6)).toBeNull();
    // Run 2: today's board renders differently, but the card that goes is the recorded one, same key.
    const second = vi.fn(async (_s: string, html: string, key?: string) => ({ sent: true as const, id: key === "picks:2026:w6" && html === "<p>card v1</p>" ? "e1" : "WRONG" }));
    const out2 = await issueAndSend({ ...base, html: "<p>card v2</p>", send: second });
    expect(out2.outcome).toBe("resent-pending");
    expect(second).toHaveBeenCalledTimes(1);
    expect(await getIssued("nfl", 2026, 6)).toMatchObject({ status: "sent", emailId: "e1" });
    expect((await getIssued("nfl", 2026, 6))?.plays[0].play).toBe("H +3");
  });

  it("a confirmed send with a missing log entry is reconciled without a second email", async () => {
    await issueAndSend({ ...base, send: async () => ({ sent: true as const, id: "e1" }) });
    await store.r.del("email:v1:sent:picks:2026:w6");
    const send = vi.fn();
    const out = await issueAndSend({ ...base, send });
    expect(out.outcome).toBe("reconciled");
    expect(send).not.toHaveBeenCalled();
    expect(await alreadySent("picks", "2026", 6)).not.toBeNull();
  });

  it("a refused send drops the intent, so nothing counts as issued", async () => {
    const out = await issueAndSend({ ...base, send: async () => ({ sent: false as const, reason: "422 invalid" }) });
    expect(out.outcome).toBe("failed");
    expect(await getIssued("nfl", 2026, 6)).toBeNull();
    expect(await loadIssued("nfl", 2026)).toEqual([]);
  });

  it("never rewrites a sent record", async () => {
    await issueAndSend({ ...base, send: async () => ({ sent: true as const, id: "e1" }) });
    await issueAndSend({ ...base, records: [{ ...rec, plays: [] }], send: async () => ({ sent: true as const, id: "e2" }) });
    expect((await getIssued("nfl", 2026, 6))?.plays).toHaveLength(1);
  });
});

describe("durable issuance: independent review findings", () => {
  beforeEach(() => {
    store.r = fakeRedis();
  });
  const cfbRec: IssuedRecord = { ...rec, league: "cfb", plays: [{ ...rec.plays[0], home: "CH", away: "CA" }] };

  it("finding 1: a crash between the two sports' records still records both before resending", async () => {
    // Run 1 claims the two-sport card, writes NFL, then dies before CFB and before sending.
    const { saveIssued } = await import("./issued-store");
    await store.r.set("picks:v2:intent:picks:2026:w6", { html: "<p>both</p>", subject: "s", records: [rec, cfbRec], createdAt: new Date().toISOString() });
    await saveIssued({ ...rec, status: "pending", idempotencyKey: "picks:2026:w6" });
    const send = vi.fn(async () => ({ sent: true as const, id: "e1" }));
    const out = await issueAndSend({ ...base, html: "<p>different render</p>", records: [rec], send });
    expect(out.sent).toBe(true);
    expect(send).toHaveBeenCalledWith("s", "<p>both</p>", "picks:2026:w6");
    expect((await getIssued("cfb", 2026, 6))?.status).toBe("sent");
    expect((await getIssued("nfl", 2026, 6))?.status).toBe("sent");
  });

  it("finding 2: a concurrent run that loses the claim sends the claimed card, not its own", async () => {
    await issueAndSend({ ...base, html: "<p>A</p>", send: async () => { throw new Error("timeout"); } });
    const send = vi.fn(async () => ({ sent: true as const, id: "e1" }));
    await issueAndSend({ ...base, html: "<p>B</p>", records: [{ ...rec, plays: [] }], send });
    expect(send).toHaveBeenCalledWith(base.subject, "<p>A</p>", base.idempotencyKey);
    expect((await getIssued("nfl", 2026, 6))?.plays).toHaveLength(1);
  });

  it("finding 4: past the resend window an unconfirmed send is never resent", async () => {
    const t0 = Date.parse("2026-10-13T21:30:00Z");
    await issueAndSend({ ...base, now: () => t0, send: async () => { throw new Error("timeout"); } });
    const send = vi.fn();
    const out = await issueAndSend({ ...base, now: () => t0 + 21 * 3600 * 1000, send });
    expect(out.outcome).toBe("unconfirmed");
    expect(send).not.toHaveBeenCalled();
    expect((await getIssued("nfl", 2026, 6))?.status).toBe("unconfirmed");
  });

  it("finding 3: recoverPending finishes a pending send before a new decision", async () => {
    const { recoverPending } = await import("./issue-send");
    await issueAndSend({ ...base, send: async () => { throw new Error("timeout"); } });
    const send = vi.fn(async () => ({ sent: true as const, id: "e9" }));
    const out = await recoverPending({ logId: "picks", season: "2026", week: 6, idempotencyKey: base.idempotencyKey, send });
    expect(out?.sent).toBe(true);
    expect((await getIssued("nfl", 2026, 6))?.status).toBe("sent");
    expect(await recoverPending({ logId: "picks", season: "2026", week: 6, idempotencyKey: base.idempotencyKey, send })).toBeNull();
  });

  it("finding 5: a failed issued read throws for exposure instead of reading as empty", async () => {
    const { loadIssuedStrict } = await import("./issued-store");
    store.r.smembers = async () => {
      throw new Error("redis down");
    };
    await expect(loadIssuedStrict("nfl", 2026)).rejects.toThrow("redis down");
  });
});
