import Link from "next/link";
import { AlertTriangle, ArrowDown, Info, Wallet } from "lucide-react";
import { buildWeeklyReport } from "@/lib/guillotine/report";
import { TIER_LABEL } from "@/lib/guillotine/market";
import type { Posture } from "@/lib/guillotine/chop-line";
import type { BidChain, WeeklyFaabReport } from "@/lib/guillotine/types";
import { RefreshButton } from "@/components/RefreshButton";
import { PlayerLink } from "@/components/PlayerLink";
import { Chip, Disclosure, Num, Section, Spotlight, type Tone } from "@/components/hh/ui";
import { PopLink } from "@/components/hh/PopLink";
import { TeamEdge } from "@/components/hh/team";
import { teamHref } from "@/app/picks/hrefs";
import { ChopLine } from "./ChopLine";
import { RoomLearning } from "./Learning";

export const dynamic = "force-dynamic";

// The weekly FAAB guide.
//
// Verdict first, on purpose. Every other layout for this page buries the only
// question that matters (spend or hold, and how much) under a table of
// available players, which is a cheat sheet rather than advice. The board is
// down the page; the answer is at the top.

const POSTURE_STYLE: Record<Posture, { tone: Tone; label: string }> = {
  red: { tone: "neg", label: "Spend" },
  yellow: { tone: "gold", label: "Selective" },
  green: { tone: "pos", label: "Hold" },
};

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

const TONE_TEXT: Record<Tone, string> = {
  accent: "text-hh-accent-ink",
  pos: "text-hh-pos",
  neg: "text-hh-neg",
  gold: "text-hh-gold",
  muted: "text-hh-muted",
  live: "text-hh-neg",
};

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-medium uppercase tracking-wide text-hh-muted">{children}</div>;
}

// A smaller stat than the shared one: this page carries a dozen of them, and
// 26px numbers in every block would shout over the verdict.
function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <div className="min-w-0">
      <Eyebrow>{label}</Eyebrow>
      <div className={`hh-num mt-0.5 text-xl font-semibold ${tone ? TONE_TEXT[tone] : "text-hh-ink"}`}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs leading-snug text-hh-muted">{hint}</div> : null}
    </div>
  );
}

/** An NFL team code that opens the team pop-up. */
function TeamCode({ team }: { team: string | null | undefined }) {
  if (!team) return null;
  return <PopLink href={teamHref("nfl", team)}>{team}</PopLink>;
}

/**
 * The season, drawn.
 *
 * The pacing block next to it answers "what can I spend today". This answers
 * "am I spending this season well", which is the question the hold curve has
 * always been computing and never showing: how much of the budget is gone
 * against how much the curve wants held, what the next three weeks look like
 * if nothing goes wrong, and when the whole pacing idea switches off.
 */
function SeasonPlan({ report }: { report: WeeklyFaabReport }) {
  const { season, league } = report;
  const budget = Math.max(1, league.budget);
  // Three segments, because the budget is three different things at once: gone,
  // available now, and held back by the curve. A single bar with a marker made
  // the marker look like a target when it is a ceiling.
  const spentPct = Math.min(100, (season.spent / budget) * 100);
  // Held is capped at what is actually left, so a wallet behind the curve
  // cannot draw a reserve bigger than the money in it. The two always sum to
  // the remaining balance, and with spent that is the whole budget.
  const held = Math.min(season.holdFloor, season.remaining);
  const heldPct = (held / budget) * 100;
  const spendablePct = Math.max(0, 100 - spentPct - heldPct);

  return (
    <Section
      label="The season plan"
      aside={
        <Chip tone={season.onPace ? "pos" : "gold"}>
          <Num>{money(Math.abs(season.aheadBy))}</Num> {season.onPace ? "ahead of" : "behind"} the curve
        </Chip>
      }
    >
      <div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--hh-track)]">
          <div className="h-full bg-hh-ink" style={{ width: `${spentPct}%` }} />
          <div className="h-full bg-hh-pos" style={{ width: `${spendablePct}%` }} />
          <div className="h-full bg-hh-line" style={{ width: `${heldPct}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-hh-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-hh-ink" aria-hidden />
            <span><Num>{money(season.spent)}</Num> spent</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-hh-pos" aria-hidden />
            <span><Num>{money(Math.max(0, season.remaining - held))}</Num> the curve frees</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-hh-line" aria-hidden />
            <span><Num>{money(held)}</Num> the curve holds</span>
          </span>
        </div>
      </div>

      {season.next.length > 0 ? (
        <div className="mt-5 border-t border-hh-line pt-4">
          <div className="grid grid-cols-3 gap-3">
            {season.next.map((w) => (
              <div key={w.week}>
                <Eyebrow>Week {w.week}</Eyebrow>
                <div className="hh-num mt-0.5 text-lg font-semibold text-hh-ink">{money(w.weeklyCap)}</div>
                <div className="mt-0.5 text-xs leading-snug text-hh-muted">
                  hold <Num>{money(w.holdFloor)}</Num> &middot; <Num>{w.teamsAlive}</Num> alive
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-hh-muted">
            One chop a week, and no week where you are in danger. This
            week&rsquo;s actual ceiling is <Num>{money(report.budget.weeklyCap)}</Num>, because posture
            moves it: a red week lifts its own ceiling, so treat these as the
            floor on your freedom rather than a cap on it.
          </p>
        </div>
      ) : null}

      <p className="mt-4 flex items-start gap-2 border-t border-hh-line pt-4 text-xs leading-relaxed text-hh-ink-2">
        <Info size={13} className="mt-0.5 shrink-0 text-hh-muted" aria-hidden />
        {[
          season.inversionWeek
            ? `Six teams left projects to week ${season.inversionWeek}, where the format inverts and ceiling starts beating floor.`
            : "The field has already inverted: outscore the survivors rather than avoid finishing last.",
          season.pacingOffWeek
            ? `Pacing itself runs until four teams, projected week ${season.pacingOffWeek}, after which unspent money is worth nothing.`
            : "Pacing is off, so unspent money is a wasted asset from here.",
        ].join(" ")}
      </p>

      {report.wallets.length > 0 ? (
        <div className="mt-5 border-t border-hh-line pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <Eyebrow>Who can outbid you</Eyebrow>
            <div className="text-[11px] text-hh-muted">
              <Num>{report.wallets.length}</Num> alive &middot; <Num>{money(budget)}</Num> each to start
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3 text-[10px] font-medium uppercase tracking-wide text-hh-muted">
            <span className="w-28 shrink-0 sm:w-32">Team</span>
            <span className="flex-1" aria-hidden />
            <span className="w-14 shrink-0 text-right">Spent</span>
            <span className="w-14 shrink-0 text-right">Left</span>
          </div>
          <ul className="mt-1.5 flex flex-col gap-2">
            {report.wallets.map((w) => {
              const spent = Math.max(0, budget - w.remaining);
              return (
                <li key={w.rosterId} className="flex items-center gap-3">
                  <span
                    className={`w-28 shrink-0 truncate text-xs sm:w-32 ${
                      w.isMine ? "font-semibold text-hh-ink" : "text-hh-ink-2"
                    }`}
                  >
                    {w.name}
                    {w.isMine ? " (you)" : ""}
                  </span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--hh-track)]">
                    <span
                      className={`block h-full rounded-full ${w.isMine ? "bg-hh-pos" : "bg-hh-muted opacity-50"}`}
                      style={{ width: `${Math.max(2, (w.remaining / budget) * 100)}%` }}
                    />
                  </span>
                  <Num className={`w-14 shrink-0 text-right text-xs ${spent > 0 ? "text-hh-ink-2" : "text-hh-muted"}`}>
                    {money(spent)}
                  </Num>
                  <Num className="w-14 shrink-0 text-right text-xs font-medium text-hh-ink">{money(w.remaining)}</Num>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-hh-muted">
            Every team still alive, richest first. Spent is what the season has
            already taken from the <Num>{money(budget)}</Num> they began with.
          </p>
        </div>
      ) : null}
    </Section>
  );
}

/** The one spotlight: spend or hold this week, and how much. */
function Verdict({ report }: { report: WeeklyFaabReport }) {
  const style = POSTURE_STYLE[report.posture.posture];
  const risk = report.risk.myChopProbability;
  const baseline = report.risk.baselineRisk;

  return (
    <Spotlight
      label={
        <span className="inline-flex items-center gap-2">
          This week&rsquo;s call <Chip tone={style.tone}>{style.label}</Chip>
        </span>
      }
      aside={<>Week <Num>{report.week}</Num> waivers</>}
    >
      <p className="font-display text-3xl font-bold leading-tight text-hh-ink sm:text-4xl">
        {report.card.sitOut ? (
          "Bid nothing meaningful this week."
        ) : (
          <>
            Commit up to <Num>{money(report.card.maxPossibleSpend)}</Num> this week.
          </>
        )}
      </p>

      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-hh-ink-2">{report.posture.detail}</p>

      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-hh-line pt-4 sm:grid-cols-4">
        <Stat
          label="Chop risk"
          value={risk == null ? "n/a" : `${(risk * 100).toFixed(1)}%`}
          hint={`Average is ${(baseline * 100).toFixed(1)}%`}
          tone={
            risk != null && risk > baseline * 1.6
              ? "neg"
              : risk != null && risk < baseline * 0.85
                ? "pos"
                : undefined
          }
        />
        <Stat label="FAAB left" value={money(report.me.faabRemaining)} hint={`of ${money(report.league.budget)}`} />
        <Stat label="Week ceiling" value={money(report.budget.weeklyCap)} hint="Across every claim" />
        <Stat label="Max one player" value={money(report.budget.maxSingleBid)} hint="Hard stop" />
      </div>
    </Spotlight>
  );
}

function Chain({ chain, index }: { chain: BidChain; index: number }) {
  return (
    <div className="border-b border-hh-line pb-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 py-2">
        <div className="flex items-baseline gap-2">
          <span className="hh-num text-xs text-hh-muted">{String(index + 1).padStart(2, "0")}</span>
          <h3 className="text-sm font-semibold text-hh-ink">{chain.need}</h3>
        </div>
        {chain.drop ? (
          <span className="text-xs text-hh-muted">
            all drop{" "}
            <span className="font-medium text-hh-ink-2">
              <PlayerLink id={chain.drop.playerId} name={chain.drop.name} />
            </span>
          </span>
        ) : (
          <span className="text-xs text-hh-neg">no free roster spot</span>
        )}
      </div>

      {chain.targets.length > 1 ? (
        <p className="mb-1 bg-hh-sunk px-3 py-2 text-xs leading-relaxed text-hh-ink-2">
          Submit all <Num>{chain.targets.length}</Num>, in this order. Only one can win: once
          a claim lands, {chain.drop?.name ?? "the drop"} is gone and Sleeper voids
          the rest. The most this chain costs is{" "}
          <Num className="font-semibold text-hh-ink">{money(Math.max(...chain.targets.map((t) => t.bid)))}</Num>
          , not the bids added together.
        </p>
      ) : null}

      <ul className="flex flex-col">
        {chain.targets.map((target, i) => (
          <li key={target.player.playerId}>
            <TeamEdge league="nfl" team={target.player.team} className="border-b border-hh-line py-3 last:border-b-0">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-hh-ink">
                      <PlayerLink id={target.player.playerId} name={target.player.name} />
                    </span>
                    <span className="text-xs text-hh-muted">
                      {target.player.position}
                      {target.player.team ? <> <TeamCode team={target.player.team} /></> : ""}
                    </span>
                    {target.player.fromChoppedRoster ? <Chip tone="neg">Chopped</Chip> : null}
                    {target.player.injuryStatus ? <Chip>{target.player.injuryStatus}</Chip> : null}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-hh-muted">
                    {TIER_LABEL[target.tier]}
                    {target.weekGain > 0 ? <>. Adds <Num>{target.weekGain.toFixed(1)}</Num> to your lineup</> : ""}
                    {target.displaces ? (
                      <>
                        {" "}over <PlayerLink id={target.displaces.playerId} name={target.displaces.name} />
                      </>
                    ) : (
                      ""
                    )}
                    .
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <div className="hh-num text-lg font-semibold text-hh-accent-ink">{money(target.bid)}</div>
                  <div className="text-[11px] text-hh-muted">
                    stop at <Num>{money(target.walkAway)}</Num>
                  </div>
                </div>
              </div>

              {i < chain.targets.length - 1 ? (
                <div className="mt-2 flex items-center gap-1 text-[11px] text-hh-muted">
                  <ArrowDown size={11} aria-hidden />
                  only if this one loses
                </div>
              ) : null}
            </TeamEdge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Field({ report }: { report: WeeklyFaabReport }) {
  return (
    <Section label="Where everyone stands">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[20rem] text-sm">
          <thead>
            <tr className="border-b border-hh-line text-left text-[11px] uppercase tracking-wide text-hh-muted">
              <th className="pb-2 font-medium">Team</th>
              <th className="pb-2 text-right font-medium">Projected</th>
              <th className="pb-2 text-right font-medium">Chop risk</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hh-line">
            {report.field.map((team) => (
              <tr key={team.rosterId} className={team.isMine ? "bg-hh-accent-soft" : ""}>
                <td className="py-2 pr-3 pl-1">
                  <span className={team.isMine ? "font-semibold text-hh-accent-ink" : "text-hh-ink"}>{team.name}</span>
                </td>
                <td className="py-2 text-right text-hh-ink-2">
                  <Num>{team.projected.toFixed(1)}</Num>
                </td>
                <td
                  className={`py-2 pr-1 text-right font-medium ${
                    team.chopProbability > report.risk.baselineRisk * 1.6 ? "text-hh-neg" : "text-hh-ink-2"
                  }`}
                >
                  <Num>{(team.chopProbability * 100).toFixed(1)}%</Num>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Unavailable({ report, leagueId }: { report: WeeklyFaabReport; leagueId: string }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <p className="hh-label">Weekly FAAB</p>
      <h1 className="hh-title mt-2">Nothing to advise yet</h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-hh-ink-2">{report.message}</p>
      <Link
        href={`/l/${leagueId}`}
        className="mt-6 inline-flex min-h-11 items-center rounded-[4px] bg-hh-accent px-4 text-sm font-semibold text-[var(--hh-on-accent)] transition-opacity hover:opacity-90"
      >
        Back to the league
      </Link>
    </main>
  );
}

export default async function FaabPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const report = await buildWeeklyReport(leagueId);

  if (report.state !== "ok") {
    return <Unavailable report={report} leagueId={leagueId} />;
  }

  const worthKnowing = [...report.league.scoringNotes, ...report.caveats];

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="hh-label">{report.league.name}</p>
          <h1 className="hh-title">Where the money goes</h1>
        </div>
        <RefreshButton leagueId={leagueId} />
      </div>

      <div className="mt-6 flex flex-col gap-8">
        <Verdict report={report} />

        <ChopLine
          teams={report.field}
          chopLine={report.risk.expectedChopLine}
          range={report.risk.chopLineRange}
        />

        <Section
          label="Claims to submit"
          aside={
            <>
              worst case <Num>{money(report.card.maxPossibleSpend)}</Num> of <Num>{money(report.budget.weeklyCap)}</Num>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-hh-ink-2">{report.card.summary}</p>

          {report.card.chains.length > 0 ? (
            <>
              <div className="mt-3 flex flex-col gap-2">
                {report.card.chains.map((chain, i) => (
                  <Chain key={chain.need} chain={chain} index={i} />
                ))}
              </div>
              <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-hh-muted">
                <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
                Every claim in a group drops the same player, so winning one
                cancels the rest. Submit them in the order shown. Claims in
                different groups can all win at once, which is why the worst
                case above counts one per group.
              </p>
            </>
          ) : null}
        </Section>

        <SeasonPlan report={report} />

        <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
          <Section label="Pacing">
            <p className="text-sm leading-relaxed text-hh-ink-2">{report.budget.phaseNote}</p>
            <div className="mt-4 grid grid-cols-2 gap-4 border-t border-hh-line pt-4">
              <Stat
                label="Chops left"
                value={String(report.budget.eliminationsRemaining)}
                hint="Including this one"
              />
              <Stat
                label="Per chop"
                value={money(report.budget.neutralAllowance)}
                hint="Neutral allowance"
              />
              <Stat
                label="Your share of live FAAB"
                value={`${(report.budget.purchasingPowerShare * 100).toFixed(1)}%`}
                hint={`Even split is ${((1 / Math.max(1, report.league.teamsAlive)) * 100).toFixed(1)}%`}
              />
              <Stat
                label="Richest rival"
                value={money(report.budget.maxRivalBid)}
                hint="Their maximum bid"
              />
            </div>
            {report.budget.notes.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-2 border-t border-hh-line pt-4">
                {report.budget.notes.map((note) => (
                  <li key={note} className="flex items-start gap-2 text-xs leading-relaxed text-hh-ink-2">
                    <Wallet size={13} className="mt-0.5 shrink-0 text-hh-muted" aria-hidden />
                    {note}
                  </li>
                ))}
              </ul>
            ) : null}
          </Section>

          <Section label="Your lineup">
            <ul className="flex flex-col">
              {report.me.starters.map((s, i) => (
                <li
                  key={`${s.name}-${i}`}
                  className="flex min-h-11 items-center justify-between gap-3 border-b border-hh-line py-2 text-sm last:border-b-0"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="hh-num w-8 shrink-0 text-[11px] uppercase text-hh-muted">{s.slot}</span>
                    <span className="truncate text-hh-ink">{s.name}</span>
                    {s.injuryStatus ? <Chip tone="neg">{s.injuryStatus}</Chip> : null}
                  </span>
                  <Num className="shrink-0 text-hh-muted">{s.points.toFixed(1)}</Num>
                </li>
              ))}
            </ul>
            <div className="mt-4 border-t border-hh-line pt-4">
              <Eyebrow>If one starter sits</Eyebrow>
              {report.me.fragility.worstOneOut ? (
                <p className="mt-1.5 text-xs leading-relaxed text-hh-ink-2">
                  Lose {report.me.fragility.worstOneOut.name} and you project{" "}
                  <Num tone={report.me.fragility.fragile ? "neg" : undefined} className="font-semibold text-hh-ink">
                    {report.me.fragility.worstOneOut.total.toFixed(1)}
                  </Num>
                  . The low score usually lands below <Num>{report.risk.chopLineRange[1].toFixed(0)}</Num>.
                </p>
              ) : null}
              {report.me.fragility.shakyStarters.length > 0 ? (
                <p className="mt-1.5 text-xs leading-relaxed text-hh-gold">
                  Tagged: {report.me.fragility.shakyStarters.join(", ")}
                </p>
              ) : null}
              {report.me.fragility.thinSlots.length > 0 ? (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {report.me.fragility.thinSlots.slice(0, 3).map((t) => (
                    <li key={t} className="text-xs text-hh-ink-2">
                      {t}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {report.me.lastWeek ? (
              <div className="mt-4 border-t border-hh-line pt-4">
                <Eyebrow>Last week</Eyebrow>
                <div className="mt-2 grid grid-cols-3 gap-3">
                  <Stat
                    label="Scored"
                    value={report.me.lastWeek.score.toFixed(1)}
                    hint={`Week ${report.me.lastWeek.week}`}
                  />
                  <Stat
                    label="Finished"
                    value={`${report.me.lastWeek.rankFromBottom} of ${report.me.lastWeek.teams}`}
                    hint="From the bottom"
                    tone={report.me.lastWeek.rankFromBottom <= 3 ? "neg" : undefined}
                  />
                  <Stat
                    label="Clear of chop"
                    value={report.me.lastWeek.margin.toFixed(1)}
                    hint={`Low was ${report.me.lastWeek.lowest.toFixed(1)}`}
                    tone={report.me.lastWeek.margin < 10 ? "neg" : undefined}
                  />
                </div>
              </div>
            ) : null}
            {report.me.byeAlerts.length > 0 ? (
              <div className="mt-4 border-t border-hh-line pt-4">
                <Eyebrow>Byes</Eyebrow>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {report.me.byeAlerts.map((alert) => (
                    <li
                      key={alert}
                      className={
                        alert.includes("plan that week")
                          ? "text-xs font-medium text-hh-gold"
                          : "text-xs text-hh-ink-2"
                      }
                    >
                      {alert}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Section>
        </div>

        <Field report={report} />

        {report.learning ? <RoomLearning learning={report.learning} /> : null}

        <div className="flex flex-col">
          <Disclosure summary="What things cost here">
            <p className="text-sm leading-relaxed text-hh-ink-2">{report.market.note}</p>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {Object.values(report.market.estimates).map((estimate) => (
                <Stat
                  key={estimate.tier}
                  label={TIER_LABEL[estimate.tier]}
                  value={money(estimate.expected)}
                  hint={estimate.basis}
                />
              ))}
            </div>
          </Disclosure>

          {worthKnowing.length > 0 && (
            <Disclosure
              summary={
                <span className="inline-flex items-center gap-1.5">
                  <AlertTriangle size={13} className="text-hh-gold" aria-hidden />
                  Worth knowing (<Num>{worthKnowing.length}</Num>)
                </span>
              }
            >
              <ul className="flex flex-col gap-2">
                {worthKnowing.map((note) => (
                  <li key={note} className="flex items-start gap-2 text-xs leading-relaxed text-hh-ink-2">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-hh-gold" aria-hidden />
                    {note}
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </div>
      </div>
    </main>
  );
}
