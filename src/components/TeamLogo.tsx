"use client";

// A team's logo from ESPN's CDN, sized for board rows. NFL and NBA resolve
// from the team abbreviation (ours or ESPN's); college needs ESPN's team id,
// since names vary too much to map. A missing or failed logo renders an empty
// box of the same size, so rows stay aligned either way.

export type LogoLeague = "nfl" | "nba" | "cfb";

// Our abbreviations that differ from ESPN's file names.
const ESPN_ABBR: Record<LogoLeague, Record<string, string>> = {
  nfl: { WAS: "wsh", LA: "lar", JAC: "jax" },
  nba: { GSW: "gs", NYK: "ny", SAS: "sa", NOP: "no", UTA: "utah", WAS: "wsh", PHO: "phx", BRK: "bkn" },
  cfb: {},
};

export function teamLogoUrl(league: LogoLeague, team: string | null | undefined, espnId?: string | number | null): string | null {
  if (league === "cfb") return espnId != null && espnId !== "" ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${espnId}.png` : null;
  if (!team) return null;
  const up = team.toUpperCase();
  const code = ESPN_ABBR[league][up] ?? up.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/${league}/500/${code}.png`;
}

export function TeamLogo({ league, team, espnId, size = 20, className = "" }: { league: LogoLeague; team?: string | null; espnId?: string | number | null; size?: number; className?: string }) {
  const src = teamLogoUrl(league, team, espnId);
  const box = { width: size, height: size };
  if (!src) return <span aria-hidden className={`inline-block shrink-0 ${className}`} style={box} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden
      loading="lazy"
      width={size}
      height={size}
      className={`inline-block shrink-0 object-contain ${className}`}
      style={box}
      onError={(e) => {
        e.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}
