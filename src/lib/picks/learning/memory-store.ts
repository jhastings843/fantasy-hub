// An in-memory LearningStore, for tests and the rehearsal.
import { BASELINE_POLICY, type PicksPolicy } from "../policy";
import type { Hypothesis } from "./model";
import type { JournalEntry, LearningStore, ReviewState } from "./review";

export function memoryStore(): LearningStore & { dump(): { hypotheses: Hypothesis[]; journal: JournalEntry[]; versions: PicksPolicy[] } } {
  const hyps = new Map<string, Hypothesis>();
  const journal: JournalEntry[] = [];
  const versions = new Map<string, PicksPolicy>([[BASELINE_POLICY.id, BASELINE_POLICY]]);
  let active: PicksPolicy = BASELINE_POLICY;
  let state: ReviewState | null = null;
  return {
    async hypotheses() { return [...hyps.values()]; },
    async putHypothesis(h) {
      const cur = hyps.get(h.id);
      // A definition is frozen: only the status may move.
      hyps.set(h.id, cur ? { ...cur, status: h.status } : h);
    },
    async append(e) { journal.push(e); },
    async journal(limit) { return journal.slice(-limit).reverse(); },
    async state() { return state; },
    async setState(s) { state = s; },
    async active() { return active; },
    async version(id) { return versions.get(id) ?? null; },
    async putVersion(p) { if (!versions.has(p.id)) versions.set(p.id, p); },
    async setActive(p) { active = p; },
    dump() { return { hypotheses: [...hyps.values()], journal: [...journal], versions: [...versions.values()] }; },
  };
}
