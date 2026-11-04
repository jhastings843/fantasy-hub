import Link from "next/link";
import type { PicksReport } from "@/lib/picks/report";
import { TeamLogo } from "@/components/TeamLogo";
import { Call, Num, Spotlight } from "@/components/hh/ui";
import { Meter } from "@/components/hh/charts";
import { LEAGUE_NAME, kickoffEt, line, price } from "./ui";

// The one spotlight on the spreads board (redesign, 2026-11-03): this week's
// best bet not yet started. Issued first (biggest stake, then soonest), else
// the best one sized and ready to send. Same pick rule as Today. Nothing new is
// computed here; every number is read straight off the board row.

export function BoardSpot({ r }: { r: PicksReport }) {
  const n = (k: string) => r.names[k] ?? k;
  const open = r.board.filter((g) => !g.final && g.basis !== "started");
  const issued = open
    .filter((g) => g.issued)
    .sort((a, b) => (b.issued!.units - a.issued!.units) || (a.ref?.kickoff ?? "").localeCompare(b.ref?.kickoff ?? ""));
  const ready = open.filter((g) => !g.issued && g.stake && g.side && g.homeLine !== undefined).sort((a, b) => (a.ref?.kickoff ?? "").localeCompare(b.ref?.kickoff ?? ""));
  const g = issued[0] ?? ready[0];
  if (!g) return null;
  const side = g.issued ? g.issued.side : g.side!;
  const homeLine = g.issued ? g.issued.homeLine : g.homeLine!;
  const sl = (v: number) => (side === "home" ? v : -v);
  const team = side === "home" ? g.home : g.away;
  const ref = g.ref ?? g.lastRef;
  const pick = `${n(team)} ${line(sl(homeLine))}`;
  const stake = g.issued ? g.issued.units : g.stake!;
  const px = g.issued ? g.issued.price : g.price;
  const models = [g.sam?.model, g.david?.model].filter((v): v is number => v !== undefined).map(sl);
  const avg = models.length === 2 ? (models[0] + models[1]) / 2 : undefined;
  const edge = ref && avg !== undefined ? sl(ref.line) - avg : undefined;
  const fmt = (v: number) => line(Math.round(v * 10) / 10);
  const href = `/picks/game?l=${r.league}&g=${encodeURIComponent(`${g.away}@${g.home}`)}`;
  return (
    <Spotlight label={g.issued ? "Best bet this week" : "Best bet · sized, not sent"} aside={`${LEAGUE_NAME[r.league]} · ${kickoffEt(ref?.kickoff)}`}>
      <Link href={href} scroll={false} className="group flex items-center gap-3" data-first-pick>
        <TeamLogo league={r.league} team={team} espnId={side === "home" ? ref?.homeId : ref?.awayId} size={40} />
        <div className="min-w-0">
          <p className="font-display text-[30px] font-bold uppercase leading-none text-hh-ink group-hover:text-hh-accent-ink">{pick}</p>
          <p className="mt-1 truncate text-sm text-hh-muted">{`${n(g.away)} at ${n(g.home)}`}</p>
        </div>
      </Link>
      {ref && (
        <div className="mt-4 grid max-w-md grid-cols-3 gap-2">
          {[
            { k: "Market", v: fmt(sl(ref.line)), us: false, tone: "text-hh-ink" },
            { k: "Sam", v: g.sam ? fmt(sl(g.sam.model)) : "none", us: true, tone: "text-hh-accent-ink" },
            { k: "David", v: g.david ? fmt(sl(g.david.model)) : "none", us: true, tone: "text-[var(--hh-david)]" },
          ].map((c) => (
            <div key={c.k} className={`rounded-[4px] px-2.5 py-2 ${c.us ? "bg-hh-accent-soft" : "bg-hh-sunk"}`}>
              <span className="block text-[11px] text-hh-muted">{c.k}</span>
              <Num className={`text-[17px] font-semibold ${c.tone}`}>{c.v}</Num>
            </div>
          ))}
        </div>
      )}
      {g.p !== undefined && (
        <div className="mt-4 max-w-md">
          <Meter value={g.p} label="Cover chance (estimate)" />
        </div>
      )}
      <div className="mt-4">
        <Call
          verb={`${g.issued ? "Bet" : "Ready:"} ${pick}, ${stake}u at ${price(px)}.`}
          reason={edge !== undefined ? `Sam and David average ${Math.abs(edge).toFixed(1)} points ${edge >= 0 ? "past" : "short of"} the market.` : undefined}
        />
      </div>
    </Spotlight>
  );
}
