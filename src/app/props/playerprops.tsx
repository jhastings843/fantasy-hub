// Player props: Sam's and David Sasser's prop models, side by side the way
// Picks treats them. Both saved before kickoff (with Rotowire's and ESPN's
// projections alongside), graded from ESPN's box score, and compared head to
// head at the same DraftKings line where both cover a prop. This week,
// results, research. NBA props (Sam only) run through the same views, with
// league="nba": its own record and system, no David board or outside projections.
import { STAT_LABEL, etDate, type League, type PropMarket, type Side } from "@/lib/props/parse";
import { isPlay, nameKey } from "@/lib/props/grade";
import { getPropsView, type PropsView, type StoredProps } from "@/lib/props/store";
import { getNbaPropsView } from "@/lib/props/nba-props";
import { MIN_BETS, matches, rwSide, type GradedPropsGame, type PropSlice, type Verdict } from "@/lib/props/trends";
import { DAVID_LABEL, DAVID_PLAY_EDGE, DAVID_URL, agreeEdge, davidEdge, davidSide, davidSliceSide, isDavidPlay, isDavidSlice, samOn, type DavidGame, type DavidGraded, type DavidMarket, type DavidProp, type DavidSlice } from "@/lib/props/david";
import { whenEt } from "../picks/ui";
import { boardWeek } from "@/lib/picks/finished";
import { LearningBlock } from "./learning";
import s from "../picks/picks.module.css";
import pp from "./props.module.css";

const SAM = "https://samthemodelman.smmodel.workers.dev/nfl/";
const SAM_NBA = "https://samthemodelman.smmodel.workers.dev/nba/";
const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const u = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}u`;
const short: { [k: string]: string } = { pass_yds: "pass yds", rush_yds: "rush yds", rec_yds: "rec yds", rec: "rec", pts: "pts", reb: "reb", ast: "ast", threes: "threes" };
const statShort = (m: PropMarket) => (m.stat ? short[m.stat] : m.statLabel.toLowerCase());
const sideWord = (x: Side) => (x === "over" ? "Over" : "Under");

async function load(season: number, league: League = "nfl"): Promise<PropsView | null> {
  return (league === "nba" ? getNbaPropsView(season) : getPropsView(season)).catch(() => null);
}

function Unavailable() {
  return <p className={s.calm}>The props tracker couldn&apos;t be read just now. Try again in a minute.</p>;
}
function Empty({ league = "nfl", graded = false }: { league?: League; graded?: boolean }) {
  if (league === "nba" && graded)
    return <p className={s.calm}>Nothing graded yet. Each night&apos;s games are graded from ESPN&apos;s box scores at the overnight run, about 2:30am ET.</p>;
  if (league === "nba")
    return (
      <p className={s.calm}>
        Nothing saved yet. Sam&apos;s NBA props pages are saved before each tip and graded from ESPN&apos;s box score once final. His site only keeps
        the current slate, so the record starts with opening night, October 20.
      </p>
    );
  return (
    <p className={s.calm}>
      Nothing saved yet. Sam&apos;s props pages and David&apos;s board are saved before each kickoff and graded from ESPN&apos;s
      box score once final. Both sites only keep the current week, so the record starts with Week 6 Sunday.
    </p>
  );
}

/** Slice ids an unsettled market's play or lean falls in, among the active system slices. */
export function systemHits(m: PropMarket, saved: StoredProps, active: string[], all: GradedPropsGame[]): string[] {
  const rw = saved.rw?.[m.id];
  const espn = saved.espn?.[m.id];
  const david = saved.david?.[m.id];
  const dk = saved.dk?.[m.id];
  const pseudo = (side: Side | null) =>
    side
      ? { week: 0, slug: saved.game.slug, m, g: { id: m.id, actual: null, play: null, lean: null }, bet: { side, line: m.line, price: 0, book: "", outcome: "P" as const, net: 0, breakEven: 0 }, rw, espn, david, dk }
      : null;
  return active.filter((id) => {
    if (isDavidSlice(id)) return false;
    const side = id.startsWith("play:")
      ? isPlay(m)
        ? m.side
        : null
      : id.startsWith("rw:")
        ? rwSide(m, rw)
        : id.startsWith("espn:")
          ? rwSide(m, espn)
          : id.startsWith("david:")
            ? rwSide(m, david)
            : m.lean;
    const row = pseudo(side);
    // Favorites need the week's own game; pass it as the only list entry.
    return !!row && matches(id, row, [{ week: 0, slug: saved.game.slug, game: saved.game, result: { markets: [], void: 0 } }, ...all]);
  });
}

/** Active system slices a David prop falls in. */
const davidHits = (p: DavidProp, samProj: number | undefined, active: string[]) =>
  active.filter((id) => isDavidSlice(id) && davidSliceSide(id, p, samProj) !== null);

function PlayRow({ m, saved, hits }: { m: PropMarket; saved: StoredProps; hits: string[] }) {
  const w = m.books.find((b) => b.win);
  const price = w && m.side ? w[m.side] : null;
  const graded = saved.result?.markets.find((x) => x.id === m.id);
  const out = graded?.play?.outcome;
  const david = saved.david?.[m.id];
  return (
    <li className={`${s.ppRow} ${hits.length ? s.ppSys : ""}`}>
      <div className={s.ppMain}>
        <span className={s.ppWho}>{`${m.player} `}<span className={s.dim}>{m.team}</span></span>
        <span className={s.ppBet}>{`${sideWord(m.side!)} ${m.line} ${statShort(m)}`}</span>
      </div>
      <div className={`${s.ppMeta} ${s.num}`}>
        {[
          price !== null && w ? `${am(price)} ${w.book}` : null,
          m.gap !== null ? (m.team === "" ? `Sam ${Math.round(m.gap * 100)}% off the market` : `gap ${m.gap.toFixed(3)}`) : null,
          `Sam ${m.model}`,
          david !== undefined ? `David ${david}${rwSide(m, david) === m.side ? " (agrees)" : rwSide(m, david) ? " (splits)" : ""}` : null,
          `market ${m.consensus}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      {(hits.length > 0 || out) && (
        <div className={s.ftdChips}>
          {hits.length > 0 && <span className={`${s.pill}`}>in the system</span>}
          {out && graded?.actual !== null && (
            <span className={`${s.resChip} ${out === "W" ? s.resW : out === "L" ? s.resL : s.resP}`}>{`${out} · ${graded!.actual}`}</span>
          )}
        </div>
      )}
    </li>
  );
}

function DavidRow({ p, samProj, result, hits }: { p: DavidProp; samProj: number | undefined; result: DavidGraded | undefined; hits: string[] }) {
  const side = davidSide(p)!;
  const price = side === "over" ? p.over : p.under;
  const samSide = samProj === undefined ? null : samProj > p.line ? "over" : samProj < p.line ? "under" : null;
  const out = result?.outcome;
  return (
    <li className={`${s.ppRow} ${hits.length ? s.ppSys : ""}`}>
      <div className={s.ppMain}>
        <span className={s.ppWho}>{`${p.player} `}<span className={s.dim}>{p.team}</span></span>
        <span className={s.ppBet}>{`${sideWord(side)} ${p.line} ${dShort[p.market]}`}</span>
      </div>
      <div className={`${s.ppMeta} ${s.num}`}>
        {[
          price !== null ? `${am(price)} DraftKings` : null,
          davidEdge(p) !== null ? `est. edge ${Math.round(davidEdge(p)! * 100)}%` : null,
          `David ${p.projection}`,
          p.lower !== null && p.upper !== null ? `80% ${p.lower}–${p.upper}` : null,
          samProj !== undefined ? `Sam ${samProj}${samSide === side ? " (agrees)" : samSide ? " (splits)" : ""}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      {(hits.length > 0 || out) && (
        <div className={s.ftdChips}>
          {hits.length > 0 && <span className={`${s.pill}`}>in the system</span>}
          {out && result?.actual !== null && (
            <span className={`${s.resChip} ${out === "W" ? s.resW : out === "L" ? s.resL : s.resP}`}>{`${out} · ${result!.actual}`}</span>
          )}
        </div>
      )}
    </li>
  );
}

const dShort: { [k: string]: string } = {
  passing_yards: "pass yds",
  pass_attempts: "pass att",
  rushing_yards: "rush yds",
  rush_attempts: "rush att",
  receiving_yards: "rec yds",
  receptions: "rec",
};
const TO_DAVID: { [k: string]: DavidMarket } = { pass_yds: "passing_yards", rush_yds: "rushing_yards", rec_yds: "receiving_yards", rec: "receptions" };
const PLAY_PCT = Math.round(DAVID_PLAY_EDGE * 100);
const OU = (x: Side | null) => (x === "over" ? "O" : x === "under" ? "U" : "–");
const sideFrom = (x: number | undefined, line: number): Side | null => (x === undefined ? null : x > line ? "over" : x < line ? "under" : null);

interface JoinedRow {
  key: string;
  player: string;
  team: string;
  stat: string;
  sam?: number;
  david?: number;
  rw?: number;
  espn?: number;
  /** DraftKings' total when David has the prop, else Sam's shown line. */
  line: number;
  lineFrom: "DK" | "Sam";
  actual?: number | null;
}

/** One row per player and stat across both models. */
function joinRows(sam: StoredProps | undefined, david: DavidGame | undefined, samOf: (p: DavidProp) => number | undefined): JoinedRow[] {
  const rows = new Map<string, JoinedRow>();
  const dRes = new Map((david?.result ?? []).map((r) => [r.id, r]));
  for (const p of david?.props ?? []) {
    rows.set(`${nameKey(p.player)}|${p.team}|${p.market}`, {
      key: p.id,
      player: p.player,
      team: p.team,
      stat: dShort[p.market],
      david: p.projection,
      sam: samOf(p),
      line: p.line,
      lineFrom: "DK",
      actual: dRes.get(p.id)?.actual,
    });
  }
  for (const m of sam?.game.markets ?? []) {
    if (!m.stat) continue;
    const r = sam!.result?.markets.find((x) => x.id === m.id);
    const extra = { rw: sam!.rw?.[m.id], espn: sam!.espn?.[m.id] };
    const hit = rows.get(`${nameKey(m.player)}|${m.team}|${TO_DAVID[m.stat]}`);
    if (hit) Object.assign(hit, { sam: m.model, ...extra, actual: hit.actual ?? r?.actual });
    else rows.set(m.id, { key: m.id, player: m.player, team: m.team, stat: statShort(m), sam: m.model, ...extra, line: m.line, lineFrom: "Sam", actual: r?.actual });
  }
  return [...rows.values()].sort((a, b) => a.team.localeCompare(b.team) || a.player.localeCompare(b.player) || a.stat.localeCompare(b.stat));
}

/** A prop both models point the same way on, at DraftKings' line: the "Both agree" slice the results page tracks. */
interface Agree {
  p: DavidProp;
  sam: number;
  side: Side;
  /** Estimated win chance minus the price's break-even, using the less confident model: both have to clear it. */
  score: number;
  result?: DavidGraded;
}

function agreements(david: DavidGame | undefined, samOf: (p: DavidProp) => number | undefined): Agree[] {
  const dRes = new Map((david?.result ?? []).map((r) => [r.id, r]));
  const out: Agree[] = [];
  for (const p of david?.props ?? []) {
    const side = davidSide(p);
    const sam = samOf(p);
    if (!side || sam === undefined || sideFrom(sam, p.line) !== side) continue;
    const score = agreeEdge(p, sam);
    if (score === null) continue;
    out.push({ p, sam, side, score, result: dRes.get(p.id) });
  }
  return out.sort((a, b) => b.score - a.score);
}

const BEST_TOP = 10;
const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(0)}%`;
/** Server render time, to split games that have kicked off from those still to come. */
const renderedAt = () => Date.now();

function AgreeRow({ a, teams }: { a: Agree; teams?: string }) {
  const price = a.side === "over" ? a.p.over : a.p.under;
  const out = a.result?.outcome;
  return (
    <li className={pp.bbRow}>
      <div className={pp.bbMain}>
        <span className={s.ppWho}>
          {`${a.p.player} `}
          <span className={s.dim}>{a.p.team}</span>
        </span>
        <span className={s.ppBet}>{`${sideWord(a.side)} ${a.p.line} ${dShort[a.p.market]}`}</span>
      </div>
      <div className={`${pp.bbMeta} ${s.num}`}>
        <span>{`Sam ${a.sam} · David ${a.p.projection}`}</span>
        {price !== null && <span>{`${am(price)} DK`}</span>}
        <span className={a.score > 0 ? s.pos : s.dim}>{`edge ${pct(a.score)} est.`}</span>
        {teams && <span className={s.dim}>{teams}</span>}
        {out && a.result?.actual !== null && (
          <span className={`${s.resChip} ${out === "W" ? s.resW : out === "L" ? s.resL : s.resP}`}>{`${out} · ${a.result!.actual}`}</span>
        )}
      </div>
    </li>
  );
}

function BestBets({ games, samOf, record, now }: { now: number; games: DavidGame[]; samOf: (p: DavidProp) => number | undefined; record: Pick<PropSlice, "w" | "l" | "p" | "units"> | undefined }) {
  const all = games.flatMap((g) => {
    const [, , away, home] = g.gameId.split("_");
    const when = `${away} at ${home} · ${whenEt(g.kickoff)}`;
    return agreements(g, samOf).map((a) => ({ a, when, started: new Date(g.kickoff).getTime() <= now }));
  });
  const up = all.filter((x) => !x.started).sort((x, y) => y.a.score - x.a.score);
  const done = all.filter((x) => x.started).sort((x, y) => y.a.score - x.a.score);
  const rec = record && record.w + record.l + record.p > 0 ? `${recOf(record)}, ${u(record.units)}` : null;
  if (!all.length) return null;
  return (
    <section className={pp.bb} aria-labelledby="pp-best">
      <div className={pp.bbHead}>
        <h3 className={pp.bbH} id="pp-best">Best bets: both models agree</h3>
        <span className={`${s.dim} ${s.num}`}>{rec ? `Season so far ${rec}` : "No graded record yet"}</span>
      </div>
      <p className={pp.bbNote}>
        Props where Sam and David land on the same side of DraftKings&apos; line. Ranked by edge, an estimate: the less confident model&apos;s chance of hitting (from David&apos;s 80% range) minus what DraftKings&apos; price needs.
        Tracking only, not in the system yet.
      </p>
      {up.length ? (
        <ol className={pp.bbList}>
          {up.slice(0, BEST_TOP).map(({ a, when }) => (
            <AgreeRow key={a.p.id} a={a} teams={when} />
          ))}
        </ol>
      ) : (
        <p className={pp.ppNone}>Every game with a shared prop has kicked off.</p>
      )}
      {up.length > BEST_TOP && (
        <details className={s.ppAll}>
          <summary>{`${up.length - BEST_TOP} more agreements`}</summary>
          <ol className={pp.bbList}>
            {up.slice(BEST_TOP).map(({ a, when }) => (
              <AgreeRow key={a.p.id} a={a} teams={when} />
            ))}
          </ol>
        </details>
      )}
      {done.length > 0 && (
        <details className={s.ppAll}>
          <summary>{`${done.length} from games already started`}</summary>
          <ol className={pp.bbList}>
            {done.map(({ a, when }) => (
              <AgreeRow key={a.p.id} a={a} teams={when} />
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

function GameCard({ gameId, sam, david, v, samOf }: { gameId: string; sam?: StoredProps; david?: DavidGame; v: PropsView; samOf: (p: DavidProp) => number | undefined }) {
  const [, , away, home] = gameId.split("_");
  const kickoff = sam?.kickoff ?? david?.kickoff;
  const plays = sam ? sam.game.markets.filter(isPlay).sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0)) : [];
  const dProps = david ? david.props.filter(isDavidPlay).sort((a, b) => davidEdge(b)! - davidEdge(a)!) : [];
  const dRes = new Map((david?.result ?? []).map((r) => [r.id, r]));
  const shared = (david?.props ?? []).filter((p) => samOf(p) !== undefined);
  const agree = agreements(david, samOf);
  const samNet = sam?.result ? sam.result.markets.reduce((a, r) => a + (r.play?.net ?? 0), 0) : null;
  const dNet = david?.result ? david.result.reduce((a, r) => a + r.net, 0) : null;
  const inSystem =
    (sam ? plays.filter((m) => systemHits(m, sam, v.active, v.graded).length).length : 0) + dProps.filter((p) => davidHits(p, samOf(p), v.active).length).length;
  const rows = joinRows(sam, david, samOf);
  const graded = !!(sam?.result || david?.result);
  return (
    <li>
      <details className={s.ftdGame}>
        <summary className={s.ftdSum}>
          <span className={s.ftdWhen}>
            <b>{`${away} at ${home}`}</b>
            <span className={s.dim}>{`${kickoff ? whenEt(kickoff) : ""}${sam?.late ? " · late copy" : ""}`}</span>
          </span>
          <span className={s.ftdPick}>
            <span className={s.ftdPickName}>{agree.length ? `${agree.length} both agree` : "No agreements"}</span>
            <span className={`${s.dim} ${s.num}`}>{shared.length ? `of ${shared.length} props they share` : sam && david ? "no props in common" : sam ? "David hasn't posted" : "Sam's page not saved yet"}</span>
          </span>
          <span className={s.ftdOdds}>
            {[sam ? `Sam ${plays.length} ${plays.length === 1 ? "play" : "plays"}` : null, david ? `David ${dProps.length} ${dProps.length === 1 ? "play" : "plays"}` : null].filter(Boolean).join(" · ")}
          </span>
          <span className={s.ftdFlags}>
            {samNet !== null && <span className={`${s.resChip} ${samNet > 0 ? s.resW : samNet < 0 ? s.resL : s.resP}`}>{`Sam ${u(samNet)}`}</span>}
            {dNet !== null && <span className={`${s.resChip} ${dNet > 0 ? s.resW : dNet < 0 ? s.resL : s.resP}`}>{`David ${u(dNet)}`}</span>}
            {samNet === null && dNet === null && inSystem > 0 && <span className={s.pill}>{`${inSystem} in system`}</span>}
            <span className={s.chev} aria-hidden>›</span>
          </span>
        </summary>
        <div className={s.ftdBody}>
          {agree.length > 0 && (
            <div className={pp.ppCol}>
              <div className={pp.ppColH}>
                <span>Both agree</span>
                <span className={s.dim}>{agree.length > 5 ? `top 5 of ${agree.length}, the rest in the table below` : "at DraftKings' line"}</span>
              </div>
              <ol className={pp.bbList}>
                {agree.slice(0, 5).map((a) => (
                  <AgreeRow key={a.p.id} a={a} />
                ))}
              </ol>
            </div>
          )}
          <div className={pp.ppCols}>
            <div className={pp.ppCol}>
              <div className={pp.ppColH}>
                <span>Sam&apos;s plays</span>
                <span className={s.dim}>{sam ? `${sam.game.markets.length} markets` : ""}</span>
              </div>
              {plays.length ? (
                <ol className={s.ppList}>
                  {plays.map((m) => (
                    <PlayRow key={m.id} m={m} saved={sam!} hits={systemHits(m, sam!, v.active, v.graded)} />
                  ))}
                </ol>
              ) : (
                <p className={pp.ppNone}>{sam ? "No play clears the vig on his page." : "Sam posts Sunday's props pages on Saturday; this fills in at the next capture."}</p>
              )}
            </div>
            <div className={pp.ppCol}>
              <div className={pp.ppColH}>
                <span>David&apos;s plays</span>
                <span className={s.dim}>{david ? `${david.props.length} props` : ""}</span>
              </div>
              {dProps.length ? (
                <ol className={s.ppList}>
                  {dProps.map((p) => (
                    <DavidRow key={p.id} p={p} samProj={samOf(p)} result={dRes.get(p.id)} hits={davidHits(p, samOf(p), v.active)} />
                  ))}
                </ol>
              ) : (
                <p className={pp.ppNone}>{david ? `No prop on his board reaches a ${PLAY_PCT}% estimated edge.` : "Not on David's board (his board drops a game at kickoff)."}</p>
              )}
            </div>
          </div>
          <details className={s.ppAll}>
            <summary>{`Every prop, both models (${rows.length})`}</summary>
            <div className={s.tw}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Stat</th>
                    <th>Line</th>
                    <th>Sam</th>
                    <th>David</th>
                    <th>Read</th>
                    <th>RW</th>
                    <th>ESPN</th>
                    {graded && <th>Actual</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const ss = sideFrom(r.sam, r.line);
                    const ds = sideFrom(r.david, r.line);
                    const read = ss && ds ? (ss === ds ? `both ${OU(ss)}` : "split") : "–";
                    return (
                      <tr key={r.key}>
                        <td>{`${r.player} `}<span className={s.dim}>{r.team}</span></td>
                        <td>{r.stat}</td>
                        <td className={s.num}>
                          {r.line}
                          <span className={s.dim}>{r.lineFrom === "DK" ? " DK" : ""}</span>
                        </td>
                        <td className={s.num}>{r.sam !== undefined ? `${r.sam} ${OU(ss)}` : "–"}</td>
                        <td className={s.num}>{r.david !== undefined ? `${r.david} ${OU(ds)}` : "–"}</td>
                        <td className={read.startsWith("both") ? s.pos : read === "split" ? s.neg : s.dim}>{read}</td>
                        <td className={s.num}>{r.rw ?? "–"}</td>
                        <td className={s.num}>{r.espn ?? "–"}</td>
                        {graded && (
                          <td className={s.num}>{r.actual === undefined ? "–" : r.actual === null ? "DNP" : r.actual}</td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
          <p className={`${s.ftdNote} ${s.dim}`}>
            {[
              sam ? `Sam's page saved ${whenEt(sam.capturedAt)}${sam.result ? ", graded" : ""}.` : null,
              david ? `David's board saved ${whenEt(david.capturedAt)} (his model updated ${david.updatedAt})${david.result ? ", graded" : ""}.` : null,
              "Sides in the table are read from the line shown: DraftKings' total where David has the prop, else Sam's playing book.",
              sam?.late ? `Sam's copy was read after kickoff: ${sam.late} Graded, but kept out of the system.` : null,
            ]
              .filter(Boolean)
              .join(" ")}
          </p>
        </div>
      </details>
    </li>
  );
}

/** The week turns over at 4am ET Tuesday, as on Picks, whether or not Sam has posted the new one. */
function Awaiting({ id, week, what }: { id: string; week: number; what: string }) {
  return (
    <section className={s.section} aria-labelledby={id}>
      <div className={s.sectionHead}>
        <h2 className={s.h2} id={id}>{`Week ${week} ${what}`}</h2>
      </div>
      <p className={s.calm}>
        {`Nothing saved for Week ${week} yet. Sam posts the Thursday game first and the Sunday and Monday pages on Saturday; the tracker picks them up at 8am and 6:30pm ET and before each kickoff. Week ${week - 1} is graded under Results.`}
      </p>
    </section>
  );
}

export async function PropsWeek({ season }: { season: number }) {
  const v = await load(season);
  if (!v) return <Unavailable />;
  const week = Math.max(v.week ?? 0, v.david.week ?? 0) || null;
  const cal = boardWeek("nfl", week, new Date(renderedAt())).week;
  if (week && cal && cal > week) return <Awaiting id="pp-week" week={cal} what="player props" />;
  const samGames = v.week === week ? Object.values(v.current) : [];
  const dGames = v.david.week === week ? v.david.games : [];
  const ids = [...new Set([...samGames.map((g) => g.game.slug), ...dGames.map((g) => g.gameId)])];
  if (!ids.length) return <Empty />;
  const samBy = new Map(samGames.map((g) => [g.game.slug, g]));
  const dBy = new Map(dGames.map((g) => [g.gameId, g]));
  const samMap = new Map(Object.entries(v.david.sam));
  const samOf = (p: DavidProp) => samOn(samMap, p);
  const kick = (id: string) => samBy.get(id)?.kickoff ?? dBy.get(id)?.kickoff ?? "";
  ids.sort((a, b) => kick(a).localeCompare(kick(b)) || a.localeCompare(b));
  const live = v.system.filter((e) => !e.retired);
  const now = renderedAt();
  return (
    <section className={s.section} aria-labelledby="pp-week">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="pp-week">{`Week ${week} player props`}</h2>
        <p className={s.p}>
          {`Sam's and David's prop models. Start with the props they agree on, then open a game for each model's plays side by side: Sam's are the ones his page says clear the vig, David's the ones his own 80% range puts ${PLAY_PCT}+ points above DraftKings' break-even (his board has no pick flag, so that bar is ours). Every prop both cover sits in the table under them. ${
            live.length
              ? `${live.length} slice${live.length > 1 ? "s have" : " has"} earned a place in the system; bets that fall in one are marked.`
              : "Nothing has earned a place in the system yet, so all of it is tracking, not money."
          }`}
        </p>
      </div>
      <BestBets now={now} games={dGames} samOf={samOf} record={v.david.trends.slices.find((x) => x.id === "h2h:agree")} />
      <h3 className={pp.bbH}>Game by game</h3>
      <ol className={s.ftdGames}>
        {ids.map((id) => (
          <GameCard key={id} gameId={id} sam={samBy.get(id)} david={dBy.get(id)} v={v} samOf={samOf} />
        ))}
      </ol>
    </section>
  );
}

function NbaGameCard({ saved, v }: { saved: StoredProps; v: PropsView }) {
  const g = saved.game;
  const plays = g.markets.filter(isPlay).sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0));
  const net = saved.result ? saved.result.markets.reduce((a, r) => a + (r.play?.net ?? 0), 0) : null;
  const inSystem = plays.filter((m) => systemHits(m, saved, v.active, v.graded).length).length;
  const res = new Map((saved.result?.markets ?? []).map((r) => [r.id, r]));
  return (
    <li>
      <details className={s.ftdGame}>
        <summary className={s.ftdSum}>
          <span className={s.ftdWhen}>
            <b>{`${g.away} at ${g.home}`}</b>
            <span className={s.dim}>{saved.kickoff ? whenEt(saved.kickoff) : ""}</span>
          </span>
          <span className={s.ftdPick}>
            <span className={s.ftdPickName}>{plays.length ? `${plays.length} ${plays.length === 1 ? "play" : "plays"}` : "No plays"}</span>
            <span className={`${s.dim} ${s.num}`}>{`of ${g.markets.length} props`}</span>
          </span>
          <span className={s.ftdOdds}>{plays[0] ? `Top: ${plays[0].player} ${sideWord(plays[0].side!)} ${plays[0].line} ${statShort(plays[0])}` : ""}</span>
          <span className={s.ftdFlags}>
            {net !== null && <span className={`${s.resChip} ${net > 0 ? s.resW : net < 0 ? s.resL : s.resP}`}>{u(net)}</span>}
            {net === null && inSystem > 0 && <span className={s.pill}>{`${inSystem} in system`}</span>}
            <span className={s.chev} aria-hidden>›</span>
          </span>
        </summary>
        <div className={s.ftdBody}>
          {plays.length ? (
            <ol className={s.ppList}>
              {plays.map((m) => (
                <PlayRow key={m.id} m={m} saved={saved} hits={systemHits(m, saved, v.active, v.graded)} />
              ))}
            </ol>
          ) : (
            <p className={pp.ppNone}>Sam isn&apos;t 15% off the market on any prop.</p>
          )}
          <details className={s.ppAll}>
            <summary>{`Every prop (${g.markets.length})`}</summary>
            <div className={s.tw}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Stat</th>
                    <th>Line</th>
                    <th>Sam</th>
                    <th>Play</th>
                    {saved.result && <th>Actual</th>}
                  </tr>
                </thead>
                <tbody>
                  {g.markets.map((m) => {
                    const r = res.get(m.id);
                    return (
                      <tr key={m.id}>
                        <td>{m.player}</td>
                        <td>{statShort(m)}</td>
                        <td className={s.num}>{m.line}</td>
                        <td className={s.num}>{`${m.model} ${OU(m.lean)}`}</td>
                        <td>{isPlay(m) ? sideWord(m.side!) : <span className={s.dim}>–</span>}</td>
                        {saved.result && <td className={s.num}>{r?.actual === undefined ? "–" : r.actual === null ? "DNP" : r.actual}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
          <p className={`${s.ftdNote} ${s.dim}`}>{`Sam's page saved ${whenEt(saved.capturedAt)}${saved.result ? ", graded" : ""}.`}</p>
        </div>
      </details>
    </li>
  );
}

const dayName = (d: string) => new Date(`${d}T16:00:00Z`).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "short", day: "numeric" });

export async function NbaPropsWeek({ season }: { season: number }) {
  const v = await load(season, "nba");
  if (!v) return <Unavailable />;
  // A rolling board, not a week: today's slate, anything saved for later days, and last night's results.
  const today = etDate(new Date(renderedAt()));
  const yesterday = etDate(new Date(renderedAt() - 86_400_000));
  const games = Object.values(v.current)
    .filter((g) => !g.kickoff || etDate(new Date(g.kickoff)) >= yesterday)
    .sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? ""));
  if (!Object.keys(v.current).length) return <Empty league="nba" />;
  const live = v.system.filter((e) => !e.retired);
  const byDay = new Map<string, StoredProps[]>();
  for (const g of games) {
    const day = g.kickoff ? etDate(new Date(g.kickoff)) : today;
    byDay.set(day, [...(byDay.get(day) ?? []), g]);
  }
  const order = [...byDay.keys()].filter((d) => d >= today).sort();
  const days = [...order, ...(byDay.has(yesterday) ? [yesterday] : [])];
  const label = (d: string) => (d === today ? `Today · ${dayName(d)}` : d === yesterday ? `Last night · ${dayName(d)}` : dayName(d));
  return (
    <section className={s.section} aria-labelledby="nba-pp-week">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="nba-pp-week">NBA player props</h2>
        <p className={s.p}>
          {`Sam's NBA props, saved before each tip and graded from ESPN's box score overnight. A play is a prop where Sam's projection sits 15%+ off the market's number (the middle of every book's line), bet at the best price posted on that number, never worse than -150. Today's slate is first; last night's games stay below with their results until the next day. Older games are on Results. ${
            live.length
              ? `${live.length} slice${live.length > 1 ? "s have" : " has"} earned a place in the NBA system; plays that fall in one are marked.`
              : "Nothing has earned a place in the NBA system yet, so all of it is tracking, not money."
          }`}
        </p>
      </div>
      {!byDay.has(today) && <p className={s.calm}>{"Nothing from Sam for today: his NBA props pages went behind his members paywall on October 21, so they can no longer be saved. Games he posted before then stay below and on Results."}</p>}
      {days.map((day) => (
        <div key={day}>
          <h3 className={pp.bbH}>{label(day)}</h3>
          <ol className={s.ftdGames}>
            {byDay.get(day)!.map((g) => (
              <NbaGameCard key={g.game.slug} saved={g} v={v} />
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className={s.tile}>
      <span className={`${s.tileV} ${s.num}`}>{value}</span>
      <span className={s.tileK}>{label}</span>
    </div>
  );
}

const recOf = (x: Pick<PropSlice, "w" | "l" | "p"> | undefined) => (x ? `${x.w}-${x.l}${x.p ? `-${x.p}` : ""}` : "0-0");

export async function PropsResults({ season, league = "nfl" }: { season: number; league?: League }) {
  const nba = league === "nba";
  const v = await load(season, league);
  if (!v) return <Unavailable />;
  const dt = v.david.trends;
  if (!v.graded.length && !dt.games) return <Empty league={league} graded={Object.keys(v.current).length > 0} />;
  const t = v.trends;
  const get = (id: string) => t.slices.find((x) => x.id === id);
  const dget = (id: string) => dt.slices.find((x) => x.id === id);
  const plays = v.graded.flatMap((x) =>
    x.result.markets.flatMap((r) => {
      const m = x.game.markets.find((y) => y.id === r.id);
      return m && r.play ? [{ week: x.week, slug: x.slug, game: x.game, kickoff: x.kickoff, m, r }] : [];
    }),
  );
  const h2hSam = dget("h2h:sam");
  const h2hDavid = dget("h2h:david");
  return (
    <section className={s.section} aria-labelledby="pp-results">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="pp-results">{nba ? "NBA player prop results" : "Player prop results"}</h2>
        {nba ? (
          <p className={s.p}>
            Sam&apos;s NBA props, graded the way the NFL ones are: every saved prop once its game is final, against the copy saved before tip, 1 unit risked per
            bet at the price shown, newest night first. A player who sat voids his props. Where a check counts weeks, they run Monday to Sunday.
          </p>
        ) : (
        <p className={s.p}>
          Sam and David, graded the same way: every saved prop once its game is final, against the copy saved before kickoff, 1 unit risked per bet at the price
          shown. The head to head grades both on the props they share, at the same DraftKings line and price.
        </p>
        )}
      </div>
      <div className={s.tiles}>
        <Tile value={u(get("play:all")?.units ?? 0)} label={`Sam's plays · ${recOf(get("play:all"))}`} />
        {nba ? (
          <>
            <Tile value={u(get("lean:all")?.units ?? 0)} label={`Sam's projection, every market · ${recOf(get("lean:all"))}`} />
            <Tile value={`${t.markets}`} label="props graded" />
            <Tile value={`${v.system.filter((e) => !e.retired).length}`} label="slices in the system" />
          </>
        ) : (
          <>
            <Tile value={u(dget("dplay:all")?.units ?? 0)} label={`David's plays · ${recOf(dget("dplay:all"))}`} />
            <Tile value={u(dget("h2h:agree")?.units ?? 0)} label={`Both agree · ${recOf(dget("h2h:agree"))}`} />
          </>
        )}
      </div>
      {!nba && (<>
      <div className={s.tw}>
        <table className={s.table}>
          <caption className={s.caption}>{`Head to head: ${dt.shared} shared props at DraftKings' line and price`}</caption>
          <thead>
            <tr>
              <th>Model</th>
              <th>Record</th>
              <th>Units</th>
              <th>When they split</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Sam", h2hSam, dget("h2h:split-sam")],
                ["David", h2hDavid, dget("h2h:split-david")],
              ] as const
            ).map(([who, all, sp]) => (
              <tr key={who}>
                <td>{who}</td>
                <td className={s.num}>{recOf(all)}</td>
                <td className={`${s.num} ${(all?.units ?? 0) > 0 ? s.pos : (all?.units ?? 0) < 0 ? s.neg : ""}`}>{u(all?.units ?? 0)}</td>
                <td className={s.num}>{`${recOf(sp)}, ${u(sp?.units ?? 0)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={s.tiles}>
        <Tile value={u(get("lean:all")?.units ?? 0)} label={`Sam's projection, every market · ${recOf(get("lean:all"))}`} />
        <Tile value={u(dget("dboard:all")?.units ?? 0)} label={`David's projection, every prop · ${recOf(dget("dboard:all"))}`} />
        <Tile value={`${t.markets + dt.props}`} label={`props graded · Sam ${t.markets}, David ${dt.props}`} />
      </div>
      <div className={s.tiles}>
        <Tile value={u(get("rw:all")?.units ?? 0)} label={`Rotowire's projection, Sam's markets · ${recOf(get("rw:all"))}`} />
        <Tile value={u(get("espn:all")?.units ?? 0)} label={`ESPN's projection, Sam's markets · ${recOf(get("espn:all"))}`} />
      </div>
      </>)}
      {plays.length > 0 && (
        <div className={s.tw}>
          <table className={s.table}>
            <caption className={s.caption}>Sam&apos;s plays</caption>
            <thead>
              <tr>
                <th>{nba ? "Date" : "Wk"}</th>
                <th>Player</th>
                <th>Bet</th>
                <th>Price</th>
                {!nba && <th>David</th>}
                <th>Actual</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {plays.map(({ week, slug, m, r, game: xg, kickoff }) => {
                const x = { game: xg };
                const d = v.graded.find((x) => x.slug === slug && x.week === week)?.david?.[m.id];
                const ds = d === undefined ? null : d > r.play!.line ? "over" : d < r.play!.line ? "under" : null;
                return (
                  <tr key={`${slug}|${m.id}`}>
                    <td className={s.num}>{nba ? (kickoff ? new Date(kickoff).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric" }) : "–") : week}</td>
                    <td>{m.team ? `${m.player} (${m.team})` : `${m.player} (${x.game.away} at ${x.game.home})`}</td>
                    <td>{`${sideWord(r.play!.side)} ${r.play!.line} ${statShort(m)}`}</td>
                    <td className={s.num}>{`${am(r.play!.price)} ${r.play!.book}`}</td>
                    {!nba && <td className={ds === r.play!.side ? s.pos : ds ? s.neg : s.dim}>{d === undefined ? "–" : `${d} ${ds === r.play!.side ? "agrees" : ds ? "splits" : ""}`}</td>}
                    <td className={s.num}>{r.actual}</td>
                    <td className={`${s.num} ${r.play!.outcome === "W" ? s.resW : r.play!.outcome === "L" ? s.resL : s.resP}`}>{r.play!.outcome === "P" ? "push" : u(r.play!.net)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!nba && dt.plays.length > 0 && (
        <div className={s.tw}>
          <table className={s.table}>
            <caption className={s.caption}>David&apos;s plays</caption>
            <thead>
              <tr>
                <th>Wk</th>
                <th>Player</th>
                <th>Bet</th>
                <th>Price</th>
                <th>Sam</th>
                <th>Actual</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {dt.plays.map(({ week, p, bet, actual, samProj }) => {
                const ss = samProj === undefined ? null : samProj > p.line ? "over" : samProj < p.line ? "under" : null;
                const price = bet.side === "over" ? p.over : p.under;
                return (
                  <tr key={`${week}|${p.id}`}>
                    <td className={s.num}>{week}</td>
                    <td>{`${p.player} (${p.team})`}</td>
                    <td>{`${sideWord(bet.side)} ${p.line} ${dShort[p.market]}`}</td>
                    <td className={s.num}>{price !== null ? `${am(price)} DK` : "–"}</td>
                    <td className={ss === bet.side ? s.pos : ss ? s.neg : s.dim}>{samProj === undefined ? "–" : `${samProj} ${ss === bet.side ? "agrees" : ss ? "splits" : ""}`}</td>
                    <td className={s.num}>{actual}</td>
                    <td className={`${s.num} ${bet.outcome === "W" ? s.resW : bet.outcome === "L" ? s.resL : s.resP}`}>{bet.outcome === "P" ? "push" : u(bet.net)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {dt.games > 0 && (
        <div className={s.tw}>
          <table className={s.table}>
            <caption className={s.caption}>David&apos;s board by market</caption>
            <thead>
              <tr>
                <th>Market</th>
                <th>Record</th>
                <th>Units</th>
              </tr>
            </thead>
            <tbody>
              {dt.slices
                .filter((x) => x.group === "dboard" && x.n + x.p > 0 && Object.keys(DAVID_LABEL).includes(x.id.split(":")[1]))
                .map((x) => (
                  <tr key={x.id}>
                    <td>{DAVID_LABEL[x.id.split(":")[1] as DavidMarket]}</td>
                    <td className={s.num}>{recOf(x)}</td>
                    <td className={`${s.num} ${x.units > 0 ? s.pos : x.units < 0 ? s.neg : ""}`}>{u(x.units)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const VERDICT: { [v in Verdict]: string } = {
  early: "too early",
  flat: "no edge yet",
  "lean-up": "leaning profitable",
  "lean-down": "leaning losing",
  profitable: "profitable",
  losing: "losing",
};

type SliceRow = Pick<PropSlice, "id" | "label" | "w" | "l" | "p" | "units" | "needed" | "move" | "verdict" | "z">;

function SliceTable({ title, rows, active }: { title: string; rows: SliceRow[]; active: string[] }) {
  return (
    <div className={s.tw}>
      <table className={s.table}>
        <caption className={s.caption}>{title}</caption>
        <thead>
          <tr>
            <th>Slice</th>
            <th>Record</th>
            <th>Units</th>
            <th>Wins vs needed</th>
            <th>Line move</th>
            <th>Read</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.id}>
              <td>
                {x.label}
                {active.includes(x.id) && <span className={s.pill}>system</span>}
              </td>
              <td className={s.num}>{recOf(x)}</td>
              <td className={`${s.num} ${x.units > 0 ? s.pos : x.units < 0 ? s.neg : ""}`}>{u(x.units)}</td>
              <td className={s.num}>{`${x.w} / ${x.needed.toFixed(1)}`}</td>
              <td className={`${s.num} ${x.move === null ? s.dim : x.move > 0 ? s.pos : x.move < 0 ? s.neg : ""}`}>
                {x.move === null ? "–" : `${x.move > 0 ? "+" : ""}${x.move.toFixed(2)}`}
              </td>
              <td className={x.verdict === "profitable" || x.verdict === "lean-up" ? s.pos : x.verdict === "losing" || x.verdict === "lean-down" ? s.neg : s.dim}>
                {VERDICT[x.verdict]}
                {x.z !== null && x.verdict !== "early" ? <span className={s.dim}>{` (z ${x.z.toFixed(1)})`}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function PropsResearch({ season, league = "nfl" }: { season: number; league?: League }) {
  const nba = league === "nba";
  const v = await load(season, league);
  if (!v) return <Unavailable />;
  const t = v.trends;
  const dt = v.david.trends;
  if (!v.graded.length && !dt.games) return <Empty league={league} graded={Object.keys(v.current).length > 0} />;
  const group = (g: PropSlice["group"]) => t.slices.filter((x) => x.group === g);
  const dgroup = (g: DavidSlice["group"]) => dt.slices.filter((x) => x.group === g);
  const findings = [
    ...t.findings,
    ...dt.slices
      .filter((x) => x.verdict === "profitable" || x.verdict === "losing")
      .map((x) => `${x.label}: ${recOf(x)}, ${u(x.units)}, ${x.w} wins against ${x.needed} needed to break even, so it is ${x.verdict === "profitable" ? "beating" : "losing to"} the prices.`),
  ];
  return (
    <section className={s.section} aria-labelledby="pp-research">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="pp-research">{nba ? "Where Sam's NBA props make money" : "Where the prop models make money"}</h2>
        <p className={s.p}>
          {nba ? `The NFL props' research, on Sam's NBA pages. Each row is a slice of bets settled at the saved price. "Wins vs needed" sets the wins against the wins it takes to break even at those prices. The read in each row is season to date, called profitable only at ${MIN_BETS}+ decided bets and z 1.96 or better. Whether a slice goes live is the learning block's call, on its own evidence and NBA games only. Line move is how far the consensus moved toward the bet between the first and last pregame copy.` : `Sam and David on the same footing. Each row is a slice of bets settled at the saved price. "Wins vs needed" sets the wins against the wins it takes to break even at those prices. The read in each row is season to date, called profitable only at ${MIN_BETS}+ decided bets and z 1.96 or better; with this many slices checked at once, a looser bar would crown one by luck every week. Whether a slice goes live is the learning block's call, below, and either model's slices can. Line move is how far the line moved toward the bet between the first and last pregame copy: steady positive numbers mean the market agrees after the fact, the quickest early sign of a real edge.`}
        </p>
      </div>
      {findings.length > 0 ? (
        <ul className={s.journal}>
          {findings.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : (
        <p className={s.calm}>
          {nba ? `No slice has cleared the bar yet. At about 13 props a game and up to 15 games a night, the bigger slices reach ${MIN_BETS} bets within the first couple of weeks.` : `No slice has cleared the bar yet. At about 30 markets a game for Sam and 25 for David, the bigger slices reach ${MIN_BETS} bets in a week or two; small ones take most of the season.`}
        </p>
      )}

      <LearningBlock v={v.learning} />

      {!nba && <SliceTable title="Head to head: the props both cover, both sides at DraftKings' line and price" rows={dgroup("h2h")} active={v.active} />}
      {!nba && dt.h2h.length > 0 && (
        <div className={s.tw}>
          <table className={s.table}>
            <caption className={s.caption}>Head to head: whose number was closer, average miss</caption>
            <thead>
              <tr>
                <th>Market</th>
                <th>Shared</th>
                <th>Sam</th>
                <th>David</th>
                <th>DK total</th>
                <th>Sam closer</th>
              </tr>
            </thead>
            <tbody>
              {dt.h2h.map((a) => (
                <tr key={a.market}>
                  <td>{DAVID_LABEL[a.market]}</td>
                  <td className={s.num}>{a.n}</td>
                  <td className={`${s.num} ${a.sam < a.david ? s.pos : ""}`}>{a.sam}</td>
                  <td className={`${s.num} ${a.david < a.sam ? s.pos : ""}`}>{a.david}</td>
                  <td className={s.num}>{a.line}</td>
                  <td className={s.num}>{`${Math.round((a.samCloser / a.n) * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SliceTable title="Sam's plays" rows={group("play")} active={v.active} />
      {!nba && <SliceTable title={`David's plays: est. edge ${PLAY_PCT}%+ at DraftKings`} rows={dgroup("dplay")} active={v.active} />}
      <SliceTable title="Sam's projection: the side it points to, every market" rows={group("lean")} active={v.active} />
      {!nba && <SliceTable title="David's board: the side his number points to, every prop, at DraftKings" rows={dgroup("dboard")} active={v.active} />}
      {!nba && <SliceTable title="Other projections on Sam's markets, at his playing book" rows={[...group("rw"), ...group("espn"), ...group("david")]} active={v.active} />}

      {t.accuracy.length > 0 && (
        <div className={s.tw}>
          <table className={s.table}>
            <caption className={s.caption}>Sam&apos;s markets: whose number was closer, average miss</caption>
            <thead>
              <tr>
                <th>Stat</th>
                <th>Markets</th>
                <th>Sam</th>
                {!nba && <th>David</th>}
                {!nba && <th>Rotowire</th>}
                {!nba && <th>ESPN</th>}
                <th>Market line</th>
                <th>Sam closer</th>
              </tr>
            </thead>
            <tbody>
              {t.accuracy.map((a) => (
                <tr key={a.stat}>
                  <td>{STAT_LABEL[a.stat]}</td>
                  <td className={s.num}>{a.n}</td>
                  <td className={`${s.num} ${a.model < a.market ? s.pos : ""}`}>{a.model}</td>
                  {!nba && <td className={`${s.num} ${a.david !== null && a.david < a.market ? s.pos : ""}`}>{a.david ?? "–"}</td>}
                  {!nba && <td className={`${s.num} ${a.rw !== null && a.rw < a.market ? s.pos : ""}`}>{a.rw ?? "–"}</td>}
                  {!nba && <td className={`${s.num} ${a.espn !== null && a.espn < a.market ? s.pos : ""}`}>{a.espn ?? "–"}</td>}
                  <td className={s.num}>{a.market}</td>
                  <td className={s.num}>{`${Math.round((a.closer / a.n) * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!nba && dt.accuracy.length > 0 && (
        <div className={s.tw}>
          <table className={s.table}>
            <caption className={s.caption}>David&apos;s board: his number against DraftKings&apos; total, average miss</caption>
            <thead>
              <tr>
                <th>Market</th>
                <th>Props</th>
                <th>David</th>
                <th>DK total</th>
                <th>David closer</th>
                <th>Inside his 80%</th>
              </tr>
            </thead>
            <tbody>
              {dt.accuracy.map((a) => (
                <tr key={a.market}>
                  <td>{DAVID_LABEL[a.market]}</td>
                  <td className={s.num}>{a.n}</td>
                  <td className={`${s.num} ${a.model < a.line ? s.pos : ""}`}>{a.model}</td>
                  <td className={s.num}>{a.line}</td>
                  <td className={s.num}>{`${Math.round((a.closer / a.n) * 100)}%`}</td>
                  <td className={s.num}>{a.inRange !== null ? `${Math.round(a.inRange * 100)}%` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {nba ? (
        <p className={`${s.notice} ${s.dim}`}>
          {"An NBA play is Sam's projection against the market's number: the side his number sits from the consensus (the median of every book's line), at the best price posted on that line, when he is 15%+ and at least half a unit off it and the price is -150 or better (a number comparison can't see heavy juice). His page's own pick of an off-market book is not used. The lean grades the same comparison on every prop. A player who sat (ESPN's did-not-play) voids the prop. Sources: "}
          <a href={SAM_NBA}>Sam&apos;s Models</a> NBA props pages, ESPN scoreboard and box scores.
        </p>
      ) : (
      <p className={`${s.notice} ${s.dim}`}>
        {`Sam's play is his own pick of side and book (mostly a book off the consensus, nudged by his projection at the weight his page states; receiving yards carry 0%). David's board is graded the way his number points from DraftKings' total, at DraftKings' price; his 80% range should catch about 80% of results if it is honest. His board flags no picks, so David's plays are ours: props where his range, read as a normal band, puts his chance ${PLAY_PCT}+ points above the price's break-even. If "Inside his 80%" runs well under 80%, that estimate is too generous and the bar should rise. The head to head takes every prop both cover (same game, player and stat) and grades each model's side at that same DraftKings line and price. Rotowire's projections come through Sleeper's free feed, matched by name and team; ESPN's from its fantasy projections, matched by name. A player missing from the box score voids the prop. Sources: `}
        <a href={SAM}>Sam&apos;s Models</a> props pages, <a href={DAVID_URL}>David Sasser&apos;s props board</a>, Sleeper (Rotowire), ESPN projections, odds and box scores.
      </p>
      )}
    </section>
  );
}
