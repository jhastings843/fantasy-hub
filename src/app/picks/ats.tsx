// Spreads (ATS): this week's bets, results, research.
import { needsPem, type BoardGame, type CutResult } from "@/lib/picks/engine";
import { cutResult } from "@/lib/picks/engine";
import type { PicksReport } from "@/lib/picks/report";
import { groupByDay } from "@/lib/picks/days";
import { decimal, kelly, worstPrice } from "@/lib/picks/staking";
import { Fragment } from "react";
import TierChecker from "./TierChecker";
import { StrategyRow, TierChip, drawdown, kickoffEt, line, n, pct, price, rec, units } from "./ui";
import s from "./picks.module.css";

type Status = "sent" | "early" | "bet" | "priced" | "budget" | "wait" | "noquote" | "started" | "final" | "pass";

function statusOf(g: BoardGame): Status {
  if (g.final) return "final";
  if (g.basis === "started") return "started";
  if (g.issued) return "sent";
  if (g.tier === "wait") return "wait";
  const tiered = g.tier === "t1" || g.tier === "t2";
  if (!tiered) return "pass";
  if (g.basis !== "reference") return "noquote";
  if (g.held && g.stake) return "early";
  if (g.stake) return "bet";
  if (g.want) return "budget";
  return "priced";
}

const STATUS_TEXT: { [k in Status]: string } = {
  sent: "Sent",
  early: "Early look",
  bet: "Bet",
  priced: "Priced out",
  budget: "Over this week's budget",
  wait: "Needs PEM's line",
  noquote: "No current line",
  started: "In progress",
  final: "Final",
  pass: "Pass",
};

function pickText(g: BoardGame, name: (k: string) => string): string {
  if (g.side && g.homeLine !== undefined) return `${name(g.side === "home" ? g.home : g.away)} ${line(g.side === "home" ? g.homeLine : -g.homeLine)}`;
  if (g.read && (g.tier === "split" || g.tier === "wait"))
    return `Sam ${name(g.read.samSide === "home" ? g.home : g.away)} · David ${name(g.read.davidSide === "home" ? g.home : g.away)}`;
  return g.play;
}

/** Which stake this is: the standard size, or cut by a limit (and which one). */
function stakeWhy(g: BoardGame, r: PicksReport): string {
  if (g.limited && g.want !== undefined && (g.stake ?? 0) < g.want) return `Cut from ${g.want}u to ${g.stake}u: ${g.limited}.`;
  const cut = g.tier === "t1" ? r.strategies.rule : g.tier === "t2" ? r.strategies.second : null;
  if (cut?.activated) return "Held to 1u: this cut was activated by the strategy review, so a bigger stake waits on its results from here on.";
  return `Standard stake for this tier at ${price(g.price)}. No limit cut it.`;
}

/** Why a qualifying pick is not a bet: no price, the price check, or a size under 1u. */
function pricedWhy(g: BoardGame): string {
  if (g.priceSource === "missing") return "No quoted price, so no stake.";
  if (g.eligible) return "Passes the price check, but the current sizing policy puts it under 1u, and anything under 1u is not a bet.";
  const worst = g.p !== undefined ? worstPrice(g.p) : null;
  const need = worst === null ? "a plus-money price" : `${price(worst)} or better`;
  return `At ${price(g.price)} the tier's estimated edge is too thin for a 1u bet. It would need ${need}.`;
}

/** One game as a card: the pick first, the reasons behind a disclosure. */
function PickCard({ g, r }: { g: BoardGame; r: PicksReport }) {
  const name = (k: string) => r.names[k] ?? k;
  const st = statusOf(g);
  const opp = g.side ? name(g.side === "home" ? g.away : g.home) : null;
  const home = name(g.home);
  return (
    <li className={`${s.card} ${st === "bet" ? s.cardBet : st === "early" ? s.cardEarly : ""}`}>
      <div className={s.cardTop}>
        <div>
          <div className={s.cardPick}>{pickText(g, name)}</div>
          <div className={s.cardMeta}>
            {opp ? `vs ${opp} · ` : `${name(g.away)} at ${home} · `}
            {kickoffEt(g.ref?.kickoff)}
          </div>
        </div>
        {st === "bet" || st === "sent" ? (
          <div className={s.stake}>
            <b className={s.num}>{st === "sent" ? g.issued!.units : g.stake}u</b>
            <span className={s.num}>{st === "sent" ? `sent ${price(g.issued!.price)}` : price(g.price)}</span>
          </div>
        ) : st === "early" ? (
          <div className={s.stake}>
            <span className={s.earlyChip}>Early look</span>
            <span className={s.num}>{`~${g.stake}u · ${kickoffEt(g.held)}`}</span>
          </div>
        ) : (
          <span className={s.statusChip}>{STATUS_TEXT[st]}</span>
        )}
      </div>
      <details className={s.why}>
        <summary>Why</summary>
        <dl className={s.kv}>
          <dt>Line now</dt>
          <dd className={s.num}>{g.ref ? `${home} ${line(g.ref.line)} · ${g.ref.source}` : "none"}</dd>
          <dt>Sam model</dt>
          <dd className={s.num}>{g.sam ? `${home} ${line(Math.round(g.sam.model * 10) / 10)}` : "not posted"}</dd>
          <dt>David model</dt>
          <dd className={s.num}>{g.david ? `${home} ${line(Math.round(g.david.model * 10) / 10)}` : "not posted"}</dd>
          {r.league === "cfb" && (
            <>
              <dt>PEM model</dt>
              <dd className={s.num}>{g.pem ? `${home} ${line(g.pem.model)}` : "missing"}</dd>
            </>
          )}
          <dt>Tier</dt>
          <dd>
            <TierChip t={g.tier} /> {g.read?.agree ? `avg edge ${g.read.avgEdge.toFixed(1)}` : ""}
          </dd>
          {g.p !== undefined && (
            <>
              <dt>Win chance</dt>
              <dd className={s.num}>
                {`${(g.p * 100).toFixed(1)}% (estimate from the tier's record, not a calibrated probability)`}
              </dd>
            </>
          )}
          {g.price !== undefined && g.p !== undefined && (
            <>
              <dt>Price</dt>
              <dd className={s.num}>{`${price(g.price)} quoted · estimated edge ${((g.p * decimal(g.price) - 1) * 100).toFixed(1)}% per unit`}</dd>
            </>
          )}
          {(st === "bet" || st === "early") && (
            <>
              <dt>Stake</dt>
              <dd>{stakeWhy(g, r)}</dd>
            </>
          )}
          {g.pemPick && (
            <>
              <dt>Note</dt>
              <dd>Sam and David split; PEM breaks it.</dd>
            </>
          )}
          {st === "priced" && (
            <>
              <dt>Why no bet</dt>
              <dd>{pricedWhy(g)}</dd>
            </>
          )}
          {st === "budget" && (
            <>
              <dt>Why no bet</dt>
              <dd>{`Worth ${g.want}u, but ${g.limited ?? "the limits leave no room"}.`}</dd>
            </>
          )}
          {st === "noquote" && (
            <>
              <dt>Why no bet</dt>
              <dd>No current quote: judged at the sites&apos; own lines, research only.</dd>
            </>
          )}
        </dl>
      </details>
    </li>
  );
}

type Res = "W" | "L" | "P";
const RES_CLASS: { [k in Res]: string } = { W: s.resW, L: s.resL, P: s.resP };

function tally(rs: (Res | undefined)[]): string | null {
  const w = rs.filter((x) => x === "W").length;
  const l = rs.filter((x) => x === "L").length;
  const p = rs.filter((x) => x === "P").length;
  return w + l + p ? rec({ w, l, p }) : null;
}

/** One finished game: the score, the board's call and how each model did. */
function FinishedRow({ g, r }: { g: BoardGame; r: PicksReport }) {
  const name = (k: string) => r.names[k] ?? k;
  const f = g.final!;
  const res = g.results ?? {};
  const call = res.issued ?? res.pick;
  const models: [string, Res | undefined][] = [
    ["Sam", res.sam],
    ["David", res.david],
    ...(r.league === "cfb" ? ([["PEM", res.pem]] as [string, Res | undefined][]) : []),
  ];
  const homeWon = f.home > f.away;
  return (
    <li className={s.finRow}>
      <div className={s.finScore}>
        <span className={!homeWon ? s.finWinner : undefined}>{`${name(g.away)} ${f.away}`}</span>
        <span className={s.muted}> at </span>
        <span className={homeWon ? s.finWinner : undefined}>{`${name(g.home)} ${f.home}`}</span>
      </div>
      <div className={s.finCall}>
        <span className={s.finPick}>
          {g.issued ? `Sent: ${pickText(g, name)} · ${g.issued.units}u` : g.side ? pickText(g, name) : g.read && !g.read.agree ? "Models split" : g.play}
        </span>
        {call && <span className={`${s.resChip} ${RES_CLASS[call]}`}>{call}</span>}
      </div>
      <div className={`${s.finModels} ${s.num}`}>
        {models.map(([who, x]) => (
          <span key={who}>
            {`${who} `}
            <b className={x ? RES_CLASS[x] : s.muted}>{x ?? "–"}</b>
          </span>
        ))}
      </div>
      <FinishedDetails g={g} r={r} />
    </li>
  );
}

const round1 = (x: number) => Math.round(x * 10) / 10;
/** Units won or lost on a settled bet at American odds (risk = units). */
const payout = (res: Res, u: number, p = -110) => (res === "W" ? (p > 0 ? (u * p) / 100 : (u * 100) / -p) : res === "L" ? -u : 0);

/** The "why" for a finished game: what each model had, the cuts it fell in, the line move and the rest. */
function FinishedDetails({ g, r }: { g: BoardGame; r: PicksReport }) {
  const name = (k: string) => r.names[k] ?? k;
  const f = g.final!;
  const res = g.results ?? {};
  const margin = f.home - f.away; // home side, positive = home won
  const team = (side: "home" | "away") => name(side === "home" ? g.home : g.away);
  const winner = margin === 0 ? null : margin > 0 ? g.home : g.away;
  // A home-side line as "Team -x": the projected winner and by how much.
  const proj = (homeLine: number) => (homeLine === 0 ? "even" : `${name(homeLine < 0 ? g.home : g.away)} by ${round1(Math.abs(homeLine))}`);
  const models = [
    { who: "Sam", m: g.sam?.model, at: g.sam?.market, res: res.sam },
    { who: "David", m: g.david?.model, at: g.david?.market, res: res.david },
    ...(r.league === "cfb" ? [{ who: "PEM", m: g.pem?.model, at: g.pem?.market ?? g.read?.avgMarket, res: res.pem }] : []),
  ].filter((x): x is { who: string; m: number; at: number | undefined; res: Res | undefined } => x.m !== undefined);
  // Miss = how far the projected margin was from the real one.
  const miss = (m: number) => Math.abs(-m - margin);
  const closest = models.length > 1 ? models.reduce((a, b) => (miss(b.m) < miss(a.m) ? b : a)) : null;
  const cuts = (g.cuts ?? []).map((id) => r.strategies.cuts.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c);
  const ruleId = r.strategies.rule?.id;
  const secondId = r.strategies.second?.id;
  cuts.sort((a, b) => Number(b.id === ruleId) - Number(a.id === ruleId) || Number(b.id === secondId) - Number(a.id === secondId) || b.record.pct - a.record.pct);
  const close = g.close?.close ?? null;
  const open = g.close?.open ?? null;
  // Points better (+) than the close for the side taken at homeLine.
  const clv = (side: "home" | "away", homeLine: number) => (close === null ? null : round1(side === "home" ? homeLine - close : close - homeLine));
  const taken = g.issued ?? (g.side && g.homeLine !== undefined ? { side: g.side, homeLine: g.homeLine } : null);
  const pts = f.home + f.away;
  const suRight = g.su && winner ? (g.su.side === "home" ? g.home : g.away) === winner : null;
  return (
    <details className={s.why}>
      <summary>Details</summary>
      <dl className={s.kv}>
        <dt>Final</dt>
        <dd>{winner ? `${name(winner)} by ${Math.abs(margin)}` : "Tie"}</dd>
        {models.map((x) => (
          <Fragment key={x.who}>
            <dt>{x.who}</dt>
            <dd>
              <span className={s.num}>{proj(x.m)}</span>
              {x.at !== undefined && <span className={s.muted}>{` vs ${name(g.home)} ${line(x.at)}`}</span>}
              {x.res && (
                <>
                  {" · "}
                  {x.m !== x.at && x.at !== undefined ? `took ${team(x.m < x.at ? "home" : "away")} ` : ""}
                  <b className={RES_CLASS[x.res]}>{x.res}</b>
                </>
              )}
              <span className={s.muted}>{` · off by ${round1(miss(x.m))}`}</span>
            </dd>
          </Fragment>
        ))}
        {closest && (
          <>
            <dt>Closest</dt>
            <dd>{`${closest.who}, ${round1(miss(closest.m))} pts from the real margin`}</dd>
          </>
        )}
        <dt>Board call</dt>
        <dd>
          <TierChip t={g.tier} /> {g.side ? pickText(g, name) : g.read && !g.read.agree ? "Sam and David split" : g.play}
          {g.read?.agree ? <span className={s.muted}>{` · avg edge ${g.read.avgEdge.toFixed(1)}, models ${g.read.modelGap.toFixed(1)} apart`}</span> : null}
        </dd>
        <dt>Cuts</dt>
        <dd>
          {cuts.length ? (
            <ul className={s.finCuts}>
              {cuts.map((c) => (
                <li key={c.id}>
                  {c.id === ruleId ? <b>Rule: </b> : c.id === secondId ? <b>Tier 2: </b> : null}
                  {c.label}
                  <span className={`${s.num} ${s.muted}`}>{` · ${rec(c.record)} (${pct(c.record)})`}</span>
                </li>
              ))}
            </ul>
          ) : g.read && !g.read.agree ? (
            "None: cuts need Sam and David on the same side."
          ) : (
            "None"
          )}
        </dd>
        {(open !== null || close !== null) && (
          <>
            <dt>Line move</dt>
            <dd className={s.num}>
              {`${name(g.home)} ${open !== null ? line(open) : "?"} open → ${close !== null ? line(close) : "?"} close`}
              {taken && clv(taken.side, taken.homeLine) !== null && (
                <span className={clv(taken.side, taken.homeLine)! > 0 ? s.pos : clv(taken.side, taken.homeLine)! < 0 ? s.neg : s.muted}>
                  {` · call ${clv(taken.side, taken.homeLine)! > 0 ? "+" : ""}${clv(taken.side, taken.homeLine)} vs close`}
                </span>
              )}
            </dd>
          </>
        )}
        {g.issued && res.issued && (
          <>
            <dt>Sent</dt>
            <dd className={s.num}>
              {`${g.issued.units}u at ${price(g.issued.price)} → `}
              <b className={RES_CLASS[res.issued]}>{units(payout(res.issued, g.issued.units, g.issued.price))}</b>
            </dd>
          </>
        )}
        {g.su && (
          <>
            <dt>Straight up</dt>
            <dd>
              {`${team(g.su.side)} to win`}
              {suRight !== null && <b className={suRight ? s.resW : s.resL}>{suRight ? " · right" : " · wrong"}</b>}
              {g.su.upset ? <span className={s.muted}> · upset call</span> : null}
            </dd>
          </>
        )}
        <dt>Total</dt>
        <dd className={s.num}>
          {`${pts} scored`}
          <span className={s.muted}>
            {[
              g.samTotal !== undefined ? `Sam ${round1(g.samTotal)}` : null,
              g.davidTotal !== undefined ? `David ${round1(g.davidTotal)}` : null,
              g.close?.totalClose != null ? `close ${g.close.totalClose}` : null,
            ]
              .filter(Boolean)
              .map((x) => ` · ${x}`)
              .join("")}
          </span>
        </dd>
      </dl>
      <p className={s.thin}>Cut records include this game. Each model is graded at its own site&apos;s line.</p>
    </details>
  );
}

function Finished({ games, r }: { games: BoardGame[]; r: PicksReport }) {
  const calls = tally(games.map((g) => g.results?.issued ?? g.results?.pick));
  const parts = [
    calls ? `Board calls ${calls}` : null,
    tally(games.map((g) => g.results?.sam)) ? `Sam ${tally(games.map((g) => g.results?.sam))}` : null,
    tally(games.map((g) => g.results?.david)) ? `David ${tally(games.map((g) => g.results?.david))}` : null,
    r.league === "cfb" && tally(games.map((g) => g.results?.pem)) ? `PEM ${tally(games.map((g) => g.results?.pem))}` : null,
  ].filter(Boolean);
  return (
    <div className={s.finished} aria-labelledby="ats-finished">
      <div className={s.finHead}>
        <h3 className={s.h3} id="ats-finished">{`Finished (${games.length})`}</h3>
        {parts.length > 0 && <span className={`${s.num} ${s.finTally}`}>{parts.join(" · ")}</span>}
      </div>
      <p className={s.notice}>Graded from the final score the day each game ends, each model at its own line. Clears when the week turns over Tuesday morning.</p>
      <ul className={s.finList}>
        {games.map((g) => (
          <FinishedRow key={`${g.away}@${g.home}`} g={g} r={r} />
        ))}
      </ul>
    </div>
  );
}

export function AtsWeek({ r }: { r: PicksReport }) {
  const st = r.strategies;
  const order = (g: BoardGame) =>
    g.stake ? -(g.stake * 10 + (g.p && g.price ? kelly(g.p, g.price) : 0)) : 0;
  const all = r.board.slice().sort((a, b) => order(a) - order(b) || (a.ref?.kickoff ?? "").localeCompare(b.ref?.kickoff ?? ""));
  const bets = all.filter((g) => statusOf(g) === "bet" || statusOf(g) === "sent").sort((a, b) => (a.ref?.kickoff ?? "").localeCompare(b.ref?.kickoff ?? ""));
  const near = all.filter((g) => ["priced", "budget", "wait", "noquote"].includes(statusOf(g)));
  const rest = all.filter((g) => statusOf(g) === "pass");
  const started = all.filter((g) => statusOf(g) === "started");
  const finished = all.filter((g) => statusOf(g) === "final");
  const early = all.filter((g) => statusOf(g) === "early");
  const days = groupByDay([...bets, ...early], (g) => g.ref?.kickoff, new Date());
  const isBet = (g: BoardGame) => statusOf(g) !== "early";
  const dayUnits = (gs: BoardGame[]) => gs.reduce((t, g) => t + (g.issued?.units ?? g.stake ?? 0), 0);
  const dayLine = (b: BoardGame[], e: number) =>
    [b.length ? `${b.length} bet${b.length === 1 ? "" : "s"} · ${u(dayUnits(b))}` : "", e ? `${e} early look${e === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
  const u = (x: number) => `${x.toFixed(2).replace(/\.?0+$/, "")}u`;
  const total = bets.reduce((t, g) => t + (g.issued?.units ?? g.stake ?? 0), 0);
  const name = (k: string) => r.names[k] ?? k;
  const firstT1 = all.find((g) => g.tier === "t1" && g.sam && g.david);
  const example =
    firstT1?.sam && firstT1.david
      ? { vegas: firstT1.ref?.line ?? firstT1.david.market, sam: firstT1.sam.model, david: firstT1.david.model, pem: firstT1.pem?.model, label: `${name(firstT1.away)} at ${name(firstT1.home)}` }
      : null;
  return (
    <section className={s.section} aria-labelledby="ats-week">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="ats-week">
          {r.week ? `Week ${r.week} spreads` : "This week's spreads"}
        </h2>
        <p className={s.p}>
          {st.rule
            ? `${bets.length} bet${bets.length === 1 ? "" : "s"}, ${total.toFixed(2).replace(/\.?0+$/, "")}u${early.length ? `, plus ${early.length} early look${early.length === 1 ? "" : "s"} that become bets at 9am on game day` : ""}. Rule: ${st.rule.label.toLowerCase()} (${rec(st.rule.record)})${st.second ? `; Tier 2: ${st.second.label.toLowerCase()} (${rec(st.second.record)} on the games it adds)` : "; no Tier 2"}.`
            : "No cut has a big enough winning record yet, so nothing is a bet this week."}
        </p>
      </div>
      {!r.boardUpdated.sam && !r.boardUpdated.david ? (
        <p className={s.notice}>{`Neither Sam nor David has posted ${r.week ? `Week ${r.week}` : "this week"} yet. Games appear here as soon as one does.`}</p>
      ) : !r.boardUpdated.sam || !r.boardUpdated.david ? (
        <p className={s.notice}>{`${!r.boardUpdated.sam ? "Sam" : "David"} hasn't posted this week's board yet, so games are single-model for now.`}</p>
      ) : null}
      {bets.length || early.length ? (
        <div className={s.days} data-first-pick>
          {days.map((d) => (
            <div key={d.key} className={s.day}>
              <div className={`${s.dayHead} ${d.label.startsWith("Today") ? s.dayToday : ""}`}>
                <span>{d.label}</span>
                <span className={s.num}>{dayLine(d.games.filter(isBet), d.games.length - d.games.filter(isBet).length)}</span>
              </div>
              <ul className={s.cards}>
                {d.games.map((g) => (
                  <PickCard key={`${g.away}@${g.home}`} g={g} r={r} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className={s.calm} data-first-pick>
          {started.length || finished.length
            ? "No spread bets left this week. Games underway and finished are below."
            : !r.boardUpdated.sam && !r.boardUpdated.david
            ? "No games on the board yet."
            : "No spread bets this week. That's a normal outcome: nothing clears the rule at a price worth a stake."}
        </p>
      )}
      {started.length > 0 && (
        <details className={s.details}>
          <summary>{`In progress (${started.length})`}</summary>
          <ul className={`${s.cards} ${s.cardsInset}`}>
            {started.map((g) => (
              <PickCard key={`${g.away}@${g.home}`} g={g} r={r} />
            ))}
          </ul>
        </details>
      )}
      {near.length > 0 && (
        <details className={s.details}>
          <summary>{`Close calls (${near.length}): fit the rule, no bet right now`}</summary>
          <ul className={`${s.cards} ${s.cardsInset}`}>
            {near.map((g) => (
              <PickCard key={`${g.away}@${g.home}`} g={g} r={r} />
            ))}
          </ul>
        </details>
      )}
      {rest.length > 0 && (
        <details className={s.details}>
          <summary>{`Every other game (${rest.length})`}</summary>
          <ul className={`${s.cards} ${s.cardsInset}`}>
            {rest.map((g) => (
              <PickCard key={`${g.away}@${g.home}`} g={g} r={r} />
            ))}
          </ul>
        </details>
      )}
      <details className={s.details}>
        <summary>Check a moved line</summary>
        <div className={s.detailsBody}>
          <TierChecker
            rule={st.rule ? { label: st.rule.label, test: st.rule.test, record: rec(st.rule.record) } : null}
            second={st.second ? { label: st.second.label, test: st.second.test, record: `${rec(st.second.record)} on games outside Tier 1` } : null}
            example={example}
            pem={r.league === "cfb"}
            pemNeeded={!!(st.rule && needsPem(st.rule.test)) || !!(st.second && needsPem(st.second.test))}
          />
        </div>
      </details>
      {finished.length > 0 && <Finished games={finished} r={r} />}
    </section>
  );
}

export function AtsResults({ r }: { r: PicksReport }) {
  const u = r.units;
  const t1 = u.byTier.t1;
  const t2 = u.byTier.t2;
  const ats = { bets: t1.bets + t2.bets, w: t1.w + t2.w, l: t1.l + t2.l, p: t1.p + t2.p, units: t1.units + t2.units, risked: t1.risked + t2.risked, pending: t1.pending + t2.pending };
  const dd = drawdown(u.byWeek.map((w) => w.ledger.units));
  const clvSent = r.clv.plays.filter((x) => x.id !== "ou");
  return (
    <section className={s.section} aria-labelledby="ats-results">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="ats-results">Spread results</h2>
        <p className={s.p}>
          Returns on what the emails recommended, at the line and price each bet was sent with. These are recommendation
          returns, not bets you confirmed placing.
        </p>
      </div>
      <div className={s.tiles}>
        <div className={`${s.tile} ${ats.w + ats.l ? (ats.units >= 0 ? s.good : s.bad) : ""}`}>
          <div className={`${s.tileV} ${s.num}`}>{ats.w + ats.l + ats.p ? units(ats.units) : "none yet"}</div>
          <div className={s.tileK}>{`Units (risked) · ${rec(ats)}${ats.pending ? `, ${ats.pending} pending` : ""}`}</div>
        </div>
        <div className={s.tile}>
          <div className={`${s.tileV} ${s.num}`}>{ats.risked ? `${Math.round((ats.units / ats.risked) * 100)}%` : "·"}</div>
          <div className={s.tileK}>{ats.risked ? `Return on ${ats.risked.toFixed(1)}u risked` : "Return on risk"}</div>
        </div>
        <div className={s.tile}>
          <div className={`${s.tileV} ${s.num}`}>{dd ? `−${dd.toFixed(1)}u` : "0u"}</div>
          <div className={s.tileK}>Worst drawdown (by week)</div>
        </div>
        <div className={s.tile}>
          <div className={`${s.tileV} ${s.num}`}>{`${r.allocation.exposure.weekly}u`}</div>
          <div className={s.tileK}>{`Issued this week, both sports · ${r.allocation.exposure.outstanding}u open`}</div>
        </div>
      </div>
      {u.unstaked > 0 && <p className={s.thin}>{`${u.unstaked} earlier plays went out before stakes existed: in the win-loss record below, not in units.`}</p>}
      <div className={s.tw}>
        <table className={s.table}>
          <caption className={s.caption}>As sent, by week (each game once, at the line first sent)</caption>
          <thead>
            <tr>
              <th>Week</th>
              <th>Tier 1</th>
              <th>Tier 2</th>
              <th>Units</th>
            </tr>
          </thead>
          <tbody>
            {r.live.length === 0 && (
              <tr>
                <td colSpan={4} className={s.dim}>
                  Nothing sent yet.
                </td>
              </tr>
            )}
            {r.live.map((w) => {
              const lw = u.byWeek.find((x) => x.week === w.week)?.ledger;
              return (
                <tr key={w.week}>
                  <td className={s.num}>
                    {w.week}
                    {w.provenance === "recovered" && <div className={s.thin}>recovered from the email</div>}
                  </td>
                  <td className={s.num}>{rec(w.t1)}</td>
                  <td className={s.num}>{rec(w.t2)}</td>
                  <td className={`${s.num} ${lw && lw.units < 0 ? s.neg : s.pos}`}>
                    {lw && lw.w + lw.l + lw.p ? units(lw.units) : "·"}
                    {w.pending ? <span className={s.dim}>{` · ${w.pending} pending`}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={s.tw}>
        <table className={s.table}>
          <caption className={s.caption}>Beating the closing line</caption>
          <thead>
            <tr>
              <th>Who</th>
              <th>Picks with a close</th>
              <th>vs close</th>
              <th>Beat / worse</th>
            </tr>
          </thead>
          <tbody>
            {[...clvSent, ...r.clv.models].map((m) => (
              <tr key={m.id}>
                <td>
                  {m.label}
                  {m.note && <div className={s.thin}>{m.note}</div>}
                </td>
                <td className={s.num}>{m.n}</td>
                <td className={`${s.num} ${m.avg > 0 ? s.pos : m.avg < 0 ? s.neg : ""}`}>{m.n ? `${m.avg > 0 ? "+" : ""}${m.avg.toFixed(2)}` : "·"}</td>
                <td className={s.num}>{m.n ? `${m.beat} / ${m.worse}` : "·"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={s.thin}>{`${r.clv.matched} of ${r.clv.games} backtest games have a closing line on file. "vs close" is points better (+) or worse than the closing spread.`}</p>
    </section>
  );
}

export function AtsResearch({ r }: { r: PicksReport }) {
  const st = r.strategies;
  const name = (k: string) => r.names[k] ?? k;
  const groups = [...new Set(st.cuts.filter((c) => c.group !== "Research").map((c) => c.group))];
  const matchesRule = (g: PicksReport["graded"][number], rule: CutResult) => cutResult(g, rule) !== undefined;
  return (
    <section className={s.section} aria-labelledby="ats-research">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="ats-research">Spread research</h2>
        <p className={s.p}>
          {`Source-line backtest: ${r.graded.length} games both models graded, weeks ${r.weeksCovered.join(", ") || "none"}. Each model is judged at its own site's line here; this week's board judges every model at one current line.`}
        </p>
      </div>
      {st.rule ? (
        <div className={s.rule}>
          <div>
            <div className={s.eyebrow}>The rule, chosen on this history</div>
            <h3 className={s.h2}>{st.rule.label}</h3>
            <p className={s.p}>
              {`Of the cuts with ${10}+ decided games and a winning rate past break-even, this has the highest low end of its 90% range (${Math.round(st.rule.record.lo * 100)}%). That range is an estimate from a small sample, not a floor.`}
              {st.rule.activated ? " Activated by the strategy review." : ""}
              {st.second
                ? ` Tier 2: ${st.second.label.toLowerCase()}, judged only on the ${n(st.second.record)} decided games it adds (${rec(st.second.record)}; whole cut ${rec(st.second.fullRecord)}).`
                : " No Tier 2: nothing else wins on the games Tier 1 leaves."}
            </p>
          </div>
          <div className={`${s.big} ${s.num}`}>
            {rec(st.rule.record)}
            <small>{pct(st.rule.record)} ATS</small>
          </div>
        </div>
      ) : (
        <p className={s.calm}>No cut qualifies as the rule yet.</p>
      )}
      <details className={s.details} open>
        <summary>Every cut tested</summary>
        <div className={s.board}>
          <div className={s.legend}>
            <span>
              <i style={{ background: "var(--pos)" }} />
              Above break-even
            </span>
            <span>
              <i style={{ background: "var(--neg)" }} />
              Below
            </span>
            <span>
              <i style={{ background: "var(--ci)" }} />
              90% likely range
            </span>
            <span>Backtest units: to win 1 at −110</span>
          </div>
          <div className={s.grp}>Baselines</div>
          {st.baselines.map((b) => (
            <StrategyRow key={b.id} label={b.label} r={b.record} />
          ))}
          <StrategyRow label="Models split: Sam's side" r={st.splits.sam} />
          <StrategyRow label="Models split: David's side" r={st.splits.david} />
          {groups.map((gname) => (
            <div key={gname}>
              <div className={s.grp}>{gname}</div>
              {st.cuts
                .filter((c) => c.group === gname)
                .map((c) => (
                  <StrategyRow key={c.id} label={c.label} r={c.record} mark={st.rule?.id === c.id ? "rule" : st.second?.id === c.id ? "second" : undefined} />
                ))}
            </div>
          ))}
          <div className={s.grp}>By week (all agreements)</div>
          {st.byWeek.map((w) => (
            <StrategyRow key={w.week} label={`Week ${w.week}`} r={w.record} />
          ))}
        </div>
      </details>
      {r.research.length > 0 && (
        <details className={s.details}>
          <summary>Does being more specific help? (research refinements)</summary>
          <div className={s.detailsBody}>
            <p className={s.p}>
              Each refinement beside the cut it narrows, and how the games it leaves out did. These are on the
              source-line history the thresholds were chosen from, so they are hypotheses: one becomes a rule candidate
              only through the strategy review, on pregame evidence recorded after it was registered.
            </p>
          </div>
          <div className={s.tw}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Refinement</th>
                  <th>W-L-P</th>
                  <th>Weeks</th>
                  <th>vs close (n)</th>
                  <th>Parent</th>
                  <th>Left out</th>
                </tr>
              </thead>
              <tbody>
                {r.research.map((x) => (
                  <tr key={x.id}>
                    <td>{x.label}</td>
                    <td className={`${s.num} ${s.nw}`}>
                      {rec(x.record)}
                      <div className={s.thin}>{`${n(x.record)} decided`}</div>
                    </td>
                    <td className={s.num}>{x.weeks.join(", ") || "·"}</td>
                    <td className={`${s.num} ${s.nw}`}>{x.clv.n ? `${x.clv.avg > 0 ? "+" : ""}${x.clv.avg.toFixed(2)} (${x.clv.n})` : "·"}</td>
                    <td className={s.num}>
                      {rec(x.parent.record)}
                      <div className={s.thin}>{x.parent.label}</div>
                    </td>
                    <td className={s.num}>{n(x.excluded) + x.excluded.p ? rec(x.excluded) : "·"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {r.pemCompare && r.pemCompare.games > 0 && (
        <details className={s.details}>
          <summary>{`PEM on the same games (${r.pemCompare.games})`}</summary>
          <div className={s.detailsBody}>
            <p className={s.p}>Every model judged and graded at one line: the average of Sam&apos;s and David&apos;s posted numbers.</p>
          </div>
          <div className={s.tw}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>On these games</th>
                  <th>W-L-P</th>
                  <th>vs close (n)</th>
                </tr>
              </thead>
              <tbody>
                {r.pemCompare.rows.map((x) => (
                  <tr key={x.id}>
                    <td>{x.label}</td>
                    <td className={s.num}>{n(x.record) + x.record.p ? rec(x.record) : "·"}</td>
                    <td className={s.num}>{x.clv.n ? `${x.clv.avg > 0 ? "+" : ""}${x.clv.avg.toFixed(2)} (${x.clv.n})` : "·"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <details className={s.details}>
        <summary>{`Game log: all ${r.graded.length} graded games`}</summary>
        <div className={s.tw}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Wk</th>
                <th>Game</th>
                <th>Final</th>
                <th>Shared pick (worse line)</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {r.graded
                .slice()
                .sort((a, b) => b.week - a.week || Number(b.read.agree) - Number(a.read.agree))
                .map((g) => (
                  <tr key={`${g.week}:${g.away}@${g.home}`}>
                    <td className={s.num}>{g.week}</td>
                    <td className={s.game}>
                      {name(g.away)} @ {name(g.home)}
                    </td>
                    <td className={s.num}>
                      {g.final.away}–{g.final.home}
                    </td>
                    <td>
                      {g.read.agree && g.read.line !== undefined ? (
                        `${name(g.read.side === "home" ? g.home : g.away)} ${line(g.read.line)}`
                      ) : (
                        <span className={s.dim}>{`Split: Sam ${g.samResult}, David ${g.davidResult}`}</span>
                      )}
                      {st.rule && matchesRule(g, st.rule) && <span className={`${s.tag} ${s.tagRule}`}>rule</span>}
                    </td>
                    <td>{g.result ? <span className={g.result === "W" ? s.w : g.result === "L" ? s.l : s.pu}>{g.result}</span> : <span className={s.dim}>·</span>}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
