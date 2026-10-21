import { GraduationCap } from "lucide-react";
import type { GuillotineLearning } from "@/lib/guillotine/learn-build";

// What the room's record has taught the model. Lessons first (the part you
// act on), then the evidence: how each rival bids, how our own bids went, and
// the scoreboards that fill in as weeks are saved.

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{children}</h3>;
}

function Lean({ value, typical }: { value: number; typical: number }) {
  const rel = value / typical;
  const tone =
    rel >= 1.1
      ? "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300"
      : rel <= 0.8
        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  const word = rel >= 1.1 ? "pushes" : rel <= 0.8 ? "soft" : "normal";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${tone}`}>
      {value.toFixed(2)}x <span className="font-medium opacity-80">{word}</span>
    </span>
  );
}

export function RoomLearning({ learning }: { learning: GuillotineLearning }) {
  const { summary, room } = learning;
  const alive = learning.rivals.filter((r) => r.alive);
  const recent = learning.ours.slice(0, 10);
  const graded = learning.shadows.find((s) => s.id === "live")?.weeks ?? 0;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          <GraduationCap size={18} className="text-amber-500" aria-hidden />
          What the room has taught us
        </h2>
        <p className="text-xs tabular-nums text-zinc-500">
          {learning.bidsSeen} bids over {learning.legs} waiver runs
        </p>
      </div>

      {learning.lessons.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2">
          {learning.lessons.map((l) => (
            <li key={l} className="border-l-2 border-amber-500 pl-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
              {l}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-zinc-500">Nothing the record says clearly yet.</p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <Eyebrow>How the survivors bid</Eyebrow>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            Head to head: their bid against the middle bid on the same player. The toughest bidder in a typical
            contested auction here runs <span className="tabular-nums">{room.typical.toFixed(2)}x</span>, and the card
            only moves a price for a rival past or well under that.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[22rem] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                  <th className="pb-2 font-medium">Team</th>
                  <th className="pb-2 pr-2 font-medium">Head to head</th>
                  <th className="pb-2 text-right font-medium">Won</th>
                  <th className="pb-2 pl-2 text-right font-medium">Left</th>
                  <th className="pb-2 pl-2 text-right font-medium">Top bid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                {alive.map((r) => (
                  <tr key={r.rosterId}>
                    <td className="max-w-[9rem] truncate py-2 pr-2 text-zinc-700 dark:text-zinc-300">{r.name}</td>
                    <td className="py-2 pr-2">
                      {r.contested >= 3 ? (
                        <Lean value={r.aggression} typical={room.typical} />
                      ) : (
                        <span className="text-xs text-zinc-400">{r.contested} contested</span>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                      {r.wins}/{r.bids}
                    </td>
                    <td className="py-2 pl-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{money(r.faabLeft)}</td>
                    <td className="py-2 pl-2 text-right tabular-nums text-zinc-500" title="Largest bid as a share of the FAAB they had going into that waiver run">
                      {Math.round(r.maxShare * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="min-w-0">
          <Eyebrow>Our bids</Eyebrow>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Mini label="Won" value={`${summary.wins}/${summary.bids}`} />
            <Mini label="Spent" value={money(summary.spent)} />
            <Mini
              label="Pts per $"
              value={summary.pointsPerDollar === null ? "n/a" : summary.pointsPerDollar.toFixed(2)}
              hint="started points"
            />
            <Mini label="Overpaid" value={money(summary.overpaid)} hint={`${summary.contestedWins} contested wins`} tone="rose" />
            <Mini label="Unopposed" value={money(summary.uncontestedExtra)} hint={`over $1, ${summary.uncontestedWins} wins`} />
            <Mini label="Near misses" value={String(summary.nearMisses)} hint="lost within 10%" />
          </div>
          <ul className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {recent.map((b) => (
              <li key={`${b.leg}-${b.playerId}`} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-7 shrink-0 font-mono text-[11px] text-zinc-400">W{b.leg}</span>
                  <span className="truncate text-zinc-700 dark:text-zinc-300">{learning.oursNamed[b.playerId]}</span>
                </span>
                <span className="shrink-0 text-right text-xs tabular-nums">
                  <span className="text-zinc-500">{money(b.amount)} </span>
                  {b.won ? (
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      won{b.runnerUp !== null ? `, next ${money(b.runnerUp)}` : ", alone"}
                    </span>
                  ) : (
                    <span className="font-semibold text-rose-600 dark:text-rose-400">lost to {money(b.price)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6 grid gap-6 border-t border-zinc-200/70 pt-5 lg:grid-cols-2 dark:border-zinc-800">
        <div className="min-w-0">
          <Eyebrow>Other ways to bid, replayed</Eyebrow>
          {graded === 0 ? (
            <p className="mt-2 text-sm leading-relaxed text-zinc-500">
              {learning.savedCards > 0
                ? `${learning.savedCards} card${learning.savedCards === 1 ? "" : "s"} saved. Each is graded once its waivers run and the games after are played.`
                : "Starts with next Tuesday's card. Sleeper keeps every bid but not what we were about to do, so each week's card is saved before waivers run."}
            </p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                {learning.shadows.map((s) => (
                  <tr key={s.id} className={s.id === "live" ? "font-semibold" : ""}>
                    <td className="py-1.5 text-zinc-700 dark:text-zinc-300">{s.label}</td>
                    <td className="py-1.5 text-right tabular-nums text-zinc-500">{s.claims} claims</td>
                    <td className="py-1.5 text-right tabular-nums text-zinc-500">{money(s.spent)}</td>
                    <td className="py-1.5 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                      {s.pointsAdded >= 0 ? "+" : ""}
                      {s.pointsAdded.toFixed(1)} pts
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="min-w-0">
          <Eyebrow>Were the chop odds honest</Eyebrow>
          {learning.chops.length === 0 ? (
            <p className="mt-2 text-sm leading-relaxed text-zinc-500">
              Graded from the first saved week on: the odds we gave the team that actually got chopped.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800/70">
              {learning.chops.map((c) => (
                <li key={c.week} className="flex justify-between gap-3 py-1.5 text-sm">
                  <span className="text-zinc-700 dark:text-zinc-300">Week {c.week}</span>
                  <span className="text-xs tabular-nums text-zinc-500">
                    chopped team was #{c.rankOfChopped} at {(c.givenToChopped * 100).toFixed(0)}%, ours{" "}
                    {(c.myProbability * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function Mini({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "rose" }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div
        className={`mt-0.5 text-base font-semibold tabular-nums ${tone === "rose" ? "text-rose-600 dark:text-rose-400" : "text-zinc-900 dark:text-zinc-100"}`}
      >
        {value}
      </div>
      {hint ? <div className="text-[11px] leading-snug text-zinc-500">{hint}</div> : null}
    </div>
  );
}
