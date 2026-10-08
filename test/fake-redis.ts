// An in-memory stand-in for the Upstash client, enough for picks tests.
export function fakeRedis() {
  const kv = new Map<string, unknown>();
  const sets = new Map<string, Set<string>>();
  const hashes = new Map<string, Map<string, unknown>>();
  const lists = new Map<string, unknown[]>();
  const clone = <T>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
  return {
    kv,
    async get<T>(k: string): Promise<T | null> { return kv.has(k) ? (clone(kv.get(k)) as T) : null; },
    async set(k: string, v: unknown, o?: { nx?: boolean; ex?: number }) {
      if (o?.nx && kv.has(k)) return null;
      kv.set(k, clone(v));
      return "OK";
    },
    async del(...ks: string[]) { let n = 0; for (const k of ks) { if (kv.delete(k) || sets.delete(k) || hashes.delete(k) || lists.delete(k)) n++; } return n; },
    async exists(k: string) { return kv.has(k) || sets.has(k) || hashes.has(k) || lists.has(k) ? 1 : 0; },
    async sadd(k: string, ...m: (string | number)[]) { const s = sets.get(k) ?? new Set(); m.forEach((x) => s.add(String(x))); sets.set(k, s); return m.length; },
    async srem(k: string, ...m: (string | number)[]) { const s = sets.get(k); m.forEach((x) => s?.delete(String(x))); return m.length; },
    async smembers(k: string) { return [...(sets.get(k) ?? [])]; },
    async hset(k: string, f: Record<string, unknown>) { const h = hashes.get(k) ?? new Map(); Object.entries(f).forEach(([a, b]) => h.set(a, clone(b))); hashes.set(k, h); return Object.keys(f).length; },
    async hsetnx(k: string, f: string, v: unknown) { const h = hashes.get(k) ?? new Map(); if (h.has(f)) return 0; h.set(f, v); hashes.set(k, h); return 1; },
    async hget<T>(k: string, f: string): Promise<T | null> { return (clone(hashes.get(k)?.get(f)) as T) ?? null; },
    async hgetall<T>(k: string): Promise<T | null> { const h = hashes.get(k); return h ? (Object.fromEntries([...h].map(([a, b]) => [a, clone(b)])) as T) : null; },
    async hkeys(k: string) { return [...(hashes.get(k)?.keys() ?? [])]; },
    async rpush(k: string, ...v: unknown[]) { const l = lists.get(k) ?? []; l.push(...v.map(clone)); lists.set(k, l); return l.length; },
    async lrange<T>(k: string, a: number, b: number): Promise<T[]> { const l = lists.get(k) ?? []; return clone(l.slice(a, b === -1 ? undefined : b + 1)) as T[]; },
    async llen(k: string) { return (lists.get(k) ?? []).length; },
  };
}
