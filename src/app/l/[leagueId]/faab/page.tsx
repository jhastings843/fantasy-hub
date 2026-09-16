import Link from "next/link";
import { AlertTriangle, ArrowDown, Info, Wallet } from "lucide-react";
import { buildWeeklyReport } from "@/lib/guillotine/report";
import { TIER_LABEL } from "@/lib/guillotine/market";
import type { Posture } from "@/lib/guillotine/chop-line";
import type { BidChain, WeeklyFaabReport } from "@/lib/guillotine/types";
import { RefreshButton } from "@/components/RefreshButton";
import { ChopLine } from "./ChopLine";

export const dynamic = "force-dynamic";

// The weekly FAAB guide.
//
// Verdict first, on purpose. Every other layout for this page buries the only
// question that matters (spend or hold, and how much) under a table of
// available players, which is a cheat sheet rather than advice. The board is
// down the page; the answer is at the top.

const POSTURE_STYLE: Record<
  Posture,
  { ring: string; chip: string; label: string }
> = {
  red: {
    ring: "border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30",
    chip: "bg-rose-500 text-white",
    label: "Spend",
  },
  yellow: {
    ring: "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
    chip: "bg-amber-500 text-white",
    label: "Selective",
  },
  green: {
    ring: "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30",
    chip: "bg-emerald-500 text-white",
    label: "Hold",
  },
};

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
      {children}
    </h2>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div
        className={`mt-0.5 text-xl font-semibold tabular-nums ${accent ?? "text-zinc-900 dark:text-zinc-100"}`}
      >
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 text-xs leading-snug text-zinc-500">{hint}</div>
      ) : null}
    </div>
  );
}


/**
 * The season, drawn.
 *
 * The pacing card next to it answers "what can I spend today". This answers
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
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>The season plan</Eyebrow>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            season.onPace
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
          }`}
        >
          {season.onPace
            ? `${money(Math.abs(season.aheadBy))} ahead of the curve`
            : `${money(Math.abs(season.aheadBy))} behind the curve`}
        </span>
      </div>

      <div className="mt-4">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div className="h-full bg-zinc-900 dark:bg-zinc-100" style={{ width: `${spentPct}%` }} />
          <div className="h-full bg-emerald-500" style={{ width: `${spendablePct}%` }} />
          <div className="h-full bg-zinc-200 dark:bg-zinc-700" style={{ width: `${heldPct}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-zinc-900 dark:bg-zinc-100" aria-hidden />
            <span className="tabular-nums">{money(season.spent)} spent</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
            <span className="tabular-nums">
              {money(Math.max(0, season.remaining - held))} the curve frees
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-zinc-200 dark:bg-zinc-700" aria-hidden />
            <span className="tabular-nums">{money(held)} the curve holds</span>
          </span>
        </div>
      </div>

      {season.next.length > 0 ? (
        <div className="mt-5 border-t border-zinc-200/70 pt-4 dark:border-zinc-800">
          <div className="grid grid-cols-3 gap-3">
            {season.next.map((w) => (
              <div key={w.week}>
                <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Week {w.week}
                </div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {money(w.weeklyCap)}
                </div>
                <div className="mt-0.5 text-xs leading-snug text-zinc-500 tabular-nums">
                  hold {money(w.holdFloor)} &middot; {w.teamsAlive} alive
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-zinc-500">
            One chop a week, and no week where you are in danger. This
            week&rsquo;s actual ceiling is {money(report.budget.weeklyCap)}, because posture
            moves it: a red week lifts its own ceiling, so treat these as the
            floor on your freedom rather than a cap on it.
          </p>
        </div>
      ) : null}

      <p className="mt-4 flex items-start gap-2 border-t border-zinc-200/70 pt-4 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        <Info size={13} className="mt-0.5 shrink-0 text-zinc-400" aria-hidden />
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
        <div className="mt-5 border-t border-zinc-200/70 pt-4 dark:border-zinc-800">
          <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Who can outbid you
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {report.wallets.slice(0, 8).map((w) => (
              <li key={w.rosterId} className="flex items-center gap-3">
                <span
                  className={`w-32 shrink-0 truncate text-xs ${
                    w.isMine
                      ? "font-semibold text-zinc-900 dark:text-zinc-100"
                      : "text-zinc-600 dark:text-zinc-400"
                  }`}
                >
                  {w.name}
                  {w.isMine ? " (you)" : ""}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <span
                    className={`block h-full rounded-full ${
                      w.isMine ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"
                    }`}
                    style={{ width: `${Math.max(2, (w.remaining / budget) * 100)}%` }}
                  />
                </span>
                <span className="w-14 shrink-0 text-right text-xs font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                  {money(w.remaining)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function Verdict({ report }: { report: WeeklyFaabReport }) {
  const style = POSTURE_STYLE[report.posture.posture];
  const risk = report.risk.myChopProbability;
  const baseline = report.risk.baselineRisk;

  return (
    <Card className={`!border ${style.ring}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${style.chip}`}
        >
          {style.label}
        </span>
        <span className="text-xs uppercase tracking-wider text-zinc-500">
          Week {report.week} waivers
        </span>
      </div>

      <p className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-zinc-900 sm:text-4xl dark:text-zinc-100">
        {report.card.sitOut
          ? "Bid nothing meaningful this week."
          : `Commit up to ${money(report.card.maxPossibleSpend)} this week.`}
      </p>

      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {report.posture.detail}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-zinc-200/70 pt-4 sm:grid-cols-4 dark:border-zinc-800">
        <Stat
          label="Chop risk"
          value={risk == null ? "n/a" : `${(risk * 100).toFixed(1)}%`}
          hint={`Average is ${(baseline * 100).toFixed(1)}%`}
          accent={
            risk != null && risk > baseline * 1.6
              ? "text-rose-600 dark:text-rose-400"
              : risk != null && risk < baseline * 0.85
                ? "text-emerald-600 dark:text-emerald-400"
                : undefined
          }
        />
        <Stat
          label="FAAB left"
          value={money(report.me.faabRemaining)}
          hint={`of ${money(report.league.budget)}`}
        />
        <Stat
          label="Week ceiling"
          value={money(report.budget.weeklyCap)}
          hint="Across every claim"
        />
        <Stat
          label="Max one player"
          value={money(report.budget.maxSingleBid)}
          hint="Hard stop"
        />
      </div>
    </Card>
  );
}

function Chain({ chain, index }: { chain: BidChain; index: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xs text-zinc-400">
            {String(index + 1).padStart(2, "0")}
          </span>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {chain.need}
          </h3>
        </div>
        {chain.drop ? (
          <span className="text-xs text-zinc-500">
            all drop{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {chain.drop.name}
            </span>
          </span>
        ) : (
          <span className="text-xs text-rose-600 dark:text-rose-400">
            no free roster spot
          </span>
        )}
      </div>

      {chain.targets.length > 1 ? (
        <p className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
          Submit all {chain.targets.length}, in this order. Only one can win: once
          a claim lands, {chain.drop?.name ?? "the drop"} is gone and Sleeper voids
          the rest. The most this chain costs is{" "}
          <span className="font-semibold text-zinc-800 dark:text-zinc-200">
            {money(Math.max(...chain.targets.map((t) => t.bid)))}
          </span>
          , not the bids added together.
        </p>
      ) : null}

      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {chain.targets.map((target, i) => (
          <li key={target.player.playerId} className="px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {target.player.name}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {target.player.position}
                    {target.player.team ? ` ${target.player.team}` : ""}
                  </span>
                  {target.player.fromChoppedRoster ? (
                    <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
                      Chopped
                    </span>
                  ) : null}
                  {target.player.injuryStatus ? (
                    <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      {target.player.injuryStatus}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                  {TIER_LABEL[target.tier]}
                  {target.weekGain > 0
                    ? `. Adds ${target.weekGain.toFixed(1)} to your lineup`
                    : ""}
                  {target.displaces ? ` over ${target.displaces.name}` : ""}.
                </p>
              </div>

              <div className="shrink-0 text-right">
                <div className="text-lg font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                  {money(target.bid)}
                </div>
                <div className="text-[11px] tabular-nums text-zinc-500">
                  stop at {money(target.walkAway)}
                </div>
              </div>
            </div>

            {i < chain.targets.length - 1 ? (
              <div className="mt-2 flex items-center gap-1 text-[11px] text-zinc-400">
                <ArrowDown size={11} aria-hidden />
                only if this one loses
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Field({ report }: { report: WeeklyFaabReport }) {
  return (
    <Card>
      <Eyebrow>Where everyone stands</Eyebrow>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[26rem] text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <th className="pb-2 font-medium">Team</th>
              <th className="pb-2 text-right font-medium">Projected</th>
              <th className="pb-2 text-right font-medium">Chop risk</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {report.field.map((team) => (
              <tr
                key={team.rosterId}
                className={team.isMine ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}
              >
                <td className="py-2 pr-3">
                  <span
                    className={
                      team.isMine
                        ? "font-semibold text-amber-700 dark:text-amber-400"
                        : "text-zinc-700 dark:text-zinc-300"
                    }
                  >
                    {team.name}
                  </span>
                </td>
                <td className="py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                  {team.projected.toFixed(1)}
                </td>
                <td
                  className={`py-2 text-right font-medium tabular-nums ${
                    team.chopProbability > report.risk.baselineRisk * 1.6
                      ? "text-rose-600 dark:text-rose-400"
                      : "text-zinc-600 dark:text-zinc-400"
                  }`}
                >
                  {(team.chopProbability * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Unavailable({ report, leagueId }: { report: WeeklyFaabReport; leagueId: string }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <Eyebrow>Weekly FAAB</Eyebrow>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Nothing to advise yet
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
        {report.message}
      </p>
      <Link
        href={`/l/${leagueId}`}
        className="mt-6 inline-block rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
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

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>{report.league.name}</Eyebrow>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl dark:text-zinc-100">
            Where the money goes
          </h1>
        </div>
        <RefreshButton leagueId={leagueId} />
      </div>

      <div className="mt-6 flex flex-col gap-5">
        <Verdict report={report} />

        <ChopLine
          teams={report.field}
          chopLine={report.risk.expectedChopLine}
          range={report.risk.chopLineRange}
        />

        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Eyebrow>Claims to submit</Eyebrow>
            <span className="text-xs tabular-nums text-zinc-500">
              worst case {money(report.card.maxPossibleSpend)} of{" "}
              {money(report.budget.weeklyCap)}
            </span>
          </div>

          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {report.card.summary}
          </p>

          {report.card.chains.length > 0 ? (
            <>
              <div className="mt-4 flex flex-col gap-3">
                {report.card.chains.map((chain, i) => (
                  <Chain key={chain.need} chain={chain} index={i} />
                ))}
              </div>
              <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-zinc-500">
                <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
                Every claim in a group drops the same player, so winning one
                cancels the rest. Submit them in the order shown. Claims in
                different groups can all win at once, which is why the worst
                case above counts one per group.
              </p>
            </>
          ) : null}
        </Card>

        <SeasonPlan report={report} />

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <Eyebrow>Pacing</Eyebrow>
            <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              {report.budget.phaseNote}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-4 border-t border-zinc-200/70 pt-4 dark:border-zinc-800">
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
              <ul className="mt-4 flex flex-col gap-2 border-t border-zinc-200/70 pt-4 dark:border-zinc-800">
                {report.budget.notes.map((note) => (
                  <li
                    key={note}
                    className="flex items-start gap-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400"
                  >
                    <Wallet size={13} className="mt-0.5 shrink-0 text-zinc-400" aria-hidden />
                    {note}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          <Card>
            <Eyebrow>Your lineup</Eyebrow>
            <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800/70">
              {report.me.starters.map((s, i) => (
                <li
                  key={`${s.name}-${i}`}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-8 shrink-0 font-mono text-[11px] uppercase text-zinc-400">
                      {s.slot}
                    </span>
                    <span className="truncate text-zinc-700 dark:text-zinc-300">
                      {s.name}
                    </span>
                    {s.injuryStatus ? (
                      <span className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
                        {s.injuryStatus}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-zinc-500">
                    {s.points.toFixed(1)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 border-t border-zinc-200/70 pt-4 dark:border-zinc-800">
              <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                If one starter sits
              </div>
              {report.me.fragility.worstOneOut ? (
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Lose {report.me.fragility.worstOneOut.name} and you project{" "}
                  <span
                    className={`font-semibold tabular-nums ${
                      report.me.fragility.fragile
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-zinc-800 dark:text-zinc-200"
                    }`}
                  >
                    {report.me.fragility.worstOneOut.total.toFixed(1)}
                  </span>
                  . The low score usually lands below{" "}
                  {report.risk.chopLineRange[1].toFixed(0)}.
                </p>
              ) : null}
              {report.me.fragility.shakyStarters.length > 0 ? (
                <p className="mt-1.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                  Tagged: {report.me.fragility.shakyStarters.join(", ")}
                </p>
              ) : null}
              {report.me.fragility.thinSlots.length > 0 ? (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {report.me.fragility.thinSlots.slice(0, 3).map((t) => (
                    <li key={t} className="text-xs text-zinc-600 dark:text-zinc-400">
                      {t}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {report.me.lastWeek ? (
              <div className="mt-4 border-t border-zinc-200/70 pt-4 dark:border-zinc-800">
                <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Last week
                </div>
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
                    accent={
                      report.me.lastWeek.rankFromBottom <= 3
                        ? "text-rose-600 dark:text-rose-400"
                        : undefined
                    }
                  />
                  <Stat
                    label="Clear of chop"
                    value={report.me.lastWeek.margin.toFixed(1)}
                    hint={`Low was ${report.me.lastWeek.lowest.toFixed(1)}`}
                    accent={
                      report.me.lastWeek.margin < 10
                        ? "text-rose-600 dark:text-rose-400"
                        : undefined
                    }
                  />
                </div>
              </div>
            ) : null}
            {report.me.byeAlerts.length > 0 ? (
              <div className="mt-4 border-t border-zinc-200/70 pt-4 dark:border-zinc-800">
                <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Byes ahead
                </div>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {report.me.byeAlerts.map((alert) => (
                    <li key={alert} className="text-xs text-zinc-600 dark:text-zinc-400">
                      {alert}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        </div>

        <Field report={report} />

        <Card>
          <Eyebrow>What things cost here</Eyebrow>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {report.market.note}
          </p>
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
        </Card>

        {(report.caveats.length > 0 || report.league.scoringNotes.length > 0) && (
          <Card className="!bg-zinc-50 dark:!bg-zinc-900/50">
            <Eyebrow>Worth knowing</Eyebrow>
            <ul className="mt-3 flex flex-col gap-2">
              {[...report.league.scoringNotes, ...report.caveats].map((note) => (
                <li
                  key={note}
                  className="flex items-start gap-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400"
                >
                  <AlertTriangle
                    size={13}
                    className="mt-0.5 shrink-0 text-amber-500"
                    aria-hidden
                  />
                  {note}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </main>
  );
}
