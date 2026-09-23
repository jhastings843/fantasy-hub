import type { InjuryNote } from "@/lib/survivor/types";

// Whether a player is actually going to play, from two sources that disagree.
//
// Sleeper's projection row carries an injury_status, and it is the only live
// status the rest of this app reads. It is also wrong often enough to matter:
// on the Tuesday of week 3 it had Kyler Murray as Out while ESPN had him
// Active and the beat was reporting that his return sends Wentz back to the
// bench, and it had Puka Nacua as Out when he was Questionable with a groin
// his coach expected to cost one game. Both of them vanished off the bid card,
// which is a worse failure than the one it was fixing: a bad tag used to make
// the app overpay, and then it made the app blind.
//
// So the tags are crossed. ESPN publishes a status per player with the beat
// note attached, the app already pulls it for the survivor picks, and where
// the two disagree the more specific one wins. Nothing here decides anything
// on its own: what it produces is a probability that the player suits up, and
// the price follows from that.

/** How likely he plays, by status. */
const PLAYS: Record<string, number> = {
  out: 0,
  ir: 0,
  pup: 0,
  nfi: 0,
  susp: 0,
  suspended: 0,
  dnp: 0,
  doubtful: 0.25,
  questionable: 0.75,
  probable: 0.95,
  active: 1,
  healthy: 1,
};

export interface Availability {
  /** 0 to 1: the chance he is in the lineup on Sunday. */
  plays: number;
  /** The status this landed on, for the card to print. */
  status: string | null;
  /** Set when the two sources disagreed, so the report can say so. */
  disputed: string | null;
  /** ESPN's beat note, where there is one worth reading. */
  note: string | null;
}

const norm = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const key = s.trim().toLowerCase().replace(/[^a-z]/g, "");
  return key || null;
};

const playsFor = (status: string | null): number | null => {
  if (!status) return null;
  for (const [key, value] of Object.entries(PLAYS)) {
    if (status.startsWith(key)) return value;
  }
  return null;
};

/** ESPN's report on one player, matched by name. */
export function injuryFor(
  name: string,
  injuries: InjuryNote[],
): InjuryNote | null {
  const wanted = name.toLowerCase().replace(/[^a-z ]/g, "").trim();
  return (
    injuries.find((i) => i.player.toLowerCase().replace(/[^a-z ]/g, "").trim() === wanted) ?? null
  );
}

/**
 * A projection Sleeper itself did not zero.
 *
 * This is the tell Jack spotted: a player who is genuinely out comes through
 * the feed at 0.00, the way Jayden Daniels did with a dislocated elbow. Kyler
 * Murray came through the same feed tagged Out and projected for 17.6, and
 * Puka Nacua tagged Out and projected for 14.4. Sleeper's own number was
 * arguing with Sleeper's own tag, and the number is the thing they recompute.
 */
const PROJECTION_IS_ZEROED = 1;

/**
 * Cross the sources.
 *
 * ESPN wins when it is the fresher read, which in practice means whenever it
 * says something other than "out": its Active means a player Sleeper has not
 * untagged yet, and its Questionable is a real weekly status rather than the
 * blunt Out that Sleeper leaves on a player all week. Sleeper wins when ESPN
 * has nothing to say about him at all, because no note means no injury rather
 * than no information: ESPN lists the hurt, not the healthy.
 */
export function availability(
  sleeperStatus: string | null,
  espn: InjuryNote | null,
  projectedPoints: number | null = null,
): Availability {
  const minePlays = playsFor(norm(sleeperStatus));
  const theirsPlays = playsFor(norm(espn?.status));
  const note = espn?.comment?.trim() ? espn.comment.trim() : null;

  // A zeroed projection settles it, whatever either status says. It is the one
  // artifact that gets recomputed when the news lands, and a player nobody
  // expects to take a snap is worth nothing this week however hopeful the
  // Wednesday practice report reads.
  if (projectedPoints != null && projectedPoints <= PROJECTION_IS_ZEROED) {
    return {
      plays: 0,
      status: espn?.status ?? sleeperStatus ?? "Out",
      disputed: null,
      note,
    };
  }

  if (theirsPlays != null) {
    const disagree =
      minePlays != null && Math.abs(minePlays - theirsPlays) >= 0.25
        ? `Sleeper has him ${sleeperStatus}, ESPN has him ${espn?.status}`
        : null;
    return {
      plays: theirsPlays,
      status: espn?.status ?? sleeperStatus ?? null,
      disputed: disagree,
      note,
    };
  }

  // Nobody at ESPN is reporting on him and Sleeper says he cannot play, but
  // Sleeper is also still projecting him as a starter. Treat that as the
  // coin flip it is rather than believing either half outright.
  if (minePlays === 0 && projectedPoints != null) {
    return {
      plays: 0.5,
      status: sleeperStatus,
      disputed: `Sleeper lists him ${sleeperStatus} but still projects ${projectedPoints.toFixed(1)} points, so the tag and the number disagree`,
      note,
    };
  }

  return {
    plays: minePlays ?? 1,
    status: sleeperStatus ?? null,
    disputed: null,
    note,
  };
}
