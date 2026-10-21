// Our own NFL First TD model (lib/models/nfl/firsttd.ts): this week's boards
// against Kalshi's prices, and the record, on the First TD tab.
import { updated } from "./updated";
import { nameKey } from "@/lib/props/grade";
import { getOurFtdView, type OurFtdStored, type OurFtdView } from "@/lib/models/nfl/ftd-store";
import { kalshiCost, kalshiFor, marketBets } from "@/lib/firsttd/trends";
import { OUR_FTD_SLICES } from "@/lib/models/learn";
import { pricedPlayers } from "@/lib/firsttd/parse";
import { whenEt } from "../picks/ui";
import { Tile } from "./ournba";
import { LearningBlock } from "./learning";
import s from "../picks/picks.module.css";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const u = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}u`;
const TOP = 10;

async function load(season: number): Promise<OurFtdView | null> {
  return getOurFtdView(season).catch(() => null);
}

function Card({ g }: { g: OurFtdStored }) {
  const players = pricedPlayers(g.game).slice(0, TOP);
  const rows = players.map((p) => {
    const k = kalshiFor(g.kalshi, p.name);
    const cost = k?.ask ? kalshiCost(k.ask) : null;
    const dk = g.dk?.prices[nameKey(p.name)];
    return { p, cost, dk, value: cost !== null && p.p > cost };
  });
  const values = rows.filter((r) => r.value).length;
  const r = g.result;
  return (
    <li>
      <details className={s.ftdGame}>
        <summary className={s.ftdSum}>
          <span className={s.ftdWhen}>
            <b>{`${g.game.away} at ${g.game.home}`}</b>
            <span className={s.dim}>{g.kickoff ? whenEt(g.kickoff) : ""}</span>
          </span>
          <span className={s.ftdPick}>
            <span className={s.ftdPickName}>{g.game.pick ? `${g.game.pick.name} ${pct(g.game.pick.p)}` : "–"}</span>
            <span className={`${s.dim} ${s.num}`}>{g.game.teams.map((t) => `${t.team} ${pct(t.pFirst)}`).join(" · ")}</span>
          </span>
          <span className={s.ftdOdds}>{g.kalshi ? (values ? `${values} above Kalshi's cost` : "None above Kalshi's cost") : "No Kalshi market"}</span>
          <span className={s.ftdFlags}>
            {r && <span className={`${s.resChip} ${r.bucket === "priced" ? s.resW : s.resP}`}>{r.first.kind === "offense" ? r.first.scorer : "No offensive TD first"}</span>}
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
                  <th>Kalshi cost</th>
                  {g.dk && <th>DK</th>}
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, cost, dk, value }) => (
                  <tr key={p.key}>
                    <td>
                      {`${p.name} `}
                      <span className={s.dim}>{p.team}</span>
                    </td>
                    <td className={s.num}>{pct(p.p)}</td>
                    <td className={s.num}>{cost !== null ? `${Math.round(cost * 100)}¢` : "–"}</td>
                    {g.dk && <td className={s.num}>{dk !== undefined ? (dk > 0 ? `+${dk}` : `${dk}`) : "–"}</td>}
                    <td className={value ? s.pos : s.dim}>{value ? `+${((p.p - cost!) * 100).toFixed(1)}` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={`${s.ftdNote} ${s.dim}`}>
            {`Any other player: ${g.game.teams.map((t) => `${t.team} ${pct(t.rest)}`).join(", ")}. No offensive TD first: ${pct(g.game.none)}. Kalshi cost is the ask plus its fee.${g.dk ? ` DK is DraftKings' price the morning of the game (The Odds API), shown for comparison.` : ""} Saved ${whenEt(g.capturedAt)}.`}
          </p>
        </div>
      </details>
    </li>
  );
}

export async function OurFtdWeek({ season }: { season: number }) {
  const v = await load(season);
  if (!v) return <p className={s.calm}>Our First TD model couldn&apos;t be read just now. Try again in a minute.</p>;
  return (
    <section className={s.section} aria-labelledby="our-ftd-week">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="our-ftd-week">
          Our model{v.week ? ` · Week ${v.week}` : ""}
        </h2>
        <p className={s.p}>{`Our chance each player scores the first touchdown, compared with Kalshi's price; tracking only until a slice clears the gate. ${updated(v.board.map((g) => g.capturedAt))}`}</p>
      </div>
      {v.board.length ? (
        <ol className={s.ftdGames}>
          {v.board.map((g) => (
            <Card key={g.game.slug} g={g} />
          ))}
        </ol>
      ) : (
        <p className={s.calm}>Nothing built yet this week. Boards are made at each NFL capture slot once DraftKings posts a total and spread.</p>
      )}
    </section>
  );
}

export async function OurFtdResults({ season }: { season: number }) {
  const v = await load(season);
  if (!v) return null;
  const tiles = OUR_FTD_SLICES.slice(0, 3).map(([id, label, keep]) => {
    const bets = marketBets(v.graded, keep);
    return { id, label, w: bets.filter((b) => b.win).length, n: bets.length, units: bets.reduce((a, b) => a + b.net, 0) };
  });
  const teamRight = v.graded.filter((x) => x.result.team && [...x.game.teams].sort((a, b) => b.pFirst - a.pFirst)[0].team === x.result.team).length;
  return (
    <section className={s.section} aria-labelledby="our-ftd-results">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="our-ftd-results">
          Our model: results
        </h2>
        <p className={s.p}>Every graded board, one contract per bet at Kalshi&apos;s ask with its fee.</p>
      </div>
      {v.graded.length ? (
        <div className={s.tiles}>
          {tiles.map((t) => (
            <Tile key={t.id} value={u(t.units)} label={`${t.label} · ${t.w} of ${t.n}`} />
          ))}
          <Tile value={`${teamRight} of ${v.graded.length}`} label="games our favored team scored first" />
        </div>
      ) : (
        <p className={s.calm}>Nothing graded yet. Boards are graded from ESPN&apos;s scoring plays after each game.</p>
      )}
      <LearningBlock v={v.learning} />
    </section>
  );
}
