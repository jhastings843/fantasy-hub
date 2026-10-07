// Jay's PEM card, as rows. Pure: the validation and the row shape, with no
// network and no model, so the checks can be tested against a card read by
// hand (test/fixtures/picks/pem-week5.csv).
//
// A card read by a vision model is only trusted when it checks itself:
//   every row's EDGE must equal the gap between PEM's line and the market
//   line, to within rounding; and the number of rows must match the count in
//   Jay's post ("All 58 games"). A card that fails either is stored as
//   unverified and kept off the backtest until someone looks.

import { teamKey } from "./parse";

/** One game as the vision read returns it. Lines are from the named team's side. */
export interface CardRow {
  away: string;
  home: string;
  /** The market favorite as printed, and the line (negative). Empty on a pick'em. */
  lineTeam?: string;
  line?: number;
  /** PEM's favorite and line (negative), as printed. */
  pemTeam: string;
  pem: number;
  edge?: number;
  awayPts?: number;
  homePts?: number;
}

/** Stored form: keyed like the other two models, home-side lines. */
export interface PemRow {
  away: string;
  home: string;
  awayName: string;
  homeName: string;
  /** PEM's line, home side. */
  model: number;
  /** The card's market line, home side. */
  market?: number;
}

export interface PemWeek {
  season: number;
  week: number;
  rows: PemRow[];
  verified: boolean;
  problems: string[];
  source: string;
  at: string;
}

/** "TROY" or "Troy" to whichever of the two teams it names. */
function sideOf(name: string, away: string, home: string): "home" | "away" | null {
  const k = teamKey("cfb", name);
  const h = teamKey("cfb", home);
  const a = teamKey("cfb", away);
  if (k === h) return "home";
  if (k === a) return "away";
  // Abbreviations: match on initials or a prefix of the folded name.
  const initials = (s: string) => s.split(" ").map((w) => w[0]).join("");
  const kk = k.replace(/ /g, "");
  if (h.replace(/ /g, "").startsWith(kk) || initials(h) === kk) return "home";
  if (a.replace(/ /g, "").startsWith(kk) || initials(a) === kk) return "away";
  // Last resort for abbreviations like JXST or TLSA: whichever team's name
  // holds more of the letters, in order. Only when one clearly wins.
  const fit = (abbr: string, team: string) => {
    let i = 0;
    let hit = 0;
    for (const ch of abbr) {
      const j = team.indexOf(ch, i);
      if (j >= 0) {
        hit++;
        i = j + 1;
      }
    }
    return hit / abbr.length;
  };
  const fh = fit(kk, h.replace(/ /g, ""));
  const fa = fit(kk, a.replace(/ /g, ""));
  if (kk.length <= 5 && Math.abs(fh - fa) >= 0.25) return fh > fa ? "home" : "away";
  return null;
}

export function toRows(card: CardRow[]): { rows: PemRow[]; problems: string[] } {
  const rows: PemRow[] = [];
  const problems: string[] = [];
  for (const c of card) {
    const label = `${c.away} at ${c.home}`;
    const ps = sideOf(c.pemTeam, c.away, c.home);
    if (!ps) {
      problems.push(`${label}: PEM's team "${c.pemTeam}" is neither side`);
      continue;
    }
    const model = ps === "home" ? -Math.abs(c.pem) : Math.abs(c.pem);
    let market: number | undefined;
    if (c.line !== undefined && c.line !== null && c.lineTeam) {
      const ls = sideOf(c.lineTeam, c.away, c.home);
      if (!ls) problems.push(`${label}: line team "${c.lineTeam}" is neither side`);
      else market = ls === "home" ? -Math.abs(c.line) : Math.abs(c.line);
    } else if (c.line === 0) market = 0;
    if (market !== undefined && c.edge !== undefined && c.edge !== null) {
      const gap = Math.abs(model - market);
      if (Math.abs(gap - c.edge) > 0.15) problems.push(`${label}: edge ${c.edge} but lines are ${gap.toFixed(1)} apart`);
    }
    rows.push({
      away: teamKey("cfb", c.away),
      home: teamKey("cfb", c.home),
      awayName: c.away,
      homeName: c.home,
      model,
      market,
    });
  }
  return { rows, problems };
}

/** "All 58 games", "58 FBS matchups": the count Jay states, if any. */
export function statedCount(text: string): number | null {
  const m = text.match(/all (\d+) games|(\d+) (?:fbs )?(?:matchups|games)/i);
  return m ? Number(m[1] ?? m[2]) : null;
}

/** Which week a card post is for, and whether it is the pre-week picks card. */
export function cardKind(text: string): { week: number; kind: "picks" | "final" } | null {
  const pick = text.match(/week (\d+) PEM picks/i) ?? text.match(/PEM week (\d+) picks/i);
  if (pick) return { week: Number(pick[1]), kind: "picks" };
  const fin = text.match(/PEM week (\d+) card, with every final|week (\d+) final card/i);
  if (fin) return { week: Number(fin[1] ?? fin[2]), kind: "final" };
  return null;
}
