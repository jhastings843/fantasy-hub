"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LAB_300_BY_SLEEPER_ID, jinglesAppliesTo } from "@/lib/jingles/data";
import { useLeagueType } from "@/components/LeagueTypeProvider";

// A consistent name link to the player profile. Used everywhere a
// player name is rendered. `stopPropagation` lets us nest the link
// inside a <label> (e.g. trade builder checkboxes) without toggling
// the parent control on click.
//
// It also carries the Jingles rank, and that is on purpose rather than for
// convenience. Jack asked for the Lab 300 rank to be visible anywhere a
// player's value is shown, and a player's value is shown in about ten places:
// rosters, the trade builder, the draft board, recommendations, search, the
// plan. Adding a chip to each of those is ten chances for the next surface to
// be built without one. This is the one component all of them already go
// through, so a new page gets it for free.
//
// The league comes from the URL rather than a prop. Every caller already
// renders inside /l/[leagueId], and threading the id through dozens of call
// sites would buy nothing.
export function PlayerLink({
  id,
  name,
  className = "",
  stopPropagation = false,
  leagueId: league,
}: {
  id: string;
  /** Needed outside /l/[leagueId] pages (Today); inside them the path supplies it. */
  leagueId?: string;
  name: string;
  className?: string;
  stopPropagation?: boolean;
}) {
  const pathname = usePathname() ?? "";
  const leagueId = league ?? pathname.split("/")[2] ?? "";
  const leagueType = useLeagueType();

  // Half-PPR REDRAFT research, so redraft and guillotine only. In a dynasty
  // league this renders nothing at all: a rank built on the next four months is
  // not an opinion about the next three years, and putting it beside a dynasty
  // value would invite exactly the trade it cannot support.
  const lab = jinglesAppliesTo(leagueType) ? LAB_300_BY_SLEEPER_ID[id] : undefined;

  return (
    <span className="inline-flex items-baseline gap-1.5">
      <Link
        href={`/l/${leagueId}/player/${id}`}
        // Opens as a pop-up over the page (app/@modal/(.)l/...); typed or shared, the full profile.
        scroll={false}
        className={`underline decoration-transparent underline-offset-[3px] hover:text-hh-accent-ink hover:decoration-current ${className}`}
        onClick={
          stopPropagation
            ? (e) => {
                e.stopPropagation();
              }
            : undefined
        }
      >
        {name}
      </Link>
      {lab ? <JinglesRank rank={lab.rank} position={lab.position} positionRank={lab.positionRank} /> : null}
    </span>
  );
}

// The rank, small enough to sit beside a name without competing with it.
//
// Overall rank is the number, because that is what answers "who do I take".
// The position rank is the title, so hovering explains the number without a
// second chip crowding every row on the page.
function JinglesRank({
  rank,
  position,
  positionRank,
}: {
  rank: number;
  position: string;
  positionRank: number;
}) {
  return (
    <span
      title={`Jingles Lab 300: ${rank} overall, ${position}${positionRank}. Half-PPR redraft.`}
      className="shrink-0 rounded px-1 py-px font-mono text-[10px] font-medium leading-none tabular-nums text-zinc-500 ring-1 ring-inset ring-zinc-200 dark:text-zinc-400 dark:ring-zinc-700"
    >
      {rank}
    </span>
  );
}
