// Player props: Sam's and David Sasser's prop models, side by side the way
// Picks treats them. Both saved before kickoff (with Rotowire's and ESPN's
// projections alongside), graded from ESPN's box score, and compared head to
// head at the same DraftKings line where both cover a prop. This week,
// results, research. NFL only.
import { STAT_LABEL, type PropMarket, type Side } from "@/lib/props/parse";
import { isPlay, nameKey } from "@/lib/props/grade";
import { getPropsView, type PropsView, type StoredProps } from "@/lib/props/store";
import { MIN_BETS, matches, rwSide, type GradedPropsGame, type PropSlice, type Verdict } from "@/lib/props/trends";
import { DAVID_LABEL, DAVID_URL, davidSide, davidSliceSide, samOn, type DavidGame, type DavidGraded, type DavidMarket, type DavidProp, type DavidSlice } from "@/lib/props/david";
import { whenEt } from "../picks/ui";
import s from "../picks/picks.module.css";
import pp from "./props.module.css";

const SAM = "https://samthemodelman.smmodel.workers.dev/nfl/";
const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const u = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}u`;
const short: { [k: string]: string } = { pass_yds: "pass yds", rush_yds: "rush yds", rec_yds: "rec yds", rec: "rec" };
const statShort = (m: PropMarket) => (m.stat ? short[m.stat] : m.statLabel.toLowerCase());
const sideWord = (x: Side) => (x === "over" ? "Over" : "Under");

async function load(season: number): Promise<PropsView | null> {
  return getPropsView(season).catch(() => null);
}

function Unavailable() {
  return <p className={s.calm}>The props tracker couldn&apos;t be read just now. Try again in a minute.</p>;
}
function Empty() {
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
    if (id.startsWith("dboard:") || id.startsWith("h2h:")) return false;
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
  active.filter((id) => (id.startsWith("dboard:") || id.startsWith("h2h:")) && davidSliceSide(id, p, samProj) !== null);

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
          m.gap !== null ? `gap ${m.gap.toFixed(3)}` : null,
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
/** How far his number sits from the total, measured against his own 80% range (so a 0.5 rushing line doesn't top the list). */
const dReach = (p: DavidProp) => Math.abs(p.projection - p.line) / (p.lower !== null && p.upper !== null && p.upper > p.lower ? p.upper - p.lower : Math.max(p.line, 1));
/** David's top edges shown per game; the rest sit in the full table. */
const DAVID_TOP = 6;
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

function GameCard({ gameId, sam, david, v, samOf }: { gameId: string; sam?: StoredProps; david?: DavidGame; v: PropsView; samOf: (p: DavidProp) => number | undefined }) {
  const [, , away, home] = gameId.split("_");
  const kickoff = sam?.kickoff ?? david?.kickoff;
  const plays = sam ? sam.game.markets.filter(isPlay).sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0)) : [];
  const dProps = david ? david.props.filter((p) => davidSide(p)).sort((a, b) => dReach(b) - dReach(a)) : [];
  const dRes = new Map((david?.result ?? []).map((r) => [r.id, r]));
  const shared = (david?.props ?? []).filter((p) => samOf(p) !== undefined);
  const agreeN = shared.filter((p) => davidSide(p) && sideFrom(samOf(p), p.line) === davidSide(p)).length;
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
            <span className={s.ftdPickName}>{`Sam ${sam ? plays.length : "–"} · David ${david ? dProps.length : "–"}`}</span>
            <span className={`${s.dim} ${s.num}`}>{sam ? `${plays.length === 1 ? "play" : "plays"} · props` : "plays · props"}</span>
          </span>
          <span className={s.ftdOdds}>
            {shared.length ? `Agree on ${agreeN} of ${shared.length} shared props` : sam && david ? "No props in common" : sam ? "David hasn't posted this game" : "Sam's page not saved yet"}
          </span>
          <span className={s.ftdFlags}>
            {samNet !== null && <span className={`${s.resChip} ${samNet > 0 ? s.resW : samNet < 0 ? s.resL : s.resP}`}>{`Sam ${u(samNet)}`}</span>}
            {dNet !== null && <span className={`${s.resChip} ${dNet > 0 ? s.resW : dNet < 0 ? s.resL : s.resP}`}>{`David ${u(dNet)}`}</span>}
            {samNet === null && dNet === null && inSystem > 0 && <span className={s.pill}>{`${inSystem} in system`}</span>}
            <span className={s.chev} aria-hidden>›</span>
          </span>
        </summary>
        <div className={s.ftdBody}>
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
                <span>David&apos;s biggest edges</span>
                <span className={s.dim}>{david ? `${david.props.length} props` : ""}</span>
              </div>
              {dProps.length ? (
                <ol className={s.ppList}>
                  {dProps.slice(0, DAVID_TOP).map((p) => (
                    <DavidRow key={p.id} p={p} samProj={samOf(p)} result={dRes.get(p.id)} hits={davidHits(p, samOf(p), v.active)} />
                  ))}
                </ol>
              ) : (
                <p className={pp.ppNone}>{david ? "No edges on his board." : "Not on David's board (his board drops a game at kickoff)."}</p>
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

export async function PropsWeek({ season }: { season: number }) {
  const v = await load(season);
  if (!v) return <Unavailable />;
  const week = Math.max(v.week ?? 0, v.david.week ?? 0) || null;
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
  return (
    <section className={s.section} aria-labelledby="pp-week">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="pp-week">{`Week ${week} player props`}</h2>
        <p className={s.p}>
          {`Sam and David, game by game. Sam's plays are the markets where his page says the price clears the vig, at the book he'd play. David's edges are where his projection sits furthest from DraftKings' total, measured against his own 80% range; every prop on his board is graded the way his number points, at DraftKings' price. Where both cover a prop, both sides are also graded at the same DraftKings line, so the two compare like for like. ${
            live.length
              ? `${live.length} slice${live.length > 1 ? "s have" : " has"} earned a place in the system; bets that fall in one are marked.`
              : "Nothing has earned a place in the system yet, so every bet here is tracking, not money."
          }`}
        </p>
      </div>
      <ol className={s.ftdGames}>
        {ids.map((id) => (
          <GameCard key={id} gameId={id} sam={samBy.get(id)} david={dBy.get(id)} v={v} samOf={samOf} />
        ))}
      </ol>
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

export async function PropsResults({ season }: { season: number }) {
  const v = await load(season);
  if (!v) return <Unavailable />;
  const dt = v.david.trends;
  if (!v.graded.length && !dt.games) return <Empty />;
  const t = v.trends;
  const get = (id: string) => t.slices.find((x) => x.id === id);
  const dget = (id: string) => dt.slices.find((x) => x.id === id);
  const plays = v.graded.flatMap((x) =>
    x.result.markets.flatMap((r) => {
      const m = x.game.markets.find((y) => y.id === r.id);
      return m && r.play ? [{ week: x.week, slug: x.slug, game: x.game, m, r }] : [];
    }),
  );
  const h2hSam = dget("h2h:sam");
  const h2hDavid = dget("h2h:david");
  return (
    <section className={s.section} aria-labelledby="pp-results">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="pp-results">Player prop results</h2>
        <p className={s.p}>
          Sam and David, graded the same way: every saved prop once its game is final, against the copy saved before kickoff, 1 unit risked per bet at the price
          shown. The head to head grades both on the props they share, at the same DraftKings line and price.
        </p>
      </div>
      <div className={s.tiles}>
        <Tile value={u(get("play:all")?.units ?? 0)} label={`Sam's plays · ${recOf(get("play:all"))}`} />
        <Tile value={u(get("lean:all")?.units ?? 0)} label={`Sam's projection, every market · ${recOf(get("lean:all"))}`} />
        <Tile value={u(dget("dboard:all")?.units ?? 0)} label={`David's board, every prop · ${recOf(dget("dboard:all"))}`} />
        <Tile value={u(dget("h2h:agree")?.units ?? 0)} label={`Both agree · ${recOf(dget("h2h:agree"))}`} />
      </div>
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
        <Tile value={`${t.markets + dt.props}`} label={`props graded · Sam ${t.markets}, David ${dt.props}`} />
        <Tile value={u(get("rw:all")?.units ?? 0)} label={`Rotowire's projection, Sam's markets · ${recOf(get("rw:all"))}`} />
        <Tile value={u(get("espn:all")?.units ?? 0)} label={`ESPN's projection, Sam's markets · ${recOf(get("espn:all"))}`} />
      </div>
      {plays.length > 0 && (
        <div className={s.tw}>
          <table className={s.table}>
            <caption className={s.caption}>Sam&apos;s plays</caption>
            <thead>
              <tr>
                <th>Wk</th>
                <th>Player</th>
                <th>Bet</th>
                <th>Price</th>
                <th>David</th>
                <th>Actual</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {plays.map(({ week, slug, m, r }) => {
                const d = v.graded.find((x) => x.slug === slug && x.week === week)?.david?.[m.id];
                const ds = d === undefined ? null : d > r.play!.line ? "over" : d < r.play!.line ? "under" : null;
                return (
                  <tr key={`${slug}|${m.id}`}>
                    <td className={s.num}>{week}</td>
                    <td>{`${m.player} (${m.team})`}</td>
                    <td>{`${sideWord(r.play!.side)} ${r.play!.line} ${statShort(m)}`}</td>
                    <td className={s.num}>{`${am(r.play!.price)} ${r.play!.book}`}</td>
                    <td className={ds === r.play!.side ? s.pos : ds ? s.neg : s.dim}>{d === undefined ? "–" : `${d} ${ds === r.play!.side ? "agrees" : ds ? "splits" : ""}`}</td>
                    <td className={s.num}>{r.actual}</td>
                    <td className={`${s.num} ${r.play!.outcome === "W" ? s.resW : r.play!.outcome === "L" ? s.resL : s.resP}`}>{r.play!.outcome === "P" ? "push" : u(r.play!.net)}</td>
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

export async function PropsResearch({ season }: { season: number }) {
  const v = await load(season);
  if (!v) return <Unavailable />;
  const t = v.trends;
  const dt = v.david.trends;
  if (!v.graded.length && !dt.games) return <Empty />;
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
        <h2 className={s.h2} id="pp-research">Where the prop models make money</h2>
        <p className={s.p}>
          {`Sam and David on the same footing. Each row is a slice of bets settled at the saved price. "Wins vs needed" sets the wins against the wins it takes to break even at those prices. A slice is called profitable only at ${MIN_BETS}+ decided bets and z 1.96 or better; with this many slices checked at once, a looser bar would crown one by luck every week. Either model's slices can earn a place in the system. Line move is how far the line moved toward the bet between the first and last pregame copy: steady positive numbers mean the market agrees after the fact, the quickest early sign of a real edge.`}
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
          {`No slice has cleared the bar yet. At about 30 markets a game for Sam and 25 for David, the bigger slices reach ${MIN_BETS} bets in a week or two; small ones take most of the season.`}
        </p>
      )}

      <div className={s.tw}>
        <table className={s.table}>
          <caption className={s.caption}>The system: slices that earned a place, money counted only from the week after</caption>
          <thead>
            <tr>
              <th>Slice</th>
              <th>Since</th>
              <th>Record since</th>
              <th>Units since</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {v.system.length ? (
              v.system.map((e) => (
                <tr key={e.id}>
                  <td>{e.label}</td>
                  <td className={s.num}>{`Wk ${e.since}`}</td>
                  <td className={s.num}>{`${e.w}-${e.l}${e.p ? `-${e.p}` : ""}`}</td>
                  <td className={`${s.num} ${e.units > 0 ? s.pos : e.units < 0 ? s.neg : ""}`}>{u(e.units)}</td>
                  <td className={e.retired ? s.neg : s.pos}>{e.retired ? `retired Wk ${e.retired.week}` : "active"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className={s.dim}>
                  Empty. A slice joins when its record through last week clears the bar, and leaves when its full record falls back under z 1.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <SliceTable title="Head to head: the props both cover, both sides at DraftKings' line and price" rows={dgroup("h2h")} active={v.active} />
      {dt.h2h.length > 0 && (
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
      <SliceTable title="Sam's projection: the side it points to, every market" rows={group("lean")} active={v.active} />
      <SliceTable title="David's board: the side his number points to, every prop, at DraftKings" rows={dgroup("dboard")} active={v.active} />
      <SliceTable title="Other projections on Sam's markets, at his playing book" rows={[...group("rw"), ...group("espn"), ...group("david")]} active={v.active} />

      {t.accuracy.length > 0 && (
        <div className={s.tw}>
          <table className={s.table}>
            <caption className={s.caption}>Sam&apos;s markets: whose number was closer, average miss</caption>
            <thead>
              <tr>
                <th>Stat</th>
                <th>Markets</th>
                <th>Sam</th>
                <th>David</th>
                <th>Rotowire</th>
                <th>ESPN</th>
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
                  <td className={`${s.num} ${a.david !== null && a.david < a.market ? s.pos : ""}`}>{a.david ?? "–"}</td>
                  <td className={`${s.num} ${a.rw !== null && a.rw < a.market ? s.pos : ""}`}>{a.rw ?? "–"}</td>
                  <td className={`${s.num} ${a.espn !== null && a.espn < a.market ? s.pos : ""}`}>{a.espn ?? "–"}</td>
                  <td className={s.num}>{a.market}</td>
                  <td className={s.num}>{`${Math.round((a.closer / a.n) * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dt.accuracy.length > 0 && (
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
      <p className={`${s.notice} ${s.dim}`}>
        {"Sam's play is his own pick of side and book (mostly a book off the consensus, nudged by his projection at the weight his page states; receiving yards carry 0%). David's board is graded the way his number points from DraftKings' total, at DraftKings' price; his 80% range should catch about 80% of results if it is honest. The head to head takes every prop both cover (same game, player and stat) and grades each model's side at that same DraftKings line and price. Rotowire's projections come through Sleeper's free feed, matched by name and team; ESPN's from its fantasy projections, matched by name. A player missing from the box score voids the prop. Sources: "}
        <a href={SAM}>Sam&apos;s Models</a> props pages, <a href={DAVID_URL}>David Sasser&apos;s props board</a>, Sleeper (Rotowire), ESPN projections, odds and box scores.
      </p>
    </section>
  );
}
