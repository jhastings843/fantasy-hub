// Our own model's boxes in the NFL and CFB pop-up, every market, under the
// Sam and David boxes (GameStats). Our numbers are the board's `ours` (latest
// saved read); records come from the same loaders as the Learner log's model
// records (model-records.tsx). Prices: the quote the board judges every model
// at (`ref`, else the last one before kickoff), as coverRead picks them.
import type { BoardGame } from "@/lib/picks/engine";
import type { PicksReport } from "@/lib/picks/report";
import { ourBoxes } from "@/lib/picks/our-boxes";
import { ourFootballRecords } from "../model-records";
import { line } from "../ui";
import { OurStats, type OurRow } from "./OurStats";
import p from "./preview.module.css";

const r1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
type Rec = { w: number; l: number; p?: number } | null;

/** Our three rows for one game. Pure. */
export function footballOurRows(g: BoardGame, r: Pick<PicksReport, "league" | "names" | "totals">, recs: { spread: Rec; total: Rec; su: Rec }) {
  const name = (k: string) => r.names[k] ?? k;
  const model = r.league === "nfl" ? "Our NFL model" : "Our college model";
  const q = g.ref ?? g.lastRef;
  const o = g.ours;

  let spread: OurRow | null = null;
  if (o && q) {
    const d = o.spread - q.line; // < 0: ours likes home more than the market does
    const home = d < 0;
    spread = {
      side: Math.abs(d) < 0.05 ? null : home ? `${name(g.home)} ${line(q.line)}` : `${name(g.away)} ${line(-q.line)}`,
      edge: `${r1(Math.abs(d))} pts`,
      word: "Cover chance",
      b: ourBoxes({ record: recs.spread, price: home ? q.homePrice : q.awayPrice }),
      label: `${model}, every game`,
      record: recs.spread,
    };
  }

  const tot = r.totals.board.find((t) => t.home === g.home && t.away === g.away);
  const mine = tot?.ours ?? o?.total;
  const at = tot?.ref ?? (q?.total !== undefined ? { total: q.total, overPrice: q.overPrice, underPrice: q.underPrice } : undefined);
  let total: OurRow | null = null;
  if (mine !== undefined && at) {
    const d = mine - at.total;
    const over = d > 0;
    total = {
      side: Math.abs(d) < 0.05 ? null : `${over ? "Over" : "Under"} ${at.total}`,
      edge: `${r1(Math.abs(d))} pts`,
      word: "Cover chance",
      b: ourBoxes({ record: recs.total, price: over ? at.overPrice : at.underPrice }),
      label: "Our model's side of the total",
      record: recs.total,
    };
  }

  let su: OurRow | null = null;
  if (o) {
    // No moneyline on the football board, so edge per unit stays blank rather than assuming one.
    su = {
      side: o.spread === 0 ? null : `${name(o.spread < 0 ? g.home : g.away)} to win`,
      edge: `by ${r1(Math.abs(o.spread))}`,
      word: "Win chance",
      b: ourBoxes({ record: recs.su, assume: false }),
      label: "Our model's projected winner",
      record: recs.su,
    };
  }
  return { spread, total, su };
}

export async function FootballOurStats({ g, r }: { g: BoardGame; r: PicksReport }) {
  const recs = await ourFootballRecords(r.league, r.season, r);
  const rows = footballOurRows(g, r, recs);
  const who = r.league === "nfl" ? "our NFL model" : "our college model";
  return (
    <section aria-label="Our model" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 className={p.h3} style={{ margin: 0 }}>Our model</h3>
      <OurStats caption="Spread" row={rows.spread} missing={`Spread: no number from ${who} for this game yet.`} />
      <OurStats caption="Total" row={rows.total} missing={`Total: no number from ${who} for this game yet.`} />
      <OurStats caption="Straight up" row={rows.su} missing={`Straight up: no number from ${who} for this game yet.`} />
    </section>
  );
}
