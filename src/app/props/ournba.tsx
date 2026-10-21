// Our own NBA props model (lib/models/nba), the board and its record. Same
// cards and tables as Sam's board in playerprops.tsx, with our chances shown
// against DraftKings' price. Its edges are model edges, not bets, until a
// slice in our own learning section clears the gate.
import { updated } from "./updated";
import { etDate, implied, type PropMarket } from "@/lib/props/parse";
import type { StoredProps } from "@/lib/props/store";
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
const short: { [k: string]: string } = { pts: "pts", reb: "reb", ast: "ast", threes: "threes", pass_yds: "pass yds", rush_yds: "rush yds", rec_yds: "rec yds", rec: "rec" };

/** A saved board from any of our props models (NBA or NFL). */
export type OurBoard = StoredProps & {
  extra: { [id: string]: { over: number; under: number; min?: number; median?: number; price?: "espn" | "odds-api" | "david" | "assumed" } };
  away: string;
  home: string;
};
const statShort = (m: PropMarket) => (m.stat ? short[m.stat] : m.statLabel.toLowerCase());
const sideWord = (x: "over" | "under") => (x === "over" ? "Over" : "Under");
/** How many edges a card lists before "every prop". */
const TOP = 8;
const renderedAt = () => Date.now();

async function load(season: number): Promise<OurNbaView | null> {
  return getOurNbaView(season).catch(() => null);
}

function EdgeRow({ m, g }: { m: PropMarket; g: OurBoard }) {
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
          price !== null ? `${am(price)} DraftKings${g.extra[m.id]?.price === "assumed" ? " (assumed, no price posted)" : g.extra[m.id]?.price === "david" ? " (via David's board)" : g.extra[m.id]?.price === "odds-api" ? " (game-day morning, via The Odds API)" : ""}` : null,
          ours !== undefined ? `our chance ${pct(ours)}` : null,
          fair !== null ? `DK ${pct(fair)} without the vig` : price !== null ? `breaks even at ${pct(implied(price))}` : null,
          g.extra[m.id]?.median !== undefined && m.stat !== "rec" ? `our median ${m.model}` : `ours ${m.model}`,
          g.extra[m.id]?.min !== undefined ? `${g.extra[m.id].min} min` : null,
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

export function GameCard({ g }: { g: OurBoard }) {
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
        <p className={s.p}>{`Our projection for points, rebounds, assists and threes against DraftKings' lines; ${live ? `${live} slice${live > 1 ? "s" : ""} live` : "tracking only until a slice clears the learning gate"}. ${updated(v.board.map((g) => g.capturedAt))}`}</p>
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

export function Tile({ value, label }: { value: string; label: string }) {
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

function FbCard({ g }: { g: OurStoredProps }) {
  const b = g.fb!;
  const edges = b.players.filter((x) => x.edge);
  const tipTeam = b.tip >= 0.5 ? b.home : b.away;
  const res = b.result;
  const net = res !== undefined ? edges.reduce((a, x) => a + (res?.player === x.id ? (x.price! > 0 ? x.price! / 100 : 100 / -x.price!) : -1), 0) : null;
  return (
    <li>
      <details className={s.ftdGame}>
        <summary className={s.ftdSum}>
          <span className={s.ftdWhen}>
            <b>{`${b.away} at ${b.home}`}</b>
            <span className={s.dim}>{g.kickoff ? whenEt(g.kickoff) : ""}</span>
          </span>
          <span className={s.ftdPick}>
            <span className={s.ftdPickName}>{`${b.players[0].name} ${pct(b.players[0].p)}`}</span>
            <span className={`${s.dim} ${s.num}`}>{`tip: ${tipTeam} ${pct(Math.max(b.tip, 1 - b.tip))}`}</span>
          </span>
          <span className={s.ftdOdds}>{edges.length ? `${edges.length} ${edges.length === 1 ? "edge" : "edges"}` : "No edges"}</span>
          <span className={s.ftdFlags}>
            {net !== null && edges.length > 0 && <span className={`${s.resChip} ${net > 0 ? s.resW : net < 0 ? s.resL : s.resP}`}>{u(net)}</span>}
            <span className={s.chev} aria-hidden>
              ›
            </span>
          </span>
        </summary>
        <div className={s.ftdBody}>
          <div className={s.tw}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Ours</th>
                  <th>DK no-vig</th>
                  <th>DK price</th>
                  <th>Edge</th>
                </tr>
              </thead>
              <tbody>
                {b.players.map((x) => (
                  <tr key={x.id}>
                    <td>
                      {`${x.name} `}
                      <span className={s.dim}>{x.team}</span>
                      {res?.player === x.id && <span className={`${s.resChip} ${s.resW}`}> first basket</span>}
                    </td>
                    <td className={s.num}>{pct(x.p)}</td>
                    <td className={s.num}>{x.fair !== null ? pct(x.fair) : "–"}</td>
                    <td className={s.num}>{x.price !== null ? am(x.price) : "–"}</td>
                    <td className={x.edge ? s.pos : s.dim}>{x.edge ? `+${((x.p - implied(x.price!)) * 100).toFixed(1)}` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={`${s.ftdNote} ${s.dim}`}>
            {`Starters from ${b.starters === "dk" ? "DraftKings' listed field" : "each team's last game"}. ${res === undefined ? "" : res === null ? "No first basket found in the play-by-play. " : ""}Saved ${whenEt(g.capturedAt)}.`}
          </p>
        </div>
      </details>
    </li>
  );
}

export async function OurFirstBasket({ season }: { season: number }) {
  const v = await load(season);
  if (!v) return null;
  const today = etDate(new Date(renderedAt()));
  const games = v.board.filter((g) => g.fb && (!g.kickoff || etDate(new Date(g.kickoff)) >= today));
  return (
    <section className={s.section} aria-labelledby="our-fb">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="our-fb">
          First Basket
        </h2>
        <p className={s.p}>{`Our chance each starter scores the first field goal, from the tip and each starter's share; tracking only until a slice clears the gate. ${updated(games.map((g) => g.capturedAt))}`}</p>
      </div>
      {games.length ? (
        <ol className={s.ftdGames}>
          {games.map((g) => (
            <FbCard key={g.game.slug} g={g} />
          ))}
        </ol>
      ) : (
        <p className={s.calm}>No First Basket boards for today yet. They are built when DraftKings posts the market, usually the day before.</p>
      )}
    </section>
  );
}

export async function OurFirstBasketResults({ season }: { season: number }) {
  const v = await load(season);
  if (!v) return null;
  const bets = v.fb.graded.flatMap((b) => b.bets);
  const w = bets.filter((x) => x.net > 0).length;
  const units = bets.reduce((a, x) => a + x.net, 0);
  const tipRight = v.fb.graded.filter((b) => b.board.result && (b.tip >= 0.5) === (b.board.result.team === b.home)).length;
  return (
    <section className={s.section} aria-labelledby="our-fb-results">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="our-fb-results">
          First Basket: results
        </h2>
        <p className={s.p}>Every edge on a graded board, 1 unit at DraftKings&apos; price.</p>
      </div>
      {v.fb.graded.length ? (
        <div className={s.tiles}>
          <Tile value={u(units)} label={`Every edge · ${w}-${bets.length - w}`} />
          <Tile value={`${tipRight} of ${v.fb.graded.length}`} label="games our favored team scored first" />
        </div>
      ) : (
        <p className={s.calm}>Nothing graded yet. Boards are graded from ESPN&apos;s play-by-play at the overnight run.</p>
      )}
      <LearningBlock v={v.fb.learning} />
    </section>
  );
}
