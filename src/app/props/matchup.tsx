// The game cell on every Props board (Jack, 2026-10-27: "space it out so it's
// the same throughout no matter the teams, time underneath, maybe channel,
// logos"): away over home, each with its logo, then kickoff and channel on
// their own line. Fixed rhythm, so long names never push a row out of line.
import { TeamLogo, type LogoLeague } from "@/components/TeamLogo";
import { PopLink } from "@/components/hh/PopLink";
import { teamHref } from "../picks/hrefs";
import { whenEt } from "../picks/ui";
import p from "./props.module.css";

export interface MatchupProps {
  league: LogoLeague;
  away: string;
  home: string;
  /** Kickoff or tip, ISO. */
  when?: string;
  /** "live" and "final" replace the time; a score line can ride along. */
  state?: "pre" | "live" | "final";
  score?: string;
  tv?: string;
  /** The game pop-up: each team name opens it. */
  href?: string;
}

export function Matchup({ league, away, home, when, state = "pre", score, tv, href }: MatchupProps) {
  // No game link (past graded games): each pro team opens its own team pop-up instead.
  const awayHref = href ?? (league === "nfl" || league === "nba" ? teamHref(league, away) : undefined);
  const homeHref = href ?? (league === "nfl" || league === "nba" ? teamHref(league, home) : undefined);
  const day = when ? new Date(when).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }) : "";
  const status = state === "live" ? "Live" : state === "final" ? (day ? `Final · ${day}` : "Final") : when ? whenEt(when) : "";
  return (
    <span className={p.mu}>
      <span className={p.muTeam}>
        <TeamLogo league={league} team={away} size={18} />
        <span className={p.muName}>{awayHref ? <PopLink href={awayHref}>{away}</PopLink> : away}</span>
      </span>
      <span className={p.muTeam}>
        <TeamLogo league={league} team={home} size={18} />
        <span className={p.muName}>
          <span className={p.muAt}>at </span>
          {homeHref ? <PopLink href={homeHref}>{home}</PopLink> : home}
        </span>
      </span>
      <span className={p.muWhen}>
        {state === "live" ? <span className={p.muLive}>{status}</span> : status}
        {score ? <span className={p.muScore}>{` · ${score}`}</span> : null}
        {tv && state !== "final" ? <span>{` · ${tv}`}</span> : null}
      </span>
    </span>
  );
}
