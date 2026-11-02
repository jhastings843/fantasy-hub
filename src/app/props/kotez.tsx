// King of the End Zone (NFL, DraftKings promo): our chance at each game's
// longest TD (lib/models/nfl/kotez.ts) off the Anytime TD board, against an
// estimated share of backers. Projections only: nothing saved or graded yet.
import { getOurFtdView } from "@/lib/models/nfl/ftd-store";
import { kotezGame, KOTEZ_SIMS, type KotezRow } from "@/lib/models/nfl/kotez";
import ATTD_PARAMS from "@/lib/models/nfl/attd-params.json";
import { implied } from "@/lib/props/parse";
import { Background, SecHead } from "../picks/board";
import { GameTable, type GameRowData } from "./week";
import { tvByEvent } from "@/lib/live/espn";
import s from "../picks/picks.module.css";

const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const VALUE = 1.2;
const nowMs = () => Date.now();

function Table({ rows }: { rows: KotezRow[] }) {
  return (
    <div className={s.tw}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Player</th>
            <th>Longest TD</th>
            <th>Anytime ours / DK</th>
            <th>Backers (est.)</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.team}|${r.key}`} className={r.value !== undefined && r.value >= VALUE ? s.rowEdge : undefined}>
              <td>
                {`${r.name} `}
                <span className={s.dim}>{r.team}</span>
              </td>
              <td className={s.num}>{pct(r.longest)}</td>
              <td className={s.num}>{`${pct(r.anytime)} / ${r.dk !== undefined ? `${am(r.dk)} (${pct(implied(r.dk))})` : "·"}`}</td>
              <td className={s.num}>{r.crowd !== undefined ? pct(r.crowd) : "·"}</td>
              <td className={`${s.num} ${r.value !== undefined && r.value >= VALUE ? s.pos : ""}`}>{r.value !== undefined ? `${r.value.toFixed(2)}x` : "·"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function KotezWeek({ season }: { season: number }) {
  const v = await getOurFtdView(season).catch(() => null);
  if (!v) return <p className={s.calm}>The board couldn&apos;t be read just now.</p>;
  const now = nowMs();
  const games = v.board.filter((g) => g.attd && !g.attdResult && (!g.kickoff || Date.parse(g.kickoff) > now)).sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? ""));
  const tv = await tvByEvent("nfl");
  const sims = games.map((g) => ({ g, k: kotezGame(g.attd!.rows, ATTD_PARAMS.other) }));
  const best = sims
    .flatMap(({ g, k }) => k.rows.filter((r) => r.value !== undefined && r.value >= VALUE && r.longest >= 0.03).map((r) => ({ r, game: `${g.game.away} at ${g.game.home}` })))
    .sort((a, b) => b.r.value! - a.r.value!)
    .slice(0, 6);
  const rows: GameRowData[] = sims.map(({ g, k }) => {
    const top = k.rows[0];
    const val = k.rows.filter((r) => r.value !== undefined && r.value >= VALUE && r.longest >= 0.03);
    return {
      key: g.game.slug,
      title: `${g.game.away} at ${g.game.home}`,
      match: { league: "nfl", away: g.game.away, home: g.game.home, tv: g.espnId ? tv.get(g.espnId) : undefined },
      when: g.kickoff,
      cells: [
        ["Likeliest", top ? `${top.name} ${pct(top.longest)}` : "·"],
        ["Value", val.length ? `${val[0].name} ${val[0].value!.toFixed(2)}x` : "none"],
        ["No TD", pct(k.noTd)],
      ],
      read: val.length ? [`${val.length} value`, s.readTrack] : ["No value", s.readPass],
      body: <Table rows={k.rows} />,
    };
  });
  return (
    <section className={s.section} aria-labelledby="kotez-week">
      <div className={s.pageFrame}>
        <SecHead id="kotez-week" title="Best value" aside={`Our chance at the game's longest TD over the estimated share backing him · ${VALUE}x and up, 3%+ to win · projections only`} />
        {best.length ? (
          <div className={s.tw}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Longest TD</th>
                  <th>Backers (est.)</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {best.map(({ r, game }) => (
                  <tr key={`${game}|${r.key}`}>
                    <td>
                      {`${r.name} `}
                      <span className={s.dim}>{r.team}</span>
                      <br />
                      <span className={s.dim}>{game}</span>
                    </td>
                    <td className={s.num}>{pct(r.longest)}</td>
                    <td className={s.num}>{pct(r.crowd!)}</td>
                    <td className={`${s.num} ${s.pos}`}>{`${r.value!.toFixed(2)}x`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={s.calm}>{games.length ? "No player clears the value bar on games still to play." : "No games with an Anytime TD board still to play."}</p>
        )}
      </div>
      <div className={s.pageFrame}>
        <SecHead title="Every game" aside="Games still to start · DraftKings runs the promo on select games, so check the app for tonight's" />
        {rows.length ? <GameTable head={["Likeliest", "Value", "No TD"]} rows={rows} /> : <p className={s.calm}>No games on the board.</p>}
      </div>
      <Background title="How the number is built, and how far to trust it">
        <p className={s.p}>
          DraftKings pays everyone who backed the player with the game&apos;s longest TD (a thrown TD counts for the receiver). We simulate each game {KOTEZ_SIMS.toLocaleString()} times:
          each player&apos;s TDs come from our Anytime TD model, each TD is a run or a catch at his own mix, and its length is drawn from his own TDs since 2024, shrunk toward the
          league&apos;s. Returns, defensive TDs and players off the list can win too, and some games have no TD.
        </p>
        <p className={s.p}>
          Backers is an estimate, not data: DraftKings doesn&apos;t publish who people pick, so each player&apos;s share is set by his anytime price, squared, so favorites draw more
          than their price says. Value is our chance over that share: 1.5x means about 1.5 times his slice of the pool. Not yet graded: treat it as a guide.
        </p>
      </Background>
    </section>
  );
}
