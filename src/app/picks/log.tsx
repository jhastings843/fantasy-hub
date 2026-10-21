// Picks' Learner log view: what the Tuesday review changed and why, in plain
// language, newest first, with the full review detail (sizing, hypotheses,
// scheduler health) one click down.
import type { League } from "@/lib/picks/parse";
import { redisStore } from "@/lib/picks/learning/store";
import type { JournalEntry } from "@/lib/picks/learning/review";
import { Background, GoLiveSteps, Hero, LearnerLog, type LogEntry } from "./board";
import { LearningPanel } from "./learning";
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

export async function PicksLog({ league, market }: { league: League; market: Market }) {
  const [journal, state] = await Promise.all([redisStore.journal(40).catch(() => []), redisStore.state().catch(() => null)]);
  const entries: LogEntry[] = journal.flatMap((j) => (KIND[j.kind] ? [{ at: j.at, kind: KIND[j.kind]!, title: j.title, detail: j.why }] : []));
  return (
    <section className={s.section} aria-labelledby="picks-log">
      <Hero
        eyebrow="What changed, and why"
        title={<span id="picks-log">Learner log</span>}
        sub="Every idea is tested on games after it was first tracked. It goes live only when it clears the bar, and comes back off if it starts losing."
      />
      <GoLiveSteps games="30+ games over 3+ weeks, judged on games it saw after registering." />
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
