// One NBA game at a glance, the football pop-up's shape (GamePreview.tsx):
// matchup with logos, then every market's four boxes (Sam's side, edge,
// cover chance, edge per unit) with our model's four under them, our prop
// edges in the game, and the lines behind them. Opened from a board
// row or a Today card (Jack, 2026-10-31).
import type { NbaBoardGame } from "@/lib/picks/nba-store";
import type { NbaPicksView } from "@/lib/picks/nba-track-store";
import { TeamLogo } from "@/components/TeamLogo";
import type { Market } from "../ui";
import { NbaStats, NbaWhy, readMarket } from "./NbaView";
import { NbaOurStats } from "./NbaOurStats";
import { NbaGameProps } from "../game/GameProps";
import { nbaSeasonOfDate } from "@/lib/props/parse";
import s from "../picks.module.css";
import p from "../game/preview.module.css";

const ET = "America/New_York";
const MARKETS: { m: Market; name: string }[] = [
  { m: "ats", name: "Spread" },
  { m: "ou", name: "Total" },
  { m: "su", name: "Straight up" },
];

export function NbaGamePreview({ raw, v }: { raw: NbaBoardGame; v: NbaPicksView | null }) {
  const reads = MARKETS.map((x) => ({ ...x, r: readMarket(raw, v, x.m) }));
  const g = reads[0].r.g;
  const tip = new Date(g.tip).toLocaleString("en-US", { timeZone: ET, weekday: "short", hour: "numeric", minute: "2-digit" });
  const staked = reads.find((x) => x.r.stake);
  const sc = g.score;
  const season = v?.season ?? nbaSeasonOfDate(new Date());
  return (
    <div className={`${s.page} ${p.root}`}>
      <span className={s.eyebrow}>{`NBA · ${g.state === "post" ? "Final" : g.state === "in" ? `Live · ${g.detail}` : `${tip}${g.tv ? ` · ${g.tv}` : ""}`}`}</span>
      <div className={p.match}>
        {(["away", "home"] as const).map((side) => (
          <div key={side} className={`${p.team} ${side === "home" ? p.teamHome : ""}`}>
            <TeamLogo league="nba" team={g[side].abbr} size={64} />
            <span className={p.teamName}>{g[side].short}</span>
            {sc && g.state !== "pre" && <span className={`${p.score} ${s.num}`}>{sc[side]}</span>}
          </div>
        ))}
        <span className={p.at} aria-hidden>
          {g.state === "post" ? "final" : "at"}
        </span>
      </div>
      <div className={`${p.verdict} ${staked ? p.verdictBet : ""}`}>
        <span className={p.verdictLabel}>{staked ? "On the card" : "No stake"}</span>
        <span>{staked ? `Tier ${staked.r.tier} · ${staked.r.stake}u` : "NBA is tracked until its go-live gate clears, so these are Sam's sides with no stake."}</span>
      </div>
      {reads.map(({ m, name, r }) => (
        <section key={m} aria-label={name}>
          <h3 className={p.h3}>{name}</h3>
          {r.bet ? <NbaStats x={r} m={m} /> : <p className={p.note} style={{ margin: "0 0 12px" }}>{g.read ? "No side from Sam here." : "No read from Sam yet."}</p>}
          <NbaOurStats g={g} m={m} season={season} />
        </section>
      ))}
      <NbaGameProps id={raw.id} />
      <section aria-label="Lines">
        <h3 className={p.h3}>Lines</h3>
        <NbaWhy g={g} />
      </section>
    </div>
  );
}

/** The game with this ESPN id on the board (today and the next days, or last night). */
export function findNbaGame(days: { games: NbaBoardGame[] }[], id: string): NbaBoardGame | undefined {
  for (const d of days) {
    const g = d.games.find((x) => x.id === id);
    if (g) return g;
  }
}
