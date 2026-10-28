// Our own NFL props model (lib/models/nfl): this week's board and its record,
// on the NFL player props tab. Same cards as the NBA board (ournba.tsx).
import { updated } from "./updated";
import { getOurNflView, type OurNflView } from "@/lib/models/nfl/store";
import { ourPropSlices, ourSliceBets, record } from "@/lib/models/learn";
import { GameCard, Tile } from "./ournba";
import { LearningBlock } from "./learning";
import { GameTable, propGradedRows } from "./week";
import { SecHead } from "../picks/board";
import s from "../picks/picks.module.css";

const u = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}u`;
const STATS = ["pass_yds", "rush_yds", "rec_yds", "rec"] as const;

async function load(season: number): Promise<OurNflView | null> {
  return getOurNflView(season).catch(() => null);
}

export async function OurNflWeek({ season }: { season: number }) {
  const v = await load(season);
  if (!v) return <p className={s.calm}>Our NFL model couldn&apos;t be read just now. Try again in a minute.</p>;
  return (
    <section className={s.section} aria-labelledby="our-nfl-week">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="our-nfl-week">
          Our model{v.week ? ` · Week ${v.week}` : ""}
        </h2>
        <p className={s.p}>{`Our projection for yards and receptions, priced against DraftKings' line; tracking only until a slice clears the learning gate. ${updated(v.board.map((g) => g.capturedAt))}`}</p>
      </div>
      {v.board.length ? (
        <ol className={s.ftdGames}>
          {v.board.map((g) => (
            <GameCard key={g.game.slug} g={g} />
          ))}
        </ol>
      ) : (
        <p className={s.calm}>Nothing projected yet this week. Boards are built at each NFL capture slot once DraftKings posts player props.</p>
      )}
    </section>
  );
}

export async function OurNflResults({ season }: { season: number }) {
  const v = await load(season);
  if (!v) return null;
  const rec = (id: string) => record(ourSliceBets(v.graded, id));
  const all = rec("edge:all");
  const lean = rec("lean:all");
  return (
    <section className={s.section} aria-labelledby="our-nfl-results">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="our-nfl-results">
          Our model: results
        </h2>
        <p className={s.p}>Every saved prop once its game is final, against the board saved before kickoff, 1 unit risked at the price shown (-110 where none was posted).</p>
      </div>
      {v.graded.length ? (
        <>
          <div className={s.tiles}>
            <Tile value={u(all.units)} label={`Every edge · ${all.w}-${all.l}${all.p ? `-${all.p}` : ""}`} />
            <Tile value={u(lean.units)} label={`Every lean · ${lean.w}-${lean.l}${lean.p ? `-${lean.p}` : ""}`} />
          </div>
          <div className={s.pageFrame}>
            <SecHead title="Game by game" aside="Newest first · each tracked edge 1u at the saved price · open a game for every prop" />
            <GameTable head={["Edges W-L", "Units", "Props graded"]} rows={propGradedRows(v.graded, "nfl")} />
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
                {ourPropSlices([...STATS]).map(([id, label]) => {
                  const r = rec(id);
                  return (
                    <tr key={id}>
                      <td>{label}</td>
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
        <p className={s.calm}>Nothing graded yet. Boards are graded from ESPN&apos;s box scores after each game.</p>
      )}
      <LearningBlock v={v.learning} />
    </section>
  );
}
