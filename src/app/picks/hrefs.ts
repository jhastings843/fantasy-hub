// Where a team, matchup or player name opens its pop-up (Jack, 2026-11-04:
// "every team/match/player should have a pop up box when i click the name").
// Every link built here goes to a route app/@modal intercepts, so a client-side
// <Link scroll={false}> opens it as a pop-up over the page; typed or shared, the
// same URL is the full page. The pop-ups read the current board only, so past
// weeks keep plain text (see docs/redesign/popups.md).

/** NFL or college football game, keyed "AWAY@HOME" in the board's own codes. */
export const footballGameHref = (league: "nfl" | "cfb", away: string, home: string) =>
  `/picks/game?l=${league}&g=${encodeURIComponent(`${away}@${home}`)}`;

/** NBA game by ESPN event id (same as NbaView's nbaGameHref). */
export const nbaGameHref = (id: string) => `/picks/nba/game?id=${encodeURIComponent(id)}`;

/** College hoops game by ESPN event id. */
export const cbbGameHref = (id: string) => `/picks/cbb/game?id=${encodeURIComponent(id)}`;

/**
 * A player's props pop-up. The team is required (the loader matches it
 * exactly); the game (ESPN id or slug) picks the right night when he plays twice.
 */
export const playerPropHref = (league: "nfl" | "nba", team: string, name: string, game?: string | null) =>
  `/props/player?l=${league}&t=${encodeURIComponent(team)}&n=${encodeURIComponent(name)}${game ? `&g=${encodeURIComponent(game)}` : ""}`;
