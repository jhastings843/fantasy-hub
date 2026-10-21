// Public betting splits and line movement, for NFL, college and NBA.
//
// Source: Action Network's public scoreboard feed
// (api.actionnetwork.com/web/v2/scoreboard/{nfl|ncaaf|nba}), the same one
// their site reads. Free, no key, unofficial: it can change or close without
// notice, so every caller treats a failed read as "no splits" and moves on.
// Checked 2026-10-21: 14 of 14 NFL, 56 of 56 college and 11 of 11 NBA games
// carried spread splits.
//
// What it gives, per game: the share of TICKETS (bets placed) and of MONEY
// (dollars wagered) on each side of the spread and total. Those are the same
// numbers on every book in the feed, so they are Action Network's own
// aggregate, not one sportsbook's. Book 30 is the opening line; book 68 is
// DraftKings. When the money share on a side runs well ahead of its ticket
// share, fewer, bigger bets are on it: the usual read is "sharp" money.
//
// Reverse line movement (RLM): the line moves TOWARD the side most tickets
// are against. Books move a line for liability or respect, and a move against
// the crowd says it was respect. That is the hypothesis, not a fact: nobody
// has published a clean, recent, out-of-sample test of it, and Action
// Network's own data has no free history. So this archives forward, and the
// Tuesday review decides (learning/model.ts).
//
// Pure: no fetches, no Redis. The feed read is splits-feed.ts.

export type SplitsLeague = "nfl" | "cfb" | "nba";

export const AN_LEAGUE: { [l in SplitsLeague]: string } = { nfl: "nfl", cfb: "ncaaf", nba: "nba" };
export const AN_BOOK_OPEN = "30";
export const AN_BOOK_DK = "68";

/** One game's public splits at one read, home-side throughout. */
export interface Splits {
  /** % of spread tickets on the home side (0-100). */
  homeTickets: number;
  /** % of spread money on the home side (0-100). */
  homeMoney: number;
  /** % of total tickets / money on the over, when the feed has them. */
  overTickets?: number;
  overMoney?: number;
  /** Opening home spread (Action Network's open book). */
  open?: number;
  /** DraftKings' home spread in the same read, to confirm the match. */
  dk?: number;
  /** Bets the feed counted on the game, when it says. */
  bets?: number;
  /** When we read it. */
  at: string;
}

export interface SplitGame extends Splits {
  start: string;
  /** Every name the feed gives each team, lowercased: location, display, full, short, abbreviation. */
  homeNames: string[];
  awayNames: string[];
}

interface AnTeam {
  id: number;
  full_name?: string;
  display_name?: string;
  short_name?: string;
  location?: string;
  abbr?: string;
}
interface AnOutcome {
  side: string;
  value: number;
  bet_info?: { tickets?: { percent?: number | null }; money?: { percent?: number | null } } | null;
}
interface AnGame {
  start_time: string;
  status?: string;
  home_team_id: number;
  away_team_id: number;
  teams: AnTeam[];
  num_bets?: number;
  markets?: Record<string, { event?: { spread?: AnOutcome[]; total?: AnOutcome[] } }>;
}

const pct = (o?: AnOutcome, k: "tickets" | "money" = "tickets") => {
  const v = o?.bet_info?.[k]?.percent;
  return typeof v === "number" ? v : undefined;
};

const names = (t?: AnTeam): string[] =>
  t ? [t.location, t.display_name, t.full_name, t.short_name, t.abbr].filter((x): x is string => !!x).map((x) => x.toLowerCase()) : [];

/** Every pregame game in a scoreboard response that has spread splits. */
export function parseScoreboard(json: unknown, at: string): SplitGame[] {
  const games = ((json as { games?: AnGame[] })?.games ?? []) as AnGame[];
  return games.flatMap((g) => {
    if (g.status && g.status !== "scheduled") return [];
    const books = g.markets ?? {};
    // Splits repeat on every book that carries them: take the first.
    const withSplits = Object.values(books).find((b) => b.event?.spread?.some((o) => pct(o) !== undefined));
    const spread = withSplits?.event?.spread ?? [];
    const home = spread.find((o) => o.side === "home");
    const away = spread.find((o) => o.side === "away");
    const homeTickets = pct(home);
    const homeMoney = pct(home, "money");
    if (homeTickets === undefined || homeMoney === undefined) return [];
    // Smaller college games show 0/0 until bets come in: no read, not "nobody on home".
    if (Math.abs(homeTickets + (pct(away) ?? -1) - 100) > 2) return [];
    const over = withSplits?.event?.total?.find((o) => o.side === "over");
    const homeLine = (b: string) => books[b]?.event?.spread?.find((o) => o.side === "home")?.value;
    const team = (id: number) => g.teams.find((t) => t.id === id);
    return [
      {
        start: g.start_time,
        homeNames: names(team(g.home_team_id)),
        awayNames: names(team(g.away_team_id)),
        homeTickets,
        homeMoney,
        overTickets: pct(over),
        overMoney: pct(over, "money"),
        open: homeLine(AN_BOOK_OPEN),
        dk: homeLine(AN_BOOK_DK),
        bets: g.num_bets,
        at,
      },
    ];
  });
}

// ---------------------------------------------------------------- matching

// Board names the feed spells differently.
const ALIAS: Record<string, string> = { massachusetts: "umass" };

const norm = (s: string) =>
  (ALIAS[s.toLowerCase()] ?? s)
    .toLowerCase()
    .replace(/\bst\.?\b/g, "state")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !GENERIC.has(t));

// Words that tell one college team from nothing: "georgia state" and
// "washington state" share "state" and must not score as half a match.
const GENERIC = new Set(["state", "university", "college", "the", "of"]);

/** 0-1: how well a board name (Sam's "ul monroe", or "NE") fits the feed's names for a team. */
export function nameScore(board: string, feed: string[]): number {
  const b = board.toLowerCase();
  if (feed.includes(b) || feed.includes(ALIAS[b] ?? "")) return 1;
  const bt = norm(board);
  let best = 0;
  for (const f of feed) {
    const ft = norm(f);
    const hit = bt.filter((t) => ft.includes(t)).length;
    if (bt.length && ft.length) best = Math.max(best, hit / Math.max(bt.length, ft.length));
  }
  // A word match never ties an exact one: "kansas state" must beat Kansas.
  return best * 0.9;
}

const KICKOFF_SLACK_MS = 60 * 60 * 1000;

/**
 * The feed's game for a board game: kickoff within an hour, then the best
 * name fit on both teams, with DraftKings' line agreeing as a tiebreak. Each
 * team must clear half a name, so a crowded noon college slate cannot hand
 * one game's splits to another.
 */
export function matchSplits(g: { home: string; away: string; kickoff?: string; line?: number }, feed: SplitGame[]): SplitGame | undefined {
  const t = g.kickoff ? Date.parse(g.kickoff) : NaN;
  let best: { s: SplitGame; score: number } | undefined;
  for (const s of feed) {
    if (!Number.isNaN(t) && Math.abs(Date.parse(s.start) - t) > KICKOFF_SLACK_MS) continue;
    const h = nameScore(g.home, s.homeNames);
    const a = nameScore(g.away, s.awayNames);
    if (h < 0.45 || a < 0.45) continue;
    const score = h + a + (g.line !== undefined && s.dk === g.line ? 0.25 : 0);
    if (!best || score > best.score) best = { s, score };
  }
  return best?.s;
}

/** The stored copy: the matched game without its name lists. */
export const toSplits = (s: SplitGame): Splits => ({
  homeTickets: s.homeTickets,
  homeMoney: s.homeMoney,
  overTickets: s.overTickets,
  overMoney: s.overMoney,
  open: s.open,
  dk: s.dk,
  bets: s.bets,
  at: s.at,
});

// ----------------------------------------------------------------- signals

/** Thresholds, per league: college lines move in bigger steps. */
export const SIGNAL = {
  /** A side is "the public" at this share of tickets or more. */
  PUBLIC_PCT: 65,
  /** Money share minus ticket share, in points, that counts as sharp on a side. */
  SHARP_GAP: 10,
  /** Points the line must move from the open to count as a move. */
  MIN_MOVE: { nfl: 0.5, cfb: 1, nba: 1 } as { [l in SplitsLeague]: number },
};

export interface MarketRead {
  /** Side holding PUBLIC_PCT+ of tickets, if any. */
  publicSide?: "home" | "away";
  /** Side where money share beats ticket share by SHARP_GAP+, if any. */
  sharpSide?: "home" | "away";
  /** Points the home line moved since the open (negative = toward home). */
  move?: number;
  /** The side the line moved toward, past MIN_MOVE. */
  movedToward?: "home" | "away";
  /** The line moved toward the side with the minority of tickets. */
  rlm?: "home" | "away";
}

/**
 * Reads one game's splits against the current home line. The line moving
 * toward home means home got more expensive: -3 to -4.5 is a move of -1.5.
 */
export function readMarket(league: SplitsLeague, s: Splits, line: number | undefined): MarketRead {
  const out: MarketRead = {};
  if (s.homeTickets >= SIGNAL.PUBLIC_PCT) out.publicSide = "home";
  else if (100 - s.homeTickets >= SIGNAL.PUBLIC_PCT) out.publicSide = "away";
  const gap = s.homeMoney - s.homeTickets;
  if (gap >= SIGNAL.SHARP_GAP) out.sharpSide = "home";
  else if (-gap >= SIGNAL.SHARP_GAP) out.sharpSide = "away";
  if (s.open !== undefined && line !== undefined) {
    out.move = Math.round((line - s.open) * 10) / 10;
    if (Math.abs(out.move) >= SIGNAL.MIN_MOVE[league]) {
      out.movedToward = out.move < 0 ? "home" : "away";
      const ticketsOn = out.movedToward === "home" ? s.homeTickets : 100 - s.homeTickets;
      if (ticketsOn < 50) out.rlm = out.movedToward;
    }
  }
  return out;
}
