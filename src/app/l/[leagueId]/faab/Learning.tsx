import { GraduationCap } from "lucide-react";
import type { GuillotineLearning } from "@/lib/guillotine/learn-build";
import { Chip, Disclosure, Num, Section, type Tone } from "@/components/hh/ui";
import { PlayerLink } from "@/components/PlayerLink";

// What the room's record has taught the model. Lessons first (the part you
// act on), then the evidence: how each rival bids, how our own bids went, and
// the scoreboards that fill in as weeks are saved.

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <h3 className="hh-label">{children}</h3>;
}

function Lean({ value, typical }: { value: number; typical: number }) {
  const rel = value / typical;
  const tone: Tone = rel >= 1.1 ? "neg" : rel <= 0.8 ? "pos" : "muted";
  const word = rel >= 1.1 ? "pushes" : rel <= 0.8 ? "soft" : "normal";
  return (
    <Chip tone={tone}>
      <Num>{value.toFixed(2)}x</Num> <span className="font-medium opacity-80">{word}</span>
    </Chip>
  );
}

export function RoomLearning({ learning }: { learning: GuillotineLearning }) {
  const { summary, room } = learning;
  const alive = learning.rivals.filter((r) => r.alive);
  const recent = learning.ours.slice(0, 10);
  const graded = learning.shadows.find((s) => s.id === "live")?.weeks ?? 0;

  return (
    <Section
      label={
        <span className="inline-flex items-center gap-1.5">
          <GraduationCap size={14} className="text-hh-accent-ink" aria-hidden />
          What the room has taught us
        </span>
      }
      aside={
        <>
          <Num>{learning.bidsSeen}</Num> bids over <Num>{learning.legs}</Num> waiver runs
        </>
      }
    >

      {learning.lessons.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {learning.lessons.map((l) => (
            <li key={l} className="border-l-2 border-hh-accent pl-3 text-sm leading-relaxed text-hh-ink-2">
              {l}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-hh-muted">Nothing the record says clearly yet.</p>
      )}

      <Disclosure summary="The evidence: rivals, our bids, replays" className="mt-3">
      <div className="mt-2 grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <Eyebrow>How the survivors bid</Eyebrow>
          <p className="mt-1 text-xs leading-relaxed text-hh-muted">
            Head to head: their bid against the middle bid on the same player. The toughest bidder in a typical
            contested auction here runs <Num>{room.typical.toFixed(2)}x</Num>, and the card
            only moves a price for a rival past or well under that.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[22rem] text-sm">
              <thead>
                <tr className="border-b border-hh-rule text-left text-[11px] uppercase tracking-wide text-hh-muted">
                  <th className="pb-2 font-medium">Team</th>
                  <th className="pb-2 pr-2 font-medium">Head to head</th>
                  <th className="pb-2 text-right font-medium">Won</th>
                  <th className="pb-2 pl-2 text-right font-medium">Left</th>
                  <th className="pb-2 pl-2 text-right font-medium">Top bid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hh-line">
                {alive.map((r) => (
                  <tr key={r.rosterId}>
                    <td className="max-w-[9rem] truncate py-2 pr-2 text-hh-ink">{r.name}</td>
                    <td className="py-2 pr-2">
                      {r.contested >= 3 ? (
                        <Lean value={r.aggression} typical={room.typical} />
                      ) : (
                        <span className="text-xs text-hh-muted"><Num>{r.contested}</Num> contested</span>
                      )}
                    </td>
                    <td className="py-2 text-right text-hh-ink-2">
                      <Num>{r.wins}/{r.bids}</Num>
                    </td>
                    <td className="py-2 pl-2 text-right text-hh-ink-2"><Num>{money(r.faabLeft)}</Num></td>
                    <td className="py-2 pl-2 text-right text-hh-muted" title="Largest bid as a share of the FAAB they had going into that waiver run">
                      <Num>{Math.round(r.maxShare * 100)}%</Num>
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
          <ul className="mt-4 divide-y divide-hh-line">
            {recent.map((b) => (
              <li key={`${b.leg}-${b.playerId}`} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="hh-num w-7 shrink-0 text-[11px] text-hh-muted">W{b.leg}</span>
                  <span className="min-w-0 truncate text-hh-ink">{learning.oursNamed[b.playerId] ? <PlayerLink id={b.playerId} name={learning.oursNamed[b.playerId]} /> : null}</span>
                </span>
                <span className="shrink-0 text-right text-xs">
                  <Num className="text-hh-muted">{money(b.amount)} </Num>
                  {b.won ? (
                    <span className="font-semibold text-hh-pos">
                      won{b.runnerUp !== null ? <>, next <Num>{money(b.runnerUp)}</Num></> : ", alone"}
                    </span>
                  ) : (
                    <span className="font-semibold text-hh-neg">lost to <Num>{money(b.price)}</Num></span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6 grid gap-6 border-t border-hh-line pt-5 lg:grid-cols-2">
        <div className="min-w-0">
          <Eyebrow>Other ways to bid, replayed</Eyebrow>
          {graded === 0 ? (
            <p className="mt-2 text-sm leading-relaxed text-hh-muted">
              {learning.savedCards > 0
                ? `${learning.savedCards} card${learning.savedCards === 1 ? "" : "s"} saved. Each is graded once its waivers run and the games after are played.`
                : "Starts with next Tuesday's card. Sleeper keeps every bid but not what we were about to do, so each week's card is saved before waivers run."}
            </p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <tbody className="divide-y divide-hh-line">
                {learning.shadows.map((s) => (
                  <tr key={s.id} className={s.id === "live" ? "font-semibold" : ""}>
                    <td className="py-1.5 text-hh-ink">{s.label}</td>
                    <td className="py-1.5 text-right text-hh-muted"><Num>{s.claims}</Num> claims</td>
                    <td className="py-1.5 text-right text-hh-muted"><Num>{money(s.spent)}</Num></td>
                    <td className="py-1.5 text-right text-hh-ink">
                      <Num>{s.pointsAdded >= 0 ? "+" : ""}{s.pointsAdded.toFixed(1)}</Num> pts
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
            <p className="mt-2 text-sm leading-relaxed text-hh-muted">
              Graded from the first saved week on: the odds we gave the team that actually got chopped.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-hh-line">
              {learning.chops.map((c) => (
                <li key={c.week} className="flex justify-between gap-3 py-1.5 text-sm">
                  <span className="text-hh-ink">Week <Num>{c.week}</Num></span>
                  <span className="text-xs text-hh-muted">
                    chopped team was <Num>#{c.rankOfChopped}</Num> at <Num>{(c.givenToChopped * 100).toFixed(0)}%</Num>, ours{" "}
                    <Num>{(c.myProbability * 100).toFixed(0)}%</Num>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      </Disclosure>
    </Section>
  );
}

function Mini({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "rose" }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-hh-muted">{label}</div>
      <div
        className={`hh-num mt-0.5 text-base font-semibold ${tone === "rose" ? "text-hh-neg" : "text-hh-ink"}`}
      >
        {value}
      </div>
      {hint ? <div className="text-[11px] leading-snug text-hh-muted">{hint}</div> : null}
    </div>
  );
}
