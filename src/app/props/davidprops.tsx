// David Sasser's NFL props board on its own (Sam's props went behind his
// paywall on 2026-10-21 and his record is no longer shown): this week's
// plays, his results, and where his board makes money. Saved before kickoff
// and graded from ESPN's box score by lib/props/store.ts, as before.
import { getPropsView, type PropsView } from "@/lib/props/store";
import { MIN_BETS, type Verdict } from "@/lib/props/trends";
import { DAVID_LABEL, DAVID_PLAY_EDGE, DAVID_URL, davidEdge, davidSide, davidSliceSide, isDavidPlay, isDavidSlice, type DavidGame, type DavidGraded, type DavidMarket, type DavidProp, type DavidSlice } from "@/lib/props/david";
import type { SectionView } from "@/lib/learning/engine";
import { whenEt } from "../picks/ui";
import { LearningBlock } from "./learning";
import { Tile } from "./ournba";
import { updated } from "./updated";
import s from "../picks/picks.module.css";
import pp from "./props.module.css";

const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const u = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}u`;
const sideWord = (x: "over" | "under") => (x === "over" ? "Over" : "Under");
const dShort: { [k: string]: string } = {
  passing_yards: "pass yds",
  pass_attempts: "pass att",
  rushing_yards: "rush yds",
  rush_attempts: "rush att",
  receiving_yards: "rec yds",
  receptions: "rec",
};
const PLAY_PCT = Math.round(DAVID_PLAY_EDGE * 100);
const recOf = (x: { w: number; l: number; p: number } | undefined) => (x ? `${x.w}-${x.l}${x.p ? `-${x.p}` : ""}` : "0-0");
/** David's own slices: his plays and his whole board (the head to head with Sam is left out). */
const isDavidOnly = (id: string) => (id.startsWith("dplay:") || id.startsWith("dboard:")) && !id.includes("sam");

async function load(season: number): Promise<PropsView | null> {
  return getPropsView(season).catch(() => null);
}

/** The NFL props learning section, David's slices only. */
function davidLearning(v: SectionView): SectionView {
  return { ...v, entries: v.entries.filter((e) => isDavidOnly(e.id)), journal: v.journal.filter((j) => !/\bSam\b/.test(j.text)) };
}

function DavidRow({ p, result, hits }: { p: DavidProp; result: DavidGraded | undefined; hits: string[] }) {
  const side = davidSide(p)!;
  const price = side === "over" ? p.over : p.under;
  const out = result?.outcome;
  return (
    <li className={`${s.ppRow} ${hits.length ? s.ppSys : ""}`}>
      <div className={s.ppMain}>
        <span className={s.ppWho}>
          {`${p.player} `}
          <span className={s.dim}>{p.team}</span>
        </span>
        <span className={s.ppBet}>{`${sideWord(side)} ${p.line} ${dShort[p.market]}`}</span>
      </div>
      <div className={`${s.ppMeta} ${s.num}`}>
        {[
          price !== null ? `${am(price)} DraftKings` : null,
          davidEdge(p) !== null ? `est. edge ${Math.round(davidEdge(p)! * 100)}%` : null,
          `David ${p.projection}`,
          p.lower !== null && p.upper !== null ? `80% ${p.lower} to ${p.upper}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      {(hits.length > 0 || out) && (
        <div className={s.ftdChips}>
          {hits.length > 0 && <span className={s.pill}>in the system</span>}
          {out && result?.actual !== null && <span className={`${s.resChip} ${out === "W" ? s.resW : out === "L" ? s.resL : s.resP}`}>{`${out} · ${result!.actual}`}</span>}
        </div>
      )}
    </li>
  );
}

function DavidCard({ g, active }: { g: DavidGame; active: string[] }) {
  const [, , away, home] = g.gameId.split("_");
  const plays = g.props.filter(isDavidPlay).sort((a, b) => davidEdge(b)! - davidEdge(a)!);
  const res = new Map((g.result ?? []).map((r) => [r.id, r]));
  const net = g.result ? g.result.reduce((a, r) => a + r.net, 0) : null;
  const hits = (p: DavidProp) => active.filter((id) => isDavidSlice(id) && isDavidOnly(id) && davidSliceSide(id, p, undefined) !== null);
  return (
    <li>
      <details className={s.ftdGame}>
        <summary className={s.ftdSum}>
          <span className={s.ftdWhen}>
            <b>{`${away} at ${home}`}</b>
            <span className={s.dim}>{whenEt(g.kickoff)}</span>
          </span>
          <span className={s.ftdPick}>
            <span className={s.ftdPickName}>{plays.length ? `${plays.length} ${plays.length === 1 ? "play" : "plays"}` : "No plays"}</span>
            <span className={`${s.dim} ${s.num}`}>{`of ${g.props.length} props`}</span>
          </span>
          <span className={s.ftdOdds}>{plays[0] ? `Top: ${plays[0].player} ${sideWord(davidSide(plays[0])!)} ${plays[0].line} ${dShort[plays[0].market]}` : ""}</span>
          <span className={s.ftdFlags}>
            {net !== null && <span className={`${s.resChip} ${net > 0 ? s.resW : net < 0 ? s.resL : s.resP}`}>{u(net)}</span>}
            <span className={s.chev} aria-hidden>
              ›
            </span>
          </span>
        </summary>
        <div className={s.ftdBody}>
          {plays.length ? (
            <ol className={s.ppList}>
              {plays.map((p) => (
                <DavidRow key={p.id} p={p} result={res.get(p.id)} hits={hits(p)} />
              ))}
            </ol>
          ) : (
            <p className={pp.ppNone}>{`No prop on his board reaches a ${PLAY_PCT}% estimated edge.`}</p>
          )}
          <details className={s.ppAll}>
            <summary>{`Every prop (${g.props.length})`}</summary>
            <div className={s.tw}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Stat</th>
                    <th>DK line</th>
                    <th>David</th>
                    {g.result && <th>Actual</th>}
                  </tr>
                </thead>
                <tbody>
                  {g.props.map((p) => {
                    const r = res.get(p.id);
                    return (
                      <tr key={p.id}>
                        <td>
                          {`${p.player} `}
                          <span className={s.dim}>{p.team}</span>
                        </td>
                        <td>{dShort[p.market]}</td>
                        <td className={s.num}>{p.line}</td>
                        <td className={s.num}>{p.projection}</td>
                        {g.result && <td className={s.num}>{r?.actual === undefined || r.actual === null ? "–" : r.actual}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
          <p className={`${s.ftdNote} ${s.dim}`}>{`David's board saved ${whenEt(g.capturedAt)} (his model updated ${g.updatedAt})${g.result ? ", graded" : ""}.`}</p>
        </div>
      </details>
    </li>
  );
}

export async function DavidWeek({ season }: { season: number }) {
  const v = await load(season);
  if (!v) return <p className={s.calm}>David&apos;s board couldn&apos;t be read just now. Try again in a minute.</p>;
  const games = [...v.david.games].sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.gameId.localeCompare(b.gameId));
  return (
    <section className={s.section} aria-labelledby="david-week">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="david-week">{`David's board${v.david.week ? ` · Week ${v.david.week}` : ""}`}</h2>
        <p className={s.p}>{`David Sasser's projections against DraftKings, saved before kickoff. A play is ${PLAY_PCT}+ points of estimated edge. ${updated(games.map((g) => g.capturedAt))}`}</p>
      </div>
      {games.length ? (
        <ol className={s.ftdGames}>
          {games.map((g) => (
            <DavidCard key={g.gameId} g={g} active={v.active} />
          ))}
        </ol>
      ) : (
        <p className={s.calm}>Nothing on David&apos;s board saved yet this week. It is saved at each NFL capture slot.</p>
      )}
    </section>
  );
}

export async function DavidResults({ season }: { season: number }) {
  const v = await load(season);
  if (!v) return null;
  const dt = v.david.trends;
  const dget = (id: string) => dt.slices.find((x) => x.id === id);
  return (
    <section className={s.section} aria-labelledby="david-results">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="david-results">
          David&apos;s results
        </h2>
        <p className={s.p}>{`Every saved prop graded once final, 1 unit per bet at DraftKings' price. ${updated(dt.plays.map((x) => x.p.kickoff), "Graded through")}`}</p>
      </div>
      {dt.games ? (
        <>
          <div className={s.tiles}>
            <Tile value={u(dget("dplay:all")?.units ?? 0)} label={`David's plays · ${recOf(dget("dplay:all"))}`} />
            <Tile value={u(dget("dboard:all")?.units ?? 0)} label={`His projection, every prop · ${recOf(dget("dboard:all"))}`} />
            <Tile value={`${dt.props}`} label="props graded" />
          </div>
          {dt.plays.length > 0 && (
            <div className={s.tw}>
              <table className={s.table}>
                <caption className={s.caption}>David&apos;s plays</caption>
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
                  {dt.plays.map(({ week, p, bet, actual }) => {
                    const price = bet.side === "over" ? p.over : p.under;
                    return (
                      <tr key={`${week}|${p.id}`}>
                        <td className={s.num}>{week}</td>
                        <td>{`${p.player} (${p.team})`}</td>
                        <td>{`${sideWord(bet.side)} ${p.line} ${dShort[p.market]}`}</td>
                        <td className={s.num}>{price !== null ? `${am(price)} DK` : "–"}</td>
                        <td className={s.num}>{actual}</td>
                        <td className={`${s.num} ${bet.outcome === "W" ? s.resW : bet.outcome === "L" ? s.resL : s.resP}`}>{bet.outcome === "P" ? "push" : u(bet.net)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
        </>
      ) : (
        <p className={s.calm}>Nothing of David&apos;s graded yet.</p>
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

function SliceTable({ title, rows, active }: { title: string; rows: DavidSlice[]; active: string[] }) {
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
              <td className={`${s.num} ${x.move === null ? s.dim : x.move > 0 ? s.pos : x.move < 0 ? s.neg : ""}`}>{x.move === null ? "–" : `${x.move > 0 ? "+" : ""}${x.move.toFixed(2)}`}</td>
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

export async function DavidResearch({ season }: { season: number }) {
  const v = await load(season);
  if (!v) return <p className={s.calm}>David&apos;s board couldn&apos;t be read just now. Try again in a minute.</p>;
  const dt = v.david.trends;
  const group = (g: DavidSlice["group"]) => dt.slices.filter((x) => x.group === g && isDavidOnly(x.id));
  const findings = dt.slices
    .filter((x) => isDavidOnly(x.id) && (x.verdict === "profitable" || x.verdict === "losing"))
    .map((x) => `${x.label}: ${recOf(x)}, ${u(x.units)}, ${x.w} wins against ${x.needed} needed to break even, so it is ${x.verdict === "profitable" ? "beating" : "losing to"} the prices.`);
  return (
    <section className={s.section} aria-labelledby="david-research">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="david-research">
          Where David&apos;s board makes money
        </h2>
        <p className={s.p}>{`Each slice's record at DraftKings' saved prices; a slice is called profitable at ${MIN_BETS}+ bets and z 1.96.`}</p>
      </div>
      {findings.length > 0 ? (
        <ul className={s.journal}>
          {findings.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : (
        <p className={s.calm}>No slice of David&apos;s has cleared the bar yet.</p>
      )}
      <LearningBlock v={davidLearning(v.learning)} />
      <SliceTable title={`David's plays: est. edge ${PLAY_PCT}%+ at DraftKings`} rows={group("dplay")} active={v.active} />
      <SliceTable title="David's board: the side his number points to, every prop, at DraftKings" rows={group("dboard")} active={v.active} />
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
        {`David's board is graded the way his number points from DraftKings' total, at DraftKings' price; his 80% range should catch about 80% of results if it is honest. His board flags no picks, so David's plays are ours: props where his range, read as a normal band, puts his chance ${PLAY_PCT}+ points above the price's break-even. A player missing from the box score voids the prop. Source: `}
        <a href={DAVID_URL}>David Sasser&apos;s props board</a>, ESPN box scores.
      </p>
    </section>
  );
}
