import type { League } from "@/lib/picks/parse";
import { redisStore } from "@/lib/picks/learning/store";
import type { SizingState } from "@/lib/picks/learning/review";
import type { Summary } from "@/lib/picks/learning/model";
import { loadOps } from "@/lib/picks/ops";
import Link from "next/link";
import { type Market, href, whenEt } from "./ui";
import s from "./picks.module.css";

// Strategy review status: last reviewed, what changed and why, next review,
// scheduler health, and the append-only journal. Read-only.

export const VERDICT: { [k: string]: string } = { promote: "Promoted", retain: "Collecting", reject: "Rejected", report: "Report only" };

/** Which market a hypothesis belongs to, by its id (learning/model.ts). Staking, timing, parlays and PEM are about the spread bets. */
export function marketOf(id: string): Market {
  if (id.includes(":su:")) return "su";
  if (id.includes(":ou:")) return "ou";
  return "ats";
}

const EMPTY: { [k in Market]: string } = {
  ats: "",
  su: "Straight-up hypotheses register at the next Tuesday review: each method against the one in force, on later games.",
  ou: "Totals hypotheses register at the next Tuesday review: each refinement against both models agreeing, on later games.",
};

export async function LearningPanel({ league, market }: { league: League; market: Market }) {
  const [state, journal, ops, active] = await Promise.all([
    redisStore.state().catch(() => null),
    redisStore.journal(12).catch(() => []),
    loadOps().catch(() => ({})),
    redisStore.active(),
  ]);
  const mine = (state?.decisions ?? []).filter((d) => (d.id.startsWith(`${league}:`) || d.id.startsWith("both:")) && marketOf(d.id) === market);
  // The review status, journal and scheduler health are shared by every
  // market, so they show once, under Spreads; the others list their own hypotheses.
  const full = market === "ats";
  const health = Object.entries(ops);
  return (
    <section className={s.section} aria-labelledby="learning">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="learning">Strategy review</h2>
        <p className={s.p}>
          Runs once a week, Tuesday at 7am ET, compares the active
          policy with registered challengers on the same games, and only changes something when the evidence clears a
          fixed bar. The rule and Tier 2 are set right after it and hold all week; games that finish mid-week count from the next review. It can never raise a limit, change grading, or rewrite what was sent.
        </p>
      </div>
      {full && (
        <>
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
      <SizingBlock rows={state?.sizing} live={active.summary.split(";")[0]} next={state ? whenEt(state.nextReviewAt) : "the next pulse"} />
        </>
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
      {full ? (
        <>
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
        </>
      ) : (
        <p className={s.thin}>
          {mine.length === 0 ? `${EMPTY[market]} ` : ""}
          The review status, learning journal and scheduler health are under{" "}
          <Link href={href(league, "ats", "log")}>the Spreads learner log</Link>.
        </p>
      )}
      <p className={s.thin}>
        <Link href="/learning">Every section&apos;s learning on one page</Link>, Picks and Props.
      </p>
    </section>
  );
}

const signed = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(2)}u`;
const pct = (x: number) => `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const tone = (x: number) => (x > 0 ? s.pos : x < 0 ? s.neg : undefined);

/**
 * Stake sizing: each challenger replayed through the real limits against the
 * live sizing, the usable sample, and the one reason it can't switch yet.
 * The old no-limits estimate is shown only as a labelled footnote.
 */
function SizingBlock({ rows, live, next }: { rows?: SizingState[]; live: string; next: string }) {
  return (
    <details className={s.details} open>
      <summary>Stake sizing</summary>
      <div className={s.cardsInset}>
        <p className={s.thin}>
          {`Live: ${live}. Challengers are replayed send by send through the same limits (weekly budget, open bets, per game, the other sport's held plays), using only what was known at each 9am decision. Bets a policy couldn't afford count as zero.`}
        </p>
        {!rows?.length && <p className={s.thin}>{`No sizing comparison yet. It starts with the review on ${next}.`}</p>}
        {rows?.map((r) => (
          <SizingCard key={r.id} r={r} next={next} />
        ))}
      </div>
    </details>
  );
}

function SizingCard({ r, next }: { r: SizingState; next: string }) {
  const rowsOf = (label: string, f: (x: Summary) => string, raw?: (x: Summary) => number) => (
    <tr>
      <td>{label}</td>
      <td className={`${s.num} ${raw && r.challenger ? (tone(raw(r.challenger)) ?? "") : ""}`}>{r.challenger ? f(r.challenger) : "-"}</td>
      <td className={`${s.num} ${raw && r.incumbent ? (tone(raw(r.incumbent)) ?? "") : ""}`}>{r.incumbent ? f(r.incumbent) : "-"}</td>
    </tr>
  );
  const v = r.view;
  const promotable = r.verdict === "promote";
  return (
    <div style={{ margin: "14px 0" }}>
      <b>{r.label}</b> <span className={s.statusChip}>{promotable ? "Clears the bar" : r.verdict === "reject" ? "Rejected" : "Collecting"}</span>
      <dl className={s.strip} aria-label="Sizing sample" style={{ marginTop: 8 }}>
        <div>
          <dt>Usable sample</dt>
          <dd className={s.num}>{`${r.n} bets · ${r.weeks} wk`}</dd>
        </div>
        <div>
          <dt>Since</dt>
          <dd className={s.num}>{v.since ? whenEt(v.since) : "first recorded send"}</dd>
        </div>
        <div>
          <dt>Weekly t</dt>
          <dd className={s.num}>{r.t === null ? "-" : `${r.t} (needs ${r.tNeeded !== null && Number.isFinite(r.tNeeded) ? r.tNeeded : "2+ wk"})`}</dd>
        </div>
        <div>
          <dt>Next review</dt>
          <dd className={s.num}>{next}</dd>
        </div>
      </dl>
      {r.challenger && r.incumbent && (
        <table className={s.table} style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>After limits</th>
              <th>Challenger</th>
              <th>Live</th>
            </tr>
          </thead>
          <tbody>
            {rowsOf("Net", (x) => signed(x.units), (x) => x.units)}
            {rowsOf("Risked", (x) => `${x.risked.toFixed(2)}u`)}
            {rowsOf("Return on risk", (x) => pct(x.roi), (x) => x.roi)}
            {rowsOf("Max drawdown", (x) => `${x.drawdown.toFixed(2)}u`)}
            {rowsOf("Bets placed", (x) => String(x.bets))}
            <tr>
              <td>Refused / cut by limits</td>
              <td className={s.num}>{`${v.refused.challenger} / ${v.cut.challenger}`}</td>
              <td className={s.num}>{`${v.refused.incumbent} / ${v.cut.incumbent}`}</td>
            </tr>
          </tbody>
        </table>
      )}
      <p className={s.p} style={{ marginTop: 8 }}>
        <b>{promotable ? "Why it would switch: " : "Why it can't switch yet: "}</b>
        {r.why}
      </p>
      {(v.unsettled > 0 || v.restartedAfter) && (
        <p className={s.thin}>
          {[v.unsettled ? `${v.unsettled} replayed bets still waiting on a final.` : "", v.restartedAfter ? `Sample restarted after a gap: ${v.restartedAfter}.` : ""].filter(Boolean).join(" ")}
        </p>
      )}
      {v.unconstrained && (
        <p className={s.thin}>
          {`Old estimate, limits not applied (display only, never used to switch): ${signed(v.unconstrained.challenger.units)} vs ${signed(v.unconstrained.incumbent.units)} on ${v.unconstrained.n} sent bets.`}
        </p>
      )}
    </div>
  );
}
