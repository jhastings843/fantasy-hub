// Turning a name in a post into a Sleeper player id.
//
// The app keys everything on Sleeper ids; his posts give a name, a position and
// a team. That gap is where the hand-curated v2.0 lost five of three hundred
// players and had to look them up by hand.
//
// Two rules shape this. Match on more than the name, because "Michael Carter"
// has been two different players in the same season. And never guess: an
// unresolved player is returned as unresolved, so the ingest can report him. A
// silently dropped player is a hole in the rankings nobody sees; a reported one
// is a two-minute fix.

export interface ResolvableName {
  name: string;
  position: string;
  team: string | null;
}

export interface SleeperCandidate {
  playerId: string;
  fullName: string;
  position: string | null;
  team: string | null;
}

export interface Resolution<T> {
  input: T;
  playerId: string;
  /** How the match was made, so a weak one can be shown as weak. */
  via: "team-defence" | "name+position+team" | "name+position" | "name" | "surname+position+team";
}

export interface ResolveResult<T> {
  resolved: Resolution<T>[];
  unresolved: T[];
  /** Names that matched more than one player and were not guessed at. */
  ambiguous: { input: T; candidates: string[] }[];
}

/** Suffixes he writes and Sleeper usually does not, e.g. "James Cook III". */
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/**
 * A name reduced to what two sources are likely to agree on.
 *
 * Apostrophes are the big one: "Ja'Marr Chase" arrives from the feed with a
 * typographic apostrophe and sits in Sleeper with a straight one, and those are
 * different strings.
 */
export function normalizeName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/[.,]/g, "")
    .replace(/[-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const parts = cleaned.split(" ").filter((p) => !SUFFIXES.has(p));
  return parts.join(" ");
}

/** His label for a team defence is DST; Sleeper's position is DEF. */
function normalizePosition(position: string): string {
  const p = position.toUpperCase();
  return p === "DST" ? "DEF" : p;
}

// Exported because anything comparing a team code he wrote against a team code
// Sleeper wrote has to go through it. On 2026-09-09 the lineup advice compared
// them raw and told Jack that two Jacksonville players were on bye in week 1,
// when there are no byes in week 1: he writes JAC and Sleeper says JAX.
export function normalizeTeam(team: string | null): string | null {
  if (!team) return null;
  const t = team.toUpperCase();
  // The handful of abbreviations that differ between sources.
  const ALIASES: Record<string, string> = { JAC: "JAX", WSH: "WAS", LA: "LAR", ARZ: "ARI" };
  return ALIASES[t] ?? t;
}

/**
 * Resolve a batch of names against Sleeper's player list.
 *
 * Tries the strictest key first and only widens when the strict key finds
 * nothing, so a right answer is never traded for a looser wrong one.
 */
export function resolveNames<T extends ResolvableName>(
  inputs: T[],
  players: SleeperCandidate[],
): ResolveResult<T> {
  const byNamePositionTeam = new Map<string, SleeperCandidate[]>();
  const byNamePosition = new Map<string, SleeperCandidate[]>();
  const byName = new Map<string, SleeperCandidate[]>();

  const push = (map: Map<string, SleeperCandidate[]>, key: string, value: SleeperCandidate) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };

  for (const player of players) {
    const name = normalizeName(player.fullName);
    if (!name) continue;
    const position = player.position ? normalizePosition(player.position) : "";
    const team = normalizeTeam(player.team) ?? "";

    push(byName, name, player);
    if (position) push(byNamePosition, `${name}|${position}`, player);
    if (position && team) push(byNamePositionTeam, `${name}|${position}|${team}`, player);
  }

  // Sleeper keys a team defence by the team itself, and he writes the nickname
  // only ("Texans", not "Houston Texans"), so no amount of name matching will
  // ever join those two. The team code is the join, and it is exact.
  const defenceByTeam = new Map<string, SleeperCandidate>();
  for (const player of players) {
    if (player.position && normalizePosition(player.position) === "DEF") {
      const team = normalizeTeam(player.team) ?? player.playerId.toUpperCase();
      defenceByTeam.set(team, player);
    }
  }

  // Last resort for the small spelling gaps between a writer and a database:
  // "Josh Palmer" against Sleeper's "Joshua Palmer", or a transposed "Tajh"
  // for "Tahj". Surname plus position plus team is specific enough that a
  // collision is reported rather than guessed.
  const bySurname = new Map<string, SleeperCandidate[]>();
  for (const player of players) {
    const parts = normalizeName(player.fullName).split(" ");
    const surname = parts[parts.length - 1];
    const position = player.position ? normalizePosition(player.position) : "";
    const team = normalizeTeam(player.team) ?? "";
    if (!surname || !position || !team) continue;
    push(bySurname, `${surname}|${position}|${team}`, player);
  }

  const resolved: Resolution<T>[] = [];
  const unresolved: T[] = [];
  const ambiguous: { input: T; candidates: string[] }[] = [];

  for (const input of inputs) {
    const name = normalizeName(input.name);
    const position = normalizePosition(input.position);
    const team = normalizeTeam(input.team) ?? "";

    if (position === "DEF") {
      const defence = defenceByTeam.get(team);
      if (defence) {
        resolved.push({ input, playerId: defence.playerId, via: "team-defence" });
        continue;
      }
      unresolved.push(input);
      continue;
    }

    const surname = name.split(" ").filter(Boolean).slice(-1)[0] ?? "";

    const attempts: [string, Map<string, SleeperCandidate[]>, Resolution<T>["via"]][] = [
      [`${name}|${position}|${team}`, byNamePositionTeam, "name+position+team"],
      [`${name}|${position}`, byNamePosition, "name+position"],
      [name, byName, "name"],
      [`${surname}|${position}|${team}`, bySurname, "surname+position+team"],
    ];

    let done = false;
    for (const [key, map, via] of attempts) {
      const hits = map.get(key);
      if (!hits || hits.length === 0) continue;

      if (hits.length === 1) {
        resolved.push({ input, playerId: hits[0].playerId, via });
        done = true;
        break;
      }

      // More than one player fits. Widening the key would only make it worse,
      // so stop and report rather than picking the first.
      ambiguous.push({
        input,
        candidates: hits.map((h) => `${h.fullName} (${h.position ?? "?"} ${h.team ?? "FA"})`),
      });
      done = true;
      break;
    }

    if (!done) unresolved.push(input);
  }

  return { resolved, unresolved, ambiguous };
}

/** Sleeper's slim player map, in the shape the resolver wants. */
export function toCandidates(
  players: Record<string, { full_name?: string; first_name?: string; last_name?: string; position?: string | null; team?: string | null }>,
): SleeperCandidate[] {
  const out: SleeperCandidate[] = [];
  for (const [playerId, p] of Object.entries(players)) {
    const fullName =
      p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
    if (!fullName) continue;
    out.push({
      playerId,
      fullName,
      position: p.position ?? null,
      team: p.team ?? null,
    });
  }
  return out;
}
