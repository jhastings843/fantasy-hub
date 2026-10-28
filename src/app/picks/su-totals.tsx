// Straight up (pick'em, not a wager) and totals: this week, results, research.
import { marginBand, marginLabel, suPick } from "@/lib/picks/engine";
import type { PicksReport } from "@/lib/picks/report";
import type { PoolTrack } from "@/lib/picks/pool-store";
import type { TotalsBoardGame } from "@/lib/picks/totals";
import { TeamLogo } from "@/components/TeamLogo";
import { GameCell, kickoffEt, price, rec, units } from "./ui";
import { priceWithBook } from "@/lib/picks/shop";
import { Background, CutRanges, Hero, SecHead } from "./board";
import { ReadLegend, WeekBets } from "./ats";
import { findGame, type LiveGame } from "@/lib/live/espn";
import s from "./picks.module.css";

// ------------------------------------------------------------- straight up

// Sleeper and ESPN spell a few teams differently (pool-store.ts canon).
const POOL_CANON: { [abbr: string]: string } = { WSH: "WAS", LA: "LAR", JAC: "JAX" };

/** The one line under a board's section heading. */
function SuSub({ text }: { text: string }) {
  return <p className={s.p}>{text}</p>;
}

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
  return (
    <section className={s.section} aria-labelledby="su-week">
      <SecHead id="su-week" title="Straight up" aside={upcoming.length ? "Who wins, surest first" : done.length ? "Every game played" : "No games on the board yet"} />
      <SuSub
        text={`${r.league === "nfl" ? "For the Weekly payout pool use the entry above; this list is for a confidence pool. " : ""}Follows ${r.su.best?.label.toLowerCase() ?? "the average of both models"}${r.su.best ? ` (${r.su.best.w}-${r.su.best.l} this season)` : ""}. Pick'em only: no stake.`}
      />
      {upcoming.length > 0 ? (
        <div className={s.section}>
          <div className={s.gtable} data-first-pick>
            {upcoming.map(({ g, side, margin }, i) => {
              const pick = side === "home" ? g.home : g.away;
              const share = poolShares ? poolShares.shares[POOL_CANON[pick.toUpperCase()] ?? pick.toUpperCase()] : undefined;
              const live = g.basis === "started";
              return (
                <div key={`${g.away}@${g.home}`} className={s.gRow}>
                  <div className={s.suLine}>
                    <span className={`${s.num} ${s.rank}`}>{i + 1}</span>
                    <span className={s.matchCell}>
                      <span className={s.matchTeam}>
                        <TeamLogo league={r.league === "nfl" ? "nfl" : "cfb"} team={pick} espnId={side === "home" ? (g.ref ?? g.lastRef)?.homeId : (g.ref ?? g.lastRef)?.awayId} size={18} />
                        <span className={s.matchName}>{name(pick)}</span>
                        {live && <span className={s.gLive}>Live</span>}
                      </span>
                      <span className={s.matchTeam}>
                        <TeamLogo league={r.league === "nfl" ? "nfl" : "cfb"} team={side === "home" ? g.away : g.home} espnId={side === "home" ? (g.ref ?? g.lastRef)?.awayId : (g.ref ?? g.lastRef)?.homeId} size={18} />
                        <span className={s.matchName}>
                          <span className={s.matchAt}>over </span>
                          {name(side === "home" ? g.away : g.home)}
                        </span>
                      </span>
                      <span className={s.matchWhen} style={{ whiteSpace: "normal" }}>{`${live ? "In progress" : `${kickoffEt(g.ref?.kickoff)}${g.ref?.tv ? ` · ${g.ref.tv}` : ""}`}${
                        g.sam && g.david && Math.sign(g.sam.model) !== Math.sign(g.david.model) ? ` · split: Sam ${name(g.sam.model < 0 ? g.home : g.away)}, David ${name(g.david.model < 0 ? g.home : g.away)}` : ""
                      }${share !== undefined ? ` · ${Math.round(share * 100)}% of the pool on ${name(pick)}` : ""}`}</span>
                    </span>
                    <span className={`${s.readChip} ${bandCls(margin)}`}>{`${marginLabel(r.league, band(margin))} · ${margin.toFixed(1)}`}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className={s.thin}>1 is the surest: in a confidence pool give it the most points. The chip is the projected margin band, not a probability. Pick&apos;em only, never staked.</p>
        </div>
      ) : (
        !done.length && <p className={s.calm}>No games on the board yet.</p>
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

export function TotalsWeek({ r, live = [] }: { r: PicksReport; live?: LiveGame[] }) {
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
          <dd className={s.num}>{`${g.stake}u at ${priceWithBook(price(g.price), g.ref, g.side)}`}</dd>
        </>
      ) : null}
    </dl>
  );
  // Solid only once sent; sized-not-sent dashed oxblood; leans and priced-out tracked (the Ledger redesign).
  const startedOf = new Set(r.board.filter((g) => g.basis === "started" && !g.final).map((g) => `${g.away}@${g.home}`));
  const liveOf = (g: { away: string; home: string }) => findGame(live, r.league, g.away, g.home);
  // Over on ESPN but not graded yet: to the bottom with its score, ahead of grading.
  const endedOf = (g: { away: string; home: string }) => startedOf.has(`${g.away}@${g.home}`) && liveOf(g)?.state === "post";
  const readOf = (g: TotalsBoardGame): { chip: [string, string]; note?: string } => {
    if (finalOf.has(`${g.away}@${g.home}`)) {
      const res = ouResult(g);
      if (g.issued && res) return { chip: [res === "W" ? "Won" : res === "L" ? "Lost" : "Push", res === "W" ? s.readW : res === "L" ? s.readL : ""], note: `Totals · ${g.issued.units}u` };
      return { chip: ["Final", s.readPass], note: res && g.side ? `Lean ${res === "W" ? "hit" : res === "L" ? "missed" : "pushed"}, no stake` : undefined };
    }
    if (g.issued) return { chip: [`Totals · ${g.issued.units}u`, s.readBet], note: startedOf.has(`${g.away}@${g.home}`) ? "In progress" : `Sent at ${price(g.issued.price)}` };
    if (endedOf(g)) return { chip: ["Final", s.readPass], note: "Grading soon" };
    if (startedOf.has(`${g.away}@${g.home}`)) return { chip: ["In progress", s.readLive] };
    if (g.stake) return { chip: ["Totals · not sent", s.readPend], note: g.held ? `Locks ${kickoffEt(g.held)}` : `${g.stake}u at ${priceWithBook(price(g.price), g.ref, g.side)}` };
    if (g.tier === "t1") return { chip: ["Close call", s.readTrack], note: `Priced out at ${priceWithBook(price(g.price), g.ref, g.side)}` };
    if (g.tier === "lean") return { chip: [`Lean ${ou(g.side).toLowerCase()} · no stake`, s.readTrack] };
    if (g.tier === "split") return { chip: ["Split", s.readPass] };
    if (g.tier === "one") return { chip: ["One model", s.readPass] };
    return { chip: ["No line", s.readPass] };
  };
  const title = bets.length ? `${bets.length} totals bet${bets.length === 1 ? "" : "s"} this week` : t.backtest.rule ? "No totals bets this week" : "Totals are tracking only";
  return (
    <section className={s.section} aria-labelledby="ou-week">
      <SecHead id="ou-week" title="Totals" aside={`${title} · started games first`} />
      <SuSub
        text={
          t.backtest.rule
            ? `Rule: ${t.backtest.rule.label.toLowerCase()} (${rec(t.backtest.rule.record)} in the archive).`
            : `No totals cut has 10+ decided games and a winning rate yet, so nothing here is a bet. ${t.backtest.archived} archived games graded so far.`
        }
      />
      {all.length > 0 ? (
        <div className={s.section}>
          <ReadLegend />
          <div className={s.gtable}>
            <div className={`${s.gHead} ${s.ledgerHead}`} aria-hidden>
              <span>Game</span>
              <span>Total</span>
              <span>Sam · David</span>
              <span>Lean</span>
              <span>Read</span>
              <span />
            </div>
            {[...games.filter((g) => startedOf.has(`${g.away}@${g.home}`) && !endedOf(g)), ...games.filter((g) => !startedOf.has(`${g.away}@${g.home}`)), ...games.filter(endedOf), ...done].map((g) => {
              const rd = readOf(g);
              const f = finalOf.get(`${g.away}@${g.home}`);
              const lg = liveOf(g);
              const live = startedOf.has(`${g.away}@${g.home}`) && lg?.state !== "post";
              return (
                <details key={`${g.away}@${g.home}`} className={`${s.gRow} ${s.ledger}`}>
                  <summary>
                    <GameCell
                      league={r.league}
                      away={g.away}
                      home={g.home}
                      awayName={name(g.away)}
                      homeName={name(g.home)}
                      quote={(() => {
                        const b = r.board.find((x) => x.away === g.away && x.home === g.home);
                        return b?.ref ?? b?.lastRef ?? g.ref;
                      })()}
                      status={
                        live ? (
                          <>
                            <span className={s.gLive}>Live</span>
                            {lg && <span className={s.scoreLine}>{`${lg.away.score + lg.home.score} so far · ${lg.detail}`}</span>}
                          </>
                        ) : lg?.state === "post" && !f ? (
                          `Final · ${lg.away.score + lg.home.score} scored`
                        ) : f ? (
                          `Final · ${f.home + f.away} scored`
                        ) : undefined
                      }
                    />
                    <span className={s.gNum} data-k="Total">{g.ref?.total ?? "·"}</span>
                    <span className={s.gNum} data-k="Sam · David">
                      <span className={s.cSam}>{`Sam ${g.sam !== undefined ? g.sam.toFixed(1) : "·"}`}</span>
                      <span className={s.cDavid}>{`David ${g.david !== undefined ? g.david.toFixed(1) : "·"}`}</span>
                    </span>
                    <span className={s.gNum} data-k="Lean">
                      {g.side && g.ref ? `${ou(g.side)} ${g.ref.total}` : "None"}
                      {g.read && <small>{`${g.read.avgEdge.toFixed(1)} off`}</small>}
                    </span>
                    <span className={s.ledgerRead}>
                      <span className={`${s.readChip} ${rd.chip[1]}`}>{rd.chip[0]}</span>
                      {rd.note && <small>{rd.note}</small>}
                    </span>
                    <span className={s.chev} aria-hidden>
                      ›
                    </span>
                  </summary>
                  <div className={s.gBody}>{why(g)}</div>
                </details>
              );
            })}
          </div>
          <p className={s.p}>{`Started games first, then the strongest reads. ${bets.length ? "" : "Tracked, not bet, until a totals cut earns a rule."}`}</p>
        </div>
      ) : (
        <p className={s.calm} data-first-pick>No totals on the board yet.</p>
      )}

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
      <WeekBets r={r} kind="total" />
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
      {/* The same range view as the learner log (Jack preferred it over the plain table). */}
      <CutRanges
        title="Every totals cut"
        rows={[
          ...bt.cuts.map((c) => ({ label: `${c.label}${bt.rule?.id === c.id ? " (the rule)" : ""}`, w: c.record.w, l: c.record.l, p: c.record.p, be: 0.524 })),
          { label: "Sam alone vs the opening total (history)", w: bt.samAlone.record.w, l: bt.samAlone.record.l, p: bt.samAlone.record.p, be: 0.524 },
        ]}
        open
      />
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
