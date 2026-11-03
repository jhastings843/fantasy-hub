// One rule for every model reading ESPN injury statuses (Jack, 2026-11-02:
// "injuries should apply to all props / game models"). Doubtful counts as Out:
// Doubtful players rarely play, and DraftKings usually pulls their props.
// Questionable still counts as playing: most do.
//
//   isOut("Out") true · isOut("Injured Reserve") true · isOut("Doubtful") true · isOut("Questionable") false
export const OUT_STATUSES = new Set(["Out", "Injured Reserve", "Doubtful", "Suspension"]);
export const isOut = (status: string | undefined) => !!status && OUT_STATUSES.has(status);
