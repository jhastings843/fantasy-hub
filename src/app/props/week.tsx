// The Props tabs' "This week / Today" view (2026-10-21 redesign, second pass):
// one market per tab, built like Picks. A headline that says whether
// anything is a bet, a strip of four numbers, the biggest edges as cards with
// the market's line against our number, a table of every game whose rows open
// to every prop, and the gate detail in a drawer.
import type { ReactNode } from "react";
import Link from "next/link";
import type { SectionView } from "@/lib/learning/engine";
import { etDate, implied, payout, type PropMarket } from "@/lib/props/parse";
import { nameKey } from "@/lib/props/grade";
import type { GradedPropsGame } from "@/lib/props/trends";
import { liveBox, tvByEvent } from "@/lib/live/espn";
import { AutoRefresh } from "@/components/AutoRefresh";
import { getPropsView } from "@/lib/props/store";
import type { DavidMarket } from "@/lib/props/david";
import { getOurNbaView, type OurNbaView, type OurStoredProps } from "@/lib/models/nba/store";
import type { FbBoard } from "@/lib/models/nba/firstbasket";
import { getOurNflView, type OurNflStored } from "@/lib/models/nfl/store";
import { getOurFtdView, type OurFtdStored } from "@/lib/models/nfl/ftd-store";
import { noVig } from "@/lib/models/nba/market";
import { OUR_FTD_SLICES, ourSliceBets, record } from "@/lib/models/learn";
import { kalshiCost, kalshiFor } from "@/lib/firsttd/trends";
import { bestBets, bestCost, bookPrice } from "@/lib/models/nfl/ftd-price";
import { pricedPlayers } from "@/lib/firsttd/parse";
import { whenEt } from "../picks/ui";
import { Background, Hero, SecHead, Stats, type Stat } from "../picks/board";
import { LearningBlock } from "./learning";
import { Matchup, type MatchupProps } from "./matchup";
import s from "../picks/picks.module.css";
import pp from "./props.module.css";

export type PropTab = "pp" | "ftd" | "nba" | "fb";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const u = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}u`;
const SHORT: { [k: string]: string } = { pts: "pts", reb: "reb", ast: "ast", threes: "threes", pass_yds: "pass yds", rush_yds: "rush yds", rec_yds: "rec yds", rec: "rec" };
const DAVID_MARKET: { [k: string]: DavidMarket } = { pass_yds: "passing_yards", rush_yds: "rushing_yards", rec_yds: "receiving_yards", rec: "receptions" };
const sideWord = (x: "over" | "under") => (x === "over" ? "Over" : "Under");
const TOP = 6;
/** NBA games a player needs this season before his edge gets a card. */
const NBA_CARD_GAMES = 3;
const nowMs = () => Date.now();

/** One edge, whatever the market: a prop side, a first basket or a first TD at Kalshi. */
export interface Edge {
  key: string;
  player: string;
  game: string;
  when?: string;
  bet: string;
  ours: number;
  mkt: number;
  mktLabel: string;
  price: string;
  gap: number;
  /** The line against our number (props only): market tick, our dot, David's dot. */
  line?: { at: number; ours: number; david?: number; fmt: (x: number) => string };
  more: [string, string][];
  result?: { won: boolean | null; text: string };
  /** A live learner slice bets this one: the card shows a stake, not "tracked". */
  staked?: boolean;
}

export interface GameRowData {
  key: string;
  title: string;
  when?: string;
  /** Started and not graded yet: sorts to the top with a Live tag. */
  live?: boolean;
  /** ESPN calls it final but the grading run hasn't caught up: a Final tag, in kickoff order. */
  final?: boolean;
  cells: [string, string][];
  read: [string, string];
  body: ReactNode;
  /** Logos, time and channel under the teams (matchup.tsx). Without it the row shows `title`. */
  match?: Omit<MatchupProps, "state" | "when">;
}

const started = (kickoff: string | undefined, graded: unknown) => !graded && !!kickoff && Date.parse(kickoff) <= nowMs();

/** Started, ungraded games that ESPN already calls final (the next grading run settles them). */
export async function endedOnEspn(games: { slug: string; kickoff?: string; espnId?: string; graded: unknown }[], sport: "nfl" | "nba"): Promise<Set<string>> {
  const ask = games.filter((g) => g.espnId && started(g.kickoff, g.graded));
  const ended = await Promise.all(ask.map(async (g) => ((await liveBox(sport, g.espnId!).catch(() => null))?.game?.state === "post" ? g.slug : null)));
  return new Set(ended.filter((x): x is string => !!x));
}

/** Our number and the market's line on one track, like the Picks market line. */
function PropLine({ line }: { line: NonNullable<Edge["line"]> }) {
  const xs = [line.at, line.ours, line.david].filter((x): x is number => x !== undefined);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const pad = Math.max((hi - lo) * 0.25, Math.max(Math.abs(line.at) * 0.08, 0.6));
  const at = (x: number) => `${(((x - (lo - pad)) / (hi - lo + 2 * pad)) * 100).toFixed(1)}%`;
  return (
    <div className={s.mline}>
      <div className={s.mtrack} role="img" aria-label={`Line ${line.fmt(line.at)}, ours ${line.fmt(line.ours)}${line.david !== undefined ? `, David ${line.fmt(line.david)}` : ""}`}>
        <span className={s.mMarket} style={{ left: at(line.at) }} />
        {line.david !== undefined && <span className={`${s.mDot} ${s.mDavid}`} style={{ left: at(line.david) }} />}
        <span className={`${s.mDot} ${s.mSam}`} style={{ left: at(line.ours) }} />
      </div>
      <div className={s.mLabels}>
        <span>{`Line ${line.fmt(line.at)}`}</span>
        <span>
          <span className={s.cSam}>{`Ours ${line.fmt(line.ours)}`}</span>
          {line.david !== undefined && <span className={s.cDavid}>{` · David ${line.fmt(line.david)}`}</span>}
        </span>
      </div>
    </div>
  );
}

/**
 * One tracked edge, compact (the Ledger redesign): who, the bet, ours vs the
 * market vs the edge. Dashed because an edge is tracked, never a stake, unless
 * the read says a live slice bet it.
 */
export function EdgeCard({ e }: { e: Edge }) {
  return (
    <li className={s.edgeCard}>
      <div className={s.edgeTop}>
        {e.result ? (
          <span className={`${s.readChip} ${e.result.won === true ? s.readW : e.result.won === false ? s.readL : ""}`}>{e.result.text}</span>
        ) : e.staked ? (
          <span className={`${s.readChip} ${s.readBet}`}>Bet · live slice</span>
        ) : (
          <span className={`${s.readChip} ${s.readTrack}`}>Tracked · no stake</span>
        )}
        <span className={s.muted}>{e.when ? whenEt(e.when) : ""}</span>
      </div>
      <div>
        <div className={s.edgeLine}>
          <span title={e.player}>{e.player}</span>
          <span className={s.edgePick}>{e.bet}</span>
        </div>
        <div className={s.edgeBet}>{`${e.price} · ${e.game}`}</div>
      </div>
      <dl className={s.edgeTrio}>
        <div>
          <dt>Ours</dt>
          <dd>{pct(e.ours)}</dd>
        </div>
        <div>
          <dt>{e.mktLabel}</dt>
          <dd>{pct(e.mkt)}</dd>
        </div>
        <div>
          <dt>Edge</dt>
          <dd className={s.pos}>{`+${(e.gap * 100).toFixed(1)}`}</dd>
        </div>
      </dl>
      {(e.line || e.more.length > 0) && (
        <details className={s.why}>
          <summary>Every number</summary>
          {e.line && <PropLine line={e.line} />}
          <dl className={s.kv}>
            {e.more.map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k}</dt>
                <dd className={s.num}>{v}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </li>
  );
}

export function GameTable({ head, rows }: { head: string[]; rows: GameRowData[] }) {
  return (
    <div className={s.gtable}>
      <div className={s.gHead} aria-hidden>
        <span>Game</span>
        {head.map((h) => (
          <span key={h}>{h}</span>
        ))}
        <span>Read</span>
        <span />
      </div>
      {[...rows.filter((r) => r.live && !r.final), ...rows.filter((r) => !r.live || r.final)].map((r) => (
        <details key={r.key} className={s.gRow}>
          <summary>
            <span className={s.gGame}>
              {r.match ? (
                <Matchup {...r.match} when={r.when} state={r.final ? "final" : r.live ? "live" : "pre"} />
              ) : (
                <>
                  {r.title}
                  {r.final ? <span>Final</span> : r.live ? <span className={s.gLive}>Live</span> : r.when && <span>{whenEt(r.when)}</span>}
                </>
              )}
            </span>
            {r.cells.map(([k, v]) => (
              <span key={k} className={s.gNum} data-k={k}>
                {v}
              </span>
            ))}
            <span className={`${s.readChip} ${r.read[1]}`}>{r.read[0]}</span>
            <span className={s.chev} aria-hidden>
              ›
            </span>
          </summary>
          <div className={s.gBody}>{r.body}</div>
        </details>
      ))}
    </div>
  );
}

/**
 * FanDuel next to DraftKings on our side of a prop: its line and price, and
 * which book is better for the side we like (a better line beats a better price).
 */
function fdNote(fd: { line: number; over: number; under: number } | undefined, m: PropMarket): string {
  if (!fd) return "not read (morning of game day)";
  const side = m.side ?? "over";
  const fp = fd[side];
  const dp = m.books[0][side];
  const text = `${side === "over" ? "o" : "u"}${fd.line} ${am(fp)}`;
  if (fd.line !== m.line) {
    const fdBetter = side === "over" ? fd.line < m.line : fd.line > m.line;
    return `${text} · ${fdBetter ? "better line at FanDuel" : "DK has the better line"}`;
  }
  if (dp === null || fp === dp) return `${text} · same as DK`;
  return `${text} · ${implied(fp) < implied(dp) ? "FanDuel pays more" : "DK pays more"}`;
}

/** The four numbers on every Props tab: edges now, the record, the closest slice, the learner. */
/** `extra` takes the third tile; the learner link then folds into the gate tile, so it stays one row of four. */
export function PropStats({ edges, graded, learning, logHref, unit, extra }: { edges: number; graded: { w: number; l: number; p: number; units: number }; learning: SectionView; logHref: string; unit: string; extra?: Stat }) {
  const best = Math.max(0, ...learning.entries.map((e) => e.ev?.games ?? 0));
  const live = learning.entries.filter((e) => e.status === "active").length;
  const testing = learning.entries.filter((e) => e.status === "collecting").length;
  const n = graded.w + graded.l + graded.p;
  return (
    <Stats
      label="Edges, record, gate and learner"
      items={[
        { k: "Edges now", v: `${edges}`, sub: unit },
        { k: "Every edge so far", v: n ? u(graded.units) : "0-0", sub: n ? `${graded.w}-${graded.l}${graded.p ? `-${graded.p}` : ""} at the saved price` : "first grades pending", tone: n ? (graded.units >= 0 ? "up" : "down") : undefined },
        ...(extra ? [extra] : []),
        {
          k: live ? "Live slices" : "Closest to a bet",
          v: live ? `${live}` : `${best} of ${learning.gate.minGames}`,
          sub: extra ? <>{live ? "bets for real" : "games a slice needs"} · <Link href={logHref}>{testing} testing</Link></> : live ? "bets for real" : "games a slice needs",
          small: true,
        },
        ...(extra ? [] : [{ k: "Learner", v: `${testing} slices testing`, sub: <Link href={logHref}>Open the log</Link>, small: true }]),
      ]}
    />
  );
}

export function Gate({ learning, label }: { learning: SectionView; label: string }) {
  return (
    <Background title={`How ${label} edges become bets: every slice and the exact bar`}>
      <LearningBlock v={learning} />
    </Background>
  );
}

/* ----------------------------------------------------- player props --- */

function propEdges(board: (OurStoredProps | OurNflStored)[], extraMore: (g: OurStoredProps | OurNflStored, m: PropMarket) => [string, string][], david?: (m: PropMarket, gameKey: string) => number | undefined): Edge[] {
  return board
    .flatMap((g) =>
      g.game.markets
        .filter((m) => m.clears && m.side && m.gap !== null)
        .map((m): Edge => {
          const dk = m.books[0];
          const side = m.side!;
          const fair = dk.over !== null && dk.under !== null ? noVig(dk.over, dk.under)[side] : 0.5;
          const x = g.extra[m.id] as { over: number; under: number; median?: number };
          const r = g.result?.markets.find((y) => y.id === m.id);
          const out = r?.play?.outcome;
          return {
            key: `${g.game.slug}|${m.id}`,
            player: m.player,
            game: `${g.away} at ${g.home}`,
            when: g.kickoff,
            bet: `${sideWord(side)} ${m.line} ${SHORT[m.stat ?? ""] ?? m.statLabel}`,
            ours: x?.[side] ?? 0,
            mkt: fair,
            mktLabel: "DK, vig out",
            price: dk[side] !== null ? `${am(dk[side]!)} DK` : "·",
            gap: m.gap!,
            line: { at: m.line, ours: x?.median ?? m.model, david: david?.(m, g.game.slug), fmt: (v) => `${Math.round(v * 10) / 10}` },
            more: extraMore(g, m),
            ...(out && r?.actual !== null ? { result: { won: out === "W" ? true : out === "L" ? false : null, text: `${out === "W" ? "Won" : out === "L" ? "Lost" : "Push"} · ${r!.actual}` } } : {}),
          };
        }),
    )
    .sort((a, b) => b.gap - a.gap);
}

/** When the board used DK's alternate line nearer -110 instead of the main line, say which. */
const altNote = (g: OurStoredProps, m: PropMarket) => {
  const x = g.extra[m.id]?.main;
  return x ? `alt line; main ${x.line} at ${x.over !== null ? am(x.over) : "·"}/${x.under !== null ? am(x.under) : "·"}` : "";
};


/**
 * Every game, the Ledger way: one folding group per game (started games pinned and open), each prop its own
 * row (player, line, ours, lean, read) that opens to the saved line and price, where the price came from,
 * our projection and the result. Read chips: dashed for a tracked edge or a wait, plain for no edge or no price.
 */
type LiveBoxes = Map<string, Awaited<ReturnType<typeof liveBox>>>;

/** ESPN box scores for every started, ungraded game on a board (free; cached a minute). */
async function liveBoxes(board: (OurStoredProps | OurNflStored)[], sport: "nfl" | "nba"): Promise<LiveBoxes> {
  const now = nowMs();
  const started = board.filter((g) => !g.result && g.kickoff && Date.parse(g.kickoff) <= now && g.espnId);
  const boxes = await Promise.all(started.map(async (g) => [g.game.slug, await liveBox(sport, g.espnId!)] as const));
  return new Map(boxes);
}

function PropGames({ board, sport, settled, live, tv }: { board: (OurStoredProps | OurNflStored)[]; sport: "nfl" | "nba"; settled?: (g: OurStoredProps | OurNflStored, m: PropMarket) => boolean; live?: LiveBoxes; tv?: Map<string, string> }) {
  const now = nowMs();
  // ESPN's final counts as final here even before the grading run: it sorts below the games still to play.
  const stateOf = (g: OurStoredProps | OurNflStored) => (g.result || live?.get(g.game.slug)?.game?.state === "post" ? "final" : g.kickoff && Date.parse(g.kickoff) <= now ? "live" : "pre");
  const order = { live: 0, pre: 1, final: 2 } as const;
  const games = [...board].sort((a, b) => order[stateOf(a)] - order[stateOf(b)] || (a.kickoff ?? "").localeCompare(b.kickoff ?? ""));
  if (!games.length) return <p className={s.calm}>No games on the board yet.</p>;
  return (
    <div className={s.propGames}>
      {games.map((g) => {
        const st = stateOf(g);
        const box = live?.get(g.game.slug);
        const lg = box?.game;
        const res = new Map((g.result?.markets ?? []).map((r) => [r.id, r]));
        const net = g.result ? g.result.markets.reduce((a, r) => a + (r.play?.net ?? 0), 0) : null;
        const priced = g.game.markets.filter((m) => (g as OurNflStored).extra[m.id]?.price !== "assumed").length;
        const markets = [...g.game.markets].sort((a, b) => (b.clears ? 1 : 0) - (a.clears ? 1 : 0) || (b.gap ?? -1) - (a.gap ?? -1));
        return (
          <details key={g.game.slug} className={s.propGroup} open={st === "live"}>
            <summary>
              <span className={s.propGroupTitle}>
                <Matchup
                  league={sport}
                  away={g.away}
                  home={g.home}
                  when={g.kickoff}
                  state={st === "final" || lg?.state === "post" ? "final" : st === "live" ? "live" : "pre"}
                  score={lg && lg.state !== "pre" ? `${lg.away.abbr} ${lg.away.score}, ${lg.home.abbr} ${lg.home.score}${lg.state === "in" ? ` · ${lg.detail}` : ""}` : undefined}
                  tv={g.espnId ? tv?.get(g.espnId) : undefined}
                />
              </span>
              <span className={s.propGroupAside}>
                {`${g.game.markets.length} props${sport === "nfl" && st === "pre" && priced < g.game.markets.length ? ` · ${g.game.markets.length - priced} wait on the morning price` : ""}${net !== null ? ` · shadow ${u(net)}` : ""}`}
              </span>
            </summary>
            <div className={s.propRows}>
              {markets.map((m) => {
                const nx = (g as OurNflStored).extra[m.id];
                const bx = (g as OurStoredProps).extra[m.id];
                const over = nx?.over ?? bx?.over;
                const r = res.get(m.id);
                const soFar = box ? box.stats.get(nameKey(m.player))?.[m.stat ?? ""] : undefined;
                const dk = m.books[0];
                const assumed = sport === "nfl" && nx?.price === "assumed";
                const waits = sport === "nba" && settled && m.clears && !settled(g, m);
                const lean = m.lean;
                const chance = over === undefined || !lean ? undefined : lean === "over" ? over : 1 - over;
                const fair = dk?.over != null && dk?.under != null && lean ? noVig(dk.over, dk.under)[lean] : undefined;
                const chip: [string, string] = r?.play
                  ? [`Shadow ${r.play.outcome === "W" ? "W" : r.play.outcome === "L" ? "L" : "P"} ${u(r.play.net)}`, r.play.outcome === "W" ? s.readW : r.play.outcome === "L" ? s.readL : ""]
                  : assumed
                    ? ["No price yet", s.readPass]
                    : waits
                      ? [`Waits · ${bx?.games ?? 0} of ${NBA_CARD_GAMES} games`, s.readTrack]
                      : m.clears && m.side && m.gap !== null
                        ? [`Tracked edge +${(m.gap * 100).toFixed(1)}`, s.readTrack]
                        : ["No edge", s.readPass];
                const why = assumed
                  ? "DraftKings' price is read the morning of game day. Until then this shows our number and claims no edge."
                  : waits
                    ? `Leans ${lean} at ${chance !== undefined ? pct(chance) : "·"} against ${fair !== undefined ? pct(fair) : "·"} after vig, but ${m.player} has ${bx?.games ?? 0} game${bx?.games === 1 ? "" : "s"} this season. Edges count from ${NBA_CARD_GAMES}, when the minutes come from this season's role.`
                    : m.clears && m.side
                      ? `Our ${m.model} against ${m.line}: ${chance !== undefined ? pct(chance) : "·"} ${lean} vs the market's ${fair !== undefined ? pct(fair) : "·"} after vig. Tracked at the saved price with no stake: no ${sport === "nfl" ? "NFL" : "NBA"} prop slice is live.`
                      : `Our ${m.model} is close to ${m.line}${chance !== undefined && fair !== undefined ? `: ${pct(chance)} ${lean} vs ${pct(fair)} after vig` : ""}. No edge.`;
                return (
                  <details key={m.id} className={s.propRow}>
                    <summary>
                      <span className={s.propWho}>
                        <b>{m.player}</b>
                        <span className={pp.propBet}>
                          {`${m.line} ${SHORT[m.stat ?? ""] ?? m.statLabel}`}
                          <span className={pp.propTeam}>{` · ${m.team}`}</span>
                        </span>
                      </span>
                      <span className={s.gNum} data-k="Line">
                        {m.line}
                        <small>{assumed ? "price not read" : `${dk?.over != null ? am(dk.over) : "·"} / ${dk?.under != null ? am(dk.under) : "·"}`}</small>
                      </span>
                      <span className={s.gNum} data-k="Ours">
                        {m.model}
                        <small>{over !== undefined ? `${pct(over)} over` : "·"}</small>
                      </span>
                      <span className={`${s.gNum} ${s.hideSm}`} data-k="Lean">
                        {lean ? sideWord(lean) : "None"}
                        <small>{chance !== undefined ? `${pct(chance)} our chance` : ""}</small>
                      </span>
                      <span className={s.ledgerRead}>
                        <span className={`${s.readChip} ${chip[1]}`}>{chip[0]}</span>
                        {r && r.actual !== undefined ? (
                          <small>{r.actual === null ? "Did not play" : `Final ${r.actual}`}</small>
                        ) : soFar !== undefined ? (
                          <small className={soFar > m.line ? (lean === "over" ? s.pos : lean === "under" ? s.neg : undefined) : undefined}>{`${lg?.state === "post" ? "Final" : "So far"} ${soFar}`}</small>
                        ) : null}
                      </span>
                      <span className={s.chev} aria-hidden>
                        ›
                      </span>
                    </summary>
                    <div className={s.gBody}>
                      <p className={s.why2}>{why}</p>
                      <dl className={s.kv}>
                        <dt>Saved line</dt>
                        <dd className={s.num}>{`${m.line}${nx?.espnLine !== undefined ? ` (ESPN showed ${nx.espnLine}; tested at DraftKings' number)` : ""}${bx?.main ? ` (alternate; main ${bx.main.line})` : ""}`}</dd>
                        <dt>Saved price</dt>
                        <dd className={s.num}>{assumed ? "Not read yet" : `Over ${dk?.over != null ? am(dk.over) : "·"} · Under ${dk?.under != null ? am(dk.under) : "·"} · DraftKings`}</dd>
                        {sport === "nfl" && (
                          <>
                            <dt>Price from</dt>
                            <dd>{nx?.price === "odds-api" ? "DraftKings via The Odds API" : nx?.price === "david" ? "David's board" : nx?.price === "espn" ? "DraftKings via ESPN" : "Not posted yet"}</dd>
                            <dt>Current quote</dt>
                            <dd className={s.num}>{nx?.fd ? `FanDuel ${nx.fd.line} at ${am(nx.fd.over)} / ${am(nx.fd.under)}` : st === "live" ? "No quote after start" : "None newer"}</dd>
                          </>
                        )}
                        {sport === "nba" && (
                          <>
                            <dt>Projected minutes</dt>
                            <dd className={s.num}>{bx?.min ?? "·"}</dd>
                            <dt>Games this season</dt>
                            <dd className={s.num}>{bx?.games ?? "·"}</dd>
                          </>
                        )}
                        <dt>Our projection</dt>
                        <dd className={s.num}>{`${m.model}${nx?.median !== undefined ? ` median` : ""}${over !== undefined ? ` · ${pct(over)} over` : ""}`}</dd>
                        <dt>Model</dt>
                        <dd>{`Hobby Hub ${sport === "nfl" ? "NFL" : "NBA"} prop model · collecting evidence`}</dd>
                        {r && (
                          <>
                            <dt>Result</dt>
                            <dd className={s.num}>{r.actual === null ? "Did not play" : r.actual === undefined ? "·" : `${r.actual} · ${r.actual > m.line ? "over" : r.actual < m.line ? "under" : "push"}`}</dd>
                          </>
                        )}
                      </dl>
                    </div>
                  </details>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}

async function PlayerPropsWeek({ league, season }: { league: "nba" | "nfl"; season: number }) {
  const now = nowMs();
  if (league === "nba") {
    const v = await getOurNbaView(season).catch(() => null);
    if (!v) return <p className={s.calm}>Our NBA model couldn&apos;t be read just now.</p>;
    // Today: tonight's games (Eastern date) until they're graded. Results: every graded game, newest first. Later days wait for their morning.
    const today = etDate(new Date(now));
    const tonight = v.board.filter((g) => !g.result && g.kickoff && etDate(new Date(g.kickoff)) === today);
    const ahead = tonight.filter((g) => Date.parse(g.kickoff!) > now);
    // A card needs the player's minutes from this season's role: 3+ games. Before that the number leans on last season, and a summer role change reads as a huge fake edge.
    const settled = (g: OurStoredProps | OurNflStored, m: PropMarket) => ((g as OurStoredProps).extra[m.id]?.games ?? 0) >= NBA_CARD_GAMES;
    const allEdges = propEdges(ahead, (g, m) => [
      ["Projected minutes", `${(g as OurStoredProps).extra[m.id]?.min ?? "·"}`],
      ["Our mean", `${m.model}`],
      ["DK over / under", `${am(m.books[0].over ?? -110)} / ${am(m.books[0].under ?? -110)}`],
      ["Games this season", `${(g as OurStoredProps).extra[m.id]?.games ?? "·"}`],
      ["Line used", altNote(g as OurStoredProps, m) || "DK's main line (nearest -110)"],
    ]);
    const keys = new Set(ahead.flatMap((g) => g.game.markets.filter((m) => settled(g, m)).map((m) => `${g.game.slug}|${m.id}`)));
    const edges = allEdges.filter((e) => keys.has(e.key));
    const early = allEdges.length - edges.length;
    const graded = record(ourSliceBets(v.graded, "edge:all"));
    const [nbaLive, nbaTv] = await Promise.all([liveBoxes(tonight, "nba"), tvByEvent("nba")]);
    return (
      <section className={s.section} aria-labelledby="pp-week">
        <div className={s.pageFrame}>
          <SecHead id="pp-week" title="Tracked edges" aside={`Players with ${NBA_CARD_GAMES}+ games · no stakes`} />
          {edges.length > 0 ? (
            <ul className={s.edgeGrid} data-first-pick>
              {edges.slice(0, TOP).map((e) => (
                <EdgeCard key={e.key} e={e} />
              ))}
            </ul>
          ) : (
            <p className={s.calm}>{`No tracked edges yet from players with ${NBA_CARD_GAMES}+ games this season.${early ? ` ${early} more wait on their third game.` : ""}`}</p>
          )}
        </div>
        <div className={s.pageFrame}>
          <SecHead title="Every game" aside="Tonight's games until graded · started games pinned on top" />
          {nbaLive.size > 0 && <AutoRefresh intervalMs={600_000} label="Live games: refreshing every" />}
          {tonight.length ? <PropGames board={tonight} sport="nba" settled={settled} live={nbaLive} tv={nbaTv} /> : <p className={s.calm}>No NBA games left today. Later days show up the morning of; graded games are under Results.</p>}
        </div>
        <div className={s.pageFrame}>
          <SecHead title="How it is doing" aside="Tracked, never staked" />
          <PropStats edges={edges.length} graded={graded} learning={v.learning} logHref="/props?m=nba&v=log" unit={early ? `${early} more wait on 3 games` : "on games still to play"} />
        </div>
        <Gate learning={v.learning} label="NBA prop" />
      </section>
    );
  }
  const [v, pv] = await Promise.all([getOurNflView(season).catch(() => null), getPropsView(season).catch(() => null)]);
  if (!v) return <p className={s.calm}>Our NFL model couldn&apos;t be read just now.</p>;
  const ahead = v.board.filter((g) => !g.kickoff || Date.parse(g.kickoff) > now);
  const done = v.board.filter((g) => g.kickoff && Date.parse(g.kickoff) <= now);
  // David's projection on the same prop, when his board has it at the same DK line.
  const dIdx = new Map((pv?.david.games ?? []).flatMap((dg) => dg.props.map((p) => [`${nameKey(p.player)}|${p.market}|${p.line}`, p.projection] as const)));
  const david = (m: PropMarket) => (m.stat && DAVID_MARKET[m.stat] ? dIdx.get(`${nameKey(m.player)}|${DAVID_MARKET[m.stat]}|${m.line}`) : undefined);
  const edges = propEdges(
    ahead,
    (g, m) => {
      const x = (g as OurNflStored).extra[m.id];
      return [
        ["Our median", `${x?.median ?? m.model}`],
        ["Price from", x?.price === "odds-api" ? `DraftKings (The Odds API)${x.espnLine !== undefined ? `, at its ${m.line}; ESPN showed ${x.espnLine}` : ""}` : x?.price === "david" ? "David's board" : x?.price === "espn" ? "DraftKings (ESPN)" : "none posted yet"],
        ["DK over / under", `${am(m.books[0].over ?? -110)} / ${am(m.books[0].under ?? -110)}`],
        ["FanDuel", fdNote(x?.fd, m)],
      ];
    },
    david,
  );
  const waiting = ahead.reduce((a, g) => a + Object.values(g.extra).filter((x) => x.price === "assumed").length, 0);
  const all = ahead.reduce((a, g) => a + g.game.markets.length, 0);
  const graded = record(ourSliceBets(v.graded, "edge:all"));
  const [nflLive, nflTv] = await Promise.all([liveBoxes(done, "nfl"), tvByEvent("nfl")]);
  // The board is games still to finish; a final game moves to Results (Jack, 2026-10-27).
  const playing = done.filter((g) => !g.result && nflLive.get(g.game.slug)?.game?.state !== "post");
  return (
    <section className={s.section} aria-labelledby="pp-week">
      <div className={s.pageFrame}>
        <SecHead id="pp-week" title="Tracked edges" aside="Games still to finish · no stakes" />
        {edges.length > 0 ? (
          <ul className={s.edgeGrid} data-first-pick>
            {edges.slice(0, TOP).map((e) => (
              <EdgeCard key={e.key} e={e} />
            ))}
          </ul>
        ) : (
          <p className={s.calm}>No tracked edges with a real price yet.</p>
        )}
        {waiting > 0 && <p className={s.thin}>{`${waiting} of ${all} props wait on DraftKings' game-day morning price, so they show our number with no edge.`}</p>}
      </div>
      <div className={s.pageFrame}>
        <SecHead title="Every game" aside="Games still to finish · started games pinned on top" />
        {nflLive.size > 0 && <AutoRefresh intervalMs={600_000} label="Live games: refreshing every" />}
        {ahead.length + playing.length ? <PropGames board={[...ahead, ...playing]} sport="nfl" live={nflLive} tv={nflTv} /> : <p className={s.calm}>Every game this week is final. Results has them game by game.</p>}
      </div>
      <div className={s.pageFrame}>
        <SecHead title="How it is doing" aside="Tracked, never staked" />
        <PropStats edges={edges.length} graded={graded} learning={v.learning} logHref="/props?v=log" unit="on games still to play" />
      </div>
      <Gate learning={v.learning} label="NFL prop" />
    </section>
  );
}

/** Graded player-prop games, newest first: each game's tracked edges as a W-L at the saved price, every prop one click down. */
export function propGradedRows(graded: GradedPropsGame[], league: "nfl" | "nba"): GameRowData[] {
  return graded.map((x) => {
    const g = x as GradedPropsGame & { kickoff?: string; capturedAt?: string };
    const byId = new Map(g.game.markets.map((m) => [m.id, m]));
    const plays = g.result.markets.filter((r) => r.play && r.actual !== null);
    const won = plays.filter((r) => r.play!.outcome === "W").length;
    const lost = plays.filter((r) => r.play!.outcome === "L").length;
    const pushed = plays.length - won - lost;
    const units = plays.reduce((a, r) => a + r.play!.net, 0);
    const record = `${won}-${lost}${pushed ? `-${pushed}` : ""}`;
    const graded = g.result.markets.filter((r) => r.actual !== null).length;
    const rows = [...g.result.markets].sort((a, b) => Number(!!b.play) - Number(!!a.play) || (byId.get(a.id)?.player ?? "").localeCompare(byId.get(b.id)?.player ?? ""));
    return {
      key: `${g.week}|${g.slug}`,
      title: `${g.game.away} at ${g.game.home}`,
      match: { league, away: g.game.away, home: g.game.home },
      when: g.kickoff ?? g.capturedAt,
      final: true,
      cells: [
        ["Edges W-L", plays.length ? record : "none"],
        ["Units", plays.length ? u(units) : "·"],
        ["Props graded", `${graded}`],
      ],
      read: !plays.length ? ["No edges", s.readPass] : [`${record} · ${u(units)}`, units > 0 ? s.readW : units < 0 ? s.readL : s.readPass],
      body: (
        <div className={s.tw}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Player and prop</th>
                <th>Ours</th>
                <th>Edge bet</th>
                <th>Actual</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const m = byId.get(r.id);
                if (!m) return null;
                return (
                  <tr key={r.id}>
                    <td>
                      <b>{m.player}</b>
                      <span className={s.dim}>{` ${m.team} · ${m.line} ${SHORT[m.stat ?? ""] ?? m.statLabel}`}</span>
                    </td>
                    <td className={s.num}>{m.model}</td>
                    <td className={s.num}>{r.play ? `${sideWord(r.play.side)} ${r.play.line} ${am(r.play.price)}` : <span className={s.dim}>·</span>}</td>
                    <td className={s.num}>{r.actual === null ? "DNP" : r.actual}</td>
                    <td className={s.num}>{r.play && r.actual !== null ? <b className={r.play.outcome === "W" ? s.pos : r.play.outcome === "L" ? s.neg : undefined}>{`${r.play.outcome === "W" ? "Won" : r.play.outcome === "L" ? "Lost" : "Push"} ${u(r.play.net)}`}</b> : <span className={s.dim}>·</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ),
    };
  });
}

/* ------------------------------------------------------- first basket --- */

/** Every starter on one First Basket board: ours against DraftKings, and who scored first once graded. */
export function FbTable({ b }: { b: FbBoard }) {
  const res = b.result;
  return (
    <div className={s.tw}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Player</th>
            <th>Ours</th>
            <th>DK, vig out</th>
            <th>DK price</th>
            <th>Edge</th>
            {res !== undefined && <th>Result</th>}
          </tr>
        </thead>
        <tbody>
          {b.players.map((x) => {
            const hit = res?.player === x.id;
            return (
              <tr key={x.id} className={hit ? s.rowHit : undefined}>
                <td>{`${x.name} `}<span className={s.dim}>{x.team}</span>{hit && <b className={s.pos}> · first basket</b>}</td>
                <td className={s.num}>{pct(x.p)}</td>
                <td className={s.num}>{x.fair !== null ? pct(x.fair) : "·"}</td>
                <td className={s.num}>{x.price !== null ? am(x.price) : "·"}</td>
                <td className={`${s.num} ${x.edge ? s.pos : s.dim}`}>{x.edge ? `+${((x.p - implied(x.price!)) * 100).toFixed(1)}` : "·"}</td>
                {res !== undefined && <td className={s.num}>{x.edge && x.price !== null ? <b className={hit ? s.pos : s.neg}>{hit ? `Won ${u(payout(x.price))}` : "Lost −1.0u"}</b> : <span className={s.dim}>·</span>}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {res === null && <p className={s.thin}>No first basket found in the play-by-play.</p>}
    </div>
  );
}

/** Graded First Basket games, newest first: each game's edges as a W-L at 1u (DraftKings' price). */
export function fbGradedRows(graded: OurNbaView["fb"]["graded"]): GameRowData[] {
  return graded.map((g) => {
    const won = g.bets.filter((x) => x.net > 0).length;
    const units = g.bets.reduce((a, x) => a + x.net, 0);
    const scorer = g.board.result ? g.board.players.find((x) => x.id === g.board.result!.player)?.name ?? "a non-starter" : "none found";
    const record = `${won}-${g.bets.length - won}`;
    return {
      key: g.event,
      title: `${g.board.away} at ${g.board.home}`,
      match: { league: "nba", away: g.board.away, home: g.board.home },
      when: g.at,
      final: true,
      cells: [
        ["Edges W-L", g.bets.length ? record : "none"],
        ["Units", g.bets.length ? u(units) : "·"],
        ["First basket", scorer],
      ],
      read: !g.bets.length ? ["No edges", s.readPass] : [`${record} · ${u(units)}`, units > 0 ? s.readW : units < 0 ? s.readL : s.readPass],
      body: <FbTable b={g.board} />,
    };
  });
}

async function FirstBasketWeek({ season }: { season: number }) {
  const v = await getOurNbaView(season).catch(() => null);
  if (!v) return <p className={s.calm}>Our First Basket model couldn&apos;t be read just now.</p>;
  const now = nowMs();
  const boards = v.board.filter((g) => g.fb);
  const ahead = boards.filter((g) => !g.kickoff || Date.parse(g.kickoff) > now);
  const edges: Edge[] = ahead
    .flatMap((g) =>
      g.fb!.players
        .filter((x) => x.edge && x.price !== null)
        .map((x): Edge => {
          const tipTeam = g.fb!.tip >= 0.5 ? g.fb!.home : g.fb!.away;
          return {
            key: `${g.game.slug}|${x.id}`,
            player: x.name,
            game: `${g.away} at ${g.home}`,
            when: g.kickoff,
            bet: `First basket · ${x.team}`,
            ours: x.p,
            mkt: x.fair ?? implied(x.price!),
            mktLabel: "DK, vig out",
            price: `${am(x.price!)} DK`,
            gap: x.p - implied(x.price!),
            more: [
              ["Tip", `${tipTeam} ${pct(Math.max(g.fb!.tip, 1 - g.fb!.tip))}`],
              [`${g.fb!.home} scores first`, pct(g.fb!.first)],
              ["DK break-even", pct(implied(x.price!))],
              ["Starters from", g.fb!.starters === "dk" ? "DraftKings' listed field" : "each team's last game"],
            ],
          };
        }),
    )
    .sort((a, b) => b.gap - a.gap);
  const bets = v.fb.graded.flatMap((b) => b.bets);
  const graded = { w: bets.filter((x) => x.net > 0).length, l: bets.filter((x) => x.net <= 0).length, p: 0, units: bets.reduce((a, x) => a + x.net, 0) };
  // Games still to be graded, soonest first; a graded game moves to Results (Jack, 2026-10-27).
  const open = boards.filter((g) => g.fb!.result === undefined);
  const [ended, tv] = await Promise.all([endedOnEspn(open.map((g) => ({ slug: g.game.slug, kickoff: g.kickoff, espnId: g.espnId, graded: undefined })), "nba"), tvByEvent("nba")]);
  const rows: GameRowData[] = open.map((g) => {
    const b = g.fb!;
    const e = b.players.filter((x) => x.edge);
    const tipTeam = b.tip >= 0.5 ? b.home : b.away;
    return {
      key: g.game.slug,
      title: `${g.away} at ${g.home}`,
      match: { league: "nba", away: b.away, home: b.home, tv: g.espnId ? tv.get(g.espnId) : undefined },
      when: g.kickoff,
      live: started(g.kickoff, undefined),
      final: ended.has(g.game.slug),
      cells: [
        ["Tip", `${tipTeam} ${pct(Math.max(b.tip, 1 - b.tip))}`],
        ["Likeliest", `${b.players[0].name.split(" ").slice(-1)[0]} ${pct(b.players[0].p)}`],
        ["Edges", `${e.length}`],
      ],
      read: e.length ? [`${e.length} tracked · no stake`, s.readTrack] : ["No edges", s.readPass],
      body: <FbTable b={b} />,
    };
  });
  return (
    <section className={s.section} aria-labelledby="fb-week">
      <Hero
        eyebrow={`NBA First Basket · ${ahead.length} game${ahead.length === 1 ? "" : "s"} ahead`}
        title={<span id="fb-week">{v.fb.learning.entries.some((e) => e.status === "active") ? "First Basket bets live" : "No First Basket bets yet"}</span>}
        sub={`Who scores the first field goal: the tip, then each starter's share of his team's first baskets. ${edges.length ? `${edges.length} starters priced above DraftKings' break-even.` : "Nobody is priced above DraftKings' break-even right now."}`}
      />
      <PropStats edges={edges.length} graded={graded} learning={v.fb.learning} logHref="/props?m=fb&v=log" unit="on games still to play" />
      {edges.length > 0 && (
        <ul className={s.edgeGrid} data-first-pick>
          {edges.slice(0, TOP).map((e) => (
            <EdgeCard key={e.key} e={e} />
          ))}
        </ul>
      )}
      <div className={s.section}>
        <div className={s.sectionHead}>
          <h3 className={s.h2}>Every game</h3>
          <p className={s.p}>Games still to play, soonest first; a game moves to Results once it is graded. Open one for every starter: our chance, DraftKings&apos; with the vig removed across the field, and the edge.</p>
        </div>
        {rows.length ? <GameTable head={["Tip", "Likeliest", "Edges"]} rows={rows} /> : <p className={s.calm}>No games waiting on a first basket. Graded games are under Results.</p>}
      </div>
      <Gate learning={v.fb.learning} label="First Basket" />
    </section>
  );
}

/* ----------------------------------------------------------- first TD --- */

/** One First TD strategy's record at the best price, as a stat: won-lost and units, 1u a bet. */
function ftdWay(graded: Awaited<ReturnType<typeof getOurFtdView>>["graded"], id: string, k: string) {
  const keep = OUR_FTD_SLICES.find(([x]) => x === id)![2];
  const bets = bestBets(graded, keep);
  const w = bets.filter((b) => b.win).length;
  const units = bets.reduce((a, b) => a + b.net, 0);
  return { k, v: bets.length ? u(units) : "·", sub: bets.length ? `${w}-${bets.length - w}, 1u a bet at the best price` : "first grades pending", tone: bets.length ? (units >= 0 ? ("up" as const) : ("down" as const)) : undefined };
}

/** Every First TD edge at the best price (Kalshi with fee, DK or FanDuel), graded: the shadow record the learner reads. Shared with Records. */
export function ftdBestRecord(graded: Awaited<ReturnType<typeof getOurFtdView>>["graded"]) {
  let w = 0;
  let l = 0;
  let units = 0;
  for (const b of bestBets(graded, (p, c) => p.p > c)) {
    if (b.win) w++;
    else l++;
    units += b.net;
  }
  return { w, l, p: 0, units };
}

async function FirstTdWeek({ season }: { season: number }) {
  const v = await getOurFtdView(season).catch(() => null);
  if (!v) return <p className={s.calm}>Our First TD model couldn&apos;t be read just now.</p>;
  const now = nowMs();
  const ahead = v.board.filter((g) => !g.kickoff || Date.parse(g.kickoff) > now);
  const kalshi = (g: OurFtdStored, name: string) => {
    const k = kalshiFor(g.kalshi, name);
    return k?.ask ? kalshiCost(k.ask) : null;
  };
  const dkPrice = (g: OurFtdStored, name: string) => bookPrice(g.dk, name);
  const fdPrice = (g: OurFtdStored, name: string) => bookPrice(g.fd, name);
  /** The cheapest of Kalshi's cost, DraftKings' and FanDuel's break-evens, and where it is (the price the record grades at). */
  const best = (g: OurFtdStored, name: string) => bestCost(g, name);
  const cost = (g: OurFtdStored, name: string) => best(g, name)?.cost ?? null;
  // A bet is a player in a learner slice that has gone live, at the best price (the learner grades there too). An edge alone is not a bet: most games have a few.
  // Only games that kicked off after a slice went live: an earlier game was never bet, whatever the slice says now.
  const since = new Map(v.learning.entries.filter((e) => e.status === "active" && e.activatedAt).map((e) => [e.id, e.activatedAt!]));
  const keepsFor = (kickoff: string | undefined) =>
    OUR_FTD_SLICES.filter(([id]) => since.has(id) && !!kickoff && Date.parse(kickoff) >= Date.parse(since.get(id)!)).map(([, , keep]) => keep);
  const edges: Edge[] = ahead
    .flatMap((g) =>
      pricedPlayers(g.game).flatMap((p): Edge[] => {
        const b = best(g, p.name);
        const c = b?.cost ?? null;
        if (c === null || p.p <= c) return [];
        const team = g.game.teams.find((t) => t.team === p.team)!;
        const k = kalshi(g, p.name);
        const d = dkPrice(g, p.name);
        const staked = k !== null && keepsFor(g.kickoff).some((keep) => keep(p, k, g.game));
        return [
          {
            staked,
            key: `${g.game.slug}|${p.key}`,
            player: p.name,
            game: `${g.game.away} at ${g.game.home}`,
            when: g.kickoff,
            bet: `First TD · ${p.team}`,
            ours: p.p,
            mkt: c,
            mktLabel: "Cheapest price",
            price: b!.where,
            gap: p.p - c,
            more: [
              ["Kalshi cost (fee in)", k !== null ? `${Math.round(k * 100)}¢` : "no market"],
              ["DraftKings", d !== null ? `${am(d)} (breaks even at ${pct(implied(d))})` : g.dk ? "not listed" : "read the morning of game day"],
              ["FanDuel", fdPrice(g, p.name) !== null ? `${am(fdPrice(g, p.name)!)} (breaks even at ${pct(implied(fdPrice(g, p.name)!))})` : g.fd ? "not listed" : "read the morning of game day"],
              [`${p.team} scores first`, pct(team.pFirst)],
              ["Touches, TDs (this season and last)", `${p.touches}, ${p.tds}`],
              ["No offensive TD first", pct(g.game.none)],
            ],
          },
        ];
      }),
    )
    .sort((a, b) => b.gap - a.gap);
  const graded = ftdBestRecord(v.graded);
  // The board holds games still to finish, soonest first; a graded game moves to Results (Jack, 2026-10-26).
  const open = v.board.filter((g) => !g.result).sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? ""));
  const [ended, tv] = await Promise.all([endedOnEspn(open.map((g) => ({ slug: g.game.slug, kickoff: g.kickoff, espnId: g.espnId, graded: g.result })), "nfl"), tvByEvent("nfl")]);
  const rows: GameRowData[] = open.map((g) => {
    const fav = [...g.game.teams].sort((a, b) => b.pFirst - a.pFirst)[0];
    const keeps = keepsFor(g.kickoff);
    const bets = pricedPlayers(g.game).filter((p) => {
      const c = cost(g, p.name);
      return c !== null && keeps.some((keep) => keep(p, c, g.game));
    });
    const vals = pricedPlayers(g.game).filter((p) => {
      const c = cost(g, p.name);
      return c !== null && p.p > c;
    });
    const r = g.result;
    return {
      key: g.game.slug,
      title: `${g.game.away} at ${g.game.home}`,
      match: { league: "nfl", away: g.game.away, home: g.game.home, tv: g.espnId ? tv.get(g.espnId) : undefined },
      when: g.kickoff,
      live: started(g.kickoff, r),
      final: ended.has(g.game.slug),
      cells: [
        ["Scores first", fav ? `${fav.team} ${pct(fav.pFirst)}` : "·"],
        ["Likeliest", g.game.pick ? `${g.game.pick.name} ${pct(g.game.pick.p)}` : "·"],
        ["Edges", g.kalshi || g.dk ? `${vals.length}` : "no prices"],
        ["First TD", r ? (r.first.kind === "offense" ? r.first.scorer : "none") : "·"],
      ],
      read: bets.length ? (r ? (bets.some((p) => p.key === r.key) ? ["Hit", s.readW] : ["Missed", s.readL]) : ["Bet", s.readBet]) : ["No bet", s.readPass],
      body: (
        <div className={s.tw}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Player</th>
                <th>Ours</th>
                <th>Kalshi cost</th>
                <th>DraftKings</th>
                <th>Edge</th>
              </tr>
            </thead>
            <tbody>
              {pricedPlayers(g.game).map((p, i) => {
                const c = cost(g, p.name);
                const k = kalshi(g, p.name);
                const d = dkPrice(g, p.name);
                return (
                  // Player keys are team + initial + surname, so two "ATL_B.Robinson"s collide; the index keeps rows distinct.
                  <tr key={`${p.key}|${i}`}>
                    <td>{`${p.name} `}<span className={s.dim}>{p.team}</span>{r?.key === p.key && <b className={s.pos}> · scored first</b>}</td>
                    <td className={s.num}>{pct(p.p)}</td>
                    <td className={s.num}>{k !== null ? `${Math.round(k * 100)}¢` : "·"}</td>
                    <td className={s.num}>{d !== null ? am(d) : "·"}</td>
                    <td className={`${s.num} ${c !== null && p.p > c ? s.pos : s.dim}`}>{c !== null && p.p > c ? `+${((p.p - c) * 100).toFixed(1)}` : "·"}</td>
                  </tr>
                );
              })}
              <tr>
                <td className={s.dim}>{`Any other player · No offensive TD first`}</td>
                <td className={s.num}>{`${pct(g.game.teams.reduce((a, t) => a + t.rest, 0))} · ${pct(g.game.none)}`}</td>
                <td />
                <td />
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      ),
    };
  });
  const fav = ftdWay(v.graded, "ftdb:pick", "Our favorite every game");
  const favTeam = v.graded.filter((x) => x.result.team && [...x.game.teams].sort((a, b) => b.pFirst - a.pFirst)[0].team === x.result.team).length;
  const favTile: Stat = { ...fav, sub: v.graded.length ? `${fav.sub.replace(", 1u a bet at the best price", "")} · team scored first ${favTeam} of ${v.graded.length}` : fav.sub };
  return (
    <section className={s.section} aria-labelledby="ftd-week">
      <Hero
        eyebrow={`NFL First TD${v.week ? ` · Week ${v.week}` : ""} · Kalshi and DraftKings`}
        title={<span id="ftd-week">{v.learning.entries.some((e) => e.status === "active") ? "First TD bets live" : "No First TD bets yet"}</span>}
        sub={`Which team scores first comes from the market's total and spread, drive by drive; the scorer from each team's TD shares. Priced against Kalshi and, from the morning of game day, DraftKings. ${edges.length ? `${edges.length} players beat the cheaper price.` : "Nobody beats the cheaper price right now."}`}
      />
      {/* "Every edge so far" is already the bet-every-value record, so it isn't repeated. */}
      <PropStats edges={edges.length} graded={graded} learning={v.learning} logHref="/props?m=ftd&v=log" unit="on games still to play" extra={favTile} />
      {edges.length > 0 && (
        <ul className={s.edgeGrid} data-first-pick>
          {edges.slice(0, TOP).map((e) => (
            <EdgeCard key={e.key} e={e} />
          ))}
        </ul>
      )}
      <div className={s.section}>
        <div className={s.sectionHead}>
          <h3 className={s.h2}>Every game</h3>
          <p className={s.p}>Games still to finish, soonest first; a game moves to Results once it is graded. Open one for every player: our chance against Kalshi&apos;s cost (fee in) and DraftKings&apos; price, read the morning of game day. It&apos;s an edge when our chance beats the best price.</p>
        </div>
        {rows.length ? <GameTable head={["Scores first", "Likeliest", "Edges", "First TD"]} rows={rows} /> : <p className={s.calm}>Every game on this board is graded (see Results). The next week&apos;s boards are built at the Tuesday and Wednesday evening captures.</p>}
      </div>
      <Gate learning={v.learning} label="First TD" />
    </section>
  );
}

export async function PropTabWeek({ tab, season }: { tab: PropTab; season: number }) {
  if (tab === "pp") return <PlayerPropsWeek league="nfl" season={season} />;
  if (tab === "nba") return <PlayerPropsWeek league="nba" season={season} />;
  if (tab === "fb") return <FirstBasketWeek season={season} />;
  return <FirstTdWeek season={season} />;
}
