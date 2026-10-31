// The four numbers behind a spread call, for every game on the board, not
// just the ones the tiers take (Jack, 2026-10-31: "what does it take for all
// these to have values... yes"). A tiered game uses its tier's p; any other
// game borrows the broadest tracked record it belongs to, so the number is
// honest about how that kind of game has done, not cherry-picked.
import type { BoardGame, Record, StrategyBoard } from "./engine";
import { decimal, shrunk } from "./staking";

export interface CoverRead {
  /** The side the number is for. */
  side: "home" | "away";
  /** Cover chance: a record pulled toward 50%, an estimate. */
  p: number;
  /** Where the record comes from, in words, and the record itself. */
  label: string;
  record: Pick<Record, "w" | "l" | "p">;
  tier: "t1" | "t2" | null;
  /** The price used for edge per unit (sent price once sent), if any. */
  price?: number;
  /** Expected return on 1u at that price, in percent. */
  edgePct?: number;
}

/** Pass `sent` when the bet already went out, so edge per unit uses the issued price. */
export function coverRead(g: BoardGame, st: StrategyBoard, sent = false): CoverRead | null {
  const r = g.read;
  if (!r) return null;
  const tierCut = g.tier === "t1" ? st.rule : g.tier === "t2" ? st.second : null;
  let side: "home" | "away";
  let p: number;
  let label: string;
  let record: Record;
  let tier: CoverRead["tier"] = null;
  if (tierCut && g.p !== undefined && (g.side ?? r.side)) {
    side = (g.side ?? r.side)!;
    p = g.p;
    label = `${g.tier === "t1" ? "The rule" : "Tier 2"}: ${tierCut.label}`;
    record = tierCut.record;
    tier = g.tier as "t1" | "t2";
  } else if (r.agree && r.side) {
    const all = st.cuts.find((c) => c.id === "agree");
    if (!all) return null;
    side = r.side;
    record = all.record;
    label = all.label;
    p = shrunk(record.w, record.l);
  } else {
    // Split: go with whichever model has the better record in split games.
    const { sam, david } = st.splits;
    const useSam = sam.pct > david.pct;
    record = useSam ? sam : david;
    if (record.w + record.l === 0) return null;
    side = useSam ? r.samSide : r.davidSide;
    label = `${useSam ? "Sam" : "David"}'s side when they split`;
    p = shrunk(record.w, record.l);
  }
  const q = g.ref ?? g.lastRef;
  const price = sent && g.issued?.price !== undefined ? g.issued.price : tier && g.price !== undefined ? g.price : side === "home" ? q?.homePrice : q?.awayPrice;
  const edgePct = price !== undefined ? (p * decimal(price) - 1) * 100 : undefined;
  return { side, p, label, record: { w: record.w, l: record.l, p: record.p }, tier, price, edgePct };
}
