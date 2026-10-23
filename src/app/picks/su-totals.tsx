// Straight up (pick'em, not a wager) and totals: this week, results, research.
import { marginBand, marginLabel, suPick } from "@/lib/picks/engine";
import type { PicksReport } from "@/lib/picks/report";
import type { PoolTrack } from "@/lib/picks/pool-store";
import type { TotalsBoardGame } from "@/lib/picks/totals";
import { kickoffEt, n, price, rec, units } from "./ui";
import { Background, Hero, MarketKey, MarketLine } from "./board";
import s from "./picks.module.css";

// ------------------------------------------------------------- straight up

// Sleeper and ESPN spell a few teams differently (pool-store.ts canon).
const POOL_CANON: { [abbr: string]: string } = { WSH: "WAS", LA: "LAR", JAC: "JAX" };

export function SuWeek({ r, poolShares }: { r: PicksReport; poolShares?: { entries: number; shares: Record<string, number> } | null }) {
  const name = (k: string) => r.names[k] ?? k;
  const method = r.su.best?.id ?? "avg";
  const list = r.board
    .flatMap((g) => {
      const p = suPick(method, g.sam, g.david, g.ref?.line);
      return p ? [{ g, ...p }] : [];
    })
    .sort((a, b) => b.margin - a.margin);
  const upcoming = list.filter((x) => !x.g.final);
  const done = list.filter((x) => x.g.final);
  const won = (x: (typeof list)[number]) => {
    const f = x.g.final!;
    return f.home === f.away ? "P" : (f.home > f.away) === (x.side === "home") ? "W" : "L";
  };
  const doneW = done.filter((x) => won(x) === "W").length;
  const band = (margin: number) => marginBand(r.league, margin);
  const bandCls = (m: number) => (band(m) === "wide" ? s.readTrack : band(m) === "clear" ? "" : s.readPass);
  const surest = upcoming.slice(0, 4);
  const rest = upcoming.slice(surest.length);
  return (
    <section className={s.section} aria-labelledby="su-week">
      <Hero
        eyebrow={`${r.league === "nfl" ? "NFL" : "College"}${r.week ? ` · Week ${r.week}` : ""} · Straight up`}
        title={<span id="su-week">{upcoming.length ? "Who wins, most sure first" : done.length ? "Every game played" : "No games on the board yet"}</span>}
        sub={`${r.league === "nfl" ? "For the Weekly payout pool use the entry above; this list is for a confidence pool. " : ""}Follows ${r.su.best?.label.toLowerCase() ?? "the average of both models"}${r.su.best ? ` (${r.su.best.w}-${r.su.best.l} this season)` : ""}. Pick'em only: no stake.`}
      />
      {surest.length > 0 && (
        <ul className={s.betGrid} data-first-pick>
          {surest.map(({ g, side, margin }, i) => {
            const pick = side === "home" ? g.home : g.away;
            const opp = side === "home" ? g.away : g.home;
            const market = g.ref?.line;
            return (
              <li key={`${g.away}@${g.home}`} className={s.betCard}>
                <div className={s.betCardTop}>
                  <div>
                    <div className={s.betPickBig}>{`${i + 1}. ${name(pick)}`}</div>
                    <div className={s.betWhen}>{`over ${name(opp)} · ${kickoffEt(g.ref?.kickoff)}`}</div>
                  </div>
                  <span className={s.lockChip}>{`${marginLabel(r.league, band(margin))} · ${margin.toFixed(1)}`}</span>
                </div>
                {market !== undefined && (
                  <MarketLine market={market} sam={g.sam?.model} david={g.david?.model} fmt={(x) => `${name(g.home)} ${x > 0 ? "+" : ""}${Math.round(x * 10) / 10}`} pk={{ below: name(g.home), above: name(g.away) }} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {surest.length > 0 && <MarketKey />}
      {rest.length > 0 && (
        <div className={s.section}>
          <h3 className={s.h2}>{`The rest, ranked ${surest.length + 1} to ${upcoming.length}`}</h3>
          <div className={s.gtable}>
            {rest.map(({ g, side, margin }, j) => {
              const i = j + surest.length;
              return (
              <div key={`${g.away}@${g.home}`} className={s.gRow}>
                <div className={s.suLine}>
                  <span className={`${s.num} ${s.rank}`}>{i + 1}</span>
                  <span className={s.gGame}>
                    {name(side === "home" ? g.home : g.away)}
                    <span>{`over ${name(side === "home" ? g.away : g.home)} · ${kickoffEt(g.ref?.kickoff)}${
                      g.sam && g.david && Math.sign(g.sam.model) !== Math.sign(g.david.model) ? ` · split: Sam ${name(g.sam.model < 0 ? g.home : g.away)}, David ${name(g.david.model < 0 ? g.home : g.away)}` : ""
                    }`}</span>
                  </span>
                  <span className={`${s.readChip} ${bandCls(margin)}`}>{`${marginLabel(r.league, band(margin))} · ${margin.toFixed(1)}`}</span>
                </div>
              </div>
              );
            })}
          </div>
          <p className={s.thin}>1 is the surest. In a confidence pool give it the most points. Bands describe the projected margin, not a probability.</p>
        </div>
      )}
      {done.length > 0 && (
        <div className={s.finished}>
          <div className={s.finHead}>
            <h3 className={s.h3}>{`Finished (${done.length})`}</h3>
            <span className={`${s.num} ${s.finTally}`}>{`Picks ${doneW}-${done.length - doneW}`}</span>
          </div>
          <ul className={s.finList}>
            {done.map((x) => {
              const f = x.g.final!;
              const res = won(x);
              return (
                <li key={`${x.g.away}@${x.g.home}`} className={s.finRow}>
                  <div className={s.finScore}>
                    <span className={f.away > f.home ? s.finWinner : undefined}>{`${name(x.g.away)} ${f.away}`}</span>
                    <span className={s.muted}> at </span>
                    <span className={f.home > f.away ? s.finWinner : undefined}>{`${name(x.g.home)} ${f.home}`}</span>
                  </div>
                  <div className={s.finCall}>
                    <span className={s.finPick}>{`${name(x.side === "home" ? x.g.home : x.g.away)} to win`}</span>
                    <span className={`${s.resChip} ${res === "W" ? s.resW : res === "L" ? s.resL : s.resP}`}>{res}</span>
                  </div>
                  {(() => {
                    if (!poolShares || f.home === f.away) return null;
                    const winner = f.home > f.away ? x.g.home : x.g.away;
                    const loser = winner === x.g.home ? x.g.away : x.g.home;
                    const shareOf = (t: string) => poolShares.shares[POOL_CANON[t.toUpperCase()] ?? t.toUpperCase()];
                    // A team nobody picked isn't in the counts: its share is what the other side left.
                    const share = shareOf(winner) ?? (shareOf(loser) !== undefined ? 1 - shareOf(loser)! : undefined);
                    return share === undefined ? null : (
                      <div className={s.thin}>{`${Math.round(share * 100)}% of the pool had ${name(winner)}`}</div>
                    );
                  })()}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

export function SuResults({ r, poolTrack }: { r: PicksReport; poolTrack?: PoolTrack | null }) {
  const total = r.live.reduce((t, w) => ({ w: t.w + w.su.w, l: t.l + w.su.l }), { w: 0, l: 0 });
  return (
    <section className={s.section} aria-labelledby="su-results">
      <Hero
        eyebrow={`${r.league === "nfl" ? "NFL" : "College"} ${r.season} · Straight up`}
        title={<span id="su-results">{total.w + total.l ? `${total.w}-${total.l} picking winners` : "No winners graded yet"}</span>}
        sub="Winners picked in the emails, as listed. Accuracy only: pick'em has no stake."
      />
      <div className={s.tiles}>
        <div className={s.tile}>
          <div className={`${s.tileV} ${s.num}`}>{total.w + total.l ? `${total.w}-${total.l}` : "none yet"}</div>
          <div className={s.tileK}>Picked winners, as sent</div>
        </div>
        {r.su.methods
          .filter((m) => ["avg", "vegas"].includes(m.id))
          .map((m) => (
            <div key={m.id} className={s.tile}>
              <div className={`${s.tileV} ${s.num}`}>{`${m.w}-${m.l}`}</div>
              <div className={s.tileK}>{`${m.label} (backtest)`}</div>
            </div>
          ))}
      </div>
      <div className={s.tw}>
        <table className={s.table}>
          <caption className={s.caption}>As sent, by week</caption>
          <thead>
            <tr>
              <th>Week</th>
              <th>Straight up</th>
            </tr>
          </thead>
          <tbody>
            {r.live.map((w) => (
              <tr key={w.week}>
                <td className={s.num}>{w.week}</td>
                <td className={s.num}>{`${w.su.w}-${w.su.l}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.league === "nfl" && (
        <div className={s.tw}>
          <table className={s.table}>
            <caption className={s.caption}>
              {poolTrack?.weeks.length
                ? `Weekly payout pool: your picks ${poolTrack.you.w}-${poolTrack.you.l}${poolTrack.entry.w + poolTrack.entry.l ? `, app entry ${poolTrack.entry.w}-${poolTrack.entry.l}` : ""}`
                : "Weekly payout pool: nothing graded yet"}
            </caption>
            <thead>
              <tr>
                <th>Week</th>
                <th>You</th>
                <th>Entry</th>
                <th>Pool best</th>
              </tr>
            </thead>
            <tbody>
              {(poolTrack?.weeks ?? []).map((w) => (
                <tr key={w.week}>
                  <td className={s.num}>{w.week}</td>
                  <td className={s.num}>{w.you ? `${w.you.w}-${w.you.l}${w.rank ? ` (#${w.rank})` : ""}` : "none"}</td>
                  <td className={s.num}>{w.entry ? (w.entry.graded < w.entry.played ? `${w.entry.w}-${w.entry.l} (${w.entry.graded} of ${w.entry.played})` : `${w.entry.w}-${w.entry.l}`) : "not saved"}</td>
                  <td className={s.num}>{w.poolBest ?? "not scored"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={s.thin}>Your picks come from Sleeper. The entry is what this page suggested, saved before each kickoff (from Oct 12). Place is shown once Sleeper scores the week.</p>
        </div>
      )}
    </section>
  );
}

export function SuResearch({ r }: { r: PicksReport }) {
  return (
    <section className={s.section} aria-labelledby="su-research">
      <Hero
        eyebrow="Straight up · every way of picking winners"
        title={<span id="su-research">What picks winners best</span>}
        sub="Each method on the graded history. The list follows the best full-slate method."
      />
      <div className={s.tw}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Method</th>
              <th>Record</th>
              <th>Rate</th>
            </tr>
          </thead>
          <tbody>
            {[...r.su.methods, ...r.su.bands].map((m) => (
              <tr key={m.id}>
                <td>
                  {m.label}
                  {r.su.best?.id === m.id && <span className={`${s.tag} ${s.tagRule}`}>followed</span>}
                </td>
                <td className={s.num}>{`${m.w}-${m.l}`}</td>
                <td className={s.num}>{m.w + m.l ? `${Math.round(m.pct * 100)}%` : "·"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ totals

export function TotalsWeek({ r }: { r: PicksReport }) {
  const t = r.totals;
  const name = (k: string) => r.names[k] ?? k;
  const order = { t1: 0, lean: 1, split: 2, one: 3, noline: 4 } as const;
  const finalOf = new Map(r.board.filter((g) => g.final).map((g) => [`${g.away}@${g.home}`, g.final!]));
  const all = t.board.slice().sort((a, b) => order[a.tier] - order[b.tier] || (b.read?.minEdge ?? 0) - (a.read?.minEdge ?? 0));
  const games = all.filter((g) => !finalOf.has(`${g.away}@${g.home}`));
  const done = all.filter((g) => finalOf.has(`${g.away}@${g.home}`));
  // Over/under on the total the board judged it at; no side, no result.
  const ouResult = (g: (typeof all)[number]): "W" | "L" | "P" | undefined => {
    const f = finalOf.get(`${g.away}@${g.home}`)!;
    const at = g.ref?.total;
    if (!g.side || at === undefined) return undefined;
    const pts = f.home + f.away;
    return pts === at ? "P" : (pts > at) === (g.side === "over") ? "W" : "L";
  };
  const bets = games.filter((g) => g.stake);
  const leans = games.filter((g) => !g.stake && (g.tier === "t1" || g.tier === "lean"));
  const ou = (x?: string) => (x === "over" ? "Over" : "Under");
  const why = (g: TotalsBoardGame) => (
    <dl className={s.kv}>
      <dt>Total now</dt>
      <dd className={s.num}>{g.ref ? `${g.ref.total} · ${g.ref.source}` : "none"}</dd>
      <dt>Sam total</dt>
      <dd className={s.num}>{g.sam !== undefined ? g.sam.toFixed(1) : "not posted"}</dd>
      <dt>David total</dt>
      <dd className={s.num}>{g.david !== undefined ? g.david.toFixed(1) : "not posted"}</dd>
      {g.p !== undefined && (
        <>
          <dt>Win chance</dt>
          <dd className={s.num}>{`${(g.p * 100).toFixed(1)}% (estimate)`}</dd>
        </>
      )}
      {g.stake ? (
        <>
          <dt>Stake</dt>
          <dd className={s.num}>{`${g.stake}u at ${price(g.price)}`}</dd>
        </>
      ) : null}
    </dl>
  );
  const readOf = (g: TotalsBoardGame): [string, string] => {
    if (finalOf.has(`${g.away}@${g.home}`)) {
      const res = ouResult(g);
      return res ? [res === "W" ? "Won" : res === "L" ? "Lost" : "Push", res === "W" ? s.readW : res === "L" ? s.readL : ""] : ["Final", s.readPass];
    }
    if (g.stake) return ["Bet", s.readBet];
    if (g.tier === "t1") return ["Priced out", ""];
    if (g.tier === "lean") return [`Lean ${ou(g.side).toLowerCase()}`, ""];
    if (g.tier === "split") return ["Split", s.readPass];
    if (g.tier === "one") return ["One model", s.readPass];
    return ["No line", s.readPass];
  };
  const title = bets.length ? `${bets.length} totals bet${bets.length === 1 ? "" : "s"} this week` : t.backtest.rule ? "No totals bets this week" : "Totals are tracking only";
  return (
    <section className={s.section} aria-labelledby="ou-week">
      <Hero
        eyebrow={`${r.league === "nfl" ? "NFL" : "College"}${r.week ? ` · Week ${r.week}` : ""} · Totals`}
        title={<span id="ou-week">{title}</span>}
        sub={
          t.backtest.rule
            ? `Rule: ${t.backtest.rule.label.toLowerCase()} (${rec(t.backtest.rule.record)} in the archive).`
            : `No totals cut has 10+ decided games and a winning rate yet, so nothing here is a bet. ${t.backtest.archived} archived games graded so far.`
        }
      />
      {bets.length > 0 && (
        <ul className={s.betGrid} data-first-pick>
          {bets.map((g) => (
            <li key={`${g.away}@${g.home}`} className={s.betCard}>
              <div className={s.betCardTop}>
                <div>
                  <div className={s.betPickBig}>{`${ou(g.side)} ${g.ref?.total ?? ""}`}</div>
                  <div className={s.betWhen}>{`${name(g.away)} at ${name(g.home)} · ${kickoffEt(g.ref?.kickoff)}`}</div>
                </div>
                <span className={s.lockChip}>{g.held ? `Locks ${kickoffEt(g.held)}` : "Bet"}</span>
              </div>
              {g.ref && <MarketLine market={g.ref.total} sam={g.sam} david={g.david} fmt={(x) => `${Math.round(x * 10) / 10}`} />}
              <dl className={s.facts}>
                <div>
                  <dt>Models vs market</dt>
                  <dd>{g.read ? `${g.read.avgEdge.toFixed(1)} pts` : "·"}</dd>
                </div>
                <div>
                  <dt>Price</dt>
                  <dd>{price(g.price)}</dd>
                </div>
                <div>
                  <dt>Stake</dt>
                  <dd>{`${g.stake}u`}</dd>
                </div>
              </dl>
              <details className={s.why}>
                <summary>Why this bet</summary>
                {why(g)}
              </details>
            </li>
          ))}
        </ul>
      )}
      {leans.length > 0 && (
        <div className={s.section}>
          <div className={s.sectionHead}>
            <h3 className={s.h2}>Both models lean</h3>
            <p className={s.p}>{bets.length ? "Same side from both models, no bet at this price." : "Same side from both models. Tracked, not bet, until a totals cut earns a rule."}</p>
          </div>
          <ul className={s.closeGrid} data-first-pick={bets.length ? undefined : true}>
            {leans.map((g) => (
              <li key={`${g.away}@${g.home}`} className={s.closeCard}>
                <span className={s.closePick}>
                  {`${ou(g.side)} ${g.ref?.total ?? ""} `}
                  <span>{`${name(g.away)} at ${name(g.home)} · ${kickoffEt(g.ref?.kickoff)}`}</span>
                </span>
                <span className={`${s.num} ${s.statK}`}>{`Sam ${g.sam?.toFixed(1) ?? "·"} · David ${g.david?.toFixed(1) ?? "·"}`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {all.length > 0 && (
        <div className={s.section}>
          <div className={s.sectionHead}>
            <h3 className={s.h2}>Market vs models</h3>
            <p className={s.p}>Every game&apos;s total. Open a game for the numbers behind it.</p>
          </div>
          <div className={s.gtable}>
            <div className={s.gHead} aria-hidden>
              <span>Game</span>
              <span>Market</span>
              <span>Sam</span>
              <span>David</span>
              <span>Gap</span>
              <span>Read</span>
              <span />
            </div>
            {[...games, ...done].map((g) => {
              const rd = readOf(g);
              const f = finalOf.get(`${g.away}@${g.home}`);
              return (
                <details key={`${g.away}@${g.home}`} className={s.gRow}>
                  <summary>
                    <span className={s.gGame}>
                      {`${name(g.away)} at ${name(g.home)}`}
                      <span>{f ? `${f.home + f.away} scored` : kickoffEt(g.ref?.kickoff)}</span>
                    </span>
                    <span className={s.gNum} data-k="Market">{g.ref?.total ?? "·"}</span>
                    <span className={`${s.gNum} ${s.cSam}`} data-k="Sam">{g.sam !== undefined ? g.sam.toFixed(1) : "·"}</span>
                    <span className={`${s.gNum} ${s.cDavid}`} data-k="David">{g.david !== undefined ? g.david.toFixed(1) : "·"}</span>
                    <span className={s.gNum} data-k="Gap">{g.read ? g.read.avgEdge.toFixed(1) : "·"}</span>
                    <span className={`${s.readChip} ${rd[1]}`}>{rd[0]}</span>
                    <span className={s.chev} aria-hidden>
                      ›
                    </span>
                  </summary>
                  <div className={s.gBody}>{why(g)}</div>
                </details>
              );
            })}
          </div>
        </div>
      )}
      {bets.length === 0 && leans.length === 0 && <p className={s.calm} data-first-pick>No totals bets this week.</p>}
      <Background>
        <p className={s.p}>Totals history only exists from our own archive (neither site keeps it), so the record grows a game at a time. The cuts and the tiebreak check are on Research.</p>
      </Background>
    </section>
  );
}

export function TotalsResults({ r }: { r: PicksReport }) {
  const l = r.units.byTier.totals;
  const sent = r.clv.plays.find((x) => x.id === "ou");
  return (
    <section className={s.section} aria-labelledby="ou-results">
      <Hero
        eyebrow={`${r.league === "nfl" ? "NFL" : "College"} ${r.season} · Totals`}
        title={
          <span id="ou-results">
            {l.w + l.l + l.p ? (
              <>
                {l.units >= 0 ? "Up " : "Down "}
                <span className={l.units >= 0 ? s.up : s.down}>{units(l.units)}</span>
                {` on ${rec(l)}`}
              </>
            ) : (
              "No totals bets settled yet"
            )}
          </span>
        }
        sub="Returns on totals the emails recommended. Recommendation returns, not confirmed bets."
      />
      <div className={s.tiles}>
        <div className={`${s.tile} ${l.w + l.l ? (l.units >= 0 ? s.good : s.bad) : ""}`}>
          <div className={`${s.tileV} ${s.num}`}>{l.w + l.l + l.p ? units(l.units) : "none yet"}</div>
          <div className={s.tileK}>{l.bets ? `${rec(l)}${l.pending ? `, ${l.pending} pending` : ""}` : "No totals sent yet"}</div>
        </div>
        <div className={s.tile}>
          <div className={`${s.tileV} ${s.num}`}>{sent?.n ? `${sent.avg > 0 ? "+" : ""}${sent.avg.toFixed(2)}` : "·"}</div>
          <div className={s.tileK}>{`vs closing total (${sent?.n ?? 0} with a close)`}</div>
        </div>
      </div>
    </section>
  );
}

export function TotalsResearch({ r }: { r: PicksReport }) {
  const bt = r.totals.backtest;
  return (
    <section className={s.section} aria-labelledby="ou-research">
      <Hero eyebrow="Totals · our own archive" title={<span id="ou-research">What actually wins on totals</span>} />
      <div className={s.sectionHead}>
        <p className={s.p}>
          {`Neither site keeps totals history, so two-model agreement is archived going forward: the first time both models' totals and a current line meet, that game is saved and never rewritten. ${r.totals.archived} archived, ${bt.archived} graded. Thresholds were fixed before grading (both ${r.totals.edge}+ off).`}
        </p>
      </div>
      <div className={s.tw}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Cut</th>
              <th>Record</th>
              <th>Weeks</th>
            </tr>
          </thead>
          <tbody>
            {bt.cuts.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.label}
                  {bt.rule?.id === c.id && <span className={`${s.tag} ${s.tagRule}`}>rule</span>}
                </td>
                <td className={s.num}>{n(c.record) + c.record.p ? rec(c.record) : "none yet"}</td>
                <td className={s.num}>{c.weeks.join(", ") || "·"}</td>
              </tr>
            ))}
            <tr>
              <td>Sam alone vs the opening total (history)</td>
              <td className={s.num}>{n(bt.samAlone.record) ? rec(bt.samAlone.record) : "none"}</td>
              <td className={s.num}>{bt.samAlone.weeks.join(", ") || "·"}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className={s.thin}>
        {bt.samAlone.clv.n
          ? `Sam alone vs the closing total: ${bt.samAlone.clv.avg > 0 ? "+" : ""}${bt.samAlone.clv.avg.toFixed(2)} on ${bt.samAlone.clv.n}; flattered if he posted after the line moved.`
          : ""}
      </p>
      <h3 className={s.h3}>Tiebreak check: closest total</h3>
      <p className={s.p}>
        {bt.miss?.games
          ? `Average points missed on the same ${bt.miss.games} graded games. The pool tiebreak uses the models' average (Jack, 2026-10-17); this shows whether that keeps holding up against the market. Models' average closer in ${bt.miss.averageCloser}, market closer in ${bt.miss.marketCloser}.`
          : "No graded games yet."}
      </p>
      {bt.miss && bt.miss.games > 0 && (
        <div className={s.tw}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Total</th>
                <th>Avg miss (pts)</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Market", bt.miss.market],
                ["Sam", bt.miss.sam],
                ["David", bt.miss.david],
                ["Sam + David average", bt.miss.average],
              ].map(([label, v]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td className={s.num}>{(v as number).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
