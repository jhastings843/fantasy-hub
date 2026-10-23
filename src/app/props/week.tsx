// The Props tabs' "This week / Today" view (2026-10-21 redesign, second pass):
// one market per tab, built like Picks. A headline that says whether
// anything is a bet, a strip of four numbers, the biggest edges as cards with
// the market's line against our number, a table of every game whose rows open
// to every prop, and the gate detail in a drawer.
import type { ReactNode } from "react";
import Link from "next/link";
import type { SectionView } from "@/lib/learning/engine";
import { etDate, implied, type PropMarket } from "@/lib/props/parse";
import { nameKey } from "@/lib/props/grade";
import { getPropsView } from "@/lib/props/store";
import type { DavidMarket } from "@/lib/props/david";
import { getOurNbaView, type OurStoredProps } from "@/lib/models/nba/store";
import { getOurNflView, type OurNflStored } from "@/lib/models/nfl/store";
import { getOurFtdView, type OurFtdStored } from "@/lib/models/nfl/ftd-store";
import { noVig } from "@/lib/models/nba/market";
import { ourSliceBets, record } from "@/lib/models/learn";
import { kalshiCost, kalshiFor } from "@/lib/firsttd/trends";
import { pricedPlayers } from "@/lib/firsttd/parse";
import { whenEt } from "../picks/ui";
import { Background, Hero, Stats } from "../picks/board";
import { LearningBlock } from "./learning";
import s from "../picks/picks.module.css";

export type PropTab = "pp" | "ftd" | "nba" | "fb";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const u = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}u`;
const SHORT: { [k: string]: string } = { pts: "pts", reb: "reb", ast: "ast", threes: "threes", pass_yds: "pass yds", rush_yds: "rush yds", rec_yds: "rec yds", rec: "rec" };
const DAVID_MARKET: { [k: string]: DavidMarket } = { pass_yds: "passing_yards", rush_yds: "rushing_yards", rec_yds: "receiving_yards", rec: "receptions" };
const sideWord = (x: "over" | "under") => (x === "over" ? "Over" : "Under");
/** "Roschon Johnson" -> "R. Johnson"; suffixes stay off ("Luther Burden III" -> "L. Burden"). */
const short = (name: string) => {
  const w = name.split(" ").filter((x) => !/^(Jr\.?|Sr\.?|II|III|IV|V)$/.test(x));
  return w.length > 1 ? `${w[0][0]}. ${w.at(-1)}` : name;
};
const TOP = 6;
/** NBA games a player needs this season before his edge gets a card. */
const NBA_CARD_GAMES = 3;
const nowMs = () => Date.now();

/** One edge, whatever the market: a prop side, a first basket or a first TD at Kalshi. */
interface Edge {
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
}

interface GameRowData {
  key: string;
  title: string;
  when?: string;
  /** Started and not graded yet: sorts to the top with a Live tag. */
  live?: boolean;
  cells: [string, string][];
  read: [string, string];
  body: ReactNode;
}

const started = (kickoff: string | undefined, graded: unknown) => !graded && !!kickoff && Date.parse(kickoff) <= nowMs();

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

function EdgeCard({ e }: { e: Edge }) {
  return (
    <li className={s.betCard}>
      <div className={s.betCardTop}>
        <div style={{ minWidth: 0 }}>
          <div className={s.betPickBig} style={{ fontSize: "clamp(28px, 4vw, 36px)" }}>
            {e.player}
          </div>
          <div className={s.betWhen}>{`${e.bet} · ${e.game}${e.when ? ` · ${whenEt(e.when)}` : ""}`}</div>
        </div>
        {e.result ? (
          <span className={`${s.readChip} ${e.result.won === true ? s.readW : e.result.won === false ? s.readL : ""}`}>{e.result.text}</span>
        ) : (
          <span className={s.lockChip}>{`Edge +${(e.gap * 100).toFixed(1)}`}</span>
        )}
      </div>
      {e.line && <PropLine line={e.line} />}
      <dl className={s.facts}>
        <div>
          <dt>Our chance</dt>
          <dd>{pct(e.ours)}</dd>
        </div>
        <div>
          <dt>{e.mktLabel}</dt>
          <dd>{pct(e.mkt)}</dd>
        </div>
        <div>
          <dt>Price</dt>
          <dd>{e.price}</dd>
        </div>
      </dl>
      {e.more.length > 0 && (
        <details className={s.why}>
          <summary>Every number</summary>
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

function GameTable({ head, rows }: { head: string[]; rows: GameRowData[] }) {
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
      {[...rows.filter((r) => r.live), ...rows.filter((r) => !r.live)].map((r) => (
        <details key={r.key} className={s.gRow}>
          <summary>
            <span className={s.gGame}>
              {r.title}
              {r.live ? <span className={s.gLive}>Live</span> : r.when && <span>{whenEt(r.when)}</span>}
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
function PropStats({ edges, graded, learning, logHref, unit }: { edges: number; graded: { w: number; l: number; p: number; units: number }; learning: SectionView; logHref: string; unit: string }) {
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
        { k: live ? "Live slices" : "Closest to a bet", v: live ? `${live}` : `${best} of ${learning.gate.minGames}`, sub: live ? "bets for real" : "games a slice needs", small: true },
        { k: "Learner", v: `${testing} slices testing`, sub: <Link href={logHref}>Open the log</Link>, small: true },
      ]}
    />
  );
}

function Gate({ learning, label }: { learning: SectionView; label: string }) {
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

/** `bettable` narrows Edges and Top edge to the props the edge cards would show (NBA: 3+ games this season). */
function propRows(
  board: (OurStoredProps | OurNflStored)[],
  extraCol: (g: OurStoredProps | OurNflStored, m: PropMarket) => string,
  bettable: (g: OurStoredProps | OurNflStored, m: PropMarket) => boolean = () => true,
): GameRowData[] {
  return board.map((g) => {
    const edges = g.game.markets.filter((m) => m.clears && m.side && bettable(g, m));
    const net = g.result ? g.result.markets.reduce((a, r) => a + (r.play?.net ?? 0), 0) : null;
    const res = new Map((g.result?.markets ?? []).map((r) => [r.id, r]));
    const top = [...edges].sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0))[0];
    return {
      key: g.game.slug,
      title: `${g.away} at ${g.home}`,
      when: g.kickoff,
      live: started(g.kickoff, g.result),
      cells: [
        ["Props", `${g.game.markets.length}`],
        ["Edges", `${edges.length}`],
        ["Top edge", top ? `${short(top.player)} ${top.side === "over" ? "o" : "u"}${top.line} ${SHORT[top.stat ?? ""] ?? top.statLabel}` : "·"],
        ["Graded", net !== null ? u(net) : "·"],
      ],
      read: net !== null ? [net > 0 ? "Up" : net < 0 ? "Down" : "Even", net > 0 ? s.readW : net < 0 ? s.readL : ""] : edges.length ? ["Edges", s.readBet] : ["No edges", s.readPass],
      body: (
        <div className={s.tw}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Player</th>
                <th>Prop</th>
                <th>Line</th>
                <th>Ours</th>
                <th>Over</th>
                <th>Edge</th>
                <th>{extraCol === noCol ? "" : "Note"}</th>
                {g.result && <th>Actual</th>}
              </tr>
            </thead>
            <tbody>
              {[...g.game.markets]
                .sort((a, b) => (b.gap ?? -1) - (a.gap ?? -1))
                .map((m) => {
                  const r = res.get(m.id);
                  const x = g.extra[m.id] as { over: number } | undefined;
                  return (
                    <tr key={m.id}>
                      <td>{`${m.player} `}<span className={s.dim}>{m.team}</span></td>
                      <td>{SHORT[m.stat ?? ""] ?? m.statLabel}</td>
                      <td className={s.num}>{m.line}</td>
                      <td className={s.num}>{m.model}</td>
                      <td className={s.num}>{x ? pct(x.over) : "·"}</td>
                      <td className={`${s.num} ${m.side ? s.cSam : s.dim}`}>{m.side && m.gap !== null ? `${sideWord(m.side)} +${(m.gap * 100).toFixed(1)}` : "·"}</td>
                      <td className={s.dim}>{extraCol(g, m)}</td>
                      {g.result && <td className={`${s.num} ${outCls(r?.play?.outcome)}`}>{r?.actual === undefined ? "·" : r.actual === null ? "DNP" : r.actual}</td>}
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
const noCol = () => "";
/** Our side in blue; a result in green or red by how our side did, white when we had no side. */
const outCls = (o: string | undefined) => (o === "W" ? s.pos : o === "L" ? s.neg : o === "P" ? s.dim : "");
/** When the board used DK's alternate line nearer -110 instead of the main line, say which. */
const altNote = (g: OurStoredProps, m: PropMarket) => {
  const x = g.extra[m.id]?.main;
  return x ? `alt line; main ${x.line} at ${x.over !== null ? am(x.over) : "·"}/${x.under !== null ? am(x.under) : "·"}` : "";
};


/**
 * Today's NBA game, opened: every prop grouped by player, with his projected
 * minutes and games, DK's prices and vig-out chance, how DK's line moved since
 * it opened, the outside projections we saved, our number, our chances and the edge.
 */
function NbaGameDetail({ g }: { g: OurStoredProps }) {
  const byPlayer = new Map<string, PropMarket[]>();
  for (const m of g.game.markets) byPlayer.set(m.player, [...(byPlayer.get(m.player) ?? []), m]);
  const best = (ms: PropMarket[]) => Math.max(-1, ...ms.map((m) => (m.clears && m.side ? (m.gap ?? 0) : -1)));
  const players = [...byPlayer].sort((a, b) => best(b[1]) - best(a[1]) || (g.extra[b[1][0].id]?.min ?? 0) - (g.extra[a[1][0].id]?.min ?? 0));
  const edges = g.game.markets.filter((m) => m.clears && m.side);
  const outside = !!(g.rw || g.espn);
  const moves = !!g.dk && Object.keys(g.dk).length > 0;
  const f1 = (x: number | undefined) => (x === undefined ? "·" : `${Math.round(x * 10) / 10}`);
  return (
    <div className={s.section} style={{ gap: 12 }}>
      <p className={s.p}>
        {`${g.game.markets.length} props on ${byPlayer.size} players, ${edges.length} edges. Players with an edge first, then by projected minutes. DK read ${whenEt(g.capturedAt)}.`}
      </p>
      <div className={s.tw}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Prop</th>
              <th>Line</th>
              <th>DK o / u</th>
              <th>DK over, vig out</th>
              {moves && <th>DK open</th>}
              <th>Ours</th>
              {outside && <th>Rotowire</th>}
              {outside && <th>ESPN</th>}
              <th>Our over</th>
              <th>Edge</th>
            </tr>
          </thead>
          <tbody>
            {players.map(([player, ms]) => {
              const x0 = g.extra[ms[0].id];
              return [
                <tr key={`${player}|h`}>
                  <td colSpan={7 + (outside ? 2 : 0) + (moves ? 1 : 0)} style={{ background: "var(--surface2)" }}>
                    <strong>{player}</strong> <span className={s.dim}>{`${ms[0].team} · ${x0?.min ?? "·"} min projected${x0?.games !== undefined ? ` · ${x0.games} game${x0.games === 1 ? "" : "s"} this season` : ""}${(x0?.games ?? 0) < NBA_CARD_GAMES ? " · leans on last season" : ""}`}</span>
                  </td>
                </tr>,
                ...[...ms]
                  .sort((a, b) => (b.gap ?? -1) - (a.gap ?? -1))
                  .map((m) => {
                    const dk = m.books[0];
                    const x = g.extra[m.id];
                    const fair = dk?.over != null && dk?.under != null ? noVig(dk.over, dk.under).over : null;
                    const mv = g.dk?.[m.id];
                    return (
                      <tr key={m.id}>
                        <td>{SHORT[m.stat ?? ""] ?? m.statLabel}</td>
                        <td className={s.num}>
                          {m.line}
                          {x?.main && <span className={s.dim}>{` alt (main ${x.main.line})`}</span>}
                        </td>
                        <td className={s.num}>{`${dk?.over != null ? am(dk.over) : "·"} / ${dk?.under != null ? am(dk.under) : "·"}`}</td>
                        <td className={s.num}>{fair !== null ? pct(fair) : "·"}</td>
                        {moves && <td className={s.num}>{mv && mv.open !== mv.current ? `${mv.open} → ${mv.current}` : mv ? `${mv.open}` : "·"}</td>}
                        <td className={s.num}>{m.model}</td>
                        {outside && <td className={s.num}>{f1(g.rw?.[m.id])}</td>}
                        {outside && <td className={s.num}>{f1(g.espn?.[m.id])}</td>}
                        <td className={s.num}>{x ? pct(x.over) : "·"}</td>
                        <td className={`${s.num} ${m.side ? s.cSam : s.dim}`}>{m.side && m.gap !== null ? `${sideWord(m.side)} +${(m.gap * 100).toFixed(1)}` : "·"}</td>
                      </tr>
                    );
                  }),
              ];
            })}
          </tbody>
        </table>
      </div>
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
    const results = v.board.filter((g) => g.result).sort((a, b) => (b.kickoff ?? "").localeCompare(a.kickoff ?? ""));
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
    const todayRows = propRows(tonight, noCol, settled).map((r, i) => ({ ...r, body: <NbaGameDetail g={tonight[i]} /> }));
    return (
      <section className={s.section} aria-labelledby="pp-week">
        <Hero
          eyebrow={`NBA player props · today · ${tonight.length} game${tonight.length === 1 ? "" : "s"}`}
          title={<span id="pp-week">{v.learning.entries.some((e) => e.status === "active") ? "Prop bets live" : "No prop bets yet"}</span>}
          sub={`Points, rebounds, assists and threes against DraftKings. ${edges.length ? `${edges.length} edges from players with ${NBA_CARD_GAMES}+ games this season; the biggest are below.` : `No edges yet from players with ${NBA_CARD_GAMES}+ games this season.`}${early ? ` ${early} more lean on last season's minutes, so they stay in the game table until the player has ${NBA_CARD_GAMES} games (a summer role change otherwise reads as a huge edge).` : ""}`}
        />
        <PropStats edges={edges.length} graded={graded} learning={v.learning} logHref="/props?m=nba&v=log" unit={early ? `${early} more wait on 3 games` : "on games still to play"} />
        {edges.length > 0 && (
          <ul className={s.betGrid} data-first-pick>
            {edges.slice(0, TOP).map((e) => (
              <EdgeCard key={e.key} e={e} />
            ))}
          </ul>
        )}
        <div className={s.section}>
          <div className={s.sectionHead}>
            <h3 className={s.h2}>Today&apos;s games</h3>
            <p className={s.p}>Open a game for every prop by player: projected minutes, DK&apos;s prices and line move, our number, our chances and the edge. Lines are the ones priced closest to -110 (DK&apos;s main line, or an alternate when the main one is lopsided). Later games show up the morning of.</p>
          </div>
          {todayRows.length ? <GameTable head={["Props", "Edges", "Top edge", "Graded"]} rows={todayRows} /> : <p className={s.calm}>No NBA games today.</p>}
        </div>
        {results.length > 0 && (
          <div className={s.section}>
            <div className={s.sectionHead}>
              <h3 className={s.h2}>Results</h3>
              <p className={s.p}>Every graded game, newest first. Our side in blue; the result green when it won, red when it lost.</p>
            </div>
            <GameTable head={["Props", "Edges", "Top edge", "Graded"]} rows={propRows(results, (g, m) => altNote(g as OurStoredProps, m))} />
          </div>
        )}
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
  return (
    <section className={s.section} aria-labelledby="pp-week">
      <Hero
        eyebrow={`NFL player props${v.week ? ` · Week ${v.week}` : ""}`}
        title={<span id="pp-week">{v.learning.entries.some((e) => e.status === "active") ? "Prop bets live" : "No prop bets yet"}</span>}
        sub={`Passing, rushing and receiving yards and receptions against DraftKings. ${
          waiting ? `${waiting} of ${all} props have no DraftKings price yet (it's read the morning of game day), so they show our number but no edge. ` : ""
        }${edges.length ? `${edges.length} edges with a real price; the biggest are below.` : "No edges with a real price yet."}`}
      />
      <PropStats edges={edges.length} graded={graded} learning={v.learning} logHref="/props?v=log" unit="on games still to play" />
      {edges.length > 0 && (
        <>
          <ul className={s.betGrid} data-first-pick>
            {edges.slice(0, TOP).map((e) => (
              <EdgeCard key={e.key} e={e} />
            ))}
          </ul>
          <div className={s.mKey}>
            <span>
              <i className="tick" style={{ width: 2, height: 12, borderRadius: 0, background: "var(--ink)" }} />
              DraftKings line
            </span>
            <span>
              <i style={{ background: "var(--accent)" }} />
              Ours (median)
            </span>
            <span>
              <i style={{ background: "var(--david)" }} />
              David
            </span>
          </div>
        </>
      )}
      <div className={s.section}>
        <div className={s.sectionHead}>
          <h3 className={s.h2}>Every game</h3>
          <p className={s.p}>Open a game for every prop. A prop shows an edge only once DraftKings&apos; price is in.</p>
        </div>
        <GameTable head={["Props", "Edges", "Top edge", "Graded"]} rows={propRows([...ahead, ...done], (g, m) => ((g as OurNflStored).extra[m.id]?.price === "assumed" ? "price at game-day morning" : ""))} />
      </div>
      <Gate learning={v.learning} label="NFL prop" />
    </section>
  );
}

/* ------------------------------------------------------- first basket --- */

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
  const rows: GameRowData[] = boards.map((g) => {
    const b = g.fb!;
    const e = b.players.filter((x) => x.edge);
    const tipTeam = b.tip >= 0.5 ? b.home : b.away;
    const res = b.result;
    const scorer = res ? b.players.find((x) => x.id === res.player)?.name ?? "a non-starter" : null;
    return {
      key: g.game.slug,
      title: `${g.away} at ${g.home}`,
      when: g.kickoff,
      live: started(g.kickoff, res),
      cells: [
        ["Tip", `${tipTeam} ${pct(Math.max(b.tip, 1 - b.tip))}`],
        ["Likeliest", `${b.players[0].name.split(" ").slice(-1)[0]} ${pct(b.players[0].p)}`],
        ["Edges", `${e.length}`],
        ["First basket", scorer ?? "·"],
      ],
      read: res !== undefined ? (e.some((x) => x.id === res?.player) ? ["Hit", s.readW] : ["Missed", e.length ? s.readL : s.readPass]) : e.length ? ["Edges", s.readBet] : ["No edges", s.readPass],
      body: (
        <div className={s.tw}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Player</th>
                <th>Ours</th>
                <th>DK, vig out</th>
                <th>DK price</th>
                <th>Edge</th>
              </tr>
            </thead>
            <tbody>
              {b.players.map((x) => (
                <tr key={x.id}>
                  <td>{`${x.name} `}<span className={s.dim}>{x.team}</span>{res?.player === x.id && <b className={s.pos}> · first basket</b>}</td>
                  <td className={s.num}>{pct(x.p)}</td>
                  <td className={s.num}>{x.fair !== null ? pct(x.fair) : "·"}</td>
                  <td className={s.num}>{x.price !== null ? am(x.price) : "·"}</td>
                  <td className={`${s.num} ${x.edge ? s.pos : s.dim}`}>{x.edge ? `+${((x.p - implied(x.price!)) * 100).toFixed(1)}` : "·"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
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
        <ul className={s.betGrid} data-first-pick>
          {edges.slice(0, TOP).map((e) => (
            <EdgeCard key={e.key} e={e} />
          ))}
        </ul>
      )}
      <div className={s.section}>
        <div className={s.sectionHead}>
          <h3 className={s.h2}>Every game</h3>
          <p className={s.p}>Open a game for every starter: our chance, DraftKings&apos; with the vig removed across the field, and the edge.</p>
        </div>
        <GameTable head={["Tip", "Likeliest", "Edges", "First basket"]} rows={rows} />
      </div>
      <Gate learning={v.fb.learning} label="First Basket" />
    </section>
  );
}

/* ----------------------------------------------------------- first TD --- */

async function FirstTdWeek({ season }: { season: number }) {
  const v = await getOurFtdView(season).catch(() => null);
  if (!v) return <p className={s.calm}>Our First TD model couldn&apos;t be read just now.</p>;
  const now = nowMs();
  const ahead = v.board.filter((g) => !g.kickoff || Date.parse(g.kickoff) > now);
  const kalshi = (g: OurFtdStored, name: string) => {
    const k = kalshiFor(g.kalshi, name);
    return k?.ask ? kalshiCost(k.ask) : null;
  };
  // DraftKings' First TD price (The Odds API, read the morning of game day), keyed by the full name squashed:
  // "J.Chase" matches the one key that starts with "j" and ends with "chase".
  const bookPrice = (book: OurFtdStored["dk"], name: string): number | null => {
    if (!book) return null;
    const [ini, ...rest] = name.split(".");
    const last = nameKey(rest.join(" "));
    const hits = Object.keys(book.prices).filter((k) => k.startsWith(ini.toLowerCase()) && k.endsWith(last));
    return hits.length === 1 ? book.prices[hits[0]] : null;
  };
  const dkPrice = (g: OurFtdStored, name: string) => bookPrice(g.dk, name);
  const fdPrice = (g: OurFtdStored, name: string) => bookPrice(g.fd, name);
  /** The cheapest of Kalshi's cost, DraftKings' and FanDuel's break-evens, and where it is. */
  const best = (g: OurFtdStored, name: string): { cost: number; where: string } | null => {
    const k = kalshi(g, name);
    const opts: { cost: number; where: string }[] = [];
    if (k !== null) opts.push({ cost: k, where: `${Math.round(k * 100)}¢ Kalshi` });
    const d = dkPrice(g, name);
    if (d !== null) opts.push({ cost: implied(d), where: `${am(d)} DK` });
    const f = fdPrice(g, name);
    if (f !== null) opts.push({ cost: implied(f), where: `${am(f)} FanDuel` });
    return opts.sort((a, b) => a.cost - b.cost)[0] ?? null;
  };
  const cost = (g: OurFtdStored, name: string) => best(g, name)?.cost ?? null;
  const edges: Edge[] = ahead
    .flatMap((g) =>
      pricedPlayers(g.game).flatMap((p): Edge[] => {
        const b = best(g, p.name);
        const c = b?.cost ?? null;
        if (c === null || p.p <= c) return [];
        const team = g.game.teams.find((t) => t.team === p.team)!;
        const k = kalshi(g, p.name);
        const d = dkPrice(g, p.name);
        return [
          {
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
  const graded = (() => {
    let w = 0;
    let l = 0;
    let units = 0;
    for (const x of v.graded)
      for (const p of pricedPlayers(x.game)) {
        const k = kalshiFor(x.kalshi, p.name);
        if (!k?.ask) continue;
        const c = kalshiCost(k.ask);
        if (c >= 1 || p.p <= c) continue;
        const won = x.result.key === p.key;
        if (won) w++;
        else l++;
        units += won ? (1 - c) / c : -1;
      }
    return { w, l, p: 0, units };
  })();
  const rows: GameRowData[] = v.board.map((g) => {
    const fav = [...g.game.teams].sort((a, b) => b.pFirst - a.pFirst)[0];
    const vals = pricedPlayers(g.game).filter((p) => {
      const c = cost(g, p.name);
      return c !== null && p.p > c;
    });
    const r = g.result;
    return {
      key: g.game.slug,
      title: `${g.game.away} at ${g.game.home}`,
      when: g.kickoff,
      live: started(g.kickoff, r),
      cells: [
        ["Scores first", fav ? `${fav.team} ${pct(fav.pFirst)}` : "·"],
        ["Likeliest", g.game.pick ? `${g.game.pick.name} ${pct(g.game.pick.p)}` : "·"],
        ["Edges", g.kalshi || g.dk ? `${vals.length}` : "no prices"],
        ["First TD", r ? (r.first.kind === "offense" ? r.first.scorer : "none") : "·"],
      ],
      read: r ? (vals.some((p) => p.key === r.key) ? ["Hit", s.readW] : ["Missed", vals.length ? s.readL : s.readPass]) : vals.length ? ["Edge", s.readBet] : ["No edge", s.readPass],
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
              {pricedPlayers(g.game).map((p) => {
                const c = cost(g, p.name);
                const k = kalshi(g, p.name);
                const d = dkPrice(g, p.name);
                return (
                  <tr key={p.key}>
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
  return (
    <section className={s.section} aria-labelledby="ftd-week">
      <Hero
        eyebrow={`NFL First TD${v.week ? ` · Week ${v.week}` : ""} · Kalshi and DraftKings`}
        title={<span id="ftd-week">{v.learning.entries.some((e) => e.status === "active") ? "First TD bets live" : "No First TD bets yet"}</span>}
        sub={`Which team scores first comes from the market's total and spread, drive by drive; the scorer from each team's TD shares. Priced against Kalshi and, from the morning of game day, DraftKings. ${edges.length ? `${edges.length} players beat the cheaper price.` : "Nobody beats the cheaper price right now."}`}
      />
      <PropStats edges={edges.length} graded={graded} learning={v.learning} logHref="/props?m=ftd&v=log" unit="on games still to play" />
      {edges.length > 0 && (
        <ul className={s.betGrid} data-first-pick>
          {edges.slice(0, TOP).map((e) => (
            <EdgeCard key={e.key} e={e} />
          ))}
        </ul>
      )}
      <div className={s.section}>
        <div className={s.sectionHead}>
          <h3 className={s.h2}>Every game</h3>
          <p className={s.p}>Open a game for every player: our chance against Kalshi&apos;s cost (fee in) and DraftKings&apos; price, which is read the morning of game day. It&apos;s an edge when our chance beats the cheaper of the two.</p>
        </div>
        <GameTable head={["Scores first", "Likeliest", "Edges", "First TD"]} rows={rows} />
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
