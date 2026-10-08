import "server-only";
import { redis } from "@/lib/redis/client";
import { BASELINE_POLICY, envelopeViolations, type PicksPolicy } from "../policy";
import { ACTIVE_POLICY_KEY, loadActivePolicy } from "../policy-store";
import type { Hypothesis } from "./model";
import type { JournalEntry, LearningStore, ReviewState } from "./review";

// Redis-backed learning store. Append-only journal; hypothesis definitions
// and policy versions are write-once; only statuses and the active pointer
// move.

const HYP = "picks:v2:learning:hyp";
const JOURNAL = "picks:v2:learning:journal";
const STATE = "picks:v2:learning:state";
const VERSIONS = "picks:v2:policy:versions";

export const redisStore: LearningStore = {
  async hypotheses() {
    const all = ((await redis.hgetall<Record<string, Hypothesis>>(HYP)) ?? {}) as Record<string, Hypothesis>;
    return Object.values(all);
  },
  async putHypothesis(h) {
    const cur = await redis.hget<Hypothesis>(HYP, h.id);
    await redis.hset(HYP, { [h.id]: cur ? { ...cur, status: h.status } : h });
  },
  async append(e: JournalEntry) {
    await redis.rpush(JOURNAL, JSON.stringify(e));
  },
  async journal(limit: number) {
    const raw = await redis.lrange<string | JournalEntry>(JOURNAL, -limit, -1);
    return raw.map((x) => (typeof x === "string" ? (JSON.parse(x) as JournalEntry) : x)).reverse();
  },
  async state() {
    return (await redis.get<ReviewState>(STATE)) ?? null;
  },
  async setState(s: ReviewState) {
    await redis.set(STATE, s);
  },
  async active() {
    return loadActivePolicy();
  },
  async version(id: string) {
    if (id === BASELINE_POLICY.id) return BASELINE_POLICY;
    return (await redis.hget<PicksPolicy>(VERSIONS, id)) ?? null;
  },
  async putVersion(p: PicksPolicy) {
    await redis.hsetnx(VERSIONS, p.id, p);
  },
  async setActive(p: PicksPolicy) {
    // The envelope is checked again at the last possible moment.
    if (envelopeViolations(p).length) throw new Error(`refusing to activate ${p.id}: ${envelopeViolations(p).join("; ")}`);
    await redis.set(ACTIVE_POLICY_KEY, p);
  },
};

export async function appendJournal(e: JournalEntry): Promise<void> {
  await redisStore.append(e);
}
