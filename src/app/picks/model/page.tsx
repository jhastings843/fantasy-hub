import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { getPicksReport } from "@/lib/picks/report";
import { redisStore } from "@/lib/picks/learning/store";
import { MAX_STAKE, MIN_STAKE, OUTSTANDING_CAP, PER_GAME_CAP, WEEKLY_CAP } from "@/lib/picks/limits";
import { PRIOR_GAMES } from "@/lib/picks/staking";
import { CRITERIA } from "@/lib/picks/learning/model";
import { leagueOf } from "../learning";
import { OurSpreadCard } from "../ours";
import { CfbModelCard } from "../cfb-model";
import { Hero, Stats } from "../board";
import { LEAGUE_NAME, href, rec, units, whenEt } from "../ui";
import s from "../picks.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "How Picks Work · Hobby Hub",
  description: "How the picks are made: the inputs, the rule, the price check, the stakes and limits, how it learns, and how it has done.",
};

// /picks/model?l=nfl|cfb: the whole method on one page, every number read
// from the live report and the review journal (nothing typed in by hand).
export default async function ModelPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  const league = q.l === "cfb" ? "cfb" : "nfl";
  const L = LEAGUE_NAME[league];
  const [rep, journal, state, active] = await Promise.all([
    getPicksReport(league).catch(() => null),
    redisStore.journal(60).catch(() => []),
    redisStore.state().catch(() => null),
    redisStore.active().catch(() => null),
  ]);
  const r = rep?.value ?? null;
  // Real changes first (went live, rolled back, retired); new ideas only fill the list when there are few.
  const ours = journal.filter((j) => {
    const lg = leagueOf(`${j.title} ${j.why}`);
    return lg === "both" || lg === league;
  });
  const changed = ours.filter((j) => ["activate", "rollback", "retire"].includes(j.kind));
  const mine = [...changed, ...ours.filter((j) => j.kind === "register")].slice(0, Math.max(5, Math.min(changed.length, 8)));
  const back = (
    <nav className={s.chips} aria-label="Sport">
      {(["nfl", "cfb"] as const).map((l) => (
        <Link key={l} className={s.chip} href={`/picks/model?l=${l}`} aria-current={l === league ? "page" : undefined}>
          {LEAGUE_NAME[l]}
        </Link>
      ))}
      <Link className={s.chip} href={href(league, "ats", "week")}>
        {`Back to ${L} picks`}
      </Link>
    </nav>
  );
  if (!r) {
    return (
      <main className={s.page}>
        <div className={s.wrap}>
          {back}
          <p className={s.calm}>The picks report isn&apos;t available right now. Try again in a few minutes.</p>
        </div>
      </main>
    );
  }
  const st = r.strategies;
  const { t1, t2, totals } = r.units.byTier;
  const spreads = { w: t1.w + t2.w, l: t1.l + t2.l, p: t1.p + t2.p, units: t1.units + t2.units };
  const su = r.live.reduce((t, w) => ({ w: t.w + w.su.w, l: t.l + w.su.l }), { w: 0, l: 0 });
  const sentClv = r.clv.plays.find((x) => x.id !== "ou" && x.n > 0);
  const steps: { k: string; v: string }[] = [
    { k: "Inputs", v: `Sam's and David Sasser's spread and total for every game${league === "cfb" ? ", plus PEM's card and John Harris's sheet as sources the review can make vetoes" : ""}. The current line and price come from DraftKings via ESPN, shopped against FanDuel and Fanatics.` },
    { k: "The read", v: "Each model is compared with the line. When both are on the same side, the game gets an average edge (how many more points that side gets than the models think it needs)." },
    { k: "The rule", v: st.rule ? `Only games in the rule bet: "${st.rule.label}", ${rec(st.rule.record)} on the games it picked${st.second ? `, plus Tier 2 "${st.second.label}" (${rec(st.second.record)} on the games it adds)` : ""}. Chosen as the cut with the highest low end of its 90% range among cuts with 10+ decided games.` : "No cut clears the bar right now, so no spread bets issue." },
    { k: "Win chance", v: `The tier's record pulled toward 50% as if it had ${PRIOR_GAMES} extra games at a coin flip. An estimate, not a calibrated probability.` },
    { k: "Price check", v: "A bet needs a price where that win chance still beats the juice. Anything sizing under 1u is not a bet." },
    { k: "Stakes", v: active ? `${active.summary.split(";")[0]}.` : "Set by the active policy." },
    { k: "Limits", v: `${MIN_STAKE}u to ${MAX_STAKE}u a bet, ${PER_GAME_CAP}u a game, ${WEEKLY_CAP}u a week across NFL and college, ${OUTSTANDING_CAP}u open at once. The biggest edges get room first.` },
    { k: "Timing", v: "Every game is an early look until 9am ET on its own game day; then it is sent at that morning's price." },
    { k: "Learning", v: `The review runs the morning after each slate. A new idea needs ${CRITERIA.MIN_OPPORTUNITIES}+ games over ${CRITERIA.MIN_WEEKS}+ weeks, recorded after it was registered, and a clear edge over what is live. Each part changes at most once per NFL week, with automatic rollback.` },
  ];
  return (
    <main className={s.page}>
      <div className={s.wrap}>
        {back}
        <Hero eyebrow={`${L} ${r.season} · the method`} title="How our picks work" sub="Every step from the two models to a sent bet, and how it has done. All numbers come from the same report the board uses." />
        <Stats
          label="How it has done"
          items={[
            { k: `${L} spreads`, v: spreads.w + spreads.l + spreads.p ? units(spreads.units) : "0-0", sub: spreads.w + spreads.l + spreads.p ? `${rec(spreads)} as sent` : "no bets settled", tone: spreads.w + spreads.l ? (spreads.units >= 0 ? "up" : "down") : undefined },
            { k: `${L} totals`, v: totals.w + totals.l + totals.p ? units(totals.units) : "0-0", sub: totals.w + totals.l + totals.p ? `${rec(totals)} as sent` : "no bets settled", tone: totals.w + totals.l ? (totals.units >= 0 ? "up" : "down") : undefined },
            { k: `${L} straight up`, v: su.w + su.l ? `${su.w}-${su.l}` : "0-0", sub: "winners picked, no stakes" },
            { k: "Vs the closing line", v: sentClv ? `${sentClv.avg > 0 ? "+" : ""}${sentClv.avg.toFixed(2)} pts` : "·", sub: sentClv ? `${sentClv.n} sent bets with a close` : "no closes yet", small: true },
          ]}
        />
        <section className={s.section} aria-labelledby="steps">
          <h2 className={s.h2} id="steps">From the models to a bet</h2>
          <div className={s.curveBox}>
            <dl className={s.kv}>
              {steps.map((x, i) => (
                <Fragment key={x.k}>
                  <dt>{`${i + 1}. ${x.k}`}</dt>
                  <dd>{x.v}</dd>
                </Fragment>
              ))}
            </dl>
          </div>
          <p className={s.thin}>
            {`Next review ${state ? whenEt(state.nextReviewAt) : "after the next slate"}. Every cut's record is on `}
            <Link href={href(league, "ats", "research")}>Research</Link>
            {"; the review's own log is under "}
            <Link href={href(league, "ats", "log")}>Learner log</Link>.
          </p>
        </section>
        <section className={s.section} aria-labelledby="changes">
          <h2 className={s.h2} id="changes">Recent changes</h2>
          {mine.length ? (
            <ul className={`${s.journal} ${s.cardsInset}`}>
              {mine.map((j, i) => (
                <li key={`${j.at}-${i}`}>
                  <div className={s.thin}>{`${whenEt(j.at)} · ${j.kind}`}</div>
                  <b>{j.title}</b>
                  <div>{j.why}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className={s.calm}>No changes recorded yet.</p>
          )}
        </section>
        <section className={s.section} aria-labelledby="ours">
          <h2 className={s.h2} id="ours">{league === "nfl" ? "Our own NFL spread model" : "Our own college model"}</h2>
          <p className={s.p}>Built and graded here, separate from Sam and David. It is tracked only and never stakes until it clears its own gate.</p>
          {league === "nfl" ? <OurSpreadCard season={r.season} /> : <CfbModelCard season={r.season} />}
        </section>
      </div>
    </main>
  );
}
