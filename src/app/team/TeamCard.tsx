import type { ReactNode } from "react";
import { getPicksReport, type PicksReport } from "@/lib/picks/report";
import type { BoardGame } from "@/lib/picks/engine";
import { getNbaBoard, type NbaBoardGame } from "@/lib/picks/nba-store";
import { getCbbBoard, type CbbBoardRow } from "@/lib/models/cbb/store";
import { getOurNflView } from "@/lib/models/nfl/store";
import { getOurNbaView } from "@/lib/models/nba/store";
import { nbaSeasonOfDate, type PropMarket } from "@/lib/props/parse";
import type { StoredProps } from "@/lib/props/store";
import { findGame, scoreboard, type LiveGame } from "@/lib/live/espn";
import { nbaAbbr, nflAbbr, proName, sportsLine, type TeamSport } from "@/lib/search/teams";
import { TeamLogo, type LogoLeague } from "@/components/TeamLogo";
import { PopLink } from "@/components/hh/PopLink";
import { Chip, Empty, Num, Row, Section, type Tone } from "@/components/hh/ui";
import { cbbGameHref, footballGameHref, nbaGameHref, playerPropHref } from "@/app/picks/hrefs";
import { kickoffEt, line, price } from "@/app/picks/ui";
import { STATUS_TEXT, pickText, statusOf } from "@/app/picks/ats";

// One organisation across every sport the site covers (Jack, 2026-11-03: "I
// click them and it has an organization block pop up that shows each sport
// separately and all relevant information"). Read only: every number is read
// straight off this week's boards; each loader fails on its own and only its
// section says so.

const seasonOf = (d: Date) => (d.getUTCMonth() < 7 ? d.getUTCFullYear() - 1 : d.getUTCFullYear());
const safe = <T,>(p: Promise<T>): Promise<T | "error"> => p.catch(() => "error" as const);
const PROPS_MAX = 8;

type Parsed = { kind: "nfl"; abbr: string } | { kind: "nba"; abbr: string } | { kind: "ncaa"; id: string } | { kind: "cfb"; boardKey: string };

export function parseTeamKey(k: string): Parsed | null {
  const i = k.indexOf(":");
  if (i < 1) return null;
  const lg = k.slice(0, i);
  const v = k.slice(i + 1).trim();
  if (!v) return null;
  if (lg === "nfl") return { kind: "nfl", abbr: nflAbbr(v) };
  if (lg === "nba") return { kind: "nba", abbr: nbaAbbr(v) };
  if (lg === "ncaa" && /^\d+$/.test(v)) return { kind: "ncaa", id: v };
  if (lg === "cfb") return { kind: "cfb", boardKey: v };
  return null;
}

/* -------------------------------------------------------------- bits -- */

function Cell({ k, v, tone }: { k: string; v: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 rounded-[4px] bg-hh-sunk px-2.5 py-2">
      <span className="block text-[11px] text-hh-muted">{k}</span>
      <span className={`text-[16px] font-semibold ${tone ?? "text-hh-ink"}`}>{v}</span>
    </div>
  );
}

const none = <span className="text-sm font-normal text-hh-muted">none</span>;
const fmt = (v: number) => line(Math.round(v * 10) / 10);

function Matchup({ league, href, at, oppName, oppAbbr, oppId, right }: { league: LogoLeague; href: string; at: boolean; oppName: string; oppAbbr?: string; oppId?: string; right: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <PopLink href={href} className="inline-flex min-w-0 items-center gap-2 font-semibold text-hh-ink">
        <span className="text-sm font-normal text-hh-muted">{at ? "at" : "vs"}</span>
        <TeamLogo league={league} team={oppAbbr} espnId={oppId} size={24} />
        <span className="truncate">{oppName}</span>
      </PopLink>
      <div className="text-sm text-hh-ink-2">{right}</div>
    </div>
  );
}

function Score({ label, tone, away, home, awayName, homeName }: { label: string; tone: Tone; away: number; home: number; awayName: string; homeName: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Chip tone={tone}>{label}</Chip>
      <span>
        {awayName} <Num>{away}</Num>, {homeName} <Num>{home}</Num>
      </span>
    </span>
  );
}

/* ---------------------------------------------------------- football -- */

const TIER: Record<BoardGame["tier"], string> = { t1: "Tier 1", t2: "Tier 2", wait: "Waiting on PEM", fav: "Favorite rule", pass: "Pass", split: "Models split", one: "One model only" };

function FootballGame({ r, g, side, live }: { r: PicksReport; g: BoardGame; side: "home" | "away"; live?: LiveGame }) {
  const n = (k: string) => r.names[k] ?? k;
  const sl = (v: number) => (side === "home" ? v : -v);
  const ref = g.ref ?? g.lastRef;
  const opp = side === "home" ? g.away : g.home;
  const oppId = side === "home" ? ref?.awayId : ref?.homeId;
  const st = statusOf(g);
  const right = g.final ? (
    <Score label="Final" tone="muted" away={g.final.away} home={g.final.home} awayName={n(g.away)} homeName={n(g.home)} />
  ) : live && live.state !== "pre" ? (
    <Score label={live.state === "post" ? "Final" : live.detail || "Live"} tone={live.state === "post" ? "muted" : "live"} away={live.away.score} home={live.home.score} awayName={n(g.away)} homeName={n(g.home)} />
  ) : (
    <span>{kickoffEt(ref?.kickoff)}</span>
  );

  let read: ReactNode;
  if (g.issued) {
    const team = g.issued.side === "home" ? g.home : g.away;
    const res = g.results?.issued;
    read = (
      <>
        <Chip tone="accent">Bet sent</Chip> <b className="text-hh-ink">{`${n(team)} `}<Num>{line(g.issued.side === "home" ? g.issued.homeLine : -g.issued.homeLine)}</Num></b> · <Num>{g.issued.units}u</Num> at <Num>{price(g.issued.price)}</Num>
        {res && <> · <Num tone={res === "W" ? "pos" : res === "L" ? "neg" : "muted"}>{res}</Num></>}
      </>
    );
  } else if ((st === "bet" || st === "early") && g.stake) {
    read = (
      <>
        <Chip tone="gold">{st === "early" ? "Early look" : "Sized, not sent"}</Chip> <b className="text-hh-ink">{pickText(g, n)}</b> · <Num>{g.stake}u</Num> at <Num>{price(g.price)}</Num>
      </>
    );
  } else {
    read = (
      <>
        {/* The chip already names the tier; skip the status when it says the same word ("Pass Pass"). */}
        <Chip tone="muted">{TIER[g.tier]}</Chip> {STATUS_TEXT[st] !== TIER[g.tier] ? STATUS_TEXT[st] : ""}
        {g.side || g.tier === "split" ? <> · {pickText(g, n)}</> : null} · no bet
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-b border-hh-line pb-4 last:border-b-0 last:pb-0">
      <Matchup league={r.league} href={footballGameHref(r.league, g.away, g.home)} at={side === "away"} oppName={(r.league === "nfl" ? proName(`nfl:${nflAbbr(opp)}`) : null) ?? n(opp)} oppAbbr={r.league === "nfl" ? opp : undefined} oppId={oppId} right={right} />
      <div className="grid max-w-md grid-cols-3 gap-2">
        <Cell k="Market" v={ref ? <Num>{fmt(sl(ref.line))}</Num> : none} />
        <Cell k="Sam" v={g.sam ? <Num>{fmt(sl(g.sam.model))}</Num> : none} tone="text-hh-accent-ink" />
        <Cell k="David" v={g.david ? <Num>{fmt(sl(g.david.model))}</Num> : none} tone="text-[var(--hh-david)]" />
      </div>
      <p className="text-sm leading-relaxed text-hh-ink-2">{read}</p>
    </div>
  );
}

async function FootballSection({ league, report, match, label }: { league: "nfl" | "cfb"; report: PicksReport | null | "error"; match: (g: BoardGame) => "home" | "away" | null; label: string }) {
  const word = league === "nfl" ? label : label.toLowerCase();
  if (report === "error") return <Section label={label}><Empty>The {word} board could not be read just now.</Empty></Section>;
  const games = (report?.board ?? []).flatMap((g) => {
    const side = match(g);
    return side ? [{ g, side }] : [];
  });
  if (!report || !games.length) return <Section label={label}><Empty>No {word} game on the board this week.</Empty></Section>;
  const live = games.some(({ g }) => g.basis === "started" && !g.final) ? await scoreboard(league).catch(() => [] as LiveGame[]) : [];
  return (
    <Section label={label} aside="Lines from this team's side">
      <div className="flex flex-col gap-4">
        {games.map(({ g, side }) => (
          <FootballGame key={`${g.away}@${g.home}`} r={report} g={g} side={side} live={findGame(live, league, g.away, g.home)} />
        ))}
      </div>
    </Section>
  );
}

/* --------------------------------------------------------------- NBA -- */

function NbaGameBlock({ g, me }: { g: NbaBoardGame; me: string }) {
  const side = nbaAbbr(g.home.abbr) === me ? "home" : "away";
  const sl = (v: number) => (side === "home" ? v : -v);
  const opp = side === "home" ? g.away : g.home;
  const r = g.read;
  const right =
    g.state === "pre" ? (
      <span>{kickoffEt(g.tip)}</span>
    ) : (
      <Score label={g.state === "post" ? "Final" : g.detail || "Live"} tone={g.state === "post" ? "muted" : "live"} away={g.score?.away ?? 0} home={g.score?.home ?? 0} awayName={g.away.abbr} homeName={g.home.abbr} />
    );
  const samTeam = r ? (r.side === "home" ? g.home : g.away) : null;
  return (
    <div className="flex flex-col gap-3 border-b border-hh-line pb-4 last:border-b-0 last:pb-0">
      <Matchup league="nba" href={nbaGameHref(g.id)} at={side === "away"} oppName={opp.name} oppAbbr={opp.abbr} right={right} />
      <div className="grid max-w-md grid-cols-3 gap-2">
        <Cell k="Market" v={g.line ? <Num>{fmt(sl(g.line.home))}</Num> : none} />
        <Cell k="Sam" v={r ? <Num>{fmt(sl(r.model))}</Num> : none} tone="text-hh-accent-ink" />
        <Cell k="Total" v={g.total ? <Num>{g.total.points}</Num> : none} />
      </div>
      <p className="text-sm leading-relaxed text-hh-ink-2">
        {r && samTeam && g.line ? (
          <>
            <Chip tone={r.crossed ? "muted" : "accent"}>{r.crossed ? "Line moved past Sam" : "Sam's side"}</Chip> <b className="text-hh-ink">{`${samTeam.short} `}<Num>{line(r.side === "home" ? g.line.home : -g.line.home)}</Num></b> · edge <Num>{r.edge.toFixed(1)}</Num>
            {r.totalSide && r.modelTotal !== undefined && (
              <>
                {` · ${r.totalSide === "over" ? "Over" : "Under"}, his total `}
                <Num>{r.modelTotal}</Num>
              </>
            )}
          </>
        ) : (
          "No Sam read on this game yet."
        )}
      </p>
    </div>
  );
}

function NbaSection({ board, me }: { board: Awaited<ReturnType<typeof getNbaBoard>> | "error"; me: string }) {
  if (board === "error") return <Section label="NBA"><Empty>The NBA board could not be read just now.</Empty></Section>;
  const seen = new Set<string>();
  const games = [...(board.yesterday?.games ?? []), ...board.days.flatMap((d) => d.games)].filter(
    (g) => (nbaAbbr(g.home.abbr) === me || nbaAbbr(g.away.abbr) === me) && !seen.has(g.id) && !!seen.add(g.id),
  );
  const next = games.find((g) => g.state !== "post");
  const last = [...games].reverse().find((g) => g.state === "post");
  const show = [last, next].filter((g): g is NbaBoardGame => !!g);
  if (!show.length) return <Section label="NBA"><Empty>No NBA game on the board in the next few days.</Empty></Section>;
  return (
    <Section label="NBA" aside="Lines from this team's side">
      <div className="flex flex-col gap-4">
        {show.map((g) => (
          <NbaGameBlock key={g.id} g={g} me={me} />
        ))}
      </div>
    </Section>
  );
}

/* --------------------------------------------------------------- CBB -- */

const pct = (p: number) => (p > 0.99 ? ">99%" : p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`);

function CbbGameBlock({ x, id }: { x: CbbBoardRow; id: string }) {
  const { g, read: r, saved } = x;
  const side = g.home.id === id ? "home" : "away";
  const sl = (v: number) => (side === "home" ? v : -v);
  const opp = side === "home" ? g.away : g.home;
  // Under way or over: our read from before tip (the saved copy), as the search box shows it.
  const pre = g.state === "pre" ? null : saved?.first;
  const v =
    g.state === "pre"
      ? { sp: r.line?.spread ?? null, tot: r.line?.total ?? null, ours: r.proj.spread, oursTot: r.proj.total, homeWin: r.proj.homeWin }
      : pre
        ? { sp: pre.spread, tot: pre.total, ours: pre.ours.spread, oursTot: pre.ours.total, homeWin: pre.ours.homeWin }
        : null;
  const right =
    g.state === "pre" ? (
      <span>{kickoffEt(g.tip)}</span>
    ) : (
      <Score label={g.state === "post" ? "Final" : g.detail || "Live"} tone={g.state === "post" ? "muted" : "live"} away={g.score?.away ?? 0} home={g.score?.home ?? 0} awayName={g.away.abbr || g.away.short} homeName={g.home.abbr || g.home.short} />
    );
  const edge = v && v.sp !== null ? v.sp - v.ours : null; // > 0: home side has the value
  const pick = edge !== null && edge !== 0 && v && v.sp !== null ? (edge > 0 ? { t: g.home.short, l: v.sp } : { t: g.away.short, l: -v.sp }) : null;
  return (
    <div className="flex flex-col gap-3 border-b border-hh-line pb-4 last:border-b-0 last:pb-0">
      <Matchup league="cfb" href={cbbGameHref(g.id)} at={side === "away" && !g.neutral} oppName={`${opp.rank ? `${opp.rank} ` : ""}${opp.short}`} oppId={opp.id} right={right} />
      {v ? (
        <>
          <div className="grid max-w-md grid-cols-3 gap-2">
            <Cell k="Market" v={v.sp !== null ? <Num>{fmt(sl(v.sp))}</Num> : none} />
            <Cell k="Ours" v={<Num>{fmt(sl(v.ours))}</Num>} tone="text-hh-accent-ink" />
            <Cell k="To win" v={<Num>{pct(side === "home" ? v.homeWin : 1 - v.homeWin)}</Num>} />
          </div>
          <p className="text-sm leading-relaxed text-hh-ink-2">
            {pick ? (
              <>
                <Chip tone="accent">Our side</Chip> <b className="text-hh-ink">{`${pick.t} `}<Num>{line(pick.l)}</Num></b> · edge <Num>{Math.abs(edge!).toFixed(1)}</Num>
              </>
            ) : (
              <>
                <Chip tone="muted">No side</Chip> {v.sp === null ? "No DK line yet" : "Our number matches the market"}
              </>
            )}
            {" · total "}
            {v.tot !== null ? <Num>{v.tot}</Num> : "none"}
            {", ours "}
            <Num>{v.oursTot}</Num>
          </p>
        </>
      ) : (
        <p className="text-sm text-hh-muted">Not priced before tip.</p>
      )}
    </div>
  );
}

function CbbSection({ board, id }: { board: Awaited<ReturnType<typeof getCbbBoard>> | "error"; id: string }) {
  if (board === "error") return <Section label="College hoops"><Empty>The college hoops board could not be read just now.</Empty></Section>;
  const rows = board.days.flatMap((d) => d.rows).filter((x) => x.g.home.id === id || x.g.away.id === id);
  const next = rows.find((x) => x.g.state !== "post");
  const last = [...rows].reverse().find((x) => x.g.state === "post");
  const show = [last, next].filter((x): x is CbbBoardRow => !!x);
  if (!show.length) return <Section label="College hoops"><Empty>No college hoops game on the board today or tomorrow.</Empty></Section>;
  return (
    <Section label="College hoops" aside="Lines from this team's side">
      <div className="flex flex-col gap-4">
        {show.map((x) => (
          <CbbGameBlock key={x.g.id} x={x} id={id} />
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------- props -- */

function PropsSection({ league, board, me }: { league: "nfl" | "nba"; board: StoredProps[] | "error"; me: string }) {
  const label = `${league.toUpperCase()} props`;
  if (board === "error") return <Section label={label}><Empty>Props could not be read just now.</Empty></Section>;
  const norm = league === "nfl" ? nflAbbr : nbaAbbr;
  const players = new Map<string, { m: PropMarket; slug: string; more: number }>();
  for (const s of board) {
    if (s.result) continue;
    for (const m of s.game.markets) {
      if (!m.clears || !m.side || norm(m.team) !== me) continue;
      const k = m.player.toLowerCase();
      const p = players.get(k);
      if (p) p.more++;
      else players.set(k, { m, slug: s.game.slug, more: 0 });
    }
  }
  const list = [...players.values()].slice(0, PROPS_MAX);
  if (!list.length) return <Section label={label}><Empty>No player on this team has a tracked edge on the current board.</Empty></Section>;
  return (
    <Section label={label} aside="Tracked edges, our model">
      <div>
        {list.map(({ m, slug, more }) => (
          <Row key={m.id}>
            <PopLink href={playerPropHref(league, m.team, m.player, league === "nba" ? slug : undefined)} className="min-w-0 truncate font-semibold text-hh-ink">
              {m.player}
            </PopLink>
            <span className="shrink-0 text-right text-sm text-hh-ink-2">
              {`${m.side === "over" ? "Over" : "Under"} `}
              <Num>{m.line}</Num> {m.statLabel.toLowerCase()} · ours <Num>{m.model}</Num>
              {more > 0 && (
                <span className="text-hh-muted">
                  {" · +"}
                  <Num>{more}</Num> more
                </span>
              )}
            </span>
          </Row>
        ))}
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------- card -- */

function Header({ name, sports, league, abbr, espnId }: { name: string; sports: TeamSport[]; league: LogoLeague; abbr?: string; espnId?: string }) {
  return (
    <header className="flex items-center gap-4 pr-10">
      <TeamLogo league={league} team={abbr} espnId={espnId} size={64} />
      <div className="min-w-0">
        <h1 className="font-display text-[30px] font-bold uppercase leading-none tracking-[0.02em] text-hh-ink sm:text-[36px]">{name}</h1>
        <p className="mt-1.5 text-sm text-hh-muted">{sportsLine(sports)}</p>
      </div>
    </header>
  );
}

const Shell = ({ children }: { children: ReactNode }) => <div className="flex flex-col gap-8 p-5 sm:p-7">{children}</div>;

/** The team's display name for a key, for a page title or dialog label (pro teams only; college needs the boards). */
export const teamLabel = (k: string) => proName(k) ?? "Team";

export default async function TeamCard({ k }: { k: string }) {
  const p = parseTeamKey(k);
  if (!p) return <Shell><Empty>That team isn&apos;t one the site knows. Try the search box.</Empty></Shell>;
  const now = new Date();

  if (p.kind === "nfl") {
    const [rep, view] = await Promise.all([safe(getPicksReport("nfl")), safe(getOurNflView(seasonOf(now)))]);
    const report = rep === "error" ? "error" : rep.value;
    return (
      <Shell>
        <Header name={proName(`nfl:${p.abbr}`) ?? p.abbr} sports={["NFL"]} league="nfl" abbr={p.abbr} />
        <FootballSection league="nfl" label="NFL" report={report} match={(g) => (nflAbbr(g.home) === p.abbr ? "home" : nflAbbr(g.away) === p.abbr ? "away" : null)} />
        <PropsSection league="nfl" board={view === "error" ? "error" : view.board} me={p.abbr} />
      </Shell>
    );
  }

  if (p.kind === "nba") {
    const [board, view] = await Promise.all([safe(getNbaBoard(now)), safe(getOurNbaView(nbaSeasonOfDate(now), now))]);
    return (
      <Shell>
        <Header name={proName(`nba:${p.abbr}`) ?? p.abbr} sports={["NBA"]} league="nba" abbr={p.abbr} />
        <NbaSection board={board} me={p.abbr} />
        <PropsSection league="nba" board={view === "error" ? "error" : view.board} me={p.abbr} />
      </Shell>
    );
  }

  if (p.kind === "cfb") {
    const rep = await safe(getPicksReport("cfb"));
    const report = rep === "error" ? "error" : rep.value;
    const name = report !== "error" ? (report?.names[p.boardKey] ?? p.boardKey) : p.boardKey;
    return (
      <Shell>
        <Header name={name} sports={["CFB"]} league="cfb" />
        <FootballSection league="cfb" label="College football" report={report} match={(g) => (g.home === p.boardKey ? "home" : g.away === p.boardKey ? "away" : null)} />
      </Shell>
    );
  }

  // College: one ESPN id across football and hoops.
  const id = p.id;
  const [rep, cbb] = await Promise.all([safe(getPicksReport("cfb")), safe(getCbbBoard(now, 1))]);
  const report = rep === "error" ? "error" : rep.value;
  const ids = (g: BoardGame) => g.ref ?? g.lastRef;
  const cfbMatch = (g: BoardGame) => (ids(g)?.homeId === id ? "home" : ids(g)?.awayId === id ? "away" : null);
  const cbbTeam = cbb === "error" ? undefined : cbb.days.flatMap((d) => d.rows).flatMap((x) => [x.g.home, x.g.away]).find((t) => t.id === id);
  const cfbGame = report === "error" ? undefined : report?.board.find((g) => cfbMatch(g));
  const cfbName = cfbGame && report !== "error" && report ? report.names[cfbMatch(cfbGame) === "home" ? cfbGame.home : cfbGame.away] : undefined;
  const sports: TeamSport[] = [...(cfbGame ? (["CFB"] as const) : []), ...(cbbTeam ? (["CBB"] as const) : [])];
  return (
    <Shell>
      <Header name={cbbTeam?.name ?? cfbName ?? "College team"} sports={sports.length ? sports : ["CFB", "CBB"]} league="cfb" espnId={id} />
      <FootballSection league="cfb" label="College football" report={report} match={cfbMatch} />
      <CbbSection board={cbb} id={id} />
    </Shell>
  );
}
