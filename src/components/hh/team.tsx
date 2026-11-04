import type { CSSProperties, ReactNode } from "react";
import { TeamLogo, type LogoLeague } from "@/components/TeamLogo";

// Team colours for row edges. Primary first; the second colour is used in dark
// mode when the primary would vanish on near-black (Raiders black, Bears navy).
// College has no table (too many teams), so its rows get the neutral rule.

type Pair = [string, string];

const NFL: Record<string, Pair> = {
  ARI: ["#97233F", "#FFB612"], ATL: ["#A71930", "#A5ACAF"], BAL: ["#241773", "#9E7C0C"], BUF: ["#00338D", "#C60C30"],
  CAR: ["#0085CA", "#BFC0BF"], CHI: ["#0B162A", "#C83803"], CIN: ["#FB4F14", "#FB4F14"], CLE: ["#311D00", "#FF3C00"],
  DAL: ["#003594", "#869397"], DEN: ["#FB4F14", "#FB4F14"], DET: ["#0076B6", "#B0B7BC"], GB: ["#203731", "#FFB612"],
  HOU: ["#03202F", "#A71930"], IND: ["#002C5F", "#A2AAAD"], JAX: ["#006778", "#D7A22A"], KC: ["#E31837", "#FFB81C"],
  LV: ["#000000", "#A5ACAF"], LAC: ["#0080C6", "#FFC20E"], LAR: ["#003594", "#FFA300"], MIA: ["#008E97", "#FC4C02"],
  MIN: ["#4F2683", "#FFC62F"], NE: ["#002244", "#C60C30"], NO: ["#D3BC8D", "#D3BC8D"], NYG: ["#0B2265", "#A71930"],
  NYJ: ["#125740", "#FFFFFF"], PHI: ["#004C54", "#A5ACAF"], PIT: ["#FFB612", "#FFB612"], SF: ["#AA0000", "#B3995D"],
  SEA: ["#002244", "#69BE28"], TB: ["#D50A0A", "#FF7900"], TEN: ["#4B92DB", "#4B92DB"], WAS: ["#5A1414", "#FFB612"],
};
const NFL_ALIAS: Record<string, string> = { WSH: "WAS", LA: "LAR", JAC: "JAX", OAK: "LV", SD: "LAC", STL: "LAR" };

const NBA: Record<string, Pair> = {
  ATL: ["#E03A3E", "#C1D32F"], BOS: ["#007A33", "#BA9653"], BKN: ["#000000", "#FFFFFF"], CHA: ["#1D1160", "#00788C"],
  CHI: ["#CE1141", "#CE1141"], CLE: ["#860038", "#FDBB30"], DAL: ["#00538C", "#B8C4CA"], DEN: ["#0E2240", "#FEC524"],
  DET: ["#C8102E", "#1D42BA"], GS: ["#1D428A", "#FFC72C"], HOU: ["#CE1141", "#C4CED4"], IND: ["#002D62", "#FDBB30"],
  LAC: ["#C8102E", "#1D428A"], LAL: ["#552583", "#FDB927"], MEM: ["#5D76A9", "#5D76A9"], MIA: ["#98002E", "#F9A01B"],
  MIL: ["#00471B", "#EEE1C6"], MIN: ["#0C2340", "#78BE20"], NO: ["#0C2340", "#C8102E"], NY: ["#006BB6", "#F58426"],
  OKC: ["#007AC1", "#EF3B24"], ORL: ["#0077C0", "#C4CED4"], PHI: ["#006BB6", "#ED174C"], PHX: ["#1D1160", "#E56020"],
  POR: ["#E03A3E", "#E03A3E"], SAC: ["#5A2D81", "#9E8FB5"], SA: ["#C4CED4", "#C4CED4"], TOR: ["#CE1141", "#CE1141"],
  UTA: ["#002B5C", "#F9A01B"], WAS: ["#002B5C", "#E31837"],
};
const NBA_ALIAS: Record<string, string> = { BRK: "BKN", GSW: "GS", NOP: "NO", NYK: "NY", PHO: "PHX", SAS: "SA", UTAH: "UTA", WSH: "WAS" };

function luminance(hex: string): number {
  const c = hex
    .replace("#", "")
    .match(/../g)!
    .map((x) => parseInt(x, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** [light-mode colour, dark-mode colour] for a team, or null when we have no table for it. */
export function teamColors(league: LogoLeague, abbr: string | null | undefined): Pair | null {
  if (!abbr || league === "cfb") return null;
  const up = abbr.toUpperCase();
  const pair = league === "nfl" ? NFL[NFL_ALIAS[up] ?? up] : NBA[NBA_ALIAS[up] ?? up];
  if (!pair) return null;
  const [primary, second] = pair;
  // Near-black primaries disappear on #0e1116; very light ones disappear on paper.
  const dark = luminance(primary) < 0.035 ? second : primary;
  const light = luminance(primary) > 0.55 ? second : primary;
  return [light, dark];
}

/** CSS variables for a team edge; pair with the hh-team-edge utility classes below. */
export function teamVars(league: LogoLeague, abbr: string | null | undefined): CSSProperties {
  const c = teamColors(league, abbr);
  return { ["--tc-l" as string]: c?.[0] ?? "var(--hh-line)", ["--tc-d" as string]: c?.[1] ?? "var(--hh-line)" };
}

/** A row with the team's colour as a 3px left edge. */
export function TeamEdge({ league, team, children, className = "" }: { league: LogoLeague; team?: string | null; children: ReactNode; className?: string }) {
  return (
    <div style={teamVars(league, team)} className={`border-l-[3px] border-[var(--tc-l)] pl-3 dark:border-[var(--tc-d)] ${className}`}>
      {children}
    </div>
  );
}

/** Logo plus abbreviation, the way game rows name a team. */
export function TeamTag({ league, team, espnId, name, size = 22 }: { league: LogoLeague; team: string; espnId?: string | number | null; name?: string; size?: number }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <TeamLogo league={league} team={team} espnId={espnId} size={size} />
      <span className="truncate font-semibold text-hh-ink">{name ?? team}</span>
    </span>
  );
}
