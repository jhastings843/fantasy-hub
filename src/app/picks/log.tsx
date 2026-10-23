// Picks' Learner log view: what the Tuesday review changed and why, in plain
// language, newest first, with the full review detail (sizing, hypotheses,
// scheduler health) one click down.
import type { League } from "@/lib/picks/parse";
import { redisStore } from "@/lib/picks/learning/store";
import type { JournalEntry } from "@/lib/picks/learning/review";
import { Background, GoLiveSteps, Hero, LearnerLog, TrackingProgress, type LogEntry } from "./board";
import { CRITERIA } from "@/lib/picks/learning/model";
import { LearningPanel, OTHER, VERDICT, leagueOf, marketOf } from "./learning";
import { whenEt, type Market } from "./ui";
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

export async function PicksLog({ league, market }: { league: League; market: Market }) {
  const [journal, state] = await Promise.all([redisStore.journal(60).catch(() => []), redisStore.state().catch(() => null)]);
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
        sub="Every idea is tested on games after it was first tracked. It goes live only when it clears the bar, and comes back off if it starts losing."
      />
      <GoLiveSteps games="30+ games over 3+ weeks, judged on games it saw after registering." />
      <TrackingProgress
        rows={ideas
          .filter((d) => d.verdict !== "reject")
          .map((d) => {
            // Reviews before 2026-10-22 saved only the sentence ("10 of 30 settled matched games, 1 of 3 weeks"; "n=12" on report-only ideas).
            const n = d.n ?? Number(/(\d+) of \d+ settled/.exec(d.why)?.[1] ?? /n=(\d+)/.exec(d.why)?.[1] ?? 0);
            const wk = d.weeks ?? (/(\d+) of \d+ weeks?/.exec(d.why) ? Number(/(\d+) of \d+ weeks?/.exec(d.why)![1]) : undefined);
            const counted = /^insufficient evidence: [^;]*$/.test(d.why);
            return {
              id: d.id,
              label: d.id.startsWith("both:") ? `${d.label} (shared with ${OTHER[league]})` : d.label,
              // "promote" means it passed; only the idea the review actually switched in is live (one per review, and validation can still refuse it).
              status: d.id === state?.activatedFrom ? ("live" as const) : d.verdict === "report" ? ("report" as const) : ("testing" as const),
              games: n,
              needGames: CRITERIA.MIN_OPPORTUNITIES,
              weeks: wk,
              needWeeks: CRITERIA.MIN_WEEKS,
              result: d.t !== undefined ? `t ${d.t.toFixed(2)} of ${CRITERIA.MIN_T}` : undefined,
              note: counted ? undefined : d.why.replace(/^insufficient evidence: /, ""),
            };
          })}
        sub={`${MARKET_NAME[market]} ideas, measured against the rule in force on games after each registered. Counts update at each Tuesday review.`}
        empty={`${MARKET_NAME[market]} ideas register at the next Tuesday review.`}
      />
      <div className={s.section}>
        <div className={s.sectionHead}>
          <h3 className={s.h2}>{`What ${MARKET_NAME[market].toLowerCase()} is testing`}</h3>
          <p className={s.p}>{AGAINST[market]}</p>
        </div>
        {ideas.length ? (
          <ol className={s.log}>
            {ideas.map((d) => (
              <li key={d.id} className={s.logRow}>
                <span className={s.logWhen}>{d.id.startsWith("both:") ? `Shared with ${OTHER[league]}` : MARKET_NAME[market]}</span>
                <span className={`${s.logKind} ${d.id === state?.activatedFrom ? s.kLive : d.verdict === "reject" ? s.kBack : ""}`}>{VERDICT[d.verdict] ?? d.verdict}</span>
                <span className={s.logText}>
                  <b>{d.label}</b>
                  <span>{d.why}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className={s.calm}>{`${MARKET_NAME[market]} ideas register at the next Tuesday review; from then on only later games count toward them.`}</p>
        )}
      </div>
      <div className={s.section}>
        <h3 className={s.h2}>Latest</h3>
        <LearnerLog entries={entries.slice(0, 20)} empty="Nothing recorded yet. The first entries come from the next Tuesday review." />
      </div>
      <p className={s.p}>{`Next review: ${state ? whenEt(state.nextReviewAt) : "Tuesday 7am ET"}.`}</p>
      <Background title="Review details: stake sizing, every idea being tested, scheduler health">
        <LearningPanel league={league} market={market} />
      </Background>
    </section>
  );
}
