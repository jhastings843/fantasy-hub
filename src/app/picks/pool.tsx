import Image from "next/image";
import { getPoolView, type PoolView } from "@/lib/picks/pool-store";
import { logoUrl } from "@/lib/survivor/teams";
import { kickoffEt } from "./ui";
import s from "./picks.module.css";

// The weekly pick'em pool entry: best chance to finish first, not the most
// expected correct. Separate from betting: no stakes, no units.

const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

function Logo({ abbr, size }: { abbr: string; size: number }) {
  return (
    <Image
      src={logoUrl(abbr)}
      alt=""
      width={size}
      height={size}
      unoptimized
      className={s.poolLogo}
    />
  );
}

/** Games in kickoff order. */
const byKickoff = (games: PoolView["games"]) =>
  [...games].sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? ""));

export async function PoolCard() {
  const v = (await getPoolView().catch(() => null))?.value ?? null;
  if (!v) {
    return (
      <section className={s.section} aria-labelledby="pool">
        <h2 className={s.h2} id="pool">
          Pick&apos;em pool
        </h2>
        <p className={s.calm}>No open games to pick for the pool right now.</p>
      </section>
    );
  }
  const r = v.result;
  const lift = r.chalkChance > 0 ? r.winChance / r.chalkChance : 0;
  return (
    <section className={s.section} aria-labelledby="pool">
      <div className={s.sectionHead}>
        <div
          className={s.eyebrow}
        >{`Sleeper · ${v.name} · Week ${v.week}`}</div>
        <h2 className={s.h2} id="pool">
          Your pool entry
        </h2>
        <p className={s.p}>
          {`Built to finish first against about ${v.entrants} entries, not to get the most right. ${
            r.upsets.length
              ? `It takes ${r.upsets.length} upset${r.upsets.length === 1 ? "" : "s"} the field mostly fades, which gives up ${(r.chalkExpectedCorrect - r.expectedCorrect).toFixed(1)} expected correct pick${r.chalkExpectedCorrect - r.expectedCorrect >= 1.5 ? "s" : ""} for a better shot at winning outright.`
              : "This week all favorites is the best entry: no upset buys enough."
          }`}
        </p>
      </div>
      <div className={s.tiles}>
        <div className={`${s.tile} ${s.good}`}>
          <div className={`${s.tileV} ${s.num}`}>{pct(r.winChance)}</div>
          <div className={s.tileK}>Chance this entry wins the week</div>
        </div>
        <div className={s.tile}>
          <div className={`${s.tileV} ${s.num}`}>{pct(r.chalkChance)}</div>
          <div
            className={s.tileK}
          >{`All favorites${lift > 1.05 ? ` (this entry is ${lift.toFixed(1)}x better)` : ""}`}</div>
        </div>
        <div className={s.tile}>
          <div className={`${s.tileV} ${s.num}`}>{pct(1 / v.entrants)}</div>
          <div className={s.tileK}>An average entry&apos;s share</div>
        </div>
        {v.tiebreaker && (
          <div className={s.tile}>
            <div className={`${s.tileV} ${s.num}`}>{v.tiebreaker.total}</div>
            <div
              className={s.tileK}
            >{`Tiebreaker: total points, ${v.tiebreaker.game} (the market total)`}</div>
          </div>
        )}
      </div>
      {r.upsets.length > 0 && (
        <ul className={s.cards}>
          {r.upsets.map((u) => (
            <li key={u.key} className={`${s.card} ${s.cardBet}`}>
              <div className={s.cardPick}>{`Take ${u.team}`}</div>
              <div
                className={s.cardMeta}
              >{`Wins ${pct(u.pWin)} of the time; ${pct(1 - u.publicOn)} of the field is on the other side${v.fieldSource === "estimate" ? " (estimated)" : ""}. When it hits, you pass most of the pool.`}</div>
            </li>
          ))}
        </ul>
      )}
      <details className={s.details} open>
        <summary>{`The full entry (${v.games.length} games)`}</summary>
        <div className={s.poolBody}>
          <p className={s.poolLegend}>
            <span>
              <i className={s.poolKeyFill} />
              chance your pick wins
            </span>
            <span>
              <i className={s.poolKeyTick} />
              {`share of the pool on your pick${v.fieldSource === "estimate" ? " (some estimated)" : ""}`}
            </span>
          </p>
          <ul className={s.poolGrid}>
            {byKickoff(v.games).map((g) => {
              const home = g.pick === "home";
              const team = home ? g.home : g.away;
              const opp = home ? g.away : g.home;
              const p = home ? g.pHome : 1 - g.pHome;
              const field = home ? g.publicHome : 1 - g.publicHome;
              const upset = p < 0.5;
              return (
                <li
                  key={g.key}
                  className={`${s.poolTile} ${upset ? s.poolUpset : ""}`}
                >
                  <div className={s.poolWhen}>
                    <span>{kickoffEt(g.kickoff)}</span>
                    {upset && <span className={s.poolChip}>Upset</span>}
                  </div>
                  <div className={s.poolTop}>
                    <Logo abbr={team} size={36} />
                    <div className={s.poolWho}>
                      <span className={s.poolTeam}>{team}</span>
                      <span className={s.poolOpp}>
                        {home ? "vs" : "at"} <Logo abbr={opp} size={16} /> {opp}
                      </span>
                    </div>
                    <div className={s.poolPct}>
                      <b className={s.num}>{pct(p)}</b>
                    </div>
                  </div>
                  <div
                    className={s.poolBar}
                    role="img"
                    aria-label={`${team} wins ${pct(p)}; ${pct(field)} of the pool picked ${team}`}
                  >
                    <span
                      className={s.poolFill}
                      style={{ width: `${p * 100}%` }}
                    />
                    <span
                      className={s.poolTick}
                      style={{ left: `${field * 100}%` }}
                    />
                  </div>
                  <div
                    className={s.poolField}
                  >{`${pct(field)} of the pool on ${team}`}</div>
                </li>
              );
            })}
          </ul>
        </div>
      </details>
      <p className={s.thin}>
        {`Win chances: the market's no-vig moneyline odds (ESPN). Field: ${v.fieldNote}. Entrants: ${v.entrants} (${v.entrantsSource}). ${r.trials.toLocaleString()} simulated weeks; ties count as an even tiebreaker split.${v.started ? ` ${v.started} game${v.started === 1 ? " has" : "s have"} already started and ${v.started === 1 ? "isn't" : "aren't"} included.` : ""} Pick'em only: no stake, not in units.`}
      </p>
    </section>
  );
}
