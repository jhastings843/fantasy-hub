import { cache } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getMyLeagues } from "@/lib/league/discover";
import { buildWeeklyLineups } from "@/lib/lineup/build";
import type { SlotAdvice } from "@/lib/lineup/weekly-advice";
import { buildWaivers, type WaiverContext } from "@/lib/waivers/build";
import type { SeasonTarget, StartableTarget } from "@/lib/waivers/rank";
import { mergePickups } from "@/lib/waivers/merge";
import { leaguePath } from "@/lib/league/tools";
import type { LeagueProfile } from "@/lib/league/types";
import { Call, Disclosure, Empty, Num, Section, Spotlight } from "@/components/hh/ui";

// Today's fantasy half: waiver claims and lineup changes, read from the same
// builders the league Waivers and Lineup pages use (lib/waivers, lib/lineup), so
// the numbers here are those pages' numbers. Streamed in behind the bets, since
// Sleeper and the rankings can be slow. Two of each claim kind per league, the
// way the midweek email lists them.

const PER_KIND = 2;
const PICKUPS_SHOWN = 3; // the Lineup page's own count

export interface Claim {
  key: string;
  leagueId: string;
  league: string;
  name: string;
  position: string;
  team: string | null;
  kind: "starts" | "season";
  bid: number | null;
  walkAway: number | null;
  tierLabel: string | null;
  longShot: boolean;
  drop: string;
  why: string | null;
  priceReason: string | null;
}

export interface LineupMove {
  key: string;
  leagueId: string;
  league: string;
  slot: string;
  start: string;
  sit: string | null;
  reason: string;
  pickup: boolean;
}

export interface FantasyNow {
  claims: Claim[];
  moves: LineupMove[];
  guillotine: LeagueProfile[];
  /** Leagues that could not be read, said out loud rather than shown empty. */
  problems: string[];
  week: number | null;
  /** Set when there is no weekly ranking list yet (lineup advice needs it). */
  lineupBlocked: string | null;
}

function dropText(dropFor: StartableTarget["dropFor"] | SeasonTarget["dropFor"]): string {
  if (dropFor === null) return "Open roster spot, no drop needed.";
  if (dropFor === undefined) return "No safe drop on your bench; pick one yourself or skip it.";
  return `Drop ${dropFor.name}.`;
}

function claimsOf(w: WaiverContext): Claim[] {
  const base = (t: StartableTarget | SeasonTarget, kind: Claim["kind"]) => ({
    key: `${w.leagueId}-${kind}-${t.player.playerId}`,
    leagueId: w.leagueId,
    league: w.leagueName,
    name: t.player.name,
    position: t.player.position,
    team: t.player.team,
    kind,
    bid: t.price?.bid ?? null,
    walkAway: t.price?.walkAway ?? null,
    tierLabel: t.price?.tierLabel ?? null,
    longShot: !!t.price?.longShot,
    priceReason: t.price?.reason ?? null,
  });
  const starts = w.report.startable.slice(0, PER_KIND).map(
    (t): Claim => ({ ...base(t, "starts"), drop: dropText(t.dropFor), why: t.displaces ? `Starts at ${t.slot} this week, ahead of ${t.displaces.name}.` : `Starts at ${t.slot} this week.` }),
  );
  const season = w.report.seasonUpgrades
    .filter((t) => !starts.some((s) => s.name === t.player.name))
    .slice(0, PER_KIND)
    .map((t): Claim => ({ ...base(t, "season"), drop: dropText(t.dropFor), why: t.why ?? (t.placesBetter ? `${t.placesBetter} places better on the season list than who you drop.` : null) }));
  return [...starts, ...season];
}

function moveOf(leagueId: string, league: string, slot: SlotAdvice, pickup: StartableTarget | null): LineupMove {
  const out = slot.benched ?? slot.current;
  return {
    key: `${leagueId}-${slot.index}`,
    leagueId,
    league,
    slot: slot.slot,
    start: pickup ? pickup.player.name : (slot.recommended?.name ?? "nobody"),
    sit: out?.name ?? null,
    reason: pickup ? `Free agent: ${dropText(pickup.dropFor).toLowerCase()}` : slot.reason,
    pickup: !!pickup,
  };
}

/** Cached per request, so the spotlight and the section share one read. */
export const getFantasyNow = cache(async (): Promise<FantasyNow> => {
  const problems: string[] = [];
  const all = await getMyLeagues().catch(() => {
    problems.push("Couldn't read your leagues from Sleeper just now.");
    return [] as LeagueProfile[];
  });
  const live = all.filter((l) => l.source !== "manual" && l.status === "in_season");
  const waiverLeagues = live.filter((l) => l.type !== "guillotine");

  const [waivers, lineups] = await Promise.all([
    Promise.allSettled(waiverLeagues.map((l) => buildWaivers(l.id))),
    buildWeeklyLineups().catch(() => null),
  ]);

  const byLeague = new Map<string, WaiverContext>();
  waivers.forEach((r, i) => {
    if (r.status === "fulfilled") byLeague.set(waiverLeagues[i].id, r.value);
    else problems.push(`Couldn't read waivers for ${waiverLeagues[i].name}.`);
  });

  const claims = [...byLeague.values()].flatMap(claimsOf);

  const moves: LineupMove[] = [];
  if (!lineups) problems.push("Couldn't build lineup advice just now.");
  for (const l of lineups?.leagues ?? []) {
    if (l.error) {
      problems.push(`${l.leagueName}: ${l.error}`);
      continue;
    }
    if (!live.some((x) => x.id === l.leagueId)) continue;
    const pickups = byLeague.get(l.leagueId)?.report.startable.slice(0, PICKUPS_SHOWN) ?? [];
    const merged = mergePickups(l.advice, pickups);
    for (const c of merged.changes) {
      // A locked slot is not a decision any more.
      if (c.slot.recommended?.locked) continue;
      moves.push(moveOf(l.leagueId, l.leagueName, c.slot, c.pickup));
    }
  }

  return {
    claims,
    moves,
    guillotine: live.filter((l) => l.type === "guillotine"),
    problems,
    week: lineups?.week ?? [...byLeague.values()].find((w) => w.week != null)?.week ?? null,
    lineupBlocked: lineups?.blocked ?? null,
  };
});

function ClaimRow({ c }: { c: Claim }) {
  return (
    <div className="border-b border-hh-line py-3 last:border-b-0">
      <Link href={leaguePath(c.leagueId, "waivers")} className="group flex min-h-11 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold text-hh-ink group-hover:text-hh-accent-ink">{c.name}</span>
            <Num className="text-xs text-hh-muted">{`${c.position}${c.team ? ` · ${c.team}` : ""}`}</Num>
          </div>
          <p className="mt-0.5 text-sm text-hh-ink-2">{c.drop}</p>
          <p className="mt-0.5 text-xs text-hh-muted">{`${c.league} · ${c.kind === "starts" ? "starts this week" : "season upgrade"}`}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          {c.bid !== null ? <Num className="text-[22px] font-semibold leading-none text-hh-accent-ink">{`$${c.bid}`}</Num> : <span className="text-xs text-hh-muted">no bid set</span>}
          {c.walkAway !== null && c.bid !== null && c.walkAway > c.bid && <Num className="text-xs text-hh-muted">{`stop at $${c.walkAway}`}</Num>}
        </div>
      </Link>
      {(c.why || c.priceReason || c.longShot) && (
        <Disclosure summary="Why">
          {c.why && <p>{c.why}</p>}
          {c.tierLabel && <p className="mt-1">{`${c.tierLabel}.`}</p>}
          {c.priceReason && <p className="mt-1">{c.priceReason}</p>}
          {c.longShot && <p className="mt-1 text-hh-neg">The room will likely pay more than he is worth to you.</p>}
        </Disclosure>
      )}
    </div>
  );
}

function MoveRow({ m }: { m: LineupMove }) {
  return (
    <div className="border-b border-hh-line py-3 last:border-b-0">
      <Link href={leaguePath(m.leagueId, "lineup")} className="group flex min-h-11 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] leading-snug text-hh-ink">
            <b className="font-semibold group-hover:text-hh-accent-ink">{`${m.pickup ? "Add" : "Start"} ${m.start}`}</b>
            {m.sit && <span className="text-hh-ink-2">{` over ${m.sit}`}</span>}
          </p>
          <p className="mt-0.5 text-xs text-hh-muted">{m.league}</p>
        </div>
        <Num className="shrink-0 rounded-[4px] border border-hh-line px-1.5 py-0.5 text-xs text-hh-ink-2">{m.slot}</Num>
      </Link>
      <Disclosure summary="Why">{m.reason}</Disclosure>
    </div>
  );
}

/** Spotlight for Today when no bet is waiting: the top claim, else the top lineup change. */
export async function FantasySpot() {
  const f = await getFantasyNow();
  const c = f.claims[0];
  const m = f.moves[0];
  if (c) {
    return (
      <Spotlight label={`Top claim · ${c.league}`} aside={f.week ? `Week ${f.week} waivers` : undefined}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-display text-[28px] font-bold uppercase leading-none text-hh-ink">{c.name}</p>
            <Num className="mt-1 block text-sm text-hh-muted">{`${c.position}${c.team ? ` · ${c.team}` : ""}`}</Num>
          </div>
          {c.bid !== null && <Num className="text-[34px] font-semibold leading-none text-hh-accent-ink">{`$${c.bid}`}</Num>}
        </div>
        <div className="mt-4">
          <Call verb={c.bid !== null ? `Claim for $${c.bid}.` : "Claim him."} reason={c.drop} />
        </div>
        {(c.why || c.priceReason) && (
          <Disclosure summary="Why this claim" className="mt-1">
            {c.why && <p>{c.why}</p>}
            {c.priceReason && <p className="mt-1">{c.priceReason}</p>}
          </Disclosure>
        )}
      </Spotlight>
    );
  }
  if (m) {
    return (
      <Spotlight label={`Lineup change · ${m.league}`}>
        <Call verb={`${m.pickup ? "Add" : "Start"} ${m.start}${m.sit ? ` over ${m.sit}` : ""}.`} reason={m.reason} />
        <Link href={leaguePath(m.leagueId, "lineup")} className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-hh-accent-ink">
          Open the lineup <ChevronRight size={15} aria-hidden />
        </Link>
      </Spotlight>
    );
  }
  return (
    <Spotlight label="Nothing urgent">
      <Call verb="No bets waiting, no claims worth making, every lineup set." reason="Check back when the next slate posts." />
    </Spotlight>
  );
}

/** Claims and lineup changes, on rules. `skipTop` drops whatever the spotlight already shows. */
export async function FantasySection({ skipTop }: { skipTop: boolean }) {
  const f = await getFantasyNow();
  const claims = skipTop && f.claims.length ? f.claims.slice(1) : f.claims;
  const moves = skipTop && !f.claims.length && f.moves.length ? f.moves.slice(1) : f.moves;
  return (
    <>
      <Section
        id="t-claims"
        label="Waiver claims"
        aside={<Num>{`${f.claims.length} worth making`}</Num>}
      >
        {claims.length ? claims.map((c) => <ClaimRow key={c.key} c={c} />) : <Empty>{f.claims.length ? "That's the only one this week." : "Nothing worth claiming in your waiver leagues."}</Empty>}
        {f.guillotine.map((g) => (
          <Link key={g.id} href={leaguePath(g.id, "faab")} className="flex min-h-11 items-center justify-between gap-3 border-t border-hh-line pt-2 text-sm text-hh-ink-2 hover:text-hh-accent-ink">
            <span>{`${g.name}: guillotine bids have their own guide`}</span>
            <ChevronRight size={15} aria-hidden />
          </Link>
        ))}
      </Section>
      <Section id="t-lineup" label="Lineup changes" aside={<Num>{`${f.moves.length} to make`}</Num>}>
        {f.lineupBlocked ? <Empty>{f.lineupBlocked}</Empty> : moves.length ? moves.map((m) => <MoveRow key={m.key} m={m} />) : <Empty>{f.moves.length ? "That's the only one." : "Every lineup already matches the rankings."}</Empty>}
        {f.problems.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 text-xs text-hh-neg">
            {f.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

/** Same shape as the sections, so nothing jumps when they arrive. */
export function FantasySkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading claims and lineups">
      {[0, 1].map((i) => (
        <div key={i} className="hh-ruled flex flex-col gap-3">
          <div className="h-3 w-28 animate-pulse rounded bg-[var(--hh-track)]" />
          <div className="h-11 animate-pulse rounded bg-[var(--hh-track)] opacity-70" />
          <div className="h-11 animate-pulse rounded bg-[var(--hh-track)] opacity-50" />
        </div>
      ))}
    </div>
  );
}
