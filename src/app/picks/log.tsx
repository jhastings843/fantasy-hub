// Picks' Learner log view: what the strategy reviews changed and why, in plain
// language, newest first, with the full review detail (sizing, hypotheses,
// scheduler health) one click down.
import type { League } from "@/lib/picks/parse";
import { redisStore } from "@/lib/picks/learning/store";
import type { JournalEntry } from "@/lib/picks/learning/review";
import { CutRanges, Hero, LearnerLog, TrackingProgress, type CutRow, type LogEntry } from "./board";
import { getPicksReport } from "@/lib/picks/report";
import { CRITERIA } from "@/lib/picks/learning/model";
import { ModelRecords } from "./model-records";
import { LearningPanel, OTHER, leagueOf, marketOf } from "./learning";
import Link from "next/link";
import { LEAGUE_NAME, href, whenEt, type Market } from "./ui";
import s from "./picks.module.css";

const KIND: { [k in JournalEntry["kind"]]?: LogEntry["kind"] } = {
  activate: "live",
  register: "new",
  rollback: "back",
  retire: "back",
  reject: "back",
  review: "test",
  retain: "test",
  proposal: "test",
};

const MARKET_NAME: { [m in Market]: string } = { ats: "Spreads", su: "Straight up", ou: "Totals" };
/** What each market's ideas are measured against, in a sentence. */
const AGAINST: { [m in Market]: string } = {
  ats: "Each spread idea is tested against the rule in force, on games it saw after registering.",
  su: "Each way of picking winners is tested against the method in force (now the Vegas favorite or the models' average).",
  ou: "Each totals idea (over only, under only, both models 2+ or more off the number) is tested against plain \"both models agree\", on games archived after it registered.",
};
/** A journal line belongs to a market when its words say so; spreads takes the rest. */
const mentions = (m: Market, t: string) => (m === "ou" ? /total|over|under/i.test(t) : m === "su" ? /straight|winner|su:/i.test(t) : !/total|straight up/i.test(t));

/** What a market's ideas are measured against, in a few words (the hero line). */
const AGAINST_SHORT: { [m in Market]: string } = { ats: "the rule in force", su: "the method in force", ou: "plain both-agree" };

/**
 * A review's reason in "has now · needs" form (Jack, 2026-11-03), e.g.
 * "not better on matched games: mean -0.04u, t=-0.5, needs 1.645" ->
 * "Has −0.04u a game vs the rule, t −0.5 · Needs t 1.645+". Other reasons pass through.
 */
export function plainWhy(why: string, against: string): string {
  const w = why.replace(/^insufficient evidence: /, "");
  const m = /^not better on matched games: mean (-?[\d.]+)u, t=(-?[\d.]+)(?: \(([^)]*)\))?, needs ([\d.]+)$/.exec(w);
  if (!m) return w;
  const mean = Number(m[1]);
  const t = m[2].replace("-", "−");
  return `Has ${mean >= 0 ? "+" : "−"}${Math.abs(mean)}u a game vs ${against}, t ${t}${m[3] ? ` (${m[3]})` : ""} · Needs t ${m[4]}+`;
}

export async function PicksLog({ league, market }: { league: League; market: Market }) {
  const [journal, state, report] = await Promise.all([redisStore.journal(60).catch(() => []), redisStore.state().catch(() => null), getPicksReport(league).catch(() => null)]);
  const rep = report?.value ?? null;
  // Every cut this market tracks, from the same report the board reads; straight up has no price, so no break-even.
  const cuts: CutRow[] = !rep
    ? []
    : market === "ats"
      ? rep.strategies.cuts.filter((c) => c.record.w + c.record.l > 0).map((c) => ({ label: c.label, w: c.record.w, l: c.record.l, p: c.record.p, be: 0.524 }))
      : market === "ou"
        ? rep.totals.backtest.cuts.filter((c) => c.record.w + c.record.l > 0).map((c) => ({ label: c.label, w: c.record.w, l: c.record.l, p: c.record.p, be: 0.524 }))
        : [...rep.su.methods, ...rep.su.bands].filter((m) => m.w + m.l > 0).map((m) => ({ label: m.label, w: m.w, l: m.l }));
  const ideas = (state?.decisions ?? []).filter((d) => (d.id.startsWith(`${league}:`) || d.id.startsWith("both:")) && marketOf(d.id) === market);
  const entries: LogEntry[] = journal.flatMap((j) => {
    const text = `${j.title} ${j.why}`;
    const lg = leagueOf(text);
    if (!KIND[j.kind] || !mentions(market, text) || (lg !== "both" && lg !== league)) return [];
    return [{ at: j.at, kind: KIND[j.kind]!, title: lg === "both" ? `Shared with ${OTHER[league]} · ${j.title}` : j.title, detail: j.why }];
  });
  return (
    <section className={s.section} aria-labelledby="picks-log">
      <Hero
        eyebrow="What changed, and why"
        title={<span id="picks-log">Learner log</span>}
        sub={`Every idea counts only games after it was first tracked. To go live it needs ${CRITERIA.MIN_OPPORTUNITIES}+ games over ${CRITERIA.MIN_WEEKS}+ weeks and to beat ${AGAINST_SHORT[market]} at t ${CRITERIA.MIN_T}+ (t is how sure the gain is real; ${CRITERIA.MIN_T} is about a 1-in-20 chance it's luck). One that loses to it just as clearly is dropped; a live one comes back off if it starts losing. Next review ${state ? whenEt(state.nextReviewAt) : "the next slate review"}.`}
      />
      {rep && <ModelRecords league={league} market={market} report={rep} />}
      <TrackingProgress
        rows={ideas
          .map((d) => {
            // Reviews before 2026-10-22 saved only the sentence ("10 of 30 settled matched games, 1 of 3 weeks"; "n=12" on report-only ideas).
            const n = d.n ?? Number(/(\d+) of \d+ settled/.exec(d.why)?.[1] ?? /n=(\d+)/.exec(d.why)?.[1] ?? 0);
            const wk = d.weeks ?? (/(\d+) of \d+ weeks?/.exec(d.why) ? Number(/(\d+) of \d+ weeks?/.exec(d.why)![1]) : undefined);
            const counted = /^insufficient evidence: [^;]*$/.test(d.why);
            const inForce = d.why === "this is the method in force";
            return {
              id: d.id,
              label: d.id.startsWith("both:") ? `${d.label} (shared with ${OTHER[league]})` : d.label,
              // "promote" means it passed; only the idea the review actually switched in is live (one per review, and validation can still refuse it).
              // Rejected ideas (lost at the same t a winner needs) list as retired, collapsed; a later review can bring one back.
              status: inForce ? ("inforce" as const) : (state?.activations ? state.activations.some((x) => x.hypothesis === d.id) : d.id === state?.activatedFrom) ? ("live" as const) : d.verdict === "report" ? ("report" as const) : d.verdict === "reject" ? ("retired" as const) : ("testing" as const),
              games: n,
              needGames: CRITERIA.MIN_OPPORTUNITIES,
              weeks: wk,
              needWeeks: CRITERIA.MIN_WEEKS,
              result: d.t !== undefined ? `t ${d.t.toFixed(2)} of ${CRITERIA.MIN_T}` : undefined,
              note: inForce ? "The baseline: every other way of picking winners is measured against this one." : counted ? undefined : plainWhy(d.why, AGAINST_SHORT[market]),
            };
          })}
        sub={`${MARKET_NAME[market]} ideas, measured against the rule in force on games after each registered. Counts update at each review, the morning after every slate.`}
        empty={`${MARKET_NAME[market]} ideas register at the next review.`}
      />
      <div className={s.section}>
        <h3 className={s.h2}>Latest</h3>
        <LearnerLog entries={entries.slice(0, 20)} empty="Nothing recorded yet. The first entries come from the next review." />
      </div>
      {market === "ats" ? (
        // Spreads' every-cut table already lives on Research; repeating it here read as a second, different list.
        <p className={s.p}>
          {`${AGAINST[market]} Every cut's record and range is on `}
          <Link href={href(league, "ats", "research")}>Research</Link>.
        </p>
      ) : (
        <div className={s.section}>
          <h3 className={s.h2}>Cut comparisons</h3>
          <p className={s.p}>{AGAINST[market]}</p>
          <CutRanges title={`${LEAGUE_NAME[league]} ${MARKET_NAME[market].toLowerCase()}`} rows={cuts} open />
        </div>
      )}
      <LearningPanel league={league} market={market} />
    </section>
  );
}
