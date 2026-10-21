// Our own NBA props model (lib/models/nba), the board and its record. Same
// cards and tables as Sam's board in playerprops.tsx, with our chances shown
// against DraftKings' price. Its edges are model edges, not bets, until a
// slice in our own learning section clears the gate.
import { etDate, implied, type PropMarket } from "@/lib/props/parse";
import { getOurNbaView, type OurNbaView, type OurStoredProps } from "@/lib/models/nba/store";
import { ourSliceBets, record, ourPropSlices } from "@/lib/models/learn";
import { noVig } from "@/lib/models/nba/market";
import { whenEt } from "../picks/ui";
import { LearningBlock } from "./learning";
import s from "../picks/picks.module.css";
import pp from "./props.module.css";

const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const u = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}u`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const short: { [k: string]: string } = { pts: "pts", reb: "reb", ast: "ast", threes: "threes" };
const statShort = (m: PropMarket) => (m.stat ? short[m.stat] : m.statLabel.toLowerCase());
const sideWord = (x: "over" | "under") => (x === "over" ? "Over" : "Under");
/** How many edges a card lists before "every prop". */
const TOP = 8;
const renderedAt = () => Date.now();

async function load(season: number): Promise<OurNbaView | null> {
  return getOurNbaView(season).catch(() => null);
}

function EdgeRow({ m, g }: { m: PropMarket; g: OurStoredProps }) {
  const dk = m.books[0];
  const side = m.side!;
  const price = dk[side];
  const ours = g.extra[m.id]?.[side];
  const fair = dk.over !== null && dk.under !== null ? noVig(dk.over, dk.under)[side] : null;
  const r = g.result?.markets.find((x) => x.id === m.id);
  const out = r?.play?.outcome;
  return (
    <li className={s.ppRow}>
      <div className={s.ppMain}>
        <span className={s.ppWho}>
          {`${m.player} `}
          <span className={s.dim}>{m.team}</span>
        </span>
        <span className={s.ppBet}>{`${sideWord(side)} ${m.line} ${statShort(m)}`}</span>
      </div>
      <div className={`${s.ppMeta} ${s.num}`}>
        {[
          price !== null ? `${am(price)} DraftKings` : null,
          ours !== undefined ? `our chance ${pct(ours)}` : null,
          fair !== null ? `DK ${pct(fair)} without the vig` : price !== null ? `breaks even at ${pct(implied(price))}` : null,
          `ours ${m.model}`,
          g.extra[m.id] ? `${g.extra[m.id].min} min` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      {out && r?.actual !== null && (
        <div className={s.ftdChips}>
          <span className={`${s.resChip} ${out === "W" ? s.resW : out === "L" ? s.resL : s.resP}`}>{`${out} · ${r!.actual}`}</span>
        </div>
      )}
    </li>
  );
}

function GameCard({ g }: { g: OurStoredProps }) {
  const edges = g.game.markets.filter((m) => m.clears && m.side);
  const net = g.result ? g.result.markets.reduce((a, r) => a + (r.play?.net ?? 0), 0) : null;
  const res = new Map((g.result?.markets ?? []).map((r) => [r.id, r]));
  return (
    <li>
      <details className={s.ftdGame}>
        <summary className={s.ftdSum}>
          <span className={s.ftdWhen}>
            <b>{`${g.away} at ${g.home}`}</b>
            <span className={s.dim}>{g.kickoff ? whenEt(g.kickoff) : ""}</span>
          </span>
          <span className={s.ftdPick}>
            <span className={s.ftdPickName}>{edges.length ? `${edges.length} ${edges.length === 1 ? "edge" : "edges"}` : "No edges"}</span>
            <span className={`${s.dim} ${s.num}`}>{`of ${g.game.markets.length} props`}</span>
          </span>
          <span className={s.ftdOdds}>{edges[0] ? `Top: ${edges[0].player} ${sideWord(edges[0].side!)} ${edges[0].line} ${statShort(edges[0])}` : ""}</span>
          <span className={s.ftdFlags}>
            {net !== null && <span className={`${s.resChip} ${net > 0 ? s.resW : net < 0 ? s.resL : s.resP}`}>{u(net)}</span>}
            <span className={s.chev} aria-hidden>
              ›
            </span>
          </span>
        </summary>
        <div className={s.ftdBody}>
          {edges.length ? (
            <ol className={s.ppList}>
              {edges.slice(0, TOP).map((m) => (
                <EdgeRow key={m.id} m={m} g={g} />
              ))}
            </ol>
          ) : (
            <p className={pp.ppNone}>Our chance doesn&apos;t beat DraftKings&apos; break-even on any prop.</p>
          )}
          <details className={s.ppAll}>
            <summary>{`Every prop (${g.game.markets.length})`}</summary>
            <div className={s.tw}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Stat</th>
                    <th>Line</th>
                    <th>Ours</th>
                    <th>Over</th>
                    <th>Edge</th>
                    {g.result && <th>Actual</th>}
                  </tr>
                </thead>
                <tbody>
                  {g.game.markets.map((m) => {
                    const r = res.get(m.id);
                    return (
                      <tr key={m.id}>
                        <td>{m.player}</td>
                        <td>{statShort(m)}</td>
                        <td className={s.num}>{m.line}</td>
                        <td className={s.num}>{m.model}</td>
                        <td className={s.num}>{g.extra[m.id] ? pct(g.extra[m.id].over) : "–"}</td>
                        <td className={s.num}>{m.side ? `${sideWord(m.side)} ${m.gap !== null ? `+${(m.gap * 100).toFixed(1)}` : ""}` : <span className={s.dim}>–</span>}</td>
                        {g.result && <td className={s.num}>{r?.actual === undefined ? "–" : r.actual === null ? "DNP" : r.actual}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
          <p className={`${s.ftdNote} ${s.dim}`}>{`Projected ${whenEt(g.capturedAt)} against DraftKings' lines at that time${g.result ? ", graded" : ""}.`}</p>
        </div>
      </details>
    </li>
  );
}

const dayName = (d: string) => new Date(`${d}T16:00:00Z`).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "short", day: "numeric" });

export async function OurNbaWeek({ season }: { season: number }) {
  const v = await load(season);
  if (!v) return <p className={s.calm}>Our NBA model couldn&apos;t be read just now. Try again in a minute.</p>;
  const today = etDate(new Date(renderedAt()));
  const yesterday = etDate(new Date(renderedAt() - 86_400_000));
  const byDay = new Map<string, OurStoredProps[]>();
  for (const g of v.board) {
    const day = g.kickoff ? etDate(new Date(g.kickoff)) : today;
    byDay.set(day, [...(byDay.get(day) ?? []), g]);
  }
  const days = [...[...byDay.keys()].filter((d) => d >= today).sort(), ...(byDay.has(yesterday) ? [yesterday] : [])];
  const label = (d: string) => (d === today ? `Today · ${dayName(d)}` : d === yesterday ? `Last night · ${dayName(d)}` : dayName(d));
  const live = v.learning.entries.filter((e) => e.status === "active").length;
  return (
    <section className={s.section} aria-labelledby="our-nba-week">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="our-nba-week">
          Our model
        </h2>
        <p className={s.p}>
          {`Our own projection for points, rebounds, assists and threes: minutes from recent games and last season, per-minute rates shrunk toward last season, both teams' pace, then a chance for each side of DraftKings' line. An edge is a side where our chance beats DK's break-even at its price. Tested on last season (it beat season averages and its chances were calibrated), not yet against real lines, which only started being saved on October 21, so early edges are mostly where the market knows a role change we don't. ${
            live ? `${live} slice${live > 1 ? "s are" : " is"} live in our learning section.` : "Nothing has cleared our learning gate, so none of it is a bet yet."
          }`}
        </p>
      </div>
      {!v.board.length && <p className={s.calm}>Nothing projected yet. Boards are built at each NBA capture slot once DraftKings posts player props.</p>}
      {days.map((day) => (
        <div key={day}>
          <h3 className={pp.bbH}>{label(day)}</h3>
          <ol className={s.ftdGames}>
            {byDay.get(day)!.map((g) => (
              <GameCard key={g.game.slug} g={g} />
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

export async function OurNbaResults({ season }: { season: number }) {
  const v = await load(season);
  if (!v) return null;
  const rec = (id: string) => record(ourSliceBets(v.graded, id));
  const all = rec("edge:all");
  const lean = rec("lean:all");
  const props = v.graded.reduce((a, x) => a + x.result.markets.filter((r) => r.actual !== null).length, 0);
  return (
    <section className={s.section} aria-labelledby="our-nba-results">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="our-nba-results">
          Our model: results
        </h2>
        <p className={s.p}>Every saved prop once its game is final, against the board saved before tip, 1 unit risked at DraftKings&apos; price. A player who sat voids his props.</p>
      </div>
      {v.graded.length ? (
        <>
          <div className={s.tiles}>
            <Tile value={u(all.units)} label={`Every edge · ${all.w}-${all.l}${all.p ? `-${all.p}` : ""}`} />
            <Tile value={u(lean.units)} label={`Every lean · ${lean.w}-${lean.l}${lean.p ? `-${lean.p}` : ""}`} />
            <Tile value={`${props}`} label="props graded" />
          </div>
          <div className={s.tw}>
            <table className={s.table}>
              <caption className={s.caption}>Every slice our learning section tracks</caption>
              <thead>
                <tr>
                  <th>Slice</th>
                  <th>Record</th>
                  <th>Units</th>
                </tr>
              </thead>
              <tbody>
                {ourPropSlices(["pts", "reb", "ast", "threes"]).map(([id, labelText]) => {
                  const r = rec(id);
                  return (
                    <tr key={id}>
                      <td>{labelText}</td>
                      <td className={s.num}>{`${r.w}-${r.l}${r.p ? `-${r.p}` : ""}`}</td>
                      <td className={`${s.num} ${r.units > 0 ? s.pos : r.units < 0 ? s.neg : ""}`}>{u(r.units)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className={s.calm}>Nothing graded yet. Our boards are graded from ESPN&apos;s box scores at the overnight run, about 2:30am ET.</p>
      )}
      <LearningBlock v={v.learning} />
    </section>
  );
}
