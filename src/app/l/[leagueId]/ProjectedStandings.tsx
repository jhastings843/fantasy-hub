import { Chip, Disclosure, Num, Section } from "@/components/hh/ui";
import { getLeagueProjection } from "@/lib/league/projection-data";

// Projected end-of-season standings, under the real standings on a league page.
// Reads first: where each team is likely to finish and the one number that
// decides the season (playoff odds, or survival in a guillotine league).

const pct = (x: number) => {
  const p = x * 100;
  if (p > 0 && p < 1) return "<1%";
  if (p < 100 && p > 99) return ">99%";
  return `${Math.round(p)}%`;
};

const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

function Bar({ value }: { value: number }) {
  return (
    <span aria-hidden className="block h-1 w-full overflow-hidden rounded-full bg-hh-sunk">
      <span className="block h-full rounded-full bg-hh-accent" style={{ width: `${Math.max(2, Math.round(value * 100))}%` }} />
    </span>
  );
}

function Delta({ now, prior }: { now: number; prior: number | undefined }) {
  if (prior === undefined) return null;
  const d = Math.round((now - prior) * 100);
  if (Math.abs(d) < 2) return null;
  return (
    <Num tone={d > 0 ? "pos" : "neg"} className="text-[11px] font-semibold">
      {d > 0 ? "+" : ""}
      {d}
    </Num>
  );
}

export async function ProjectedStandings({
  leagueId,
  names,
  myRosterId,
  chopped,
}: {
  leagueId: string;
  names: Record<number, string>;
  myRosterId: number | null;
  chopped: [number, number][];
}) {
  const p = await getLeagueProjection(leagueId, new Map(chopped)).catch(() => null);
  if (!p) return null;
  const g = p.format === "guillotine";
  const done = p.weeksLeft === 0;
  const keyOdds = (t: (typeof p.teams)[number]) => (g ? (t.champPct ?? 0) : t.playoffPct);

  return (
    <Section
      label="Projected finish"
      aside={
        done ? (
          <>Regular season over</>
        ) : (
          <>
            {g ? (
              <><Num>{p.teams.length - chopped.length}</Num> teams alive</>
            ) : (
              <><Num>{p.weeksLeft}</Num> week{p.weeksLeft === 1 ? "" : "s"} left</>
            )} · <Num>{p.sims.toLocaleString()}</Num> sims
          </>
        )
      }
    >
      {p.teams.length > 0 && myRosterId !== null && (() => {
        const place = p.teams.findIndex((t) => t.rosterId === myRosterId);
        const mine = p.teams[place];
        if (!mine || done) return null;
        return (
          <p className="mb-3 text-sm text-hh-ink-2">
            You: projected <b className="font-semibold text-hh-ink">{ord(place + 1)}</b>,{" "}
            {g ? <>wins it <Chip tone="accent">{pct(mine.champPct ?? 0)}</Chip></> : <>playoffs <Chip tone={mine.playoffPct >= 0.5 ? "pos" : "neg"}>{pct(mine.playoffPct)}</Chip></>}
          </p>
        );
      })()}
      <div className="flex items-center justify-end gap-3 pb-1 text-[11px] uppercase tracking-wider text-hh-muted">
        <span className="w-16 text-right">{g ? "Out" : "Record"}</span>
        <span className="w-20 text-right">{g ? "Wins it" : `Top ${p.playoffTeams}`}</span>
        {!g && p.teams[0]?.champPct !== null && <span className="hidden w-12 text-right sm:inline">Title</span>}
      </div>
      <ol className="flex flex-col">
        {p.teams.map((t, i) => {
          const isMe = t.rosterId === myRosterId;
          const out = g ? chopped.find(([id]) => id === t.rosterId)?.[1] : undefined;
          const odds = keyOdds(t);
          return (
            <li
              key={t.rosterId}
              className={`flex min-h-11 items-center justify-between gap-3 border-b border-hh-line py-2 last:border-b-0 ${isMe ? "-mx-2 bg-hh-sunk px-2" : ""}`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <Num className="w-7 shrink-0 text-sm text-hh-muted">{ord(i + 1)}</Num>
                <span className="truncate text-sm font-medium text-hh-ink">
                  {names[t.rosterId] ?? `Team ${t.rosterId}`}
                  {isMe ? " (you)" : ""}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="w-16 text-right text-xs text-hh-ink-2">
                  {g ? (
                    out ? <span className="text-hh-muted">wk <Num>{out}</Num></span> : t.chopWeek ? <>wk <Num>{t.chopWeek}</Num></> : <span className="text-hh-muted">lasts</span>
                  ) : (
                    <Num>
                      {t.wins.toFixed(1)}-{t.losses.toFixed(1)}
                    </Num>
                  )}
                </span>
                <span className="flex w-20 flex-col items-end gap-1">
                  <span className="flex items-baseline gap-1.5">
                    <Delta now={odds} prior={p.prior?.[t.rosterId]} />
                    <Num className={`text-sm font-semibold ${odds >= 0.5 ? "text-hh-ink" : "text-hh-ink-2"}`}>{pct(odds)}</Num>
                  </span>
                  <Bar value={odds} />
                </span>
                {!g && t.champPct !== null && (
                  <Num className="hidden w-12 text-right text-xs text-hh-ink-2 sm:inline">{pct(t.champPct)}</Num>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <Disclosure summary="How this is projected" className="mt-3">
        <p className="text-xs leading-relaxed text-hh-muted">
          Plays out the rest of the {g ? "season" : "regular season"} {p.sims.toLocaleString()} times from each roster as it stands
          today. Every week, each team scores around its best projected lineup for that week (Sleeper player projections in this
          league&apos;s scoring, so byes and injuries count), plus <Num>{p.offset.toFixed(1)}</Num> points to match what teams here
          have actually scored the last few weeks.{" "}
          {g
            ? "The low score is chopped each week until one team is left. Out is the most likely chop week."
            : `Real schedule, wins then points for as the tiebreak${p.teams[0]?.champPct !== null ? ", then the playoff bracket for title odds" : ""}. Record is the average.`}{" "}
          Teams are ordered by average finish. Green and red numbers are the move since last week. Updates when a week is scored and
          every few hours as rosters change. Trades and waiver adds after today are not foreseen.
        </p>
      </Disclosure>
    </Section>
  );
}
