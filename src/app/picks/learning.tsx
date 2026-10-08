import type { League } from "@/lib/picks/parse";
import { redisStore } from "@/lib/picks/learning/store";
import { loadOps } from "@/lib/picks/ops";
import { whenEt } from "./ui";
import s from "./picks.module.css";

// Strategy review status: last reviewed, what changed and why, next review,
// scheduler health, and the append-only journal. Read-only.

const VERDICT: { [k: string]: string } = { promote: "Promoted", retain: "Collecting", reject: "Rejected", report: "Report only" };

export async function LearningPanel({ league }: { league: League }) {
  const [state, journal, ops, active] = await Promise.all([
    redisStore.state().catch(() => null),
    redisStore.journal(12).catch(() => []),
    loadOps().catch(() => ({})),
    redisStore.active(),
  ]);
  const mine = (state?.decisions ?? []).filter((d) => d.id.startsWith(`${league}:`) || d.id.startsWith("both:"));
  const health = Object.entries(ops);
  return (
    <section className={s.section} aria-labelledby="learning">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="learning">Strategy review</h2>
        <p className={s.p}>
          Runs on its own schedule (Tuesday mornings, and early when 15+ newly settled games arrive), compares the active
          policy with registered challengers on the same games, and only changes something when the evidence clears a
          fixed bar. It can never raise a limit, change grading, or rewrite what was sent.
        </p>
      </div>
      <dl className={s.strip} aria-label="Review status">
        <div>
          <dt>Last reviewed</dt>
          <dd className={s.num}>{state ? whenEt(state.lastReviewAt) : "not yet"}</dd>
        </div>
        <div>
          <dt>What changed</dt>
          <dd>{state?.lastOutcome ?? "nothing yet"}</dd>
        </div>
        <div>
          <dt>Active policy</dt>
          <dd className={s.num}>{active.id}</dd>
        </div>
        <div>
          <dt>Next review</dt>
          <dd className={s.num}>{state ? whenEt(state.nextReviewAt) : "next pulse"}</dd>
        </div>
      </dl>
      {state && (
        <p className={s.p}>
          <b>Why: </b>
          {journal.find((j) => j.kind === "review")?.why ?? state.lastOutcome}
        </p>
      )}
      <p className={s.thin}>{active.summary}</p>
      {state?.calibration && (
        <p className={s.thin}>
          {state.calibration.n
            ? `Probability check: ${state.calibration.n} settled issued bets, mean estimate ${(state.calibration.meanP * 100).toFixed(1)}%, actual ${(state.calibration.winRate * 100).toFixed(1)}%. Stakes may only size up once 50+ bets agree within 5 points.`
            : "Probability check: no settled issued bets with a stored estimate yet, so the estimates are unproven and stakes can't size up."}
        </p>
      )}
      {mine.length > 0 && (
        <details className={s.details}>
          <summary>{`Hypotheses being tested (${mine.length})`}</summary>
          <ul className={`${s.journal} ${s.cardsInset}`}>
            {mine.map((d) => (
              <li key={d.id}>
                <b>{d.label}</b> <span className={s.statusChip}>{VERDICT[d.verdict] ?? d.verdict}</span>
                <div className={s.thin}>{d.why}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className={s.details}>
        <summary>{`Learning journal (latest ${journal.length})`}</summary>
        <ul className={`${s.journal} ${s.cardsInset}`}>
          {journal.length === 0 && <li>Nothing recorded yet.</li>}
          {journal.map((j, i) => (
            <li key={`${j.at}-${i}`}>
              <div className={s.thin}>{`${whenEt(j.at)} · ${j.kind}`}</div>
              <b>{j.title}</b>
              <div>{j.why}</div>
              {j.rollbackTarget && <div className={s.thin}>{`Rollback target: ${j.rollbackTarget}`}</div>}
            </li>
          ))}
        </ul>
      </details>
      <details className={s.details}>
        <summary>Scheduler health</summary>
        <ul className={`${s.journal} ${s.cardsInset}`}>
          {health.length === 0 && <li>No scheduled runs recorded yet.</li>}
          {health.map(([name, h]) => (
            <li key={name}>
              <b>{name}</b>
              <div className={s.thin}>{`last success ${whenEt(h.lastSuccess)} · next expected ${whenEt(h.nextExpected)}${h.lastFailure ? ` · last failure ${whenEt(h.lastFailure)}: ${h.lastError}` : ""}`}</div>
              {h.detail && <div className={s.thin}>{h.detail}</div>}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
