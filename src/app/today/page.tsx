import { Suspense } from "react";
import { Freshness } from "@/components/hh/Freshness";
import { LiveResearch, type Feed } from "@/components/hh/activity-client";
import { loadChecks, recentLines } from "@/lib/money/activity";
import { getSnapshot } from "@/lib/money/store";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getPicksReport, type PicksReport } from "@/lib/picks/report";
import { getNbaBoard } from "@/lib/picks/nba-store";
import { forwardNote, totalsForwardNote, totalsStakes } from "@/lib/picks/forward";
import { tierStakes } from "@/lib/picks/engine";
import { getNbaPicksView } from "@/lib/picks/nba-track-store";
import { nbaGameHref, readGame } from "../picks/nba/NbaView";
import { findGame, scoreboard } from "@/lib/live/espn";
import { AutoRefresh } from "@/components/AutoRefresh";
import { TeamLogo, type LogoLeague } from "@/components/TeamLogo";
import { stakedNbaToday, stakedPropsToday, type StakedBet } from "@/lib/props/staked";
import { checkNote } from "@/lib/props/staked-core";
import { loadProducts } from "../props/top";
import type { ModelRow } from "../picks/board";
import { playerPropHref } from "../picks/hrefs";
import { LEAGUE_NAME, kickoffEt, line, price, rec } from "../picks/ui";
import { Call, Chip, Disclosure, Empty, Num, PageHead, Section, Spotlight, Stat, type Tone } from "@/components/hh/ui";
import { Meter, Sparkline } from "@/components/hh/charts";
import { TeamEdge } from "@/components/hh/team";
import { LiveScore } from "@/components/hh/LiveScore";
import { FantasySection, FantasySkeleton } from "./fantasy";
import { PortfolioToday, portfolioBig } from "./portfolio";
import { bigNews, type BigNews } from "@/lib/today/spotlight";

// Today (redesign, 2026-11-03): what to do right now. Answer first: one spotlight
// for the next best bet, taken over only by something big from the last 3 hours
// (a props slice going live or rolled back, a do-now portfolio trade; Jack,
// 2026-11-13: claims never take it, they stay at the bottom), then
// what is live and next beside the research desks' live feed, portfolio and the record, then claims and lineup changes. Model
// drivers and per-bet staking notes sit behind disclosures. Every stake shown is
// one the picks emails issued (or the allocator has ready to issue), never a
// tracked edge. Bets data assembly is unchanged from the Ledger version.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Today · Hobby Hub",
  description: "What to bet, claim and change right now, and what is live.",
};

const seasonOf = (d: Date) => (d.getMonth() < 7 ? d.getFullYear() - 1 : d.getFullYear());
const u = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}u`;

interface Logo {
  team: string;
  /** ESPN team id; college logos need it. */
  id?: string;
}

/** The lines behind a football bet, from the picked side: market, each model, and the estimated cover chance. */
interface Lines {
  market: number;
  sam?: number;
  david?: number;
  /** Estimated win probability (tier record pulled toward 50%): an estimate, not a calibration. */
  p?: number;
}

interface Slip {
  key: string;
  /** The side's team, or both teams for a total. */
  logos: { league: LogoLeague; teams: Logo[] };
  /** Board team keys, to find the live score. */
  awayKey?: string;
  homeKey?: string;
  league: string;
  pick: string;
  game: string;
  /** Live score line, kept apart from the matchup so it can tick. */
  score?: string;
  when: string;
  kickoff: string;
  state: "live" | "next";
  kind: "issued" | "ready" | "tracked";
  tier: string;
  stake?: number;
  /** The staking scheme behind a non-flat stake: "quarter Kelly". */
  stakeNote?: string;
  price?: number;
  note?: string;
  lines?: Lines;
  /** Where the card opens: the game pop-up. */
  href?: string;
}

/** Said once under Next up rather than on every row that is waiting to send. */
const READY_NOTE = "Not sent yet: it goes out as a late-add email within 30 minutes (none inside an hour of kickoff).";

/** "Missouri +2.5" -> name in the text face, the number in mono. */
function PickText({ pick, className = "" }: { pick: string; className?: string }) {
  const m = /^(.*?)\s([+−-]?\d+(?:\.\d+)?|PK)$/.exec(pick);
  if (!m) return <span className={`font-semibold ${className}`}>{pick}</span>;
  return (
    <span className={`font-semibold ${className}`}>
      {m[1]} <span className="hh-num">{m[2]}</span>
    </span>
  );
}

const sideLine = (homeLine: number, side: "home" | "away") => (side === "home" ? homeLine : -homeLine);

/** Issued and ready-to-issue football bets this week that are not final. */
function footballSlips(r: PicksReport): Slip[] {
  const n = (k: string) => r.names[k] ?? k;
  const out: Slip[] = [];
  for (const g of r.board) {
    if (g.final) continue;
    const ref = g.ref ?? g.lastRef;
    const kick = ref?.kickoff ?? "";
    const state = g.basis === "started" ? "live" : "next";
    const game = `${n(g.away)} at ${n(g.home)}`;
    const href = `/picks/game?l=${r.league}&g=${encodeURIComponent(`${g.away}@${g.home}`)}`;
    const team = (side: "home" | "away"): Logo => (side === "home" ? { team: g.home, id: ref?.homeId } : { team: g.away, id: ref?.awayId });
    const linesFor = (side: "home" | "away"): Lines | undefined =>
      ref ? { market: sideLine(ref.line, side), sam: g.sam ? sideLine(g.sam.model, side) : undefined, david: g.david ? sideLine(g.david.model, side) : undefined, p: g.p } : undefined;
    if (g.issued) {
      const side = g.issued.side;
      out.push({ href, key: `${r.league}-${g.home}`, awayKey: g.away, homeKey: g.home, logos: { league: r.league, teams: [team(side)] }, league: LEAGUE_NAME[r.league], pick: side === "home" ? `${n(g.home)} ${line(g.issued.homeLine)}` : `${n(g.away)} ${line(-g.issued.homeLine)}`, game, when: kickoffEt(kick), kickoff: kick, state, kind: "issued", tier: g.tier === "t1" ? "Tier 1" : g.tier === "t2" ? "Tier 2" : "Issued", stake: g.issued.units, price: g.issued.price, lines: linesFor(side) });
    } else if (g.stake && g.side && g.homeLine !== undefined && state === "next") {
      out.push({ href, key: `${r.league}-${g.home}`, logos: { league: r.league, teams: [team(g.side)] }, league: LEAGUE_NAME[r.league], pick: g.side === "home" ? `${n(g.home)} ${line(g.homeLine)}` : `${n(g.away)} ${line(-g.homeLine)}`, game, when: kickoffEt(kick), kickoff: kick, state, kind: "ready", tier: g.tier === "t1" ? "Tier 1" : "Tier 2", stake: g.stake, price: g.price, lines: linesFor(g.side), note: g.held ? `Early look: it locks ${kickoffEt(g.held)} at that morning's price.` : READY_NOTE });
    }
  }
  for (const t of r.totals.board) {
    const g = r.board.find((x) => x.home === t.home && x.away === t.away);
    if (!g || g.final || !t.issued) continue;
    const kick = (g.ref ?? g.lastRef)?.kickoff ?? "";
    out.push({ href: `/picks/game?l=${r.league}&g=${encodeURIComponent(`${t.away}@${t.home}`)}`, key: `${r.league}-${t.home}-ou`, awayKey: t.away, homeKey: t.home, logos: { league: r.league, teams: [{ team: g.away, id: (g.ref ?? g.lastRef)?.awayId }, { team: g.home, id: (g.ref ?? g.lastRef)?.homeId }] }, league: LEAGUE_NAME[r.league], pick: `${t.issued.side === "over" ? "Over" : "Under"} ${t.issued.line}`, game: `${n(t.away)} at ${n(t.home)}`, when: kickoffEt(kick), kickoff: kick, state: g.basis === "started" ? "live" : "next", kind: "issued", tier: "Totals rule", stake: t.issued.units, price: t.issued.price });
  }
  return out;
}

/**
 * Staked props and NBA bets (lib/props/staked.ts) as slips, the football way.
 * Only staked bets come back from there, never tracked ones. The note names the live slice.
 */
function stakedSlips(bets: StakedBet[], now: number): Slip[] {
  return bets.map((b): Slip => {
    const [away, home] = b.game.split(" at ");
    const league: LogoLeague = b.sport === "NBA" ? "nba" : "nfl";
    return {
      key: `staked-${b.id}`,
      // A one-player bet opens that player's pop-up; tickets and spreads open their board.
      href: b.player && b.team ? playerPropHref(league, b.team, b.player) : b.href,
      logos: { league, teams: home ? [{ team: away }, { team: home }] : [] },
      league: b.sport,
      pick: b.pick,
      game: b.game,
      when: kickoffEt(b.kickoff),
      kickoff: b.kickoff,
      state: Date.parse(b.kickoff) <= now ? "live" : "next",
      kind: "issued",
      tier: b.sectionName,
      stake: b.stake,
      ...(b.stakeNote ? { stakeNote: b.stakeNote } : {}),
      price: b.price,
      note: `${b.slice}${b.price === undefined ? ` · ${b.priceText}` : b.book && b.book !== "DraftKings" ? ` · at ${b.book}` : ""}${checkNote(b)}`,
    };
  });
}

const KIND: Record<Slip["kind"], { tone: Tone; text: (x: Slip) => string }> = {
  issued: { tone: "accent", text: (x) => `${x.tier} · ${x.stake}u${x.stakeNote ? `, ${x.stakeNote}` : ""}` },
  ready: { tone: "gold", text: (x) => `${x.tier} · not sent` },
  tracked: { tone: "muted", text: (x) => `${x.tier} · no stake` },
};

function Logos({ x, size = 28 }: { x: Slip; size?: number }) {
  const pair = x.logos.teams.length > 1;
  return (
    <span className={`flex shrink-0 items-center ${pair ? "-space-x-2" : ""}`}>
      {x.logos.teams.map((t) => (
        <TeamLogo key={t.team} league={x.logos.league} team={t.team} espnId={t.id} size={pair ? Math.round(size * 0.8) : size} />
      ))}
    </span>
  );
}

/** One bet on a hairline row, team colour on the edge. The row opens the game pop-up; the staking note waits behind Why. */
function BetRow({ x }: { x: Slip }) {
  const edgeTeam = x.logos.teams.length === 1 ? x.logos.teams[0].team : undefined;
  const k = KIND[x.kind];
  const body = (
    <div className="flex min-h-14 items-center gap-3 py-2.5">
      <Logos x={x} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <PickText pick={x.pick} className="text-[16px] text-hh-ink" />
          <Chip tone={x.state === "live" ? "live" : k.tone}>{x.state === "live" ? `Live · ${k.text(x)}` : k.text(x)}</Chip>
        </div>
        <p className="mt-0.5 truncate text-[13px] text-hh-muted">
          {x.state === "next" && x.when ? `${x.league} · ${x.when} · ${x.game}` : `${x.league} · ${x.game}`}
        </p>
        {x.note?.startsWith("Early look") && <p className="mt-0.5 text-xs text-hh-gold">{`Locks ${/locks (.*?) at that/.exec(x.note)?.[1] ?? "before kickoff"}`}</p>}
        {x.score && <LiveScore text={x.score} className="mt-0.5 inline-block text-[13px] text-hh-ink" />}
      </div>
      {x.kind !== "tracked" ? (
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <Num className="text-[16px] font-semibold text-hh-ink">{`${x.stake}u`}</Num>
          <Num className="text-xs text-hh-muted">{price(x.price)}</Num>
        </div>
      ) : (
        <span className="shrink-0 text-xs text-hh-muted">No stake</span>
      )}
    </div>
  );
  return (
    <div className="border-b border-hh-line last:border-b-0">
      <TeamEdge league={x.logos.league} team={edgeTeam}>
        {x.href ? (
          // The whole row opens the game pop-up (Jack, 2026-10-31: "click a bet from any sport and get the full picture").
          <Link href={x.href} scroll={false} aria-label={`${x.pick}: ${x.href.startsWith("/props/player") ? "open the player" : "open the game"}`} className="block rounded-[4px] transition-colors hover:bg-hh-sunk/60">
            {body}
          </Link>
        ) : (
          body
        )}
        {((x.note && x.note !== READY_NOTE && !x.note.startsWith("Early look")) || x.kind === "tracked") && (
          <Disclosure summary="Why" className="-mt-1">
            {x.note ?? "Tracked at the saved price. No stake."}
          </Disclosure>
        )}
      </TeamEdge>
    </div>
  );
}

/** The best bet, in the one box on the screen: teams, our numbers against the market, the cover chance, the call. */
function BetSpot({ x }: { x: Slip }) {
  const l = x.lines;
  const models = [l?.sam, l?.david].filter((v): v is number => v !== undefined);
  const avg = models.length ? models.reduce((a, b) => a + b, 0) / models.length : undefined;
  // Points past the market from the picked side: a lower (more negative) side line is better for that side.
  const edge = l && avg !== undefined ? l.market - avg : undefined;
  const fmt = (v: number) => line(Math.round(v * 10) / 10);
  return (
    <Spotlight label={x.kind === "ready" ? "Today's best bet, any sport · not sent yet" : "Today's best bet, any sport"} aside={x.state === "live" ? "Live now" : `${x.league} · ${x.when}`}>
      <Link href={x.href ?? "/picks"} scroll={false} className="group flex items-center gap-3">
        <Logos x={x} size={40} />
        <div className="min-w-0">
          <p className="font-display text-[32px] font-bold uppercase leading-none text-hh-ink group-hover:text-hh-accent-ink">{x.pick}</p>
          <p className="mt-1 truncate text-sm text-hh-muted">{x.game}</p>
        </div>
      </Link>
      {l && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { k: "Market", v: fmt(l.market) },
            { k: "Sam", v: l.sam !== undefined ? fmt(l.sam) : "none" },
            { k: "David", v: l.david !== undefined ? fmt(l.david) : "none" },
          ].map((c, i) => (
            <div key={c.k} className={`rounded-[4px] px-2.5 py-2 ${i === 0 ? "bg-hh-sunk" : "bg-hh-accent-soft"}`}>
              <span className="block text-[11px] text-hh-muted">{c.k}</span>
              <Num className={`text-[17px] font-semibold ${i === 0 ? "text-hh-ink" : i === 1 ? "text-hh-accent-ink" : "text-[var(--hh-david)]"}`}>{c.v}</Num>
            </div>
          ))}
        </div>
      )}
      {l?.p !== undefined && (
        <div className="mt-4">
          <Meter value={l.p} label="Cover chance (estimate)" />
        </div>
      )}
      <div className="mt-4">
        <Call
          verb={`${x.kind === "ready" ? "Ready:" : "Bet"} ${x.pick}, ${x.stake}u at ${price(x.price)}.`}
          reason={edge !== undefined && models.length === 2 ? `Sam and David average ${Math.abs(edge).toFixed(1)} points ${edge >= 0 ? "past" : "short of"} the market.` : undefined}
        />
      </div>
      {(x.note || x.tier) && (
        <Disclosure summary="Why this bet" className="mt-1">
          <p>{`${x.tier}${x.stakeNote ? `, ${x.stakeNote}` : ""}. The row opens the full game.`}</p>
          {x.note && <p className="mt-1">{x.note}</p>}
        </Disclosure>
      )}
    </Spotlight>
  );
}

const STATUS: Record<ModelRow["status"], { tone: Tone; text: string }> = {
  active: { tone: "accent", text: "Sets real stakes" },
  collecting: { tone: "muted", text: "Collecting evidence" },
  projections: { tone: "gold", text: "Projections only" },
  input: { tone: "muted", text: "Input to a rule" },
  unavailable: { tone: "neg", text: "Unavailable" },
};

export default async function TodayPage() {
  const season = seasonOf(new Date());
  const nowDate = new Date();
  const big = portfolioBig().catch(() => null);
  const [nfl, cfb, board, nbaView, nflProducts, nbaProducts, stakedProps, stakedNba] = await Promise.all([
    getPicksReport("nfl").catch(() => null),
    getPicksReport("cfb").catch(() => null),
    getNbaBoard().catch(() => null),
    getNbaPicksView().catch(() => null),
    loadProducts("nfl", season).catch(() => null),
    loadProducts("nba", season).catch(() => null),
    // Props from the start of today, so bets in play still show; NBA picks not yet tipped (started ones are in nbaLive).
    stakedPropsToday(nowDate, { since: new Date(nowDate.getTime() - 18 * 3_600_000) }).catch(() => ({ bets: [], problems: [] })),
    stakedNbaToday(nowDate).catch(() => ({ bets: [], problems: [] })),
  ]);
  const staked = stakedSlips([...stakedProps.bets, ...stakedNba.bets], nowDate.getTime());
  const reports = [nfl?.value, cfb?.value].filter((r): r is PicksReport => !!r);
  // Live scores for started football games (ESPN, free); NBA's board carries its own.
  const boards = await Promise.all(reports.map(async (r) => [r.league, r.board.some((g) => g.basis === "started" && !g.final) ? await scoreboard(r.league).catch(() => []) : []] as const));
  const scoreOf = (league: "nfl" | "cfb", away: string, home: string) => {
    const g = findGame(boards.find(([l]) => l === league)?.[1] ?? [], league, away, home);
    return g && g.state !== "pre" ? `${g.away.abbr || g.away.name} ${g.away.score}, ${g.home.abbr || g.home.name} ${g.home.score} · ${g.state === "post" ? "Final" : g.detail}` : undefined;
  };
  const football = reports
    .flatMap((r) => footballSlips(r).map((x) => (x.state === "live" ? { ...x, score: scoreOf(r.league, x.awayKey!, x.homeKey!) } : x)))
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff));

  // NBA: tonight's started games. Staked only once NBA's go-live gate clears; until then Sam's side is tracked.
  const nbaLive: Slip[] = (board?.days[0]?.games ?? [])
    .filter((g) => g.state === "in")
    .map((raw) => {
      const x = readGame(raw, nbaView);
      const picked = x.bet?.side === "home" ? raw.home : x.bet?.side === "away" ? raw.away : null;
      return {
        key: `nba-${raw.id}`,
        href: nbaGameHref(raw.id),
        logos: { league: "nba" as const, teams: picked ? [{ team: picked.abbr }] : [{ team: raw.away.abbr }, { team: raw.home.abbr }] },
        league: "NBA",
        // No saved read, or a read with no side (readGame then falls back to the matchup): nothing to show, so the row is left out.
        pick: x.r && x.pick !== `${raw.away.short} at ${raw.home.short}` ? x.pick : "",
        game: `${raw.away.short} at ${raw.home.short}`,
        score: `${raw.away.abbr} ${raw.score?.away ?? 0}, ${raw.home.abbr} ${raw.score?.home ?? 0}${raw.detail ? ` · ${raw.detail}` : ""}`,
        when: "",
        kickoff: raw.tip,
        state: "live" as const,
        kind: x.stake ? ("issued" as const) : ("tracked" as const),
        tier: x.stake ? `Tier ${x.tier}` : "Sam's side",
        stake: x.stake ?? undefined,
        price: x.pickPrice,
      };
    })
    .filter((x) => x.pick);

  const live = [...football.filter((x) => x.state === "live"), ...nbaLive, ...staked.filter((x) => x.state === "live")];
  const liveSorted = [...live.filter((x) => x.kind === "issued"), ...live.filter((x) => x.kind !== "issued")];
  const next = [...football.filter((x) => x.state === "next"), ...staked.filter((x) => x.state === "next")].sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const liveStakes = live.filter((x) => x.kind === "issued");
  const issuedNext = next.filter((x) => x.kind === "issued");
  const readyNext = next.filter((x) => x.kind === "ready");

  // The spotlight: the biggest issued bet not yet started (soonest breaks ties), else one ready to send.
  const betSpot = [...issuedNext].sort((a, b) => (b.stake ?? 0) - (a.stake ?? 0) || a.kickoff.localeCompare(b.kickoff))[0] ?? readyNext[0] ?? null;
  // Something big in the last 3 hours takes the box; otherwise the bet keeps it (claims never do).
  const news = bigNews(
    [...(nflProducts ?? []), ...(nbaProducts ?? [])].map((p) => ({ name: p.name, href: "/props", journal: p.learning.journal ?? [] })),
    await big,
    nowDate,
  );
  const spot = news ? null : betSpot;
  const nextRest = spot ? next.filter((x) => x.key !== spot.key) : next;

  // Which model drives each section, from the same data each page reads.
  const products = [...(nflProducts ?? []), ...(nbaProducts ?? [])].filter((p) => p.name !== "Sam's props");
  const propsLive = products.flatMap((p) => p.learning.entries.filter((e) => e.status === "active").map((e) => `${p.name}: ${e.label}`));
  const drivers: ModelRow[] = [
    ...reports.map((r): ModelRow => {
      const rule = r.strategies.rule;
      return rule
        ? { name: `${LEAGUE_NAME[r.league]} spreads`, role: `Rule: ${rule.label}`, status: tierStakes(rule) || tierStakes(r.strategies.second) ? "active" : "collecting", note: `Issues Tier 1 and Tier 2 with a saved price and a stake. ${rec(rule.record)} since tracking. Sam and David feed it; neither stakes alone.${forwardNote(r.strategies) ? ` ${forwardNote(r.strategies)}` : ""}` }
        : { name: `${LEAGUE_NAME[r.league]} spreads`, role: "No rule clears the bar", status: "collecting", note: "Nothing issues until a cut clears the bar. Every game is tracked." };
    }),
    ...reports.map((r): ModelRow => {
      const t = r.totals.backtest.rule;
      return t
        ? { name: `${LEAGUE_NAME[r.league]} totals`, role: `Rule: ${t.label}`, status: totalsStakes(t) ? "active" : "collecting", note: `${totalsStakes(t) ? "Issues totals bets with a saved price and a stake." : "Tracked with no stake until its forward check passes."}${totalsForwardNote(t) ? ` ${totalsForwardNote(t)}` : ""}` }
        : { name: `${LEAGUE_NAME[r.league]} totals`, role: "Both models agree", status: "collecting", note: "Tracked with no stake until a totals cut clears the bar." };
    }),
    nbaView
      ? { name: "NBA picks", role: "Sam's NBA reads", status: nbaView.gate.live ? "active" : "collecting", note: nbaView.gate.live ? "Tier bets carry stakes under NBA's own limits." : `Tracked, no stakes, until the go-live gate clears (${nbaView.gate.checks.filter((c) => c.ok).length} of ${nbaView.gate.checks.length} checks met).` }
      : { name: "NBA picks", role: "Sam's NBA reads", status: "unavailable", note: "Couldn't read the NBA record just now." },
    {
      name: "Props, all four markets",
      role: "Hobby Hub's own prop models",
      status: propsLive.length ? "active" : products.length ? "collecting" : "unavailable",
      note: propsLive.length ? `Live slices with real stakes: ${propsLive.join("; ")}. Everything else is tracked.` : products.length ? "Projecting every prop. No slice is live, so nothing in Props carries a stake." : "Couldn't read the Props learning just now.",
    },
    { name: "King of the Court", role: "Slate simulation", status: "projections", note: "Chance to lead tonight's slate in PRA. Never staked." },
  ];

  const settled = reports.reduce((a, r) => ({ w: a.w + r.units.total.w, l: a.l + r.units.total.l, p: a.p + r.units.total.p, units: a.units + r.units.total.units }), { w: 0, l: 0, p: 0, units: 0 });
  const openIssued = [...live, ...next].filter((x) => x.kind === "issued");
  // Units by week, running total, per league (the weeks of NFL and college don't line up, so they aren't summed).
  const curves = reports.map((r) => {
    const weeks = [...r.units.byWeek].sort((a, b) => a.week - b.week);
    let run = 0;
    return { league: LEAGUE_NAME[r.league], total: r.units.total, labels: weeks.map((w) => `Week ${w.week}`), values: weeks.map((w) => (run += w.ledger.units)) };
  });

  const today = nowDate.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "short", day: "numeric" });
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const sub = [
    live.length ? `${plural(liveStakes.length, "stake", "stakes")} in play` : "Nothing in play",
    issuedNext.length ? `${issuedNext.length} more issued and not started` : "none issued yet",
    readyNext.length ? `${plural(readyNext.length, "bet", "bets")} set and waiting to be emailed` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <main className="hh-page-in mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pb-16 pt-6 sm:px-6 sm:pt-10 lg:px-8">
      <PageHead
        title={today}
        sub={`${sub}.${propsLive.length ? "" : " Nothing in Props carries a stake."}`}
        aside={live.length ? <AutoRefresh intervalMs={600_000} label="Live games: refreshing every" /> : undefined}
      />
      <Freshness what={["lines", "props", "pulse"]} className="-mt-5" />

      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-8">
          {news ? <NewsSpot n={news} /> : spot ? <BetSpot x={spot} /> : <QuietSpot />}

          <Section
            id="t-live"
            label={
              <span className="inline-flex items-center gap-2">
                {live.length > 0 && <span className="hh-live-dot" aria-hidden />}
                Live now
              </span>
            }
            aside={live.length ? "Real stakes first, then sides we only track" : undefined}
          >
            {liveSorted.length ? liveSorted.map((x) => <BetRow key={x.key} x={x} />) : <Empty>Nothing is in play right now.</Empty>}
          </Section>

          <Section id="t-next" label="Next up" aside={<Num>{`${next.reduce((a, x) => a + (x.kind === "issued" ? (x.stake ?? 0) : 0), 0)}u issued, not started`}</Num>}>
            {nextRest.length ? nextRest.map((x) => <BetRow key={x.key} x={x} />) : <Empty>{spot ? "That's the only bet waiting." : "No issued bets are waiting to start."}</Empty>}
            {next.some((x) => x.note === READY_NOTE) && <p className="mt-3 text-xs leading-relaxed text-hh-muted">{`"Not sent" bets: ${READY_NOTE.replace("Not sent yet: it", "each")}`}</p>}
            {next.some((x) => x.note?.startsWith("Early look")) && <p className="mt-2 text-xs leading-relaxed text-hh-muted">An early look is sized now and locks at that morning&apos;s price, the time shown in gold.</p>}
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-8">
        <Section
          id="t-research"
          label="Research desks"
          aside={
            <Link href="/money" className="inline-flex min-h-11 items-center gap-0.5 font-semibold text-hh-accent-ink hover:underline">
              Money<ChevronRight size={14} aria-hidden />
            </Link>
          }
        >
          <Suspense fallback={<div className="h-24 animate-pulse rounded bg-hh-line" aria-hidden />}>
            <ResearchFeed />
          </Suspense>
        </Section>

          <Suspense fallback={null}>
            <PortfolioToday />
          </Suspense>

          <Section id="t-record" label="Issued record" aside={<Link href="/records" className="inline-flex min-h-11 items-center gap-0.5 font-semibold text-hh-accent-ink hover:underline">All records<ChevronRight size={14} aria-hidden /></Link>}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-5">
              <Stat
                label="Settled"
                value={settled.w + settled.l + settled.p ? u(settled.units) : "0-0"}
                sub={`${settled.w}-${settled.l}${settled.p ? `-${settled.p}` : ""} at each saved price`}
                tone={settled.w + settled.l ? (settled.units >= 0 ? "pos" : "neg") : undefined}
              />
              <Stat label="Open" value={`${openIssued.reduce((a, x) => a + (x.stake ?? 0), 0)}u`} sub={`${openIssued.length} bets not final`} />
            </div>
            <div className="mt-5 flex flex-col">
              {curves.map((c) => (
                <div key={c.league} className="flex items-center justify-between gap-4 border-t border-hh-line py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-hh-ink">{`${c.league} spreads and totals`}</p>
                    <Num className="text-xs text-hh-muted">{`${c.total.w}-${c.total.l}${c.total.p ? `-${c.total.p}` : ""} · `}</Num>
                    <Num className="text-xs" tone={c.total.units >= 0 ? "pos" : "neg"}>
                      {u(c.total.units)}
                    </Num>
                  </div>
                  <Sparkline values={c.values} labels={c.labels} label={`${c.league} issued units, running total by week`} format={u} width={132} height={40} />
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-hh-muted">
              {`${readyNext.length} set and waiting to be emailed, not counted until sent. Sides we only track carry no money and stay out of these totals; `}
              <Link href="/records" className="font-medium text-hh-accent-ink hover:underline">
                their records
              </Link>
              {" are kept apart."}
            </p>
          </Section>
        </div>
      </div>

      <Suspense fallback={<FantasySkeleton />}>
        <FantasySection skipTop={false} />
      </Suspense>

      <Section id="t-drivers" label="Details">
        <Disclosure summary="What drives each section">
          <ul className="mt-1 flex flex-col">
            {drivers.map((d) => (
              <li key={d.name} className="flex flex-col gap-1 border-b border-hh-line py-3 last:border-b-0 sm:flex-row sm:items-start sm:gap-6">
                <div className="flex shrink-0 flex-col gap-1 sm:w-56">
                  <span className="font-semibold text-hh-ink">{d.name}</span>
                  <span>
                    <Chip tone={STATUS[d.status].tone}>{STATUS[d.status].text}</Chip>
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-hh-ink-2">{d.role}</p>
                  <p className="mt-0.5 text-sm text-hh-muted">{d.note}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-hh-muted">
            <Link href="/picks" className="font-medium text-hh-accent-ink hover:underline">
              Picks
            </Link>
            {" and "}
            <Link href="/props" className="font-medium text-hh-accent-ink hover:underline">
              Props
            </Link>
            {" have the full lineups. "}
            <Chip tone="accent">Sets real stakes</Chip> its picks get real stakes. <Chip>Collecting evidence</Chip> tracked, no stakes, until it clears its gate.{" "}
            <Chip tone="gold">Projections only</Chip> numbers only, never staked.
          </p>
        </Disclosure>
      </Section>
    </main>
  );
}

/** Something big from the last 3 hours (lib/today/spotlight.ts). */
function NewsSpot({ n }: { n: BigNews }) {
  const t = new Date(n.at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  return (
    <Spotlight label={n.label} aside={`${t} ET`}>
      <Call verb={n.verb} reason={n.reason} />
      <Link href={n.href} className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-hh-accent-ink">
        Open <ChevronRight size={15} aria-hidden />
      </Link>
    </Spotlight>
  );
}

/** No bet waiting and nothing big: say so plainly. Claims and lineups are further down. */
function QuietSpot() {
  return (
    <Spotlight label="Next best bet">
      <Call verb="No bet is waiting right now." reason="The next one lands here when the picks email issues it. Claims and lineup changes are at the bottom of the page." />
      <Link href="/picks" className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-hh-accent-ink">
        Open Picks <ChevronRight size={15} aria-hidden />
      </Link>
    </Spotlight>
  );
}

/** What the Mac's money desks are doing right now, live (Jack, 2026-11-09). Streams in after the page. */
async function ResearchFeed() {
  let initial: Feed | null = null;
  try {
    const [lines, snap] = await Promise.all([recentLines(60), getSnapshot().catch(() => null)]);
    initial = { now: new Date().toISOString(), lines, checks: await loadChecks(snap) };
  } catch (e) {
    console.error("[today] research feed:", e);
  }
  return <LiveResearch initial={initial} />;
}
