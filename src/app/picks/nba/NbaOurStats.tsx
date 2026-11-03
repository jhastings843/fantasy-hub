// Our NBA game model's boxes in the NBA pop-up, one market at a time, under
// Sam's. Our number is the last one the props run saved for this ESPN event
// (game-store.ts); the cover chance is that signal's tracked record. Price:
// DraftKings' on the board when it's still at our saved number, else -110.
import type { NbaBoardGame } from "@/lib/picks/nba-store";
import { NBA_LIMITS } from "@/lib/picks/nba-track";
import { ourBoxes } from "@/lib/picks/our-boxes";
import type { SignalRecord, TrackedNbaGame } from "@/lib/models/nba/game-track";
import { ourNbaGameModel } from "../model-records";
import { OurStats, type OurRow } from "../game/OurStats";
import { line } from "../ui";
import type { Market } from "../ui";

const r1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

/** Our row for one market, or null when our model has nothing here. Pure. */
export function nbaOurRow(g: NbaBoardGame, t: TrackedNbaGame | undefined, records: SignalRecord[], m: Market): OurRow | null {
  const x = t?.last;
  if (!x || m === "su") return null;
  if (m === "ats") {
    const rec = records.find((r) => r.id === "lean") ?? null;
    const home = x.res > 0;
    const side = x.res === 0 ? null : home ? `${g.home.short} ${line(x.spread)}` : `${g.away.short} ${line(-x.spread)}`;
    const atOurs = g.line && g.line.home === x.spread;
    const price = atOurs ? (home ? g.line!.homePrice : g.line!.awayPrice) : undefined;
    return { side, edge: `${r1(Math.abs(x.res))} pts`, word: "Cover chance", b: ourBoxes({ record: rec, price, priorGames: NBA_LIMITS.SHRINK_GAMES }), label: "Our NBA model, every spread", record: rec };
  }
  const rec = records.find((r) => r.id === "total") ?? null;
  const d = x.ours.total - x.total;
  const over = d > 0;
  const side = d === 0 ? null : `${over ? "Over" : "Under"} ${x.total}`;
  const atOurs = g.total && g.total.points === x.total;
  const price = atOurs ? (over ? g.total!.overPrice : g.total!.underPrice) : undefined;
  return { side, edge: `${r1(Math.abs(d))} pts`, word: "Cover chance", b: ourBoxes({ record: rec, price, priorGames: NBA_LIMITS.SHRINK_GAMES }), label: "Our NBA model, every total", record: rec };
}

export async function NbaOurStats({ g, m, season }: { g: NbaBoardGame; m: Market; season: number }) {
  if (m === "su") return <OurStats row={null} missing="No straight-up number from our NBA model." />;
  const v = await ourNbaGameModel(season);
  const t = v?.games.find((x) => x.event === g.id);
  const missing = !v ? "Couldn't load our NBA model just now." : `No ${m === "ats" ? "spread" : "total"} from our NBA model for this game yet.`;
  return <OurStats row={v ? nbaOurRow(g, t, v.records, m) : null} missing={missing} />;
}
