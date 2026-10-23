// Spreads (ATS): this week's bets, results, research.
import { needsPem, type BoardGame, type CutResult } from "@/lib/picks/engine";
import { bettable, cutResult } from "@/lib/picks/engine";
import type { PicksReport } from "@/lib/picks/report";
import type { BetRow } from "@/lib/picks/units";
import { decimal, worstPrice } from "@/lib/picks/staking";
import { Fragment } from "react";
import Link from "next/link";
import TierChecker from "./TierChecker";
import { StrategyRow, TierChip, drawdown, kickoffEt, line, n, pct, price, rec, units } from "./ui";
import { Background, Curve, Hero, MarketKey, MarketLine, SecHead } from "./board";
import { findGame, type LiveGame } from "@/lib/live/espn";
import s from "./picks.module.css";

export type Status = "sent" | "early" | "bet" | "priced" | "budget" | "wait" | "noquote" | "started" | "final" | "pass";

export function statusOf(g: BoardGame): Status {
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

export const STATUS_TEXT: { [k in Status]: string } = {
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

export function pickText(g: BoardGame, name: (k: string) => string): string {
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
  if (r.policy?.staking?.kind === "flat") return `Flat ${r.policy.staking.flatUnits}u: every pick that passes the price check bets the same, while quarter Kelly is tracked in shadow. No limit cut it.`;
  return `Standard quarter-Kelly stake for this tier at ${price(g.price)}. No limit cut it.`;
}

/** Why a qualifying pick is not a bet: no price, the price check, or a size under 1u. */
function pricedWhy(g: BoardGame): string {
  if (g.priceSource === "missing") return "No quoted price, so no stake.";
  if (g.eligible) return "Passes the price check, but the current sizing policy puts it under 1u, and anything under 1u is not a bet.";
  const worst = g.p !== undefined ? worstPrice(g.p) : null;
  const need = worst === null ? "a plus-money price" : `${price(worst)} or better`;
  return `At ${price(g.price)} the tier's estimated edge is too thin for a 1u bet. It would need ${need}.`;
}

/** Every reason behind a game's call: the line, each model, tier, chance, price, stake or why no bet. */
function WhyList({ g, r }: { g: BoardGame; r: PicksReport }) {
  const home = r.names[g.home] ?? g.home;
  const st = statusOf(g);
  return (
    <dl className={s.kv}>
      <dt>Line now</dt>
      <dd className={s.num}>{g.ref ? `${home} ${line(g.ref.line)} · ${g.ref.source}` : st === "started" || g.final ? "Closed at kickoff" : "none"}</dd>
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
        {g.vetoedBy ? ` · skipped: ${g.vetoedBy} disagrees (veto)` : ""}
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
  );
}

/** The full breakdown page for one game. */
export const gameHref = (r: PicksReport, g: BoardGame) => `/picks/game?l=${r.league}&g=${encodeURIComponent(`${g.away}@${g.home}`)}`;

/**
 * One game's read chip and the small line under it (the Ledger redesign).
 * Solid only once a bet is sent; sized-not-sent and early looks are dashed;
 * close calls are tracked; a pass is plain text.
 */
function readOf(g: BoardGame, r: PicksReport, live?: LiveGame): { chip: [string, string]; note?: string; noteCls?: string } {
  const st = statusOf(g);
  const tier = g.tier === "t1" ? "Tier 1" : g.tier === "t2" ? "Tier 2" : "Bet";
  const res = g.results?.issued ?? g.results?.pick;
  if (st === "final")
    return g.issued && res
      ? { chip: [res === "W" ? "Won" : res === "L" ? "Lost" : "Push", res === "W" ? s.readW : res === "L" ? s.readL : ""], note: `${tier} · ${amt(g.issued.units)}` }
      : { chip: ["Final", s.readPass], note: res && g.side ? `Pick ${res === "W" ? "covered" : res === "L" ? "missed" : "pushed"}, no stake` : undefined };
  if (st === "started") {
    if (!g.issued) return live?.state === "post" ? { chip: ["Final", s.readPass], note: "Grading soon" } : { chip: ["In progress", s.readLive] };
    if (!live) return { chip: [`${tier} · ${amt(g.issued.units)}`, s.readBet], note: "In progress", noteCls: s.liveNote };
    // Live cover at the line it was sent at: home margin plus the home line, flipped for the away side.
    const m = live.home.score - live.away.score + g.issued.homeLine;
    const by = g.issued.side === "home" ? m : -m;
    const done = live.state === "post";
    return {
      chip: [`${tier} · ${amt(g.issued.units)}`, s.readBet],
      note: by > 0 ? `${done ? "Covered" : "Covering"} by ${by}` : by < 0 ? `${done ? "Missed" : "Short"} by ${-by}` : "On the number",
      noteCls: by > 0 ? s.pos : by < 0 ? s.neg : s.liveNote,
    };
  }
  if (st === "sent") return { chip: [`${tier} · ${amt(g.issued!.units)}`, s.readBet], note: `Sent at ${price(g.issued!.price)}` };
  if (st === "early") return { chip: [`${tier} · not sent`, s.readPend], note: `Locks ${kickoffEt(g.held)}` };
  if (st === "bet") return { chip: [`${tier} · not sent`, s.readPend], note: `${amt(g.stake ?? 0)} at ${price(g.price)}` };
  if (st === "priced") {
    const worst = g.p !== undefined ? worstPrice(g.p) : null;
    return { chip: ["Close call", s.readTrack], note: `Now ${price(g.price)} · needs ${worst === null ? "plus money" : price(worst)}` };
  }
  if (st === "budget") return { chip: ["Close call", s.readTrack], note: "Over this week's budget" };
  if (st === "wait") return { chip: ["Needs PEM", s.readTrack], note: g.waitFor ? `${g.waitFor === "t1" ? "Tier 1" : "Tier 2"} if PEM agrees` : undefined };
  if (st === "noquote") return { chip: ["No line", s.readPass] };
  return { chip: [g.tier === "split" ? "Split" : "Pass", s.readPass], note: r.league && g.read && g.tier !== "split" ? `Edge ${g.read.avgEdge.toFixed(1)}` : undefined };
}

/** One game in the ledger: matchup, market, both models, our side and the read; opens to every reason. */
function LedgerRow({ g, r, live }: { g: BoardGame; r: PicksReport; live?: LiveGame }) {
  const name = (k: string) => r.names[k] ?? k;
  const st = statusOf(g);
  const home = name(g.home);
  const m = (x?: number) => (x === undefined ? "·" : `${home} ${line(Math.round(x * 10) / 10)}`);
  const rd = readOf(g, r, live);
  const side = g.side && g.homeLine !== undefined ? pickText(g, name) : g.tier === "split" && g.read ? "Models split" : "None";
  return (
    <details className={`${s.gRow} ${s.ledger}`} open={st === "started" && !!g.issued}>
      <summary>
        <span className={s.gGame}>
          {`${name(g.away)} at ${home}`}
          {st === "started" && live?.state === "post" ? (
            // Over on ESPN but not graded yet: say Final, never Live.
            <span className={s.scoreLine}>{`Final ${live.away.abbr} ${live.away.score}, ${live.home.abbr} ${live.home.score}`}</span>
          ) : st === "started" ? (
            <>
              <span className={s.gLive}>Live</span>
              {live && <span className={s.scoreLine}>{`${live.away.abbr} ${live.away.score}, ${live.home.abbr} ${live.home.score} · ${live.detail}`}</span>}
            </>
          ) : (
            <span>{g.final ? `Final ${name(g.away)} ${g.final.away}, ${home} ${g.final.home}` : kickoffEt(g.ref?.kickoff)}</span>
          )}
        </span>
        <span className={s.gNum} data-k="Market">{g.ref ? m(g.ref.line) : st === "started" || st === "final" ? "Closed" : "·"}</span>
        <span className={s.gNum} data-k="Sam · David">
          <span className={s.cSam}>{m(g.sam?.model)}</span>
          <small className={s.cDavid}>{m(g.david?.model)}</small>
        </span>
        <span className={s.gNum} data-k="Side">
          {side}
          {g.read && <small>{`edge ${g.read.avgEdge.toFixed(1)} pts`}</small>}
        </span>
        <span className={s.ledgerRead}>
          <span className={`${s.readChip} ${rd.chip[1]}`}>{rd.chip[0]}</span>
          {rd.note && <small className={rd.noteCls}>{rd.note}</small>}
        </span>
        <span className={s.chev} aria-hidden>
          ›
        </span>
      </summary>
      <div className={s.gBody}>
        {st === "final" ? <FinishedDetails g={g} r={r} /> : <WhyList g={g} r={r} />}
        <Link href={gameHref(r, g)} className={s.linkA} style={{ display: "inline-block", marginTop: 8, fontWeight: 600, fontSize: 14 }}>
          Full breakdown ›
        </Link>
      </div>
    </details>
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
              {x.at !== undefined && <span className={s.muted}>{` vs ${name(g.home)} ${line(bettable(x.at, x.m < x.at ? "home" : "away"))}`}</span>}
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
          {g.vetoedBy ? <span className={s.muted}>{` · fits the rule, skipped: ${g.vetoedBy} disagrees and the review made ${g.vetoedBy === "PEM" ? "PEM" : "him"} a veto`}</span> : null}
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
      <p className={s.notice}>Graded from the final score the day each game ends, each model at its own line. These count toward the rule at the review next Tuesday, not before. Clears when the week turns over Tuesday morning.</p>
      <ul className={s.finList}>
        {games.map((g) => (
          <FinishedRow key={`${g.away}@${g.home}`} g={g} r={r} />
        ))}
      </ul>
    </div>
  );
}

/** When this week's rule was set: frozen at the Tuesday review, or provisional until it runs. */
function ruleSetLine(r: PicksReport): string {
  const through = (w: number | null | undefined) => (w ? ` on games through Week ${w}` : "");
  if (r.ruleSet) {
    const day = new Date(r.ruleSet.at).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });
    return `Set at the ${day} review${through(r.ruleSet.throughWeek)}; holds until next Tuesday.`;
  }
  const prior = r.weeksCovered.filter((w) => !r.week || w < r.week);
  return `Provisional${through(prior.length ? Math.max(...prior) : null)} until Tuesday's 7am review sets it for the week.`;
}

/** What each read chip means, above every board (the Ledger redesign). */
export function ReadLegend() {
  return (
    <div className={s.legendRow}>
      <span>
        <span className={`${s.readChip} ${s.readBet}`}>Tier 1 · 1u</span> sent, saved price and stake
      </span>
      <span>
        <span className={`${s.readChip} ${s.readPend}`}>Tier 2 · not sent</span> qualifies, not sent yet
      </span>
      <span>
        <span className={`${s.readChip} ${s.readTrack}`}>Close call</span> tracked, no stake
      </span>
      <span>
        <span className={`${s.readChip} ${s.readPass}`}>Pass</span> no position
      </span>
    </div>
  );
}

export function AtsWeek({ r, live = [] }: { r: PicksReport; live?: LiveGame[] }) {
  const st = r.strategies;
  const byKick = (a: BoardGame, b: BoardGame) => (a.ref?.kickoff ?? "").localeCompare(b.ref?.kickoff ?? "");
  const all = r.board.slice().sort(byKick);
  const best = all.filter((g) => ["bet", "sent", "early"].includes(statusOf(g)));
  const near = all.filter((g) => ["priced", "budget", "wait"].includes(statusOf(g)));
  const finished = all.filter((g) => statusOf(g) === "final");
  const open = all.filter((g) => statusOf(g) !== "final");
  const name = (k: string) => r.names[k] ?? k;
  const firstT1 = all.find((g) => g.tier === "t1" && g.sam && g.david);
  const example =
    firstT1?.sam && firstT1.david
      ? { vegas: firstT1.ref?.line ?? firstT1.david.market, sam: firstT1.sam.model, david: firstT1.david.model, pem: firstT1.pem?.model, label: `${name(firstT1.away)} at ${name(firstT1.home)}` }
      : null;
  const early = best.filter((g) => statusOf(g) === "early").length;
  const title = best.length ? `${best.length} best bet${best.length === 1 ? "" : "s"} this week` : finished.length && !open.length ? "Week done" : "No spread bets this week";
  const sub = !r.boardUpdated.sam && !r.boardUpdated.david
    ? `Neither Sam nor David has posted ${r.week ? `Week ${r.week}` : "this week"} yet.`
    : best.length
    ? `${st.rule ? `${st.rule.label} (${rec(st.rule.record)})${st.second ? `, plus Tier 2: ${st.second.label.toLowerCase()}` : ""}.` : ""}${early ? ` Early looks lock at 9am on game day.` : ""}`
    : "Nothing clears the rule at a price worth a stake. That's a normal week.";
  const started = open.filter((g) => statusOf(g) === "started");
  const upcoming = open.filter((g) => statusOf(g) !== "started");
  return (
    <section className={s.section} aria-labelledby="ats-week">
      <SecHead id="ats-week" title="Spreads" aside={`${title} · started games first`} />
      {sub && <p className={s.p}>{sub}</p>}
      {all.length > 0 ? (
        <div className={s.section}>
          <ReadLegend />
          <div className={s.gtable}>
            <div className={`${s.gHead} ${s.ledgerHead}`} aria-hidden>
              <span>Game</span>
              <span>Market</span>
              <span>Sam · David</span>
              <span>Side</span>
              <span>Read</span>
              <span />
            </div>
            {[...started, ...upcoming, ...finished].map((g) => (
              <LedgerRow key={`${g.away}@${g.home}`} g={g} r={r} live={findGame(live, r.league, g.away, g.home)} />
            ))}
          </div>
          <p className={s.p}>{`Started games first, then by kickoff${finished.length ? `; ${finished.length} final at the bottom` : ""}. Home spread throughout. Open a game for every reason.`}</p>
          {near.length + best.length > 0 && <MarketKey pem={r.league === "cfb"} />}
        </div>
      ) : (
        <p className={s.calm}>No games on the board yet.</p>
      )}
      <Background>
        <p className={s.p}>{ruleSetLine(r)}</p>
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
      </Background>
    </section>
  );
}

/** Units with up to two decimals: 0.5u, 1u, 1.25u. */
const amt = (x: number) => `${Number(x.toFixed(2))}u`;

/** "BYU -11", "Over 47.5 (Iowa State at BYU)", or a parlay's legs joined. */
function betText(b: BetRow, name: (k: string) => string): string {
  const leg = (l: BetRow["legs"][number]) =>
    l.side === "over" || l.side === "under"
      ? `${l.side === "over" ? "Over" : "Under"} ${l.line} (${name(l.away)} at ${name(l.home)})`
      : `${name(l.side === "home" ? l.home : l.away)} ${line(bettable(l.side === "home" ? l.line : -l.line, "home"))}`;
  return b.legs.map(leg).join(" + ");
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
      <Hero
        eyebrow={`${r.league === "nfl" ? "NFL" : "College"} ${r.season} · Spreads · every bet sent`}
        title={
          <span id="ats-results">
            {ats.w + ats.l + ats.p ? (
              <>
                {ats.units >= 0 ? "Up " : "Down "}
                <span className={ats.units >= 0 ? s.up : s.down}>{units(ats.units)}</span>
                {` on ${rec(ats)}`}
              </>
            ) : (
              "No bets settled yet"
            )}
          </span>
        }
        sub="1 unit risked per unit staked, at the line and price each bet was sent with. Recommendation returns, not bets you confirmed placing."
      />
      {u.byWeek.length > 0 && (
        <div className={s.curveBox}>
          <h3 className={s.h3} style={{ margin: 0 }}>Units over the season</h3>
          <Curve points={u.byWeek.map((w) => ({ x: `Week ${w.week}`, v: w.ledger.units }))} label="Running units after each week" />
        </div>
      )}
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
      <div className={s.betWeeks}>
        <h3 className={s.caption}>As sent, by week (each game once, at the line first sent)</h3>
        {r.live.length === 0 && <p className={s.dim}>Nothing sent yet.</p>}
        {[...r.live].reverse().map((w, i) => {
          const wk = u.byWeek.find((x) => x.week === w.week);
          const lw = wk?.ledger;
          // Only settled bets: a pending one's stake and line can still change.
          const settled = wk?.bets.filter((b) => b.result) ?? [];
          const staked = settled.filter((b) => !b.unstaked);
          const early = settled.filter((b) => b.unstaked);
          // The heading counts staked bets only, so it matches the list and the units.
          const tierRec = (t: "t1" | "t2") => {
            const rs = staked.filter((b) => b.kind === "spread" && b.tier === t).map((b) => b.result);
            return { w: rs.filter((x) => x === "W").length, l: rs.filter((x) => x === "L").length, p: rs.filter((x) => x === "P").length };
          };
          const earlyRec = { w: early.filter((b) => b.result === "W").length, l: early.filter((b) => b.result === "L").length, p: early.filter((b) => b.result === "P").length };
          return (
            <details key={w.week} className={s.betWeek} open={i === 0}>
              <summary>
                <span className={s.betWeekName}>{`Week ${w.week}`}</span>
                <span className={`${s.num} ${s.betWeekRec}`}>{`T1 ${rec(tierRec("t1"))} · T2 ${rec(tierRec("t2"))}`}</span>
                <span className={`${s.num} ${s.betWeekNet} ${lw && lw.units < 0 ? s.neg : s.pos}`}>
                  {lw && lw.w + lw.l + lw.p ? units(lw.units) : "·"}
                </span>
              </summary>
              <div className={s.betWeekBody}>
                <p className={s.thin}>
                  {[
                    staked.length ? `${staked.length} settled bet${staked.length === 1 ? "" : "s"}, ${amt(lw!.risked)} risked` : "No settled staked bets",
                    early.length ? `first email, before stakes: ${rec(earlyRec)}, not counted here` : "",
                    w.pending ? `${w.pending} pending, listed once final` : "",
                    w.provenance === "recovered" ? "recovered from the email" : "",
                  ].filter(Boolean).join(" · ")}
                </p>
                {staked.length ? (
                  <ul className={s.betList}>
                    {staked.map((b, j) => (
                      <li key={j} className={s.betRow}>
                        <span className={`${s.tier} ${b.tier === "t1" ? s.t1 : b.tier === "t2" ? s.t2 : s.tPass}`}>
                          {b.kind === "spread" ? (b.tier === "t1" ? "Tier 1" : "Tier 2") : b.kind === "total" ? "Total" : "Parlay"}
                        </span>
                        <span className={s.betPick}>{betText(b, (k) => r.names[k] ?? k)}</span>
                        <span className={`${s.num} ${s.betStake}`}>
                          {`${amt(b.units)} at ${b.price !== undefined ? price(b.price) : `${b.decimal?.toFixed(2)}x`}`}
                        </span>
                        <span className={`${s.num} ${s.betNet} ${RES_CLASS[b.result!]}`}>
                          {`${b.result} ${(b.net ?? 0) >= 0 ? "+" : "−"}${amt(Math.abs(b.net ?? 0))}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={s.thin}>No staked bets settled yet.</p>
                )}
              </div>
            </details>
          );
        })}
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

/** `harris`: the college John Harris panel, placed between PEM and the game log. */
export function AtsResearch({ r, panel }: { r: PicksReport; panel?: React.ReactNode }) {
  const st = r.strategies;
  const name = (k: string) => r.names[k] ?? k;
  const groups = [...new Set(st.cuts.filter((c) => c.group !== "Research").map((c) => c.group))];
  const matchesRule = (g: PicksReport["graded"][number], rule: CutResult) => cutResult(g, rule) !== undefined;
  return (
    <section className={s.section} aria-labelledby="ats-research">
      <Hero
        eyebrow={`${r.league === "nfl" ? "NFL" : "College"} spreads · ${r.graded.length} games through Week ${Math.max(0, ...r.weeksCovered)}`}
        title={<span id="ats-research">What actually wins</span>}
        sub="Each idea's record if you had bet every game it covers at -110. The shaded band is its 90% likely range; the line is break-even. Each model is judged at its own site's line here."
      />
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
      {panel}
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

const SU_METHOD: { [k: string]: string } = { avg: "the two models' average", sam: "Sam's line", david: "David's line", vegas: "the Vegas favorite" };

/** The straight-up call in words: who, by how much, and, when Sam and David split, what broke the tie. */
export function suWhy(g: BoardGame, name: (k: string) => string): string {
  const su = g.su!;
  const pick = name(su.side === "home" ? g.home : g.away);
  const by = `by ${su.margin.toFixed(1)}`;
  const who = (x: number) => (x < 0 ? name(g.home) : name(g.away));
  const split = !su.agree && g.sam && g.david;
  const tie = split ? ` Sam has ${who(g.sam!.model)} by ${Math.abs(g.sam!.model).toFixed(1)}, David has ${who(g.david!.model)} by ${Math.abs(g.david!.model).toFixed(1)}: they split, so ${SU_METHOD[su.method] ?? su.method} decides.` : "";
  const toss = su.margin < 1 ? " A coin flip either way." : "";
  return `${pick} to win, ${by} on ${SU_METHOD[su.method] ?? su.method}${su.upset ? " (upset call)" : ""}.${tie}${toss}`;
}

/** One game on its own page: the pick, the market against every model, why it is or isn't a bet, and everything else known about the game. */
export function GameDetail({ g, r }: { g: BoardGame; r: PicksReport }) {
  const name = (k: string) => r.names[k] ?? k;
  const st = statusOf(g);
  const home = name(g.home);
  const away = name(g.away);
  const market = g.ref?.line ?? g.david?.market ?? g.sam?.market;
  const st1 = r.strategies;
  const cut = g.tier === "t1" ? st1.rule : g.tier === "t2" ? st1.second : null;
  const proj = (x: number) => (Math.abs(x) < 0.05 ? "a pick'em" : `${x < 0 ? home : away} by ${Math.abs(Math.round(x * 10) / 10)}`);
  const models = [g.sam?.model, g.david?.model].filter((x): x is number => x !== undefined);
  const avg = models.length ? models.reduce((a, x) => a + x, 0) / models.length : null;
  const tot = r.totals.board.find((t) => t.home === g.home && t.away === g.away);
  const worst = g.p !== undefined ? worstPrice(g.p) : null;
  const eyebrow = `${["bet", "sent", "early"].includes(st) ? "Best bet" : STATUS_TEXT[st]} · ${r.league === "nfl" ? "NFL" : "College"}${r.week ? ` Week ${r.week}` : ""}`;
  return (
    <section className={s.section} aria-labelledby="game">
      <div className={s.hero}>
        <span className={s.eyebrow}>{eyebrow}</span>
        <h1 className={s.heroH} id="game" style={{ fontSize: "clamp(44px, 8vw, 72px)" }}>
          {g.side ? pickText(g, name) : `${away} at ${home}`}
        </h1>
        <p className={s.heroSub}>{`${away} at ${home} · ${kickoffEt(g.ref?.kickoff)}`}</p>
        <div className={s.chips} style={{ marginTop: 6 }}>
          {st === "early" && <span className={`${s.chip} ${s.chipLock}`}>{`Locks ${kickoffEt(g.held)}`}</span>}
          {(st === "bet" || st === "sent" || st === "early") && <span className={s.chip}>{`${st === "sent" ? g.issued!.units : g.stake}u at ${price(st === "sent" ? g.issued!.price : g.price)}`}</span>}
          {g.final && <span className={s.chip}>{`Final: ${away} ${g.final.away}, ${home} ${g.final.home}`}</span>}
        </div>
      </div>

      {market !== undefined && (
        <div className={s.curveBox}>
          <h2 className={s.h2}>Market vs models</h2>
          <MarketLine market={market} sam={g.sam ? Math.round(g.sam.model * 10) / 10 : undefined} david={g.david ? Math.round(g.david.model * 10) / 10 : undefined} pem={r.league === "cfb" && g.pem ? g.pem.model : undefined} fmt={(x) => `${home} ${line(x)}`}
          pk={{ below: home, above: name(g.away) }} />
          {avg !== null && (
            <p className={s.p}>
              {`The models have ${proj(avg)}${models.length > 1 ? " on average" : ""}. The market has ${proj(market)}.${g.read?.agree && g.side ? ` So ${name(g.side === "home" ? g.home : g.away)} gets ${g.read.avgEdge.toFixed(1)} more points than the models think it needs.` : g.read && !g.read.agree ? " Sam and David are on different sides, so no spread bet." : ""}`}
            </p>
          )}
          <MarketKey pem={r.league === "cfb"} />
        </div>
      )}

      <div className={s.edgeGrid} style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(300px, 100%), 1fr))" }}>
        <div className={s.edgeCard}>
          <span className={s.eyebrow}>{["bet", "sent", "early"].includes(st) ? "Why it is a bet" : "Why it is not a bet"}</span>
          <b className={s.closePick} style={{ textTransform: "none" }}>{cut ? cut.label : g.read?.agree ? "Agree, but outside the rule" : g.read ? "Models split" : "One model or no line"}</b>
          <span className={s.p}>{cut ? `${g.tier === "t1" ? "The rule" : "Tier 2"} in force since the last review: ${rec(cut.record)} on the games it picked.` : "Only games in the rule or Tier 2 become bets."}</span>
          <Link href={`/picks${r.league === "cfb" ? "/cfb" : ""}?v=research`} className={s.linkA} style={{ fontWeight: 600, fontSize: 14 }}>
            See the rule&apos;s record ›
          </Link>
        </div>
        <div className={s.edgeCard}>
          <span className={s.eyebrow}>Price</span>
          <b className={s.closePick} style={{ textTransform: "none" }}>{g.price !== undefined ? `${price(g.price)} at DraftKings` : "No price yet"}</b>
          <span className={s.p}>
            {g.p !== undefined && g.price !== undefined
              ? `Estimated edge ${((g.p * decimal(g.price) - 1) * 100).toFixed(1)}% per unit. ${
                  worst === null
                    ? "It needs plus money to be a bet."
                    : g.price >= worst
                      ? `Still a bet down to ${price(worst)}; anything more expensive than that (${price(worst - 3)}, say) is a pass.`
                      : `Too expensive at ${price(g.price)}: it needs ${price(worst)} or cheaper (${price(Math.min(-100, worst + 2))}, say) to be a bet.`
                }`
              : "Priced when a line is quoted."}
          </span>
        </div>
        <div className={s.edgeCard}>
          <span className={s.eyebrow}>Win chance</span>
          <b className={s.closePick} style={{ textTransform: "none" }}>{g.p !== undefined ? `${(g.p * 100).toFixed(1)}%` : "·"}</b>
          <span className={s.p}>{g.p !== undefined ? "An estimate from the tier's record so far, not a calibrated probability." : "Only rule and Tier 2 games carry one."}</span>
        </div>
      </div>

      {g.close && (g.close.open !== null || g.close.close !== null) && (
        <div className={s.curveBox}>
          <h2 className={s.h2}>Line since open</h2>
          <p className={s.p}>{`${home} ${g.close.open !== null ? line(g.close.open) : "?"} at open → ${g.close.close !== null ? line(g.close.close) : "?"} at close.`}</p>
        </div>
      )}

      <div className={s.curveBox}>
        <h2 className={s.h2}>Every number</h2>
        {g.final ? <FinishedDetails g={g} r={r} /> : <WhyList g={g} r={r} />}
      </div>

      <Background title="The rest of this game: totals and straight up">
        <dl className={s.kv}>
          <dt>Total</dt>
          <dd className={s.num}>{tot?.ref ? `${tot.ref.total} now · Sam ${tot.sam?.toFixed(1) ?? "·"} · David ${tot.david?.toFixed(1) ?? "·"}${tot.side ? ` · both lean ${tot.side}` : ""}` : "no total yet"}</dd>
          <dt>Straight up</dt>
          <dd>{g.su ? suWhy(g, name) : "no read"}</dd>
        </dl>
      </Background>
    </section>
  );
}
