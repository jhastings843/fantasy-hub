// One strategy review, against a store: memory in tests and the rehearsal,
// Redis in production (store.ts). Bounded: at most one activation per
// review, no edits to definitions, nothing it writes can loosen a limit.

import type { League } from "../parse";
import type { CutTest } from "../engine";
import type { ForecastSnapshot } from "../forecasts";
import type { IssuedRecord } from "../issued";
import { DEFAULT_POLICY, type PicksPolicy } from "../policy";
import {
  CRITERIA,
  type Comparison,
  type Decision,
  type Evaluation,
  type Hypothesis,
  applyPromotion,
  calibration,
  compare,
  decide,
  evaluate,
  isIncumbentStaking,
  issuedBets,
  laterHypotheses,
  opportunities,
  propose,
  scoreCut,
  seedHypotheses,
  shouldRollBack,
  validate,
  type ValidationInput,
} from "./model";
import { payout } from "../units";
import { stakeFor } from "../staking";

export interface JournalEntry {
  at: string;
  kind: "review" | "register" | "activate" | "retain" | "reject" | "retire" | "rollback" | "proposal" | "ui" | "ops";
  title: string;
  why: string;
  policyBefore?: string;
  policyAfter?: string;
  rollbackTarget?: string;
  evidence?: unknown;
}

export interface ReviewState {
  lastReviewAt: string;
  lastOutcome: string;
  nextReviewAt: string;
  settledOpportunities: number;
  activePolicyId: string;
  /** The policy the active one replaced, and when: what a rollback returns to. */
  previousPolicyId?: string;
  activatedAt?: string;
  activatedFrom?: string;
  /** Every hypothesis's verdict at the last review, for the page. */
  decisions?: { id: string; label: string; verdict: string; why: string }[];
  calibration?: { n: number; meanP: number; winRate: number; brier: number };
}

export interface LearningStore {
  hypotheses(): Promise<Hypothesis[]>;
  /** Insert (never overwrites a definition) or move status. */
  putHypothesis(h: Hypothesis): Promise<void>;
  append(e: JournalEntry): Promise<void>;
  journal(limit: number): Promise<JournalEntry[]>;
  state(): Promise<ReviewState | null>;
  setState(s: ReviewState): Promise<void>;
  active(): Promise<PicksPolicy>;
  version(id: string): Promise<PicksPolicy | null>;
  /** Store a version (never overwrites one). */
  putVersion(p: PicksPolicy): Promise<void>;
  setActive(p: PicksPolicy): Promise<void>;
}

export interface ReviewInputs {
  now: Date;
  forecasts: { league: League; snaps: ForecastSnapshot[] }[];
  finals: { league: League; map: Map<string, { home: number; away: number }> }[];
  closes: { league: League; map: Map<string, number | null> }[];
  issued: { league: League; records: IssuedRecord[] }[];
  ruleTest: { nfl?: CutTest; cfb?: CutTest };
  /** Replays this week's card under a policy (the caller knows how to compose). */
  replay(policy: PicksPolicy): Promise<ValidationInput["replay"]>;
  /** A stable summary of issued-history grading, to prove a policy change rewrites nothing. */
  history(): Promise<string>;
}

export interface ReviewResult {
  decisions: Decision[];
  evaluations: Evaluation[];
  activated?: { from: string; to: string; hypothesis: string };
  rolledBack?: { from: string; to: string; why: string };
  registered: string[];
  journal: JournalEntry[];
  state: ReviewState;
}

/** Next Tuesday, first hourly pulse (7am ET; 11:00 UTC in EDT), well before the 5:30pm card. */
export function nextReviewAt(now: Date): string {
  const d = new Date(now);
  d.setUTCHours(11, 0, 0, 0);
  // The next Tuesday 11:00 UTC strictly after now (today's, if it is still ahead).
  while (d.getUTCDay() !== 2 || d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

export async function runReview(store: LearningStore, x: ReviewInputs, opts: { dryRun?: boolean; reason?: string } = {}): Promise<ReviewResult> {
  const at = x.now.toISOString();
  const journal: JournalEntry[] = [];
  const write = async (e: JournalEntry) => {
    journal.push(e);
    if (!opts.dryRun) await store.append(e);
  };

  // Register the launch set the first time, before any of its sample exists.
  let hs = await store.hypotheses();
  const registered: string[] = [];
  if (!hs.length) {
    hs = seedHypotheses(at);
    for (const h of hs) if (!opts.dryRun) await store.putHypothesis(h);
    registered.push(...hs.map((h) => h.id));
    await write({ at, kind: "register", title: `Registered ${hs.length} hypotheses`, why: "Launch set: each research refinement vs its parent, the flat-risk and eighth-Kelly staking challengers, and report-only questions (timing, parlays, straight-up method, PEM). Their samples start now." });
  }

  // Hypotheses added after launch, registered now so their sample starts now.
  for (const h of laterHypotheses(at).filter((y) => !hs.some((z) => z.id === y.id))) {
    if (!opts.dryRun) await store.putHypothesis(h);
    hs = [...hs, h];
    registered.push(h.id);
    await write({ at, kind: "register", title: `Registered ${h.id}`, why: h.origin });
  }

  // Settle and score.
  const opps = x.forecasts.flatMap((f) =>
    opportunities(f.league, f.snaps, x.finals.find((m) => m.league === f.league)?.map ?? new Map(), x.closes.find((m) => m.league === f.league)?.map ?? new Map()),
  );
  const settled = opps.filter((o) => o.final).length;
  const bets = x.issued.flatMap((i) => issuedBets(i.league, i.records, x.finals.find((m) => m.league === i.league)?.map ?? new Map()));
  const cal = calibration(bets);
  let active = await store.active();
  const prev = await store.state();
  const historyBefore = await x.history();

  // Rollback check on the policy in force, before anything new.
  let rolledBack: ReviewResult["rolledBack"];
  if (prev?.previousPolicyId && prev.activatedAt && active.id !== prev.previousPolicyId) {
    const stored = await store.version(prev.previousPolicyId);
    // A missing version falls back to the default (flat 1u), never to p1's
    // larger stakes: those come back only through the calibration gate.
    const before = stored ?? DEFAULT_POLICY;
    const missingNote = stored ? "" : ` (previous version ${prev.previousPolicyId} not on file; would return to the default ${DEFAULT_POLICY.id})`;
    const since = opps.filter((o) => o.first.at >= prev.activatedAt!);
    let c: Comparison | null = null;
    const newCut = active.atsCandidates.find((id) => !before.atsCandidates.includes(id));
    if (newCut && prev.activatedFrom) {
      const h = hs.find((y) => y.id === prev.activatedFrom);
      if (h?.definition.kind === "ats-cut") {
        const d = h.definition;
        const own = since.filter((o) => o.league === h.league);
        c = compare(own.map((o) => ({ o, ch: scoreCut(d.test, o.first, o), inc: scoreCut(d.parentTest, o.first, o) })));
      }
    } else if (JSON.stringify(active.staking) !== JSON.stringify(before.staking)) {
      const recent = bets.filter((b) => b.at >= prev.activatedAt!);
      c = compare(
        recent.map((b) => ({
          o: { week: b.week, first: { at: b.at }, final: { home: 0, away: 0 } } as never,
          ch: { bet: true, units: payout(b.result, stakeFor(b.p, b.price, active.staking), b.price), risked: stakeFor(b.p, b.price, active.staking) },
          inc: { bet: true, units: payout(b.result, stakeFor(b.p, b.price, before.staking), b.price), risked: stakeFor(b.p, b.price, before.staking) },
        })),
      );
    }
    const fails = validate({ policy: active, replay: await x.replay(active), historyBefore, historyAfter: historyBefore });
    const reason = shouldRollBack(c, fails);
    const why = reason ? `${reason}${missingNote}` : null;
    if (why) {
      rolledBack = { from: active.id, to: before.id, why };
      await write({ at, kind: "rollback", title: `Rolled back ${active.id} to ${before.id}`, why, policyBefore: active.id, policyAfter: before.id, evidence: c });
      if (!opts.dryRun) await store.setActive(before);
      active = before;
    }
  }

  // A staking challenger that matches the live sizing is the incumbent now
  // (flat 1u became live on 2026-10-10): retire it rather than compare it
  // with itself.
  for (const h of hs.filter((y) => y.status === "collecting" && isIncumbentStaking(y, active))) {
    if (!opts.dryRun) await store.putHypothesis({ ...h, status: "retired" });
    hs = hs.map((y) => (y.id === h.id ? { ...y, status: "retired" as const } : y));
    await write({ at, kind: "retire", title: `Retired ${h.id}`, why: `${active.id} already sizes this way; it is the incumbent, not a challenger.` });
  }

  // Evaluate and decide.
  const collecting = hs.filter((h) => h.status === "collecting");
  const evaluations = collecting.map((h) => evaluate(h, { opps, issued: bets, active, ruleTest: x.ruleTest }));
  const decisions = collecting.map((h, i) => decide(h, evaluations[i], { calibration: cal, active }));
  for (const d of decisions.filter((y) => y.verdict === "reject")) {
    const h = hs.find((y) => y.id === d.id)!;
    if (!opts.dryRun) await store.putHypothesis({ ...h, status: "rejected" });
    await write({ at, kind: "reject", title: `Rejected ${h.id}`, why: d.why, evidence: evaluations.find((e) => e.id === d.id)?.comparison });
  }

  // At most one activation per review: the strongest promotion that validates.
  let activated: ReviewResult["activated"];
  const promos = decisions
    .filter((y) => y.verdict === "promote")
    .map((y) => ({ y, t: evaluations.find((e) => e.id === y.id)?.comparison?.t ?? 0 }))
    .sort((a, b) => b.t - a.t);
  if (promos.length && !rolledBack) {
    const h = hs.find((y) => y.id === promos[0].y.id)!;
    // Ids are unique by time, so a rollback can never lead to a reused id.
    const next = applyPromotion(active, h, `p${at.replace(/[-:]/g, "").slice(0, 13)}`, at);
    const historyAfter = await x.history();
    const fails = validate({ policy: next, replay: await x.replay(next), historyBefore, historyAfter });
    if (fails.length) {
      await write({ at, kind: "retain", title: `Kept ${active.id}: ${h.id} failed validation`, why: fails.join("; "), evidence: evaluations.find((e) => e.id === h.id)?.comparison });
    } else {
      activated = { from: active.id, to: next.id, hypothesis: h.id };
      if (!opts.dryRun) {
        await store.putVersion(next);
        await store.setActive(next);
        await store.putHypothesis({ ...h, status: "promoted" });
      }
      await write({ at, kind: "activate", title: `Activated ${next.id} (${h.id})`, why: promos[0].y.why, policyBefore: active.id, policyAfter: next.id, rollbackTarget: active.id, evidence: evaluations.find((e) => e.id === h.id)?.comparison });
      active = next;
    }
  }

  // Bounded new proposals from the evidence, registered before their sample.
  const fresh = propose(hs, evaluations, at);
  for (const h of fresh) {
    if (!opts.dryRun) await store.putHypothesis(h);
    registered.push(h.id);
    await write({ at, kind: "proposal", title: `Registered ${h.id}`, why: h.origin });
  }

  const retained = decisions.filter((d) => d.verdict === "retain");
  const outcome = activated
    ? `activated ${activated.to}`
    : rolledBack
      ? `rolled back to ${rolledBack.to}`
      : `no change: kept ${active.id}`;
  const why = activated
    ? promos[0].y.why
    : rolledBack
      ? rolledBack.why
      : retained.length
        ? `${retained.length} hypotheses still collecting (closest: ${retained.map((d) => d.why).sort()[0]}). Settled matched games so far: ${settled}. Calibration: ${cal.n} settled issued bets, mean estimate ${cal.meanP}, win rate ${cal.winRate}.`
        : "nothing collecting met the criteria";
  const state: ReviewState = {
    lastReviewAt: at,
    lastOutcome: outcome,
    nextReviewAt: nextReviewAt(x.now),
    settledOpportunities: settled,
    activePolicyId: active.id,
    previousPolicyId: activated ? activated.from : rolledBack ? undefined : prev?.previousPolicyId,
    activatedAt: activated ? at : rolledBack ? undefined : prev?.activatedAt,
    activatedFrom: activated ? activated.hypothesis : rolledBack ? undefined : prev?.activatedFrom,
    decisions: decisions.map((d) => {
      const h = hs.find((y) => y.id === d.id)!;
      return { id: d.id, label: "label" in h.definition ? h.definition.label : d.id, verdict: d.verdict, why: d.why };
    }),
    calibration: { n: cal.n, meanP: cal.meanP, winRate: cal.winRate, brier: cal.brier },
  };
  await write({ at, kind: "review", title: `Review (${opts.reason ?? "scheduled"}): ${outcome}`, why, policyAfter: active.id });
  if (!opts.dryRun) await store.setState(state);
  return { decisions, evaluations, activated, rolledBack, registered, journal, state };
}

export { CRITERIA };
