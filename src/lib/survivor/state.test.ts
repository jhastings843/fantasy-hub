import { describe, expect, it } from "vitest";
import { getPool, savePool, type PoolStore } from "./state";
import { poolMeta } from "./pools";

function memoryStore(seed: Record<string, unknown> = {}): PoolStore & {
  data: Map<string, unknown>;
} {
  const data = new Map<string, unknown>(Object.entries(seed));
  return {
    data,
    async get<T>(key: string) {
      return (data.get(key) as T) ?? null;
    },
    async set<T>(key: string, value: T) {
      data.set(key, value);
    },
  };
}

const LEGACY = "survivor:pool:2026:v1";
const MAIN = "survivor:pool:2026:main:v1";
const THIRTY = "survivor:pool:2026:thirty:v1";

describe("poolMeta", () => {
  it("refuses an id that is not a pool", () => {
    // A typo in a query string must not silently read or write the wrong pool.
    expect(() => poolMeta("main2")).toThrow(/Unknown survivor pool/);
  });
});

describe("getPool", () => {
  it("seeds a pool that has never been saved from its own defaults", async () => {
    // The important one. A fresh second pool inheriting 500 entries would make
    // every equity number on its board wrong while looking entirely normal.
    const pool = await getPool(2026, "thirty", memoryStore());
    expect(pool.poolSize).toBe(30);
    expect(pool.strikes).toBe(1);
    expect(pool.usedTeams).toEqual([]);
  });

  it("carries the pool's display name", async () => {
    const pool = await getPool(2026, "thirty", memoryStore());
    expect(pool.name).toBe("30-entry pool");
  });

  it("reads the main pool from the key written before pools had ids", async () => {
    const store = memoryStore({
      [LEGACY]: { poolSize: 500, usedTeams: ["LAC"], myPicks: { "1": "LAC" } },
    });
    const pool = await getPool(2026, "main", store);
    expect(pool.usedTeams).toEqual(["LAC"]);
    expect(pool.myPicks).toEqual({ "1": "LAC" });
  });

  it("does not let the second pool see the legacy key", async () => {
    // Burned teams are per pool. Reading them across would strike teams off a
    // board where they are still available.
    const store = memoryStore({
      [LEGACY]: { poolSize: 500, usedTeams: ["LAC"], myPicks: { "1": "LAC" } },
    });
    const pool = await getPool(2026, "thirty", store);
    expect(pool.usedTeams).toEqual([]);
    expect(pool.myPicks).toEqual({});
    expect(pool.poolSize).toBe(30);
  });

  it("prefers the pool-scoped key over the legacy one for main", async () => {
    const store = memoryStore({
      [LEGACY]: { usedTeams: ["LAC"] },
      [MAIN]: { usedTeams: ["JAX"] },
    });
    const pool = await getPool(2026, "main", store);
    expect(pool.usedTeams).toEqual(["JAX"]);
  });
});

describe("savePool", () => {
  it("writes the pool-scoped key rather than the legacy one", async () => {
    const store = memoryStore();
    await savePool(2026, "main", { usedTeams: ["LAC"] }, store);
    expect(store.data.has(MAIN)).toBe(true);
    expect(store.data.has(LEGACY)).toBe(false);
  });

  it("gives each pool its own key", async () => {
    const store = memoryStore();
    await savePool(2026, "thirty", { usedTeams: ["JAX"] }, store);
    expect(store.data.has(THIRTY)).toBe(true);
    expect(store.data.has(MAIN)).toBe(false);
  });

  it("leaves the other pool untouched", async () => {
    const store = memoryStore({
      [MAIN]: { poolSize: 500, usedTeams: ["LAC"] },
    });
    await savePool(2026, "thirty", { usedTeams: ["JAX"] }, store);

    const main = await getPool(2026, "main", store);
    const thirty = await getPool(2026, "thirty", store);
    expect(main.usedTeams).toEqual(["LAC"]);
    expect(main.poolSize).toBe(500);
    expect(thirty.usedTeams).toEqual(["JAX"]);
    expect(thirty.poolSize).toBe(30);
  });

  it("keeps the size it was given rather than resetting to the default", async () => {
    const store = memoryStore();
    await savePool(2026, "thirty", { poolSize: 28 }, store);
    expect((await getPool(2026, "thirty", store)).poolSize).toBe(28);
  });

  it("still upper-cases and de-blanks picks", async () => {
    const store = memoryStore();
    const saved = await savePool(
      2026,
      "thirty",
      { myPicks: { "1": " jax ", "2": "" } },
      store,
    );
    expect(saved.myPicks).toEqual({ "1": "JAX" });
  });
});
