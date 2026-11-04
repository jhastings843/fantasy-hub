"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Info,
  Lock,
  RotateCcw,
  Settings2,
} from "lucide-react";
import { formatPickPaste, parsePickPaste } from "@/lib/survivor/paste";
import { NFL_TEAMS } from "@/lib/survivor/teams";
import type { Candidate, CandidateFlag, SurvivorReport } from "@/lib/survivor/types";
import { Chip, Disclosure, Num, Section, Spotlight, type Tone } from "@/components/hh/ui";
import { PopLink } from "@/components/hh/PopLink";
import { TeamLogo } from "@/components/TeamLogo";
import { teamHref } from "@/app/picks/hrefs";

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

// Controls on the hh tokens: 44px tall on phones, a little tighter from sm up.
const BTN =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-[6px] border border-hh-line bg-hh-panel px-3 text-xs font-semibold text-hh-ink-2 transition-colors hover:border-hh-accent hover:text-hh-accent-ink focus:outline-none focus-visible:border-hh-accent disabled:opacity-50 sm:h-9";
const BTN_PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-[6px] bg-hh-accent px-4 text-sm font-semibold text-[var(--hh-on-accent)] transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-hh-accent focus-visible:ring-offset-2 focus-visible:ring-offset-hh-bg disabled:opacity-50";
const INPUT =
  "h-11 rounded-[6px] border border-hh-line bg-hh-panel px-3 text-[16px] text-hh-ink placeholder:text-hh-muted focus:border-hh-accent focus:outline-none sm:h-9 sm:text-sm";
const FIELD_LABEL = "text-[11px] font-semibold uppercase tracking-wider text-hh-muted";

const FLAG_TONE: Record<CandidateFlag["severity"], Tone> = {
  info: "muted",
  warn: "gold",
  danger: "neg",
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
  return <TeamLogo league="nfl" team={abbr} size={size} />;
}

/** A team name for THIS week's board: opens the team pop-up. */
function TeamName({ abbr }: { abbr: string }) {
  return <PopLink href={teamHref("nfl", abbr)}>{abbr}</PopLink>;
}

function Flags({ flags }: { flags: CandidateFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {flags.map((f, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0">
            <Chip tone={FLAG_TONE[f.severity]}>{FLAG_LABEL[f.kind]}</Chip>
          </span>
          <span className="text-xs leading-relaxed text-hh-ink-2">{f.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** One number with its label, aligned for scanning down a column. */
function Fig({
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
  const t: Tone | undefined =
    tone === "good" ? "pos" : tone === "bad" ? "neg" : tone === "accent" ? "accent" : undefined;
  return (
    <div className="flex flex-col gap-0.5" title={hint}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-hh-muted">{label}</span>
      <Num tone={t} className={`text-sm font-semibold ${t ? "" : "text-hh-ink"}`}>
        {value}
      </Num>
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
    <Spotlight
      label={
        <span className="inline-flex items-center gap-1.5">
          <Check size={13} aria-hidden />
          Your pick, week <Num>{report.week}</Num>
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <Logo abbr={taken.team} size={48} />
          <div className="flex flex-col gap-0.5">
            <p className="text-3xl font-semibold tracking-tight text-hh-ink sm:text-4xl">
              <TeamName abbr={taken.team} /> <span className="text-hh-muted">over</span>{" "}
              <TeamName abbr={taken.opponent} />
            </p>
            <p className="text-sm text-hh-ink-2">
              {taken.home ? "Home" : "Away"} &middot; {kickoffLabel(taken.kickoff)}
            </p>
          </div>
          <button type="button" disabled={working} onClick={onChange} className={`${BTN} ml-auto text-sm`}>
            <RotateCcw size={15} aria-hidden />
            Change pick
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-hh-line pt-4 sm:grid-cols-4">
          <Fig label="Win" value={pct(taken.winProb)} tone="good" />
          <Fig
            label="Field on it"
            value={pct(taken.ownership)}
            hint="Share of the field on this team, so the share that survives with you."
          />
          <Fig
            label="Equity"
            value={`${taken.equityMultiplier.toFixed(2)}x`}
            tone={taken.equityMultiplier >= 1 ? "good" : "bad"}
            hint="Above 1.00 gains ground on the field, below loses it."
          />
          <Fig
            label="Future cost"
            value={taken.futureCost.toFixed(3)}
            tone={taken.futureCost > 0.05 ? "bad" : "default"}
            hint="Discounted log-survival given up by burning this team now."
          />
        </div>

        {report.myPickNote && (
          <p className="border-l-2 border-hh-gold pl-3 text-sm leading-relaxed text-hh-ink-2">
            {report.myPickNote}
          </p>
        )}

        <Flags flags={taken.flags} />
      </div>
    </Spotlight>
  );
}

export default function SurvivorTool({ reports }: { reports: SurvivorReport[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [poolId, setPoolId] = useState(reports[0].poolId);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Reading the pool's own board from a screenshot. The small pool shows its
  // picks as logos in a grid, so there is nothing to copy and a photo of it is
  // the only export that exists.
  const [boardBusy, setBoardBusy] = useState(false);
  const [boardResult, setBoardResult] = useState<
    { rows: number; alive: number; unreadable: number } | null
  >(null);
  const [boardError, setBoardError] = useState<string | null>(null);

  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  // Which finished week the paste box is pointed at, per pool. Unset means the
  // default: the newest week still missing its picks. Set means Jack opened an
  // older week to correct it, which is the only way a bad paste gets fixed.
  const [weekChoice, setWeekChoice] = useState<Record<string, number>>({});

  // Every pool's board arrives in one payload, so switching is instant and both
  // are priced off the same ownership pull. A stale id (a pool removed between
  // renders) falls back to the first rather than blanking the page.
  const report = reports.find((r) => r.poolId === poolId) ?? reports[0];

  const { pool } = report;
  // The REAL burn set: the hand-edited list plus every pick from a week already
  // gone. Reading pool.usedTeams here meant a pick that burned itself when the
  // week turned was missing from the board with nothing on the grid to say why.
  const usedSet = useMemo(() => new Set(report.burnedTeams), [report.burnedTeams]);
  const boardRead = pool.entriesWeek === report.week ? (pool.entries?.length ?? 0) : 0;
  // SPENT, not burned. A team taken this week is still on this week's board,
  // because it is the answer, and it is still gone for the rest of the season.
  // Every count on the page reads this one: Jack had JAX taken in the 500 and
  // LAC in the 30-player and nothing on the page said either was used up.
  const spentSet = useMemo(() => new Set(report.spentTeams), [report.spentTeams]);
  // Read from the report rather than searched for in candidates. Searching was
  // the bug behind the two screenshots: candidates drops a game once it kicks
  // off, so the 500 board drew a TAKE THIS card for LAC while its own headline
  // said "you have JAX". The engine prices the pick; the page just draws it.
  const taken = report.myPickCandidate;
  const out = !report.status.alive;

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/survivor?pool=${encodeURIComponent(report.poolId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // Locked device (security audit, 2026-11-04): send it to the unlock page.
      if (res.status === 401) {
        router.push("/unlock");
        return;
      }
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

  /**
   * Burn or un-burn a team by hand, for weeks the tool did not see.
   *
   * Seeded from pool.usedTeams, the HAND-EDITED list, and not from the derived
   * burn set. Seeding from the derived set meant one tap copied every
   * pick-derived burn into the manual list permanently, after which clearing a
   * pick left the team burned by a row nobody had typed.
   */
  function toggleBurned(team: string) {
    const next = new Set(report.pool.usedTeams);
    if (next.has(team)) next.delete(team);
    else next.add(team);
    void patch({ usedTeams: [...next] });
  }

  /**
   * Parses the paste (lib/survivor/paste.ts, tested there) and writes it over
   * whichever week the box is pointed at, so re-saving an edited week replaces
   * the old numbers rather than stacking on them.
   */
  function submitPaste() {
    const parsed = parsePickPaste(paste, {
      entriesAlive: report.entriesAlive,
      poolSize: pool.poolSize,
    });
    if (!parsed.ok) {
      setPasteError(parsed.error);
      return;
    }
    setPasteError(null);
    setPasteOpen(false);
    setPaste("");
    void patch({
      weeklyPicks: { ...pool.weeklyPicks, [String(logWeek)]: parsed.picks },
    });
  }

  /**
   * Send a screenshot of the pool's board and store what comes back.
   *
   * The whole board every time, not a diff: it is one upload either way, and a
   * board read fresh each week cannot drift from the site the way an
   * accumulating record would.
   */
  async function uploadBoard(file: File) {
    setBoardBusy(true);
    setBoardError(null);
    setBoardResult(null);
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read that file."));
        reader.readAsDataURL(file);
      });

      const res = await fetch(`/api/survivor/entries?pool=${report.poolId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setBoardError(body.error ?? "The board could not be read.");
        return;
      }
      setBoardResult({
        rows: body.stored,
        alive: body.alive,
        unreadable: body.unreadable ?? 0,
      });
      startTransition(() => router.refresh());
    } catch (e) {
      setBoardError(e instanceof Error ? e.message : "The upload failed.");
    } finally {
      setBoardBusy(false);
    }
  }

  /** Point the box at a week and load what is saved for it, if anything. */
  function openWeek(week: number) {
    setWeekChoice((prev) => ({ ...prev, [report.poolId]: week }));
    setPaste(formatPickPaste(pool.weeklyPicks[String(week)] ?? {}));
    setPasteError(null);
    setPasteOpen(true);
  }

  // The week the log box writes to: the most recent finished week still missing
  // its pool picks, falling back to the last completed week for corrections.
  const defaultLogWeek =
    report.unloggedWeeks.length > 0
      ? report.unloggedWeeks[report.unloggedWeeks.length - 1]
      : Math.max(1, report.week - 1);
  const logWeek = weekChoice[report.poolId] ?? defaultLogWeek;
  // Every week that has finished, plus anything logged under an odd key, so a
  // saved week can always be reached to edit or delete it.
  const finishedWeeks = useMemo(() => {
    const weeks = new Set<number>();
    for (let w = 1; w < report.week; w++) weeks.add(w);
    for (const k of Object.keys(pool.weeklyPicks)) if (Number(k) > 0) weeks.add(Number(k));
    return [...weeks].sort((a, b) => a - b);
  }, [report.week, pool.weeklyPicks]);
  const logWeekSaved = Boolean(pool.weeklyPicks[String(logWeek)]);

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

  const logNeeded = report.unloggedWeeks.length > 0;
  const ownershipSource =
    report.ownership.source === "projected"
      ? `Ownership projected for your pool (${report.calibration.alpha.toFixed(2)}x chalk)`
      : report.ownership.source === "manual"
        ? "Ownership from your logged picks"
        : "Ownership from Yahoo national";

  return (
    <div className="flex flex-col gap-8">
      {reports.length > 1 && (
        <div
          role="tablist"
          aria-label="Survivor pool"
          className="flex gap-1 border-b border-hh-line"
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
                className={`-mb-px flex min-h-11 flex-1 flex-col justify-center border-b-2 px-3 py-2 text-left transition-colors focus:outline-none focus-visible:bg-hh-sunk ${
                  active ? "border-hh-accent" : "border-transparent hover:bg-hh-sunk"
                }`}
              >
                <span className={`text-sm font-semibold ${active ? "text-hh-accent-ink" : "text-hh-ink-2"}`}>
                  {r.pool.name}
                </span>
                {/* Each pool's own answer, so agreement or disagreement is
                    visible without switching tabs. */}
                <span className="text-[11px] text-hh-muted">
                  {r.status.alive ? (
                    <>
                      {r.myPick ?? r.bestTeam ?? "nothing left"}
                      {r.myPick ? " taken" : ""}
                      {" · "}
                      <Num>{r.spentTeams.length}</Num> spent
                    </>
                  ) : (
                    <>
                      Out in week <Num>{r.status.endedBy?.week ?? "?"}</Num>
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Header */}
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="hh-title">Survivor</h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-hh-ink-2">
            Ranked on first-place equity, not weekly safety. Live moneylines,
            public pick percentages, and the cost of burning a team you will want
            in November.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Chip tone="accent">
            Week <Num>{report.week}</Num>
          </Chip>
          {locksIn && !out && (
            <Chip>
              <Lock size={11} aria-hidden />
              Locks in <Num>{locksIn}</Num>
            </Chip>
          )}
          <span className="text-xs text-hh-muted">
            <Num>{report.entriesAlive.toLocaleString()}</Num> entries alive
          </span>
          <span className="text-xs text-hh-muted">
            <Num>{32 - spentSet.size}</Num> teams left
          </span>
          {/* What the pool is playing for. Drives which end of a tie the board
              takes, so it belongs next to the pick rather than buried. */}
          <Chip tone={report.posture.mode === "outright" ? "pos" : "gold"}>
            {report.posture.mode === "outright" ? "Plays for an outright win" : "Plays for a share"}
            <span className="font-normal opacity-80">
              ~
              <Num>
                {report.posture.expectedSurvivors < 10
                  ? report.posture.expectedSurvivors.toFixed(1)
                  : Math.round(report.posture.expectedSurvivors)}
              </Num>{" "}
              left at 18
            </span>
          </Chip>
          <button
            type="button"
            onClick={() => setShowSettings((s) => !s)}
            aria-expanded={showSettings}
            className={`${BTN} ml-auto`}
          >
            <Settings2 size={13} aria-hidden />
            Pool settings
          </button>
        </div>
        <p className="max-w-2xl text-xs leading-relaxed text-hh-muted">{report.posture.summary}</p>
      </header>

      {showSettings && (
        <PoolSettings
          report={report}
          working={working}
          onPatch={patch}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Out of this pool: the page stops asking for anything. */}
      {out && <OutCard report={report} />}

      {!out && (
      <>
      {/* Once a pick is in, it replaces the board. One way back, the button. */}
      {taken && (
        <TakenPick taken={taken} report={report} working={working} onChange={clearPick} />
      )}

      {/* The pick */}
      {taken ? null : best ? (
        <div className="grid gap-8 lg:grid-cols-3">
          <Spotlight label="Take this" className="lg:col-span-2">
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center gap-4">
                <Logo abbr={best.team} size={56} />
                <div className="flex flex-col">
                  <p className="text-3xl font-semibold tracking-tight text-hh-ink sm:text-4xl">
                    <TeamName abbr={best.team} />
                  </p>
                  <p className="text-sm text-hh-ink-2">
                    {best.home ? "vs" : "at"} <TeamName abbr={best.opponent} /> &middot;{" "}
                    {kickoffLabel(best.kickoff)}
                    {best.spread !== null && (
                      <>
                        {" "}&middot; <Num>{best.spread > 0 ? "+" : ""}{best.spread}</Num>
                      </>
                    )}
                  </p>
                </div>
                <div className="ml-auto text-right">
                  <Num tone="accent" className="block text-4xl font-semibold tracking-tight">
                    {pct(best.winProb)}
                  </Num>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-hh-muted">
                    to win
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-y border-hh-line py-4 sm:grid-cols-4">
                <Fig
                  label="Field on it"
                  value={pct(best.ownership)}
                  tone={best.ownership > best.winProb ? "bad" : "default"}
                  hint="Share of entries expected to make this same pick."
                />
                <Fig
                  label="Rivals survive"
                  value={pct(best.fieldSurvival)}
                  hint="Fraction of the field still alive next week if this pick hits."
                />
                <Fig
                  label="Equity"
                  value={`${best.equityMultiplier.toFixed(2)}x`}
                  tone={best.equityMultiplier >= 1 ? "good" : "bad"}
                  hint="Value against an even share of the prize. Above 1.00 means you gain ground."
                />
                <Fig
                  label="Burn cost"
                  value={best.futureCost.toFixed(3)}
                  tone={best.futureCost > 0.05 ? "bad" : "default"}
                  hint="Discounted log-survival given up by burning this team now."
                />
              </div>

              <Flags flags={best.flags} />

              <button
                type="button"
                disabled={working}
                onClick={() => takePick(best.team)}
                className={BTN_PRIMARY}
              >
                <Check size={16} aria-hidden />
                I took {best.team}
              </button>
            </div>
          </Spotlight>

          <div className="flex flex-col gap-8">
            {safest ? (
              <Section label="Safest board">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <Logo abbr={safest.team} size={36} />
                    <div className="flex flex-col">
                      <span className="text-xl font-semibold tracking-tight text-hh-ink">
                        <TeamName abbr={safest.team} />
                      </span>
                      <span className="text-xs text-hh-muted">
                        {safest.home ? "vs" : "at"} <TeamName abbr={safest.opponent} />
                      </span>
                    </div>
                    <Num className="ml-auto text-2xl font-semibold text-hh-ink">{pct(safest.winProb)}</Num>
                  </div>
                  <p className="text-xs leading-relaxed text-hh-ink-2">
                    <Num>{(report.safetyGiveUp * 100).toFixed(1)}</Num> points safer than{" "}
                    {best.team}, but <Num>{pct(safest.ownership)}</Num> of the field is already
                    there. Equity <Num>{safest.equityMultiplier.toFixed(2)}x</Num>.
                  </p>
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => takePick(safest.team)}
                    className={`${BTN} self-start`}
                  >
                    I took {safest.team} instead
                  </button>
                </div>
              </Section>
            ) : (
              <Section label="No trade-off">
                <p className="text-xs leading-relaxed text-hh-ink-2">
                  {best.team} is both the safest board and the best equity this
                  week. Nothing to weigh.
                </p>
              </Section>
            )}

            <Section label="Why">
              <ul className="flex flex-col">
                {report.reasoning.map((r, i) => (
                  <li
                    key={i}
                    className="border-b border-hh-line py-2 text-xs leading-relaxed text-hh-ink-2 last:border-b-0"
                  >
                    {r}
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </div>
      ) : (
        <Spotlight label="No pick">
          <p className="text-sm font-semibold text-hh-ink">{report.headline}</p>
          <p className="mt-1 text-sm text-hh-ink-2">
            Every team playing this week is already burned, or the slate has
            locked.
          </p>
        </Spotlight>
      )}

      {/* Notes */}
      {report.notes.length > 0 && (
        <ul className="flex flex-col">
          {report.notes.map((n, i) => (
            <li
              key={i}
              className="flex items-start gap-2.5 border-b border-hh-line py-2.5 last:border-b-0"
            >
              <Info size={13} aria-hidden className="mt-0.5 shrink-0 text-hh-muted" />
              <span className="text-xs leading-relaxed text-hh-ink-2">{n}</span>
            </li>
          ))}
        </ul>
      )}

      {/* The board, hidden once the decision is made. */}
      {!taken && rest.length > 0 && (
        <Section label="The rest of the board" aside={ownershipSource}>
          <ul className="flex flex-col">
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
              className={`${BTN} mt-3`}
            >
              <ChevronDown
                size={13}
                aria-hidden
                className={showAll ? "rotate-180 transition-transform" : "transition-transform"}
              />
              {showAll
                ? "Show fewer"
                : <>Show all <Num>{report.candidates.length}</Num> legal picks</>}
            </button>
          )}
        </Section>
      )}

      {/* Log last week, which is the only recurring input the tool asks for.
          A finished week still waiting for its picks keeps a visible line above the fold of the box. */}
      <Section
        label={
          logNeeded
            ? `Log Week ${logWeek}`
            : nothingToLogYet
              ? "Pool history"
              : `${report.field.weeksLogged} week(s) logged`
        }
        aside={logNeeded ? <Chip tone="gold">Needs your paste</Chip> : undefined}
      >
        <p className="max-w-xl text-xs leading-relaxed text-hh-ink-2">
          {logNeeded
            ? `Week ${logWeek} is finished, so your pool now shows what everyone picked. Paste it once and three things update: how far your pool leans off the public, which teams the field has burned, and how many entries are left.`
            : nothingToLogYet
              ? "Nothing to log yet. Once a week finishes, your pool shows what everyone picked and which teams they have used. Paste that here and the ownership numbers stop being Yahoo's public estimate and start being your pool."
              : "Every finished week is in, so the ownership numbers are projected for your pool rather than taken from Yahoo alone."}
        </p>

        <Disclosure summary="Field logging and screenshots" className="mt-2">
          <div className="flex flex-col gap-4">
            {!nothingToLogYet && !report.board && (
              <button
                type="button"
                onClick={() => (pasteOpen ? setPasteOpen(false) : openWeek(logWeek))}
                className={logNeeded ? `${BTN_PRIMARY} self-start text-xs` : `${BTN} self-start`}
              >
                {pasteOpen
                  ? "Close"
                  : logNeeded
                    ? `Paste Week ${logWeek} picks`
                    : "Edit logged weeks"}
              </button>
            )}

            {pasteOpen && !report.board && (
              <div className="flex flex-col gap-2 border-t border-hh-line pt-3">
                {finishedWeeks.length > 1 && (
                  <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Week to log">
                    {finishedWeeks.map((w) => {
                      const saved = Boolean(pool.weeklyPicks[String(w)]);
                      const active = w === logWeek;
                      return (
                        <button
                          key={w}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => openWeek(w)}
                          className={`inline-flex h-11 items-center gap-1 rounded-[6px] border px-2.5 text-[11px] font-semibold transition-colors focus:outline-none focus-visible:border-hh-accent sm:h-8 ${
                            active
                              ? "border-hh-accent bg-hh-accent text-[var(--hh-on-accent)]"
                              : saved
                                ? "border-hh-line bg-hh-panel text-hh-ink-2 hover:border-hh-accent"
                                : "border-dashed border-hh-gold text-hh-gold hover:bg-hh-sunk"
                          }`}
                        >
                          Wk <Num>{w}</Num>
                          {saved ? <Check size={11} aria-label="logged" /> : null}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs text-hh-ink-2">
                  {logWeekSaved
                    ? `Week ${logWeek} as saved. Change any line and update, or delete the week to log it again from scratch.`
                    : "One team per line, team code then percentage (or a head count in a small pool). Any separator, and a partial list is fine."}
                </p>
                <textarea
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  rows={6}
                  placeholder={"LAC 32.2%\nJAX 21.7%\nDET 18.2%"}
                  className="rounded-[6px] border border-hh-line bg-hh-panel px-3 py-2 font-mono text-[16px] text-hh-ink placeholder:text-hh-muted focus:border-hh-accent focus:outline-none sm:text-xs"
                />
                {pasteError && (
                  <p className="flex items-center gap-1.5 text-xs text-hh-neg">
                    <AlertTriangle size={12} aria-hidden />
                    {pasteError}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={working}
                    onClick={submitPaste}
                    className={`${BTN_PRIMARY} text-xs`}
                  >
                    {logWeekSaved ? "Update" : "Save"} Week {logWeek}
                  </button>
                  {logWeekSaved && (
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => {
                        const next = { ...pool.weeklyPicks };
                        delete next[String(logWeek)];
                        void patch({ weeklyPicks: next });
                        setPasteOpen(false);
                        setPaste("");
                      }}
                      className={`${BTN} hover:!border-hh-neg hover:!text-hh-neg`}
                    >
                      Delete Week {logWeek}
                    </button>
                  )}
                </div>
              </div>
            )}

            {report.board?.source === "sleeper" ? (
              <div className="flex flex-col gap-1 border-t border-hh-line pt-3">
                <p className="text-xs font-semibold text-hh-ink">Read live from Sleeper</p>
                <p className="text-xs text-hh-ink-2">
                  All <Num>{report.board.entries.toLocaleString()}</Num> entries and their whole pick history,
                  straight off the league. <Num>{report.board.alive}</Num> alive,{" "}
                  <Num>{report.board.untouched.length}</Num> teams nobody surviving has used. Nothing to paste
                  and nothing to keep in step.
                </p>
              </div>
            ) : null}

            {report.board?.source !== "sleeper" && (
              /* The board itself, read from a screenshot.
                 Percentages answer this week. Rows answer the season: which
                 entries are carrying which burned teams, which is the thing the
                 model can only estimate. */
              <div className="flex flex-col gap-2 border-t border-hh-line pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-hh-ink">Read the board from a screenshot</p>
                    <p className="text-xs text-hh-ink-2">
                      {boardRead
                        ? `${boardRead} rows stored, so burned teams and the count left are exact rather than modelled.`
                        : "Screenshot the pool's grid of names and picks. Every entry, every week, read row by row."}
                    </p>
                  </div>
                  <label
                    className={`${BTN} shrink-0 cursor-pointer focus-within:border-hh-accent ${
                      boardBusy ? "!cursor-default bg-hh-sunk text-hh-muted" : ""
                    }`}
                  >
                    {boardBusy ? "Reading..." : boardRead ? "Upload a newer one" : "Upload screenshot"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      disabled={boardBusy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void uploadBoard(file);
                      }}
                    />
                  </label>
                </div>
                {boardResult && (
                  <p className="text-xs text-hh-pos">
                    Read <Num>{boardResult.rows}</Num> entries, <Num>{boardResult.alive}</Num> still alive.
                    {boardResult.unreadable > 0
                      ? ` ${boardResult.unreadable} pick${boardResult.unreadable === 1 ? "" : "s"} could not be identified, so check those rows.`
                      : ""}
                  </p>
                )}
                {boardError && (
                  <p className="flex items-center gap-1.5 text-xs text-hh-neg">
                    <AlertTriangle size={12} aria-hidden />
                    {boardError}
                  </p>
                )}
              </div>
            )}

            {report.field.weeksLogged > 0 && !report.board && (
              <div className="grid gap-4 border-t border-hh-line pt-3 sm:grid-cols-3">
                <Fig
                  label="Entries left"
                  value={report.field.entriesAlive.toLocaleString()}
                  hint="Derived from the picks you logged and the results, not typed in."
                />
                <Fig
                  label="Chalk factor"
                  value={`${report.calibration.alpha.toFixed(2)}x`}
                  tone={report.calibration.alpha > 1.15 ? "accent" : "default"}
                  hint="Above 1 means your pool crowds the favourite harder than the public does."
                />
                <Fig
                  label="Fit confidence"
                  value={report.calibration.confidence}
                  hint={`Based on ${report.calibration.weeks} logged week(s).`}
                />
              </div>
            )}

            {burnedByField.length > 0 && (
              <div className="flex flex-col gap-2 border-t border-hh-line pt-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-hh-muted">
                  What the field has burned
                </span>
                <ul className="flex flex-wrap gap-1.5">
                  {burnedByField.map(([team, share]) => (
                    <li
                      key={team}
                      className="inline-flex items-center gap-1.5 rounded-[4px] border border-hh-line px-2 py-1"
                    >
                      <Logo abbr={team} size={16} />
                      <span className="text-[11px] font-semibold text-hh-ink">{team}</span>
                      <Num className="text-[11px] text-hh-muted">{pct(share, 0)}</Num>
                    </li>
                  ))}
                </ul>
                <p className="text-xs leading-relaxed text-hh-ink-2">
                  These are unavailable to that share of the surviving field. If
                  you still hold one for a week it is a big favourite, most of the
                  pool cannot follow you.
                </p>
              </div>
            )}
          </div>
        </Disclosure>
      </Section>

      {/* Plan */}
      {report.plan.length > 1 && (
        <Disclosure
          summary={
            <>
              Path from here: <Num>{pct(report.planSurvival)}</Num> to survive all{" "}
              <Num>{report.plan.length}</Num> weeks
            </>
          }
        >
          <ul className="grid grid-cols-2 gap-x-4 sm:grid-cols-4 lg:grid-cols-8">
            {report.plan.map((p) => (
              <li
                key={p.week}
                className={`flex flex-col gap-1.5 border-b py-3 ${
                  p.week === report.week ? "border-hh-accent" : "border-hh-line"
                }`}
              >
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider ${
                    p.week === report.week ? "text-hh-accent-ink" : "text-hh-muted"
                  }`}
                >
                  Week <Num>{p.week}</Num>
                </span>
                <div className="flex items-center gap-1.5">
                  <Logo abbr={p.team} size={20} />
                  <span className="text-sm font-semibold text-hh-ink">
                    {p.week === report.week ? <TeamName abbr={p.team} /> : p.team}
                  </span>
                </div>
                <span className="text-[11px] text-hh-muted">
                  {p.home ? "vs" : "at"} {p.opponent} &middot; <Num>{pct(p.winProb, 0)}</Num>
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      {/* Used teams */}
      <Section
        label="Teams burned"
        aside={
          <>
            <Num>{spentSet.size}</Num> of <Num>32</Num> used, this week&rsquo;s pick included. Your picks
            spend themselves, so tap only to record one the tool never saw.
          </>
        }
      >
        <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
          {NFL_TEAMS.map((t) => {
            const isUsed = usedSet.has(t.abbr);
            // Burned by one of your own logged picks rather than by hand. Those
            // are derived, so a tap here could not clear them and would silently
            // edit the manual list instead.
            const byPick = report.burnedByPick[t.abbr];
            // Taken THIS week: spent, but not struck through, because it is the
            // answer and its numbers are what the rest of the page is about.
            // Left plain it read as available, which is the whole complaint.
            const isTaken = report.myPick === t.abbr;
            return (
              <li key={t.abbr}>
                <button
                  type="button"
                  disabled={working || byPick !== undefined || isTaken}
                  onClick={() => toggleBurned(t.abbr)}
                  aria-pressed={isUsed || isTaken}
                  title={
                    isTaken
                      ? `Your pick this week, so it is spent from next week on`
                      : byPick !== undefined
                        ? `Your week ${byPick} pick`
                        : undefined
                  }
                  className={`flex min-h-[44px] w-full flex-col items-center justify-center gap-1 rounded-[6px] border px-1 py-2 transition-colors focus:outline-none focus-visible:border-hh-accent disabled:opacity-50 ${
                    isTaken
                      ? "border-hh-accent bg-hh-accent-soft"
                      : isUsed
                        ? "border-hh-line bg-hh-sunk"
                        : "border-hh-line bg-hh-panel hover:border-hh-accent"
                  }`}
                >
                  <span className={isUsed ? "opacity-30 grayscale" : ""}>
                    <Logo abbr={t.abbr} size={22} />
                  </span>
                  <span
                    className={`text-[10px] font-bold ${
                      isUsed ? "text-hh-muted line-through" : "text-hh-ink-2"
                    }`}
                  >
                    {t.abbr}
                  </span>
                  {isTaken && (
                    <Num className="text-[9px] font-semibold text-hh-accent-ink">W{report.week}</Num>
                  )}
                  {byPick !== undefined && (
                    <Num className="text-[9px] font-semibold text-hh-accent-ink">W{byPick}</Num>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </Section>
      </>
      )}
    </div>
  );
}

/**
 * The pool is over for Jack. Says how, shows the season that got him there,
 * and states plainly that nothing on this page or in the email needs him now.
 */
function OutCard({ report }: { report: SurvivorReport }) {
  const { endedBy, record } = report.status;
  const lasted = endedBy ? endedBy.week - 1 : record.length;
  return (
    <Spotlight label={`Out of the ${report.pool.name}`}>
      <div className="flex flex-col gap-5">
        {endedBy && (
          <div className="flex flex-wrap items-center gap-4">
            <Logo abbr={endedBy.team} size={48} />
            <div className="flex flex-col gap-0.5">
              <p className="text-2xl font-semibold tracking-tight text-hh-ink sm:text-3xl">
                {endedBy.team} {endedBy.result === "T" ? "tied" : "lost"}{" "}
                <Num>
                  {endedBy.teamScore}&ndash;{endedBy.oppScore}
                </Num>
              </p>
              <p className="text-sm text-hh-ink-2">
                {endedBy.home ? "vs" : "at"} {endedBy.opponent} &middot; week <Num>{endedBy.week}</Num>
              </p>
            </div>
          </div>
        )}

        <ol className="flex flex-wrap gap-2" aria-label="Your picks this season">
          {record.map((p) => (
            <li
              key={p.week}
              className={`inline-flex items-center gap-1.5 rounded-[4px] border px-2.5 py-1.5 text-xs ${
                p.result === "W"
                  ? "border-hh-line text-hh-pos"
                  : "border-hh-neg bg-[var(--hh-neg-soft)] text-hh-neg"
              }`}
            >
              <Num className="font-semibold">W{p.week}</Num>
              <Logo abbr={p.team} size={16} />
              {p.team}
              <Num className="opacity-70">
                {p.teamScore}&ndash;{p.oppScore}
              </Num>
            </li>
          ))}
        </ol>

        <p className="max-w-2xl text-sm leading-relaxed text-hh-ink-2">
          Survived <Num>{lasted}</Num> week{lasted === 1 ? "" : "s"}.{" "}
          <Num>{report.entriesAlive.toLocaleString()}</Num> of{" "}
          <Num>{report.pool.poolSize.toLocaleString()}</Num> entries are still going. Nothing here needs you
          until next season: the emails and the Sunday alarm have dropped this pool, and the board
          resets on its own in August.
        </p>
      </div>
    </Spotlight>
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
    <li className="border-b border-hh-line last:border-b-0">
      <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Num className="w-5 shrink-0 text-right text-xs font-semibold text-hh-muted">{rank}</Num>
          <Logo abbr={c.team} size={30} />
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold text-hh-ink">
              <TeamName abbr={c.team} />{" "}
              <span className="font-normal text-hh-muted">
                {c.home ? "vs" : "at"} <TeamName abbr={c.opponent} />
              </span>
            </span>
            <span className="text-[11px] text-hh-muted">{kickoffLabel(c.kickoff)}</span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3 sm:w-[420px] sm:shrink-0">
          <Fig label="Win" value={pct(c.winProb)} />
          <Fig
            label="Field"
            value={pct(c.ownership)}
            tone={c.ownership > c.winProb ? "bad" : "default"}
          />
          <Fig
            label="Equity"
            value={`${c.equityMultiplier.toFixed(2)}x`}
            tone={c.equityMultiplier >= 1 ? "good" : "default"}
          />
          <Fig
            label="Burn cost"
            value={c.futureCost.toFixed(3)}
            tone={c.futureCost > 0.05 ? "bad" : "default"}
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Fixed width even when empty: a candidate with no notes used to pull
              its whole stat block sideways and break the column alignment. */}
          <div className="w-[76px] shrink-0">
            {c.flags.length > 0 && (
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className={`${BTN} w-full px-2 text-[11px]`}
              >
                <Num>{c.flags.length}</Num> note{c.flags.length > 1 ? "s" : ""}
              </button>
            )}
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={onTake}
            className={`${BTN} text-[11px]`}
          >
            Took it
          </button>
        </div>
      </div>

      {open && c.flags.length > 0 && (
        <div className="border-t border-hh-line py-3 pl-8">
          <Flags flags={c.flags} />
        </div>
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
    <Section
      label="Pool settings"
      aside={
        <button type="button" onClick={onClose} className={BTN}>
          Done
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Entries at start</span>
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
              className={`${INPUT} hh-num`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Still alive</span>
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
              className={`${INPUT} hh-num`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Weeks to plan</span>
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
              className={`${INPUT} hh-num`}
            />
          </label>
        </div>

        <p className="text-xs leading-relaxed text-hh-muted">
          Update &quot;still alive&quot; as the pool thins out. Leverage is measured
          against the entries left, not the ones that started, so the number matters
          more in November than it does now. Future value always solves to Week 18
          regardless of the planning window.
        </p>

        <button
          type="button"
          disabled={working || pool.usedTeams.length === 0}
          onClick={() => void onPatch({ usedTeams: [] })}
          className={`${BTN} self-start hover:!border-hh-neg hover:!text-hh-neg disabled:opacity-40`}
        >
          <RotateCcw size={13} aria-hidden />
          Clear hand-burned teams
        </button>
      </div>
    </Section>
  );
}
