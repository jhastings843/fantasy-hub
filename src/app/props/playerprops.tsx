// Player props: Sam's prop model, saved before kickoff with Rotowire's
// projection for the same markets, graded from ESPN's box score. This week,
// results, research (the slices and the system they feed). NFL only.
import { STAT_LABEL, type PropMarket, type Side } from "@/lib/props/parse";
import { isPlay } from "@/lib/props/grade";
import { getPropsView, type PropsView, type StoredProps } from "@/lib/props/store";
import { MIN_BETS, matches, rwSide, type GradedPropsGame, type PropSlice, type Verdict } from "@/lib/props/trends";
import { whenEt } from "../picks/ui";
import s from "../picks/picks.module.css";

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
      Nothing saved yet. Sam&apos;s props pages are saved before each kickoff (with Rotowire&apos;s projection for the same players) and graded from ESPN&apos;s
      box score once final. His site only keeps the current week, so the record starts with Week 6 Sunday.
    </p>
  );
}

/** Slice ids an unsettled market's play or lean falls in, among the active system slices. */
function systemHits(m: PropMarket, saved: StoredProps, active: string[], all: GradedPropsGame[]): string[] {
  const rw = saved.rw?.[m.id];
  const espn = saved.espn?.[m.id];
  const dk = saved.dk?.[m.id];
  const pseudo = (side: Side | null) =>
    side
      ? { week: 0, slug: saved.game.slug, m, g: { id: m.id, actual: null, play: null, lean: null }, bet: { side, line: m.line, price: 0, book: "", outcome: "P" as const, net: 0, breakEven: 0 }, rw, espn, dk }
      : null;
  return active.filter((id) => {
    const side = id.startsWith("play:") ? (isPlay(m) ? m.side : null) : id.startsWith("rw:") ? rwSide(m, rw) : id.startsWith("espn:") ? rwSide(m, espn) : m.lean;
    const row = pseudo(side);
    // Favorites need the week's own game; pass it as the only list entry.
    return !!row && matches(id, row, [{ week: 0, slug: saved.game.slug, game: saved.game, result: { markets: [], void: 0 } }, ...all]);
  });
}

function PlayRow({ m, saved, hits }: { m: PropMarket; saved: StoredProps; hits: string[] }) {
  const w = m.books.find((b) => b.win);
  const price = w && m.side ? w[m.side] : null;
  const rw = saved.rw?.[m.id];
  const espn = saved.espn?.[m.id];
  const dk = saved.dk?.[m.id];
  const graded = saved.result?.markets.find((x) => x.id === m.id);
  const out = graded?.play?.outcome;
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
          rw !== undefined ? `Rotowire ${rw}` : null,
          espn !== undefined ? `ESPN ${espn}` : null,
          `market ${m.consensus}`,
          dk && dk.open !== dk.current ? `DK opened ${dk.open}` : null,
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

function GameCard({ saved, v }: { saved: StoredProps; v: PropsView }) {
  const g = saved.game;
  const plays = g.markets.filter(isPlay).sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0));
  const inSystem = plays.filter((m) => systemHits(m, saved, v.active, v.graded).length).length;
  const top = plays[0];
  const net = saved.result ? saved.result.markets.reduce((a, r) => a + (r.play?.net ?? 0), 0) : null;
  return (
    <li>
      <details className={s.ftdGame}>
        <summary className={s.ftdSum}>
          <span className={s.ftdWhen}>
            <b>{`${g.away} at ${g.home}`}</b>
            <span className={s.dim}>{`${saved.kickoff ? whenEt(saved.kickoff) : `Week ${g.week}`}${saved.late ? " · late copy" : ""}`}</span>
          </span>
          <span className={s.ftdPick}>
            <span className={s.ftdPickName}>{plays.length ? `${plays.length} play${plays.length > 1 ? "s" : ""}` : "No plays"}</span>
            <span className={`${s.dim} ${s.num}`}>{`${g.markets.length} markets`}</span>
          </span>
          <span className={`${s.ftdOdds}`}>{top ? `Top: ${top.player} ${sideWord(top.side!)} ${top.line} ${statShort(top)} (gap ${top.gap?.toFixed(3)})` : ""}</span>
          <span className={s.ftdFlags}>
            {net !== null ? (
              <span className={`${s.resChip} ${net > 0 ? s.resW : net < 0 ? s.resL : s.resP}`}>{u(net)}</span>
            ) : inSystem > 0 ? (
              <span className={s.pill}>{`${inSystem} in system`}</span>
            ) : null}
            <span className={s.chev} aria-hidden>›</span>
          </span>
        </summary>
        <div className={s.ftdBody}>
      {plays.length > 0 && (
        <ol className={s.ppList}>
          {plays.map((m) => (
            <PlayRow key={m.id} m={m} saved={saved} hits={systemHits(m, saved, v.active, v.graded)} />
          ))}
        </ol>
      )}
      <details className={s.ppAll}>
        <summary>{`Every market (${g.markets.length})`}</summary>
        <div className={s.tw}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Player</th>
                <th>Stat</th>
                <th>Sam</th>
                <th>RW</th>
                <th>ESPN</th>
                <th>Line</th>
                <th>Lean</th>
                {saved.result && <th>Actual</th>}
              </tr>
            </thead>
            <tbody>
              {g.markets.map((m) => {
                const r = saved.result?.markets.find((x) => x.id === m.id);
                return (
                  <tr key={m.id}>
                    <td>{m.player}</td>
                    <td>{statShort(m)}</td>
                    <td className={s.num}>{m.model}</td>
                    <td className={s.num}>{saved.rw?.[m.id] ?? "–"}</td>
                    <td className={s.num}>{saved.espn?.[m.id] ?? "–"}</td>
                    <td className={s.num}>{m.line}</td>
                    <td>{m.lean ? (m.lean === "over" ? "O" : "U") : "–"}</td>
                    {saved.result && (
                      <td className={`${s.num} ${r?.lean?.outcome === "W" ? s.resW : r?.lean?.outcome === "L" ? s.resL : ""}`}>{r?.actual ?? "DNP"}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
          <p className={`${s.ftdNote} ${s.dim}`}>{`Saved ${whenEt(saved.capturedAt)}${saved.result ? ", graded" : ""}.${saved.late ? ` Read after kickoff: ${saved.late} Graded, but kept out of the system.` : ""}`}</p>
        </div>
      </details>
    </li>
  );
}

export async function PropsWeek({ season }: { season: number }) {
  const v = await load(season);
  if (!v) return <Unavailable />;
  const games = Object.values(v.current).sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? "") || a.game.slug.localeCompare(b.game.slug));
  if (!games.length) return <Empty />;
  const live = v.system.filter((e) => !e.retired);
  return (
    <section className={s.section} aria-labelledby="pp-week">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="pp-week">{`Week ${v.week} player props`}</h2>
        <p className={s.p}>
          {`Sam's plays: the markets where his page says the price clears the vig, at the book he'd play. Each is graded 1 unit at that price. ${
            live.length
              ? `${live.length} slice${live.length > 1 ? "s have" : " has"} earned a place in the system; plays that fall in one are marked.`
              : "Nothing has earned a place in the system yet, so every play here is tracking, not a bet."
          }`}
        </p>
      </div>
      <ol className={s.ftdGames}>
        {games.map((g) => (
          <GameCard key={g.game.slug} saved={g} v={v} />
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

const recOf = (x: PropSlice | undefined) => (x ? `${x.w}-${x.l}${x.p ? `-${x.p}` : ""}` : "0-0");

export async function PropsResults({ season }: { season: number }) {
  const v = await load(season);
  if (!v) return <Unavailable />;
  if (!v.graded.length) return <Empty />;
  const t = v.trends;
  const get = (id: string) => t.slices.find((x) => x.id === id);
  const plays = v.graded.flatMap((x) =>
    x.result.markets.flatMap((r) => {
      const m = x.game.markets.find((y) => y.id === r.id);
      return m && r.play ? [{ week: x.week, slug: x.slug, game: x.game, m, r }] : [];
    }),
  );
  return (
    <section className={s.section} aria-labelledby="pp-results">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="pp-results">Player prop results</h2>
        <p className={s.p}>Every saved market once its game is final, against the copy saved before kickoff. 1 unit risked per bet at the price the page showed.</p>
      </div>
      <div className={s.tiles}>
        <Tile value={`${t.markets}`} label={`markets graded · ${v.graded.length} games`} />
        <Tile value={u(get("play:all")?.units ?? 0)} label={`Sam's plays · ${recOf(get("play:all"))}`} />
        <Tile value={u(get("lean:all")?.units ?? 0)} label={`Sam's projection, every market · ${recOf(get("lean:all"))}`} />
        <Tile value={u(get("rw:all")?.units ?? 0)} label={`Rotowire's projection · ${recOf(get("rw:all"))}`} />
        <Tile value={u(get("espn:all")?.units ?? 0)} label={`ESPN's projection · ${recOf(get("espn:all"))}`} />
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
                <th>Actual</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {plays.map(({ week, slug, m, r }) => (
                <tr key={`${slug}|${m.id}`}>
                  <td className={s.num}>{week}</td>
                  <td>{`${m.player} (${m.team})`}</td>
                  <td>{`${sideWord(r.play!.side)} ${r.play!.line} ${statShort(m)}`}</td>
                  <td className={s.num}>{`${am(r.play!.price)} ${r.play!.book}`}</td>
                  <td className={s.num}>{r.actual}</td>
                  <td className={`${s.num} ${r.play!.outcome === "W" ? s.resW : r.play!.outcome === "L" ? s.resL : s.resP}`}>{r.play!.outcome === "P" ? "push" : u(r.play!.net)}</td>
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

function SliceTable({ title, rows, active }: { title: string; rows: PropSlice[]; active: string[] }) {
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
  if (!v.graded.length) return <Empty />;
  const t = v.trends;
  const group = (g: PropSlice["group"]) => t.slices.filter((x) => x.group === g);
  return (
    <section className={s.section} aria-labelledby="pp-research">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="pp-research">Where the prop models make money</h2>
        <p className={s.p}>
          {`Each row is a slice of bets settled at the saved price. "Wins vs needed" sets the wins against the wins it takes to break even at those prices. A slice is called profitable only at ${MIN_BETS}+ decided bets and z 1.96 or better; with this many slices checked at once, a looser bar would crown one by luck every week. Line move is how far the consensus moved toward the bet between the first and last pregame copy: steady positive numbers mean the market agrees after the fact, the quickest early sign of a real edge.`}
        </p>
      </div>
      {t.findings.length > 0 ? (
        <ul className={s.journal}>
          {t.findings.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : (
        <p className={s.calm}>
          {`No slice has cleared the bar yet. At about 30 markets a game, the bigger slices reach ${MIN_BETS} bets in a week or two; small ones take most of the season.`}
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

      <SliceTable title="Sam's plays" rows={group("play")} active={v.active} />
      <SliceTable title="Projection only: the side each number points to, every market" rows={[...group("lean"), ...group("rw"), ...group("espn")]} active={v.active} />

      {t.accuracy.length > 0 && (
        <div className={s.tw}>
          <table className={s.table}>
            <caption className={s.caption}>Whose number was closer: average miss</caption>
            <thead>
              <tr>
                <th>Stat</th>
                <th>Markets</th>
                <th>Sam</th>
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
      <p className={`${s.notice} ${s.dim}`}>
        {"Sam's play is his own pick of side and book (mostly a book off the consensus, nudged by his projection at the weight his page states; receiving yards carry 0%). The projection rows ignore that and bet the way the number points, at the same book's price. Rotowire's projections come through Sleeper's free feed, matched by name and team; ESPN's from its fantasy projections, matched by name. DraftKings' opening line comes from ESPN's odds feed; the line-move slices compare it with DraftKings' last pregame line. A player missing from the box score voids the market. Sources: "}
        <a href={SAM}>Sam&apos;s Models</a> props pages, Sleeper (Rotowire), ESPN projections, odds and box scores.
      </p>
    </section>
  );
}
