// The four boxes behind a spread call (models, avg edge, cover chance, edge
// per unit), shared by the game pop-up, the board's open row and the full
// game page so all three read the same.
import type { BoardGame } from "@/lib/picks/engine";
import type { PicksReport } from "@/lib/picks/report";
import { coverRead } from "@/lib/picks/cover";
import { statusOf } from "../ats";
import { rec } from "../ui";
import s from "../picks.module.css";
import p from "./preview.module.css";

export function GameStats({ g, r }: { g: BoardGame; r: PicksReport }) {
  const name = (k: string) => r.names[k] ?? k;
  const c = coverRead(g, r.strategies, statusOf(g) === "sent");
  const rd = g.read;
  const team = c ? name(c.side === "home" ? g.home : g.away) : "";
  const edgeSide = rd ? name(rd.avgModel < rd.avgMarket ? g.home : g.away) : "";
  return (
    <div className={p.statsWrap}>
      <dl className={p.stats}>
        <div>
          <dt>Models</dt>
          <dd>{rd ? (rd.agree ? "Agree" : "Split") : "One or none"}</dd>
        </div>
        <div>
          <dt>Avg edge</dt>
          <dd className={s.num}>{rd ? `${rd.avgEdge.toFixed(1)} pts` : "·"}</dd>
          {rd && rd.avgEdge >= 0.05 && <small className={p.statSub}>{edgeSide}</small>}
        </div>
        <div>
          <dt>Cover chance</dt>
          <dd className={s.num}>{c ? `${(c.p * 100).toFixed(1)}%` : "·"}</dd>
          {c && <small className={p.statSub}>{team}</small>}
        </div>
        <div>
          <dt>Edge per unit</dt>
          <dd className={`${s.num} ${c?.edgePct !== undefined ? (c.edgePct >= 0 ? s.pos : s.neg) : ""}`}>
            {c?.edgePct !== undefined ? `${c.edgePct >= 0 ? "+" : ""}${c.edgePct.toFixed(1)}%` : "·"}
          </dd>
          {c?.edgePct === undefined && c && <small className={p.statSub}>no price yet</small>}
        </div>
      </dl>
      {c && (
        <p className={p.statNote}>
          {`${c.label} (${rec(c.record)}). Cover chance is that record pulled toward 50%, an estimate.${c.tier ? "" : " Outside the tiers, so tracked only, not a bet."}`}
        </p>
      )}
    </div>
  );
}
