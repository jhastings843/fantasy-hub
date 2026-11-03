// Our own model's four boxes for one market, under Sam's (and David's) in
// every game pop-up: our side, our edge in points against the market, a
// cover (or win) chance from our tracked record, and edge per unit at the
// posted price (Jack, 2026-11-02: "our line should also be listed within the
// boxed breakdowns"). Same grid as GameStats, so it wraps two by two on a phone.
import type { OurBoxes } from "@/lib/picks/our-boxes";
import { price as am, rec } from "../ui";
import s from "../picks.module.css";
import p from "./preview.module.css";

export interface OurRow {
  /** "Nets +14.5", "Over 228.5", "Knicks to win"; null when our number lands on the market's. */
  side: string | null;
  /** Points of edge against the market, already worded: "2.4 pts", "by 3.1". */
  edge: string;
  /** "Cover chance", "Win chance", "Over chance". */
  word: string;
  b: OurBoxes;
  /** Where the chance comes from, and its record. */
  label: string;
  record: { w: number; l: number; p?: number } | null;
}

const pctOf = (x: number) => `${(x * 100).toFixed(1)}%`;

/** One market's row, or one calm line when our model has no number here. */
export function OurStats({ row, missing, caption }: { row: OurRow | null; missing: string; caption?: string }) {
  if (!row) return <p className={p.statNote}>{missing}</p>;
  const { side, edge, word, b, label, record } = row;
  const graded = !!record && record.w + record.l > 0;
  const priceNote = b.price === null ? "no moneyline" : b.assumed ? "at -110, assumed" : `at ${am(b.price)}`;
  return (
    <div className={p.statsWrap}>
      {caption && <span className={p.ourCap}>{caption}</span>}
      <dl className={`${p.stats} ${p.ours}`}>
        <div>
          <dt>Our side</dt>
          <dd>{side ?? "On the number"}</dd>
        </div>
        <div>
          <dt>{word.startsWith("Win") ? "Margin" : "Edge"}</dt>
          <dd className={s.num}>{side ? edge : "·"}</dd>
        </div>
        <div>
          <dt>{word}</dt>
          <dd className={s.num}>{side && b.p !== null ? pctOf(b.p) : "·"}</dd>
        </div>
        <div>
          <dt>Edge per unit</dt>
          <dd className={`${s.num} ${side && b.edgePct !== null ? (b.edgePct >= 0 ? s.pos : s.neg) : ""}`}>{side && b.edgePct !== null ? `${b.edgePct >= 0 ? "+" : ""}${b.edgePct.toFixed(1)}%` : "·"}</dd>
          {side && b.p !== null && <small className={p.statSub}>{priceNote}</small>}
        </div>
      </dl>
      <p className={p.statNote}>
        {graded
          ? `${label} (${rec({ w: record.w, l: record.l, p: record.p ?? 0 })}). ${word} is that record pulled toward 50%, an estimate.${b.assumed && side ? " No price posted, so edge per unit is at -110, assumed." : ""} Our models are tracked only, not staked.`
          : `${label}: no graded games yet. Our models are tracked only, not staked.`}
      </p>
    </div>
  );
}
