import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fakeRedis } from "../../../../test/fake-redis";

const store = { r: fakeRedis() };
vi.mock("@/lib/redis/client", () => ({ redis: new Proxy({}, { get: (_t, p) => (store.r as Record<string, unknown>)[p as string] }) }));

import { K, ingestFinals } from "./store";
import type { FbTables } from "./firstbasket";
import type { PlayerEntry, TeamEntry } from "./history";

const summary = readFileSync("test/fixtures/models/espn-nba-summary-401909088.json", "utf8");
const ID = "401909088";
const S = 2026;

const okFetch = () => vi.fn(async () => new Response(summary, { status: 200 }));

async function state() {
  const teams = (await store.r.get<{ [t: string]: TeamEntry }>(K.teams(S)))!;
  const fb = (await store.r.get<FbTables>(K.fb))!;
  const players = (await store.r.hgetall<{ [id: string]: PlayerEntry }>(K.players(S)))!;
  return { teams, fb, players, ingested: await store.r.smembers(K.ingested(S)) };
}

describe("NBA ingestFinals: idempotent, marker last, one run at a time", () => {
  beforeEach(() => {
    store.r = fakeRedis();
    vi.stubGlobal("fetch", okFetch());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("folds a final once and marks it", async () => {
    const report = { problems: [] as string[] };
    expect(await ingestFinals(S, [ID], report)).toEqual([ID]);
    const s = await state();
    expect(s.ingested).toEqual([ID]);
    expect(s.teams.BOS.poss).toHaveLength(1);
    expect(s.teams.BOS.seen).toEqual([ID]);
    expect(s.players["4251"].games).toHaveLength(1);
    expect(s.fb.tipTeamFirst.n).toBe(1);
    expect(await store.r.get(K.ingestLock(S))).toBeNull();
  });

  it("a retry after a crash before the marker does not double count", async () => {
    await ingestFinals(S, [ID], { problems: [] });
    // The run timed out after saving everything but the marker.
    await store.r.del(K.ingested(S));
    expect(await ingestFinals(S, [ID], { problems: [] })).toEqual([ID]);
    const s = await state();
    expect(s.teams.BOS.poss).toHaveLength(1);
    expect(s.teams.DET.recent).toHaveLength(1);
    expect(s.players["4251"].games).toHaveLength(1);
    expect(s.fb.tipTeamFirst.n).toBe(1);
    expect(s.fb.tips["4351852"].n).toBe(1);
    expect(s.ingested).toEqual([ID]);
  });

  it("a crash after players but before the tables completes the tables on retry, without repeating players", async () => {
    const realSet = store.r.set.bind(store.r);
    let fail = true;
    store.r.set = (async (k: string, v: unknown, o?: { nx?: boolean; ex?: number }) => {
      if (fail && k === K.teams(S)) throw new Error("timeout");
      return realSet(k, v, o);
    }) as typeof store.r.set;
    await expect(ingestFinals(S, [ID], { problems: [] })).rejects.toThrow("timeout");
    expect(await store.r.smembers(K.ingested(S))).toEqual([]);
    expect((await store.r.hgetall<{ [id: string]: PlayerEntry }>(K.players(S)))!["4251"].games).toHaveLength(1);
    fail = false;
    expect(await ingestFinals(S, [ID], { problems: [] })).toEqual([ID]);
    const s = await state();
    expect(s.teams.BOS.poss).toHaveLength(1);
    expect(s.players["4251"].games).toHaveLength(1);
    expect(s.ingested).toEqual([ID]);
  });

  it("skips while another run holds the lock", async () => {
    await store.r.set(K.ingestLock(S), "other", { nx: true, ex: 300 });
    const report = { problems: [] as string[] };
    expect(await ingestFinals(S, [ID], report)).toEqual([]);
    expect(report.problems[0]).toMatch(/lock/);
    expect(await store.r.get(K.teams(S))).toBeNull();
    expect(await store.r.get(K.ingestLock(S))).toBe("other");
  });

  it("a fetch failure leaves the game unmarked and the lock free", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 500 })));
    const report = { problems: [] as string[] };
    expect(await ingestFinals(S, [ID], report)).toEqual([]);
    expect(report.problems[0]).toMatch(/ingest 401909088/);
    expect(await store.r.smembers(K.ingested(S))).toEqual([]);
    expect(await store.r.get(K.ingestLock(S))).toBeNull();
  });
});
