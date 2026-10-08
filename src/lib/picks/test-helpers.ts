// Test-only: the stakes a board WANTS, given straight to `stake` (no limits),
// for tests about issuing and grading rather than about allocation.
import { wantStakes } from "./staking";

export function stakeBoard<G extends Parameters<typeof wantStakes>[0][number]>(
  board: G[],
  records: { t1?: { w: number; l: number }; t2?: { w: number; l: number } },
  _week?: number,
) {
  void _week;
  return { board: wantStakes(board, records).map((g) => ({ ...g, stake: g.want })) };
}
