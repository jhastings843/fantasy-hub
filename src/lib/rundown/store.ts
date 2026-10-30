import "server-only";
// Readers for the nightly rundown: each market's settled plays, taken from the
// same functions its own page (or /records) uses, as `MarketSource`s for
// assemble.ts. Nothing is graded here that a page doesn't already grade; a
// market with no unit grading gets `hasUnits: false` and `net: null`.
import { getPicksCore } from "@/lib/picks/report";
import { loadIssued } from "@/lib/picks/issued-store";
import { confirmed, type IssuedRecord } from "@/lib/picks/issued";
import { unitReport, type BetRow } from "@/lib/picks/units";
import { firstSends } from "@/lib/picks/update";
import { key as gameKey } from "@/lib/picks/engine";
import type { League } from "@/lib/picks/parse";
import { redisStore as footballLearning } from "@/lib/picks/learning/store";
import { getNbaPicksView } from "@/lib/picks/nba-track-store";
import { settledRows } from "@/lib/picks/nba-track";
import { getPoolEntry, canon } from "@/lib/picks/pool-store";
import { gradeTeams } from "@/lib/picks/pool";
import { allBoards, getNbaSectionLearning, getOurNbaView } from "@/lib/models/nba/store";
import { getKotcNights } from "@/lib/models/nba/kotc-store";
import { rungsOf, tickets, STAKE } from "@/lib/models/nba/lotto";
import { getOurNflView } from "@/lib/models/nfl/store";
import { attdGraded, getAttdLearning, getOurFtdView } from "@/lib/models/nfl/ftd-store";
import { bestBets } from "@/lib/models/nfl/ftd-price";
import { ourSliceBets } from "@/lib/models/learn";
import { ATTD_SLICES, SECTIONS, taggedProp } from "@/lib/models/sections";
import { MODEL_KEYS, storedParams } from "@/lib/models/params-store";
import { payout } from "@/lib/props/parse";
import type { GradedPropsGame } from "@/lib/props/trends";
import type { SectionView } from "@/lib/learning/engine";
import { getSeasonGames } from "@/lib/survivor/odds";
import { getPool } from "@/lib/survivor/state";
import { POOLS } from "@/lib/survivor/pools";
import { SEASON as SURVIVOR_SEASON } from "@/lib/survivor/report";
import { entryStatus } from "@/lib/survivor/status";
import { american, etDay, oneSentence, type MarketSource, type Play, type RundownEvent } from "./assemble";

const LEAGUE_LABEL: Record<League, string> = { nfl: "NFL", cfb: "College" };
const line = (x: number) => (x > 0 ? `+${x}` : `${x}`);
/** "20261029" -> "2026-10-29" */
const ymd = (d: string) => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d);

// ------------------------------------------------------------ football issued

/**
 * The issued book, exactly as /records and the Money page total it:
 * unitReport over firstSends(confirmed(records)) with the core's finals.
 * A bet's day is its kickoff; a game-day send without one is dated by when it went out.
 */
function betDay(b: BetRow): string | null {
  if (b.kickoff) return etDay(b.kickoff);
  if (b.sentAt && b.slot?.startsWith("g") && !Number.isNaN(Date.parse(b.sentAt))) return etDay(b.sentAt);
  return null;
}

function betLabel(b: BetRow, names: { [k: string]: string }): string {
  const n = (k: string) => names[k] ?? k;
  return b.legs
    .map((l) =>
      l.side === "over" || l.side === "under"
        ? `${l.side === "over" ? "Over" : "Under"} ${l.line} ${n(l.away)}-${n(l.home)}`
        : l.side === "home"
          ? `${n(l.home)} ${line(l.line)}`
          : `${n(l.away)} ${line(-l.line)}`,
    )
    .join(" + ");
}

async function footballIssued(league: League): Promise<MarketSource[]> {
  const core = (await getPicksCore(league)).value;
  if (!core) return [];
  const records = firstSends(confirmed(await loadIssued(league, core.season)));
  const finals = new Map(core.finals);
  const units = unitReport(records, finals);
  const L = LEAGUE_LABEL[league];
  const by: { [k in BetRow["kind"]]: Play[] } = { spread: [], total: [], parlay: [] };
  for (const wk of units.byWeek)
    for (const b of wk.bets) {
      // Unstaked early plays sit in each Picks page's W-L, not in /records; same here.
      if (b.unstaked || b.result === undefined) continue;
      by[b.kind].push({
        day: betDay(b),
        at: b.kickoff ?? b.sentAt ?? "",
        result: b.result,
        net: b.net ?? 0,
        label: betLabel(b, core.names),
        price: b.price !== undefined ? american(b.price) : b.decimal ? american(b.decimal >= 2 ? (b.decimal - 1) * 100 : -100 / (b.decimal - 1)) : null,
      });
    }
  const out: MarketSource[] = [
    { key: `${league}-spreads`, label: `${L} spreads`, sport: league, issued: true, hasUnits: true, plays: by.spread },
    { key: `${league}-totals`, label: `${L} totals`, sport: league, issued: true, hasUnits: true, plays: by.total },
  ];
  if (by.parlay.length) out.push({ key: `${league}-parlays`, label: `${L} parlays`, sport: league, issued: true, hasUnits: true, plays: by.parlay });
  out.push({ key: `${league}-straight-up`, label: `${L} straight up`, sport: league, issued: true, hasUnits: false, plays: suPlays(records, finals, core.names) });
  return out;
}

/**
 * Straight-up picks the emails showed, graded as gradeIssued does (a tie
 * counts neither way), each game once at its first send. No units: they're
 * sent without a stake and /records doesn't total them.
 */
function suPlays(records: IssuedRecord[], finals: Map<string, { home: number; away: number }>, names: { [k: string]: string }): Play[] {
  const seen = new Set<string>();
  const out: Play[] = [];
  for (const rec of records)
    for (const p of rec.su) {
      if (!p.shownInEmail) continue;
      const k = gameKey({ week: rec.week, home: p.home, away: p.away });
      if (seen.has(k)) continue;
      seen.add(k);
      const f = finals.get(k);
      if (!f || f.home === f.away) continue;
      const kickoff = [...rec.plays, ...(rec.totals ?? [])].find((x) => x.home === p.home && x.away === p.away)?.kickoff;
      const day = kickoff ? etDay(kickoff) : rec.slot?.startsWith("g") ? etDay(rec.issuedAt) : null;
      const team = p.side === "home" ? p.home : p.away;
      out.push({ day, at: kickoff ?? rec.issuedAt, result: (p.side === "home") === f.home > f.away ? "W" : "L", net: null, label: names[team] ?? team, price: null });
    }
  return out;
}

// ------------------------------------------------------------ NBA game picks

async function nbaGamePicks(): Promise<MarketSource[]> {
  const v = await getNbaPicksView();
  const by: { [m: string]: Play[] } = { ats: [], ou: [], su: [] };
  // Every Sam side, total and straight-up pick at the saved DK price: the "ats:all" / "ou:all" / "su:all" cuts, per game.
  for (const { game: g, bet } of settledRows(v.games)) {
    const team = bet.side === "home" ? g.home : g.away;
    const label = bet.market === "ou" ? `${bet.side === "over" ? "Over" : "Under"} ${bet.line} ${g.away}-${g.home}` : bet.market === "su" ? `${team} ML` : `${team} ${line(bet.line)}`;
    by[bet.market]?.push({ day: ymd(g.day), at: g.tip, result: bet.result!, net: bet.net ?? 0, label, price: bet.price !== undefined ? american(bet.price) : null });
  }
  return [
    { key: "nba-spreads", label: "NBA spreads (Sam, tracked)", sport: "nba", issued: false, hasUnits: true, plays: by.ats },
    { key: "nba-totals", label: "NBA totals (Sam, tracked)", sport: "nba", issued: false, hasUnits: true, plays: by.ou },
    { key: "nba-straight-up", label: "NBA straight up (Sam, tracked)", sport: "nba", issued: false, hasUnits: true, plays: by.su },
  ];
}

// ------------------------------------------------------------------ props

/** Every tracked edge ("edge:all"), 1u at the saved price: the /records shadow row, per prop. */
function propPlays(graded: GradedPropsGame[]): Play[] {
  return ourSliceBets(graded, "edge:all").map(({ x, bet, marketId, line: ln }) => {
    const at = x.kickoff ?? x.capturedAt ?? "";
    const [stat, player] = marketId.split("|");
    return {
      day: at ? etDay(at) : null,
      at,
      result: bet.outcome === "W" ? "W" : bet.outcome === "L" ? "L" : "P",
      net: bet.net,
      label: `${player ?? marketId} ${bet.side} ${ln} ${stat ?? ""}`.trim(),
      price: american(bet.price),
    };
  });
}

async function nbaProps(season: number): Promise<{ sources: MarketSource[]; views: [string, SectionView][] }> {
  const v = await getOurNbaView(season);
  const fb: Play[] = v.fb.graded.flatMap((g) =>
    // /records: a First Basket bet is a win when its net is positive.
    g.bets.map((b) => ({
      day: etDay(g.at),
      at: g.at,
      result: b.net > 0 ? ("W" as const) : ("L" as const),
      net: b.net,
      label: g.board.players.find((p) => p.id === b.id)?.name ?? b.id,
      price: american(b.price),
    })),
  );
  return {
    sources: [
      { key: "nba-props", label: "NBA props", sport: "nba", issued: false, hasUnits: true, plays: propPlays(v.graded) },
      { key: "nba-first-basket", label: "NBA first basket", sport: "nba", issued: false, hasUnits: true, plays: fb },
    ],
    views: [
      ["nba-props", v.learning],
      ["nba-first-basket", v.fb.learning],
    ],
  };
}

async function nflProps(season: number): Promise<{ sources: MarketSource[]; views: [string, SectionView][] }> {
  const v = await getOurNflView(season);
  return { sources: [{ key: "nfl-props", label: "NFL props", sport: "nfl", issued: false, hasUnits: true, plays: propPlays(v.graded) }], views: [["nfl-props", v.learning]] };
}

async function firstTd(season: number): Promise<{ sources: MarketSource[]; views: [string, SectionView][] }> {
  const v = await getOurFtdView(season);
  // ftdBestRecord (props/week.tsx, the /records row): every player our chance puts above the best cost, 1u, fee in.
  const plays: Play[] = bestBets(v.graded, (p, c) => p.p > c).map((b) => {
    const dec = 1 / b.cost;
    const name = b.game.teams.flatMap((t) => t.players).find((p) => p.key === b.player);
    return {
      day: b.kickoff ? etDay(b.kickoff) : null,
      at: b.kickoff ?? "",
      result: b.win ? "W" : "L",
      net: b.net,
      label: name?.name ?? b.player,
      price: american(dec >= 2 ? (dec - 1) * 100 : -100 / (dec - 1)),
    };
  });
  return { sources: [{ key: "nfl-first-td", label: "NFL first TD", sport: "nfl", issued: false, hasUnits: true, plays }], views: [["nfl-first-td", v.learning]] };
}

async function anytimeTd(season: number): Promise<{ sources: MarketSource[]; views: [string, SectionView][] }> {
  const [graded, learning] = await Promise.all([attdGraded(season), getAttdLearning(season)]);
  // The learner's parent slice, "Our chance above DK's break-even", 1u at DK's price (sections.ts attdCandidates).
  const keep = ATTD_SLICES.find(([id]) => id === "attd:value")![2];
  const plays: Play[] = graded.flatMap((g) =>
    g.rows.flatMap((r): Play[] => {
      const t = g.result[r.key];
      if (r.dk === undefined || t === null || t === undefined || !keep(r.anytime, r.dk)) return [];
      return [{ day: g.at ? etDay(g.at) : null, at: g.at, result: t > 0 ? "W" : "L", net: t > 0 ? payout(r.dk) : -1, label: r.name, price: american(r.dk) }];
    }),
  );
  return { sources: [{ key: "nfl-anytime-td", label: "NFL anytime TD", sport: "nfl", issued: false, hasUnits: true, plays }], views: [["nfl-anytime-td", learning]] };
}

async function nbaBoardsMarkets(season: number): Promise<{ sources: MarketSource[]; views: [string, SectionView][] }> {
  const [boards, nights, lottoLearning, kotcLearning] = await Promise.all([
    allBoards(season),
    getKotcNights(season),
    getNbaSectionLearning(SECTIONS.nbaLotto, season),
    getNbaSectionLearning(SECTIONS.nbaKotc, season),
  ]);
  // King of the Court: tag the prop of anyone in our top 10 (the learner's parent slice, kotcCandidates).
  const kotc: Play[] = nights
    .filter((n) => n.result)
    .flatMap((n) => {
      const mine = boards.filter((b) => n.games.some((g) => g.id === b.espnId));
      return n.board.rows.slice(0, 10).flatMap((row): Play[] => {
        const t = taggedProp(mine, row.name);
        return t ? [{ day: ymd(n.date), at: n.firstTip, result: t.net > 0 ? "W" : t.net < 0 ? "L" : "P", net: t.net, label: row.name, price: null }] : [];
      });
    });
  // Lottos, the two records on Lottos > Results: every edge rung as a 1u single, and the parlay of the day.
  const rungs = rungsOf(boards);
  const am = (p: number) => american(p);
  const singles: Play[] = rungs
    .filter((r) => r.ev > 0 && (r.hit === true || r.hit === false))
    .map((r) => ({ day: r.date, at: r.at, result: r.hit === true ? "W" : "L", net: r.hit === true ? payout(r.over) : -1, label: `${r.player} ${Math.ceil(r.line)}+ ${r.stat}`, price: am(r.over) }));
  const parlay: Play[] = tickets(rungs)
    .filter((t) => t.outcome)
    .map((t) => ({
      day: t.date,
      at: t.legs[0]?.at ?? `${t.date}T23:00:00Z`,
      result: t.outcome!,
      net: t.outcome === "W" ? STAKE * payout(t.price) : -STAKE,
      label: t.legs.map((r) => `${r.player} ${Math.ceil(r.line)}+ ${r.stat}`).join(" / "),
      price: am(t.price),
    }));
  return {
    sources: [
      { key: "nba-kotc", label: "NBA King of the Court", sport: "nba", issued: false, hasUnits: true, plays: kotc },
      { key: "nba-lotto-singles", label: "NBA lotto singles", sport: "nba", issued: false, hasUnits: true, plays: singles },
      { key: "nba-lotto-parlay", label: "NBA lotto parlay of the day", sport: "nba", issued: false, hasUnits: true, plays: parlay },
    ],
    views: [
      ["nba-lotto-singles", lottoLearning],
      ["nba-kotc", kotcLearning],
    ],
  };
}

// ------------------------------------------------------- pick'em and survivor

/** The app's saved pick'em entry, per game, graded with gradeTeams (the pool page's grader). No units: a pool, not a bet. */
async function pickem(): Promise<MarketSource[]> {
  const season = await getSeasonGames(SURVIVOR_SEASON);
  const done = season.games.filter((g) => g.completed);
  const weeks = [...new Set(done.map((g) => g.week))];
  const entries = await Promise.all(weeks.map((w) => getPoolEntry(w).catch(() => ({}) as Awaited<ReturnType<typeof getPoolEntry>>)));
  const plays: Play[] = [];
  weeks.forEach((w, i) => {
    const e = entries[i];
    for (const g of done.filter((x) => x.week === w)) {
      const pick = e[`${canon(g.away)}@${canon(g.home)}`];
      if (!pick) continue;
      const [r] = gradeTeams(new Map([[w, new Set([pick.team])]]), [g], canon);
      if (!r || r.w + r.l === 0) continue;
      plays.push({ day: etDay(g.kickoff), at: g.kickoff, result: r.w ? "W" : "L", net: null, label: pick.team, price: null });
    }
  });
  return [{ key: "pickem-pool", label: "Pick'em pool (app entry)", sport: "nfl", issued: false, hasUnits: false, plays }];
}

async function survivor(): Promise<MarketSource[]> {
  const { games } = await getSeasonGames(SURVIVOR_SEASON);
  return Promise.all(
    POOLS.map(async (meta): Promise<MarketSource> => {
      const pool = await getPool(SURVIVOR_SEASON, meta.id);
      const st = entryStatus(pool, games);
      const plays: Play[] = st.record.map((p) => {
        const g = games.find((x) => x.week === p.week && (x.home === p.team || x.away === p.team));
        const verb = p.result === "W" ? "beat" : p.result === "L" ? "lost to" : "tied";
        return {
          day: g ? etDay(g.kickoff) : null,
          at: g?.kickoff ?? "",
          result: p.result === "T" ? "P" : p.result,
          net: null,
          label: `${p.team} ${verb} ${p.opponent} ${p.teamScore}-${p.oppScore}`,
          price: null,
        };
      });
      return {
        key: `survivor-${meta.id}`,
        label: `Survivor (${pool.name || meta.name})`,
        sport: "nfl",
        issued: false,
        hasUnits: false,
        plays,
        survivor: { pool: pool.name || meta.name, alive: st.alive, losses: st.losses, strikes: st.strikes },
      };
    }),
  );
}

// ------------------------------------------------------------------ events

function sectionEvents(views: [string, SectionView][]): RundownEvent[] {
  return views.flatMap(([market, v]) =>
    v.journal.flatMap((j): RundownEvent[] =>
      j.kind === "activated" || j.kind === "rolled back" ? [{ day: etDay(j.at), kind: j.kind === "activated" ? "review" : "rollback", text: oneSentence(j.text), market }] : [],
    ),
  );
}

async function otherEvents(): Promise<RundownEvent[]> {
  const [football, nba, refits] = await Promise.all([
    footballLearning.journal(200).catch(() => []),
    getNbaPicksView().then((v) => v.journal).catch(() => []),
    Promise.all(MODEL_KEYS.map(async (m) => [m, await storedParams(m).catch(() => null)] as const)),
  ]);
  const out: RundownEvent[] = [];
  for (const e of football)
    if (e.kind === "activate" || e.kind === "rollback") out.push({ day: etDay(e.at), kind: e.kind === "activate" ? "review" : "rollback", text: oneSentence(`Picks review: ${e.title}`) });
  for (const e of nba)
    if (e.kind === "activate" || e.kind === "rollback") out.push({ day: etDay(e.at), kind: e.kind === "activate" ? "review" : "rollback", text: oneSentence(`NBA picks review: ${e.text}`) });
  for (const [m, s] of refits)
    if (s?.at) out.push({ day: etDay(s.at), kind: "review", text: `The weekly refit stored new ${m} model settings (held-out loss ${s.evidence.before} to ${s.evidence.after} over ${s.evidence.games} games).` });
  return out;
}

// ------------------------------------------------------------------- entry

const seasonOf = (d: Date) => (d.getMonth() < 7 ? d.getFullYear() - 1 : d.getFullYear());

/** Every market's settled plays and the review events. A reader that fails is named in `problems` and skipped. */
export async function loadRundownInputs(date: string): Promise<{ sources: MarketSource[]; events: RundownEvent[]; problems: string[] }> {
  const season = seasonOf(new Date(`${date}T12:00:00Z`));
  const problems: string[] = [];
  const safe = async <T,>(what: string, p: () => Promise<T>, empty: T): Promise<T> => {
    try {
      return await p();
    } catch (e) {
      problems.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
      return empty;
    }
  };
  const none = { sources: [] as MarketSource[], views: [] as [string, SectionView][] };
  const [nfl, cfb, nbaPicks, nbaP, nflP, ftd, attd, boards, pool, surv, events] = await Promise.all([
    safe("NFL issued", () => footballIssued("nfl"), []),
    safe("College issued", () => footballIssued("cfb"), []),
    safe("NBA picks", nbaGamePicks, []),
    safe("NBA props", () => nbaProps(season), none),
    safe("NFL props", () => nflProps(season), none),
    safe("NFL first TD", () => firstTd(season), none),
    safe("NFL anytime TD", () => anytimeTd(season), none),
    safe("NBA lottos and King of the Court", () => nbaBoardsMarkets(season), none),
    safe("Pick'em", pickem, []),
    safe("Survivor", survivor, []),
    safe("Reviews", otherEvents, []),
  ]);
  const props = [nbaP, nflP, ftd, attd, boards];
  return {
    sources: [...nfl, ...cfb, ...nbaPicks, ...props.flatMap((x) => x.sources), ...pool, ...surv],
    events: [...events, ...sectionEvents(props.flatMap((x) => x.views))],
    problems,
  };
}
