// Moved to src/lib/lineup/solve.ts on 2026-09-09.
//
// The solver was always general: it reads a Sleeper roster_positions array and
// knows nothing about guillotine leagues. It lived here because the FAAB
// advisor was the first thing to need it. The weekly lineup advice is the
// second, and a shared primitive importing from one format's folder is the kind
// of seam that goes wrong later.
//
// Re-exported rather than moved-and-updated everywhere, so the FAAB advisor's
// imports are untouched and this move cannot have broken it.
export {
  bestLineup,
  marginalValue,
  slotAccepts,
  startingSlots,
  weakestSlots,
  type FilledSlot,
  type Lineup,
  type LineupPlayer,
} from "@/lib/lineup/solve";
