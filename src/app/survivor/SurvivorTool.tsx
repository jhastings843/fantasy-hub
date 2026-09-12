"use client";

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ClipboardList,
  ChevronDown,
  Info,
  Lock,
  RotateCcw,
  Settings2,
  Shield,
  TrendingUp,
} from "lucide-react";
import { NFL_TEAMS, logoUrl } from "@/lib/survivor/teams";
import type { Candidate, CandidateFlag, SurvivorReport } from "@/lib/survivor/types";

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

function kickoffLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function countdown(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const FLAG_TINT: Record<CandidateFlag["severity"], string> = {
  info: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  danger: "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300",
};

const FLAG_LABEL: Record<CandidateFlag["kind"], string> = {
  injury: "Injury",
  trap: "Trap",
  scarcity: "Save it",
  leverage: "Leverage",
  chalk: "Chalk",
  data: "Soft data",
};

function Logo({ abbr, size }: { abbr: string; size: number }) {
  return (
    <Image
      src={logoUrl(abbr)}
      alt=""
      width={size}
      height={size}
      unoptimized
      className="shrink-0 object-contain"
    />
  );
}

/** One number with its label, aligned for scanning down a column. */
function Stat({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "bad" | "accent";
  hint?: string;
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "bad"
        ? "text-rose-600 dark:text-rose-400"
        : tone === "accent"
          ? "text-amber-700 dark:text-amber-400"
          : "text-zinc-900 dark:text-zinc-50";
  return (
    <div className="flex flex-col gap-0.5" title={hint}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <span className={`text-sm font-semibold tabular-nums ${toneClass}`}>
        {value}
      </span>
    </div>
  );
}

/**
 * The screen once a pick is in.
 *
 * It replaces the board rather than sitting above it, because the decision is
 * made and a list of alternatives is now noise. The one way back is the button.
 * What it must show is what Jack asked for: the game he is actually in, the
 * plan built on having spent this team, and a way to change his mind. The
 * public-picks box stays where it is, outside this component, because that is
 * filled in after the week and has nothing to do with the pick.
 */
function TakenPick({
  taken,
  report,
  working,
  onChange,
}: {
  taken: Candidate;
  report: SurvivorReport;
  working: boolean;
  onChange: () => void;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border-2 border-emerald-400 bg-gradient-to-b from-emerald-50/70 to-white p-5 dark:border-emerald-600/70 dark:from-emerald-950/25 dark:to-zinc-900 lg:p-6">
      <div className="flex items-center gap-2">
        <Check size={14} className="text-emerald-600 dark:text-emerald-400" aria-hidden />
        <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
          Your pick, week {report.week}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Logo abbr={taken.team} size={48} />
        <div className="flex flex-col gap-0.5">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {taken.team} <span className="text-zinc-400 dark:text-zinc-500">over</span>{" "}
            {taken.opponent}
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {taken.home ? "Home" : "Away"} &middot; {kickoffLabel(taken.kickoff)}
          </p>
        </div>
        <button
          type="button"
          disabled={working}
          onClick={onChange}
          className="ml-auto inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition-colors hover:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600"
        >
          <RotateCcw size={15} aria-hidden />
          Change pick
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-emerald-200/70 pt-4 sm:grid-cols-4 dark:border-emerald-900/50">
        <Stat label="Win" value={pct(taken.winProb)} tone="good" />
        <Stat
          label="Field on it"
          value={pct(taken.ownership)}
          hint="Share of the field on this team, so the share that survives with you."
        />
        <Stat
          label="Equity"
          value={`${taken.equityMultiplier.toFixed(2)}x`}
          tone={taken.equityMultiplier >= 1 ? "good" : "bad"}
          hint="Above 1.00 gains ground on the field, below loses it."
        />
        <Stat
          label="Future cost"
          value={taken.futureCost.toFixed(3)}
          tone={taken.futureCost > 0.05 ? "bad" : "default"}
          hint="Discounted log-survival given up by burning this team now."
        />
      </div>

      {report.myPickNote && (
        <p className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
          {report.myPickNote}
        </p>
      )}

      {taken.flags.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {taken.flags.map((f, i) => (
            <li key={i} className="flex items-start gap-2">
              <span
                className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${FLAG_TINT[f.severity]}`}
              >
                {FLAG_LABEL[f.kind]}
              </span>
              <span className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                {f.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function SurvivorTool({ reports }: { reports: SurvivorReport[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [poolId, setPoolId] = useState(reports[0].poolId);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  // Every pool's board arrives in one payload, so switching is instant and both
  // are priced off the same ownership pull. A stale id (a pool removed between
  // renders) falls back to the first rather than blanking the page.
  const report = reports.find((r) => r.poolId === poolId) ?? reports[0];

  const { pool } = report;
  const usedSet = useMemo(() => new Set(pool.usedTeams), [pool.usedTeams]);
  const taken = report.myPick
    ? (report.candidates.find((c) => c.team === report.myPick) ?? null)
    : null;

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/survivor?pool=${encodeURIComponent(report.poolId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  const working = busy || pending;

  /**
   * Take a team for THIS week.
   *
   * Writes myPicks, not usedTeams. Writing usedTeams was the bug: it means
   * burned, so the engine dropped the team from the board and the pick
   * disappeared instead of becoming the answer. A pick burns itself once the
   * week has passed, derived in the engine.
   */
  function takePick(team: string) {
    void patch({ myPicks: { ...report.pool.myPicks, [String(report.week)]: team } });
  }

  function clearPick() {
    void patch({ myPicks: { ...report.pool.myPicks, [String(report.week)]: "" } });
  }

  /** Burn or un-burn a team by hand, for weeks the tool did not see. */
  function toggleBurned(team: string) {
    const next = new Set(usedSet);
    if (next.has(team)) next.delete(team);
    else next.add(team);
    void patch({ usedTeams: [...next] });
  }

  /**
   * Accepts what a pool's distribution screen actually looks like when you copy
   * it: a team key and a number per line, in any order, with or without a
   * percent sign.
   */
  function submitPaste() {
    const valid = new Set(NFL_TEAMS.map((t) => t.abbr));
    const picks: Record<string, number> = {};
    for (const line of paste.split("\n")) {
      const m = line.trim().match(/^([A-Za-z]{2,4})\b[^0-9]*([0-9]+(?:\.[0-9]+)?)\s*%?/);
      if (!m) continue;
      const abbr = m[1].toUpperCase();
      if (!valid.has(abbr)) continue;
      picks[abbr] = Number(m[2]);
    }
    const total = Object.values(picks).reduce((a, b) => a + b, 0);
    if (Object.keys(picks).length < 2) {
      setPasteError("Could not read two teams out of that. One team and one number per line.");
      return;
    }
    if (total < 50 || total > 150) {
      setPasteError(`Those add up to ${total.toFixed(1)}%, which does not look like a distribution.`);
      return;
    }
    setPasteError(null);
    setPasteOpen(false);
    setPaste("");
    void patch({
      weeklyPicks: { ...pool.weeklyPicks, [String(logWeek)]: picks },
    });
  }

  // The week the log box writes to: the most recent finished week still missing
  // its pool picks, falling back to the last completed week for corrections.
  const logWeek =
    report.unloggedWeeks.length > 0
      ? report.unloggedWeeks[report.unloggedWeeks.length - 1]
      : Math.max(1, report.week - 1);

  const best = report.candidates[0] ?? null;
  const safest =
    report.safestTeam && report.safestTeam !== report.bestTeam
      ? report.candidates.find((c) => c.team === report.safestTeam) ?? null
      : null;
  const rest = showAll ? report.candidates.slice(1) : report.candidates.slice(1, 8);
  const locksIn = countdown(report.locksAt);

  // Teams a meaningful slice of the surviving field can no longer pick.
  // Nothing is loggable until a week has actually finished.
  const nothingToLogYet =
    report.unloggedWeeks.length === 0 && report.field.weeksLogged === 0;

  const burnedByField = Object.entries(report.field.burned)
    .filter(([, share]) => share >= 0.05)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  return (
    <div className="flex flex-col gap-8">
      {reports.length > 1 && (
        <div
          role="tablist"
          aria-label="Survivor pool"
          className="flex gap-1 rounded-xl border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900"
        >
          {reports.map((r) => {
            const active = r.poolId === report.poolId;
            return (
              <button
                key={r.poolId}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPoolId(r.poolId)}
                className={`flex min-h-11 flex-1 flex-col justify-center rounded-lg px-3 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                  active
                    ? "bg-amber-100 dark:bg-amber-950/50"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                <span
                  className={`text-sm font-semibold ${
                    active
                      ? "text-amber-900 dark:text-amber-200"
                      : "text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {r.pool.name}
                </span>
                {/* Each pool's own answer, so agreement or disagreement is
                    visible without switching tabs. */}
                <span className="text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                  {r.myPick ?? r.bestTeam ?? "nothing left"}
                  {r.myPick ? " taken" : ""}
                  {" \u00b7 "}
                  {r.pool.usedTeams.length} burned
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Header */}
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
            Week {report.week}
          </span>
          {locksIn && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1 text-[11px] font-semibold text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
              <Lock size={11} aria-hidden />
              Locks in {locksIn}
            </span>
          )}
          <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
            {report.entriesAlive.toLocaleString()} entries alive
          </span>
          <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
            {32 - usedSet.size} teams left
          </span>
          {/* What the pool is playing for. Drives which end of a tie the board
              takes, so it belongs next to the pick rather than buried. */}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              report.posture.mode === "outright"
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                : "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300"
            }`}
            title={report.posture.summary}
          >
            {report.posture.mode === "outright" ? "Plays for an outright win" : "Plays for a share"}
            <span className="font-normal tabular-nums opacity-80">
              ~{report.posture.expectedSurvivors < 10
                ? report.posture.expectedSurvivors.toFixed(1)
                : Math.round(report.posture.expectedSurvivors)}{" "}
              left at 18
            </span>
          </span>
          <button
            type="button"
            onClick={() => setShowSettings((s) => !s)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-zinc-600 transition-colors hover:border-zinc-300 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700"
          >
            <Settings2 size={13} aria-hidden />
            Pool
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Survivor
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
            Ranked on first-place equity, not weekly safety. Live moneylines,
            public pick percentages, and the cost of burning a team you will want
            in November.
          </p>
        </div>
      </header>

      {showSettings && (
        <PoolSettings
          report={report}
          working={working}
          onPatch={patch}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Once a pick is in, it replaces the board. One way back, the button. */}
      {taken && (
        <TakenPick taken={taken} report={report} working={working} onChange={clearPick} />
      )}

      {/* The pick */}
      {taken ? null : best ? (
        <section className="grid gap-4 lg:grid-cols-3">
          <article className="flex flex-col gap-5 rounded-2xl border-2 border-amber-400 bg-gradient-to-b from-amber-50/70 to-white p-5 dark:border-amber-600/70 dark:from-amber-950/25 dark:to-zinc-900 lg:col-span-2 lg:p-6">
            <div className="flex items-center gap-2">
              <TrendingUp size={14} className="text-amber-600 dark:text-amber-400" aria-hidden />
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Take this
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <Logo abbr={best.team} size={56} />
              <div className="flex flex-col">
                <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  {best.team}
                </h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {best.home ? "vs" : "at"} {best.opponent} &middot;{" "}
                  {kickoffLabel(best.kickoff)}
                  {best.spread !== null && (
                    <span className="tabular-nums"> &middot; {best.spread > 0 ? "+" : ""}{best.spread}</span>
                  )}
                </p>
              </div>
              <div className="ml-auto text-right">
                <div className="text-4xl font-semibold tabular-nums tracking-tight text-amber-700 dark:text-amber-400">
                  {pct(best.winProb)}
                </div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  to win
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 border-y border-amber-200/70 py-4 sm:grid-cols-4 dark:border-amber-900/40">
              <Stat
                label="Field on it"
                value={pct(best.ownership)}
                tone={best.ownership > best.winProb ? "bad" : "default"}
                hint="Share of entries expected to make this same pick."
              />
              <Stat
                label="Rivals survive"
                value={pct(best.fieldSurvival)}
                hint="Fraction of the field still alive next week if this pick hits."
              />
              <Stat
                label="Equity"
                value={`${best.equityMultiplier.toFixed(2)}x`}
                tone={best.equityMultiplier >= 1 ? "good" : "bad"}
                hint="Value against an even share of the prize. Above 1.00 means you gain ground."
              />
              <Stat
                label="Burn cost"
                value={best.futureCost.toFixed(3)}
                tone={best.futureCost > 0.05 ? "bad" : "default"}
                hint="Discounted log-survival given up by burning this team now."
              />
            </div>

            {best.flags.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {best.flags.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${FLAG_TINT[f.severity]}`}
                    >
                      {FLAG_LABEL[f.kind]}
                    </span>
                    <span className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                      {f.text}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              disabled={working}
              onClick={() => takePick(best.team)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:opacity-50 dark:focus:ring-offset-zinc-900"
            >
              <Check size={16} aria-hidden />
              I took {best.team}
            </button>
          </article>

          <div className="flex flex-col gap-4">
            {safest ? (
              <article className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center gap-2">
                  <Shield size={14} className="text-cyan-600 dark:text-cyan-400" aria-hidden />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-400">
                    Safest board
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Logo abbr={safest.team} size={36} />
                  <div className="flex flex-col">
                    <span className="text-xl font-semibold tracking-tight">
                      {safest.team}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {safest.home ? "vs" : "at"} {safest.opponent}
                    </span>
                  </div>
                  <span className="ml-auto text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                    {pct(safest.winProb)}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {(report.safetyGiveUp * 100).toFixed(1)} points safer than{" "}
                  {best.team}, but {pct(safest.ownership)} of the field is already
                  there. Equity {safest.equityMultiplier.toFixed(2)}x.
                </p>
                <button
                  type="button"
                  disabled={working}
                  onClick={() => takePick(safest.team)}
                  className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-700 transition-colors hover:border-zinc-300 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-700"
                >
                  I took {safest.team} instead
                </button>
              </article>
            ) : (
              <article className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center gap-2">
                  <Shield size={14} className="text-emerald-600 dark:text-emerald-400" aria-hidden />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    No trade-off
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {best.team} is both the safest board and the best equity this
                  week. Nothing to weigh.
                </p>
              </article>
            )}

            <article className="flex flex-col gap-2.5 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Why
              </span>
              <ul className="flex flex-col gap-2">
                {report.reasoning.map((r, i) => (
                  <li
                    key={i}
                    className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300"
                  >
                    {r}
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </section>
      ) : (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm font-semibold">{report.headline}</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Every team playing this week is already burned, or the slate has
            locked.
          </p>
        </div>
      )}

      {/* Notes */}
      {report.notes.length > 0 && (
        <ul className="flex flex-col gap-2">
          {report.notes.map((n, i) => (
            <li
              key={i}
              className="flex items-start gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50/60 px-3.5 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/50"
            >
              <Info size={13} aria-hidden className="mt-0.5 shrink-0 text-zinc-400 dark:text-zinc-500" />
              <span className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                {n}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Log last week, which is the only recurring input the tool asks for */}
      <section className="flex flex-col gap-3">
        <div
          className={`flex flex-col gap-3 rounded-2xl border p-5 ${
            report.unloggedWeeks.length > 0
              ? "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20"
              : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <ClipboardList
                  size={14}
                  aria-hidden
                  className={
                    report.unloggedWeeks.length > 0
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-zinc-400 dark:text-zinc-500"
                  }
                />
                <span
                  className={`text-[11px] font-bold uppercase tracking-wider ${
                    report.unloggedWeeks.length > 0
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-zinc-500 dark:text-zinc-400"
                  }`}
                >
                  {report.unloggedWeeks.length > 0
                    ? `Log Week ${logWeek}`
                    : nothingToLogYet
                      ? "Pool history"
                      : `${report.field.weeksLogged} week(s) logged`}
                </span>
              </div>
              <p className="max-w-xl text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                {report.unloggedWeeks.length > 0
                  ? `Week ${logWeek} is finished, so your pool now shows what everyone picked. Paste it once and three things update: how far your pool leans off the public, which teams the field has burned, and how many entries are left.`
                  : nothingToLogYet
                    ? "Nothing to log yet. Once a week finishes, your pool shows what everyone picked and which teams they have used. Paste that here and the ownership numbers stop being Yahoo's public estimate and start being your pool."
                    : "Every finished week is in, so the ownership numbers are projected for your pool rather than taken from Yahoo alone."}
              </p>
            </div>
            {!nothingToLogYet && (
              <button
                type="button"
                onClick={() => setPasteOpen((o) => !o)}
                className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                  report.unloggedWeeks.length > 0
                    ? "bg-amber-500 text-white hover:bg-amber-600"
                    : "border border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-800 dark:text-zinc-400"
                }`}
              >
                {pasteOpen ? "Close" : `Paste Week ${logWeek} picks`}
              </button>
            )}
          </div>

          {pasteOpen && (
            <div className="flex flex-col gap-2 border-t border-zinc-200/70 pt-3 dark:border-zinc-800">
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                One team per line, team code then percentage. Any separator, and
                a partial list is fine.
              </p>
              <textarea
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                rows={6}
                placeholder={"LAC 32.2%\nJAX 21.7%\nDET 18.2%"}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-zinc-800 dark:bg-zinc-950"
              />
              {pasteError && (
                <p className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400">
                  <AlertTriangle size={12} aria-hidden />
                  {pasteError}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={working}
                  onClick={submitPaste}
                  className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
                >
                  Save Week {logWeek}
                </button>
                {pool.weeklyPicks[String(logWeek)] && (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => {
                      const next = { ...pool.weeklyPicks };
                      delete next[String(logWeek)];
                      void patch({ weeklyPicks: next });
                      setPasteOpen(false);
                    }}
                    className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-600 transition-colors hover:border-rose-300 hover:text-rose-700 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-400"
                  >
                    Delete Week {logWeek}
                  </button>
                )}
              </div>
            </div>
          )}

          {report.field.weeksLogged > 0 && (
            <div className="grid gap-4 border-t border-zinc-200/70 pt-3 sm:grid-cols-3 dark:border-zinc-800">
              <Stat
                label="Entries left"
                value={report.field.entriesAlive.toLocaleString()}
                hint="Derived from the picks you logged and the results, not typed in."
              />
              <Stat
                label="Chalk factor"
                value={`${report.calibration.alpha.toFixed(2)}x`}
                tone={report.calibration.alpha > 1.15 ? "accent" : "default"}
                hint="Above 1 means your pool crowds the favourite harder than the public does."
              />
              <Stat
                label="Fit confidence"
                value={report.calibration.confidence}
                hint={`Based on ${report.calibration.weeks} logged week(s).`}
              />
            </div>
          )}

          {burnedByField.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-zinc-200/70 pt-3 dark:border-zinc-800">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                What the field has burned
              </span>
              <ul className="flex flex-wrap gap-1.5">
                {burnedByField.map(([team, share]) => (
                  <li
                    key={team}
                    className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <Logo abbr={team} size={16} />
                    <span className="text-[11px] font-semibold">{team}</span>
                    <span className="text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                      {pct(share, 0)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                These are unavailable to that share of the surviving field. If
                you still hold one for a week it is a big favourite, most of the
                pool cannot follow you.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* The board, hidden once the decision is made. */}
      {!taken && rest.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              The rest of the board
            </h2>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {report.ownership.source === "projected"
                ? `Ownership projected for your pool (${report.calibration.alpha.toFixed(2)}x chalk)`
                : report.ownership.source === "manual"
                  ? "Ownership from your logged picks"
                  : "Ownership from Yahoo national"}
            </span>
          </div>

          <ul className="flex flex-col gap-2">
            {rest.map((c, i) => (
              <CandidateRow
                key={`${c.team}-${c.week}`}
                rank={i + 2}
                candidate={c}
                disabled={working}
                onTake={() => takePick(c.team)}
              />
            ))}
          </ul>

          {report.candidates.length > 8 && (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="inline-flex items-center justify-center gap-1.5 self-start rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-600 transition-colors hover:border-zinc-300 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700"
            >
              <ChevronDown
                size={13}
                aria-hidden
                className={showAll ? "rotate-180 transition-transform" : "transition-transform"}
              />
              {showAll
                ? "Show fewer"
                : `Show all ${report.candidates.length} legal picks`}
            </button>
          )}
        </section>
      )}

      {/* Plan */}
      {report.plan.length > 1 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Path from here
            </h2>
            <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              {pct(report.planSurvival)} to survive all {report.plan.length} weeks
            </span>
          </div>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {report.plan.map((p) => (
              <li
                key={p.week}
                className={`flex flex-col gap-1.5 rounded-xl border p-3 ${
                  p.week === report.week
                    ? "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20"
                    : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                }`}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Week {p.week}
                </span>
                <div className="flex items-center gap-1.5">
                  <Logo abbr={p.team} size={20} />
                  <span className="text-sm font-semibold">{p.team}</span>
                </div>
                <span className="text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                  {p.home ? "vs" : "at"} {p.opponent} &middot; {pct(p.winProb, 0)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Used teams */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Teams burned
          </h2>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Tap to toggle. {usedSet.size} of 32 used.
          </span>
        </div>
        <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
          {NFL_TEAMS.map((t) => {
            const isUsed = usedSet.has(t.abbr);
            return (
              <li key={t.abbr}>
                <button
                  type="button"
                  disabled={working}
                  onClick={() => toggleBurned(t.abbr)}
                  aria-pressed={isUsed}
                  className={`flex min-h-[44px] w-full flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50 ${
                    isUsed
                      ? "border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800"
                      : "border-zinc-200 bg-white hover:border-amber-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-amber-800"
                  }`}
                >
                  <span className={isUsed ? "opacity-30 grayscale" : ""}>
                    <Logo abbr={t.abbr} size={22} />
                  </span>
                  <span
                    className={`text-[10px] font-bold ${
                      isUsed
                        ? "text-zinc-400 line-through dark:text-zinc-600"
                        : "text-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    {t.abbr}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function CandidateRow({
  rank,
  candidate: c,
  disabled,
  onTake,
}: {
  rank: number;
  candidate: Candidate;
  disabled: boolean;
  onTake: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-2xl border border-zinc-200 bg-white transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
      <div className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="w-5 shrink-0 text-right text-xs font-semibold tabular-nums text-zinc-400 dark:text-zinc-600">
            {rank}
          </span>
          <Logo abbr={c.team} size={30} />
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold">
              {c.team}{" "}
              <span className="font-normal text-zinc-500 dark:text-zinc-400">
                {c.home ? "vs" : "at"} {c.opponent}
              </span>
            </span>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {kickoffLabel(c.kickoff)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3 sm:w-[420px] sm:shrink-0">
          <Stat label="Win" value={pct(c.winProb)} />
          <Stat
            label="Field"
            value={pct(c.ownership)}
            tone={c.ownership > c.winProb ? "bad" : "default"}
          />
          <Stat
            label="Equity"
            value={`${c.equityMultiplier.toFixed(2)}x`}
            tone={c.equityMultiplier >= 1 ? "good" : "default"}
          />
          <Stat
            label="Burn cost"
            value={c.futureCost.toFixed(3)}
            tone={c.futureCost > 0.05 ? "bad" : "default"}
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Fixed width even when empty: a candidate with no notes used to pull
              its whole stat block sideways and break the column alignment. */}
          <div className="w-[68px] shrink-0">
            {c.flags.length > 0 && (
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-[11px] font-semibold text-zinc-500 transition-colors hover:border-zinc-300 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-zinc-800 dark:text-zinc-400"
              >
                {c.flags.length} note{c.flags.length > 1 ? "s" : ""}
              </button>
            )}
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={onTake}
            className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-700 transition-colors hover:border-amber-400 hover:text-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-amber-700 dark:hover:text-amber-400"
          >
            Took it
          </button>
        </div>
      </div>

      {open && c.flags.length > 0 && (
        <ul className="flex flex-col gap-1.5 border-t border-zinc-200 px-3.5 py-3 dark:border-zinc-800">
          {c.flags.map((f, i) => (
            <li key={i} className="flex items-start gap-2">
              <span
                className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${FLAG_TINT[f.severity]}`}
              >
                {FLAG_LABEL[f.kind]}
              </span>
              <span className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                {f.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function PoolSettings({
  report,
  working,
  onPatch,
  onClose,
}: {
  report: SurvivorReport;
  working: boolean;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const { pool } = report;
  const [poolSize, setPoolSize] = useState(String(pool.poolSize));
  const [alive, setAlive] = useState(
    pool.entriesAlive === null ? "" : String(pool.entriesAlive),
  );
  const [horizon, setHorizon] = useState(String(pool.horizon));

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Pool</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-semibold text-zinc-500 hover:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:text-zinc-400"
        >
          Done
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Entries at start
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={poolSize}
            onChange={(e) => setPoolSize(e.target.value)}
            onBlur={() => {
              const n = Number(poolSize);
              if (n >= 1 && n !== pool.poolSize) void onPatch({ poolSize: n });
            }}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-zinc-800 dark:bg-zinc-950"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Still alive
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={alive}
            placeholder={String(pool.poolSize)}
            onChange={(e) => setAlive(e.target.value)}
            onBlur={() => {
              const n = alive === "" ? null : Number(alive);
              if (n === null || n >= 1) void onPatch({ entriesAlive: n });
            }}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-zinc-800 dark:bg-zinc-950"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Weeks to plan
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={12}
            value={horizon}
            onChange={(e) => setHorizon(e.target.value)}
            onBlur={() => {
              const n = Number(horizon);
              if (n >= 1 && n <= 12 && n !== pool.horizon) {
                void onPatch({ horizon: n });
              }
            }}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-zinc-800 dark:bg-zinc-950"
          />
        </label>
      </div>

      <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        Update &quot;still alive&quot; as the pool thins out. Leverage is measured
        against the entries left, not the ones that started, so the number matters
        more in November than it does now. Future value always solves to Week 18
        regardless of the planning window.
      </p>

      <button
        type="button"
        disabled={working || pool.usedTeams.length === 0}
        onClick={() => void onPatch({ usedTeams: [] })}
        className="inline-flex items-center gap-1.5 self-start rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-600 transition-colors hover:border-rose-300 hover:text-rose-700 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-40 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-rose-800 dark:hover:text-rose-400"
      >
        <RotateCcw size={13} aria-hidden />
        Clear all burned teams
      </button>
    </section>
  );
}
