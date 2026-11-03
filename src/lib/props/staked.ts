import "server-only";
import { redis } from "@/lib/redis/client";
import { loadSection } from "@/lib/learning/store";
import type { SectionState } from "@/lib/learning/engine";
import { etDate, nbaSeasonOfDate } from "./parse";
import { PROPS_SECTION } from "./learn";
import { getPropsView } from "./store";
import { getNbaPropsView } from "./nba-props";
import { FTD_SECTION } from "@/lib/firsttd/learn";
import { getFirstTdView } from "@/lib/firsttd/store";
import { OUR_SECTION } from "@/lib/models/learn";
import { SECTIONS } from "@/lib/models/sections";
import { getOurNbaView } from "@/lib/models/nba/store";
import { getKotcNights } from "@/lib/models/nba/kotc-store";
import { rungsOf, tickets } from "@/lib/models/nba/lotto";
import { getOurNflView } from "@/lib/models/nfl/store";
import { getOurFtdView } from "@/lib/models/nfl/ftd-store";
import { loadVenomProps, loadVenomWeekPicks } from "@/lib/models/nfl/venom";
import { getNbaPicksView } from "@/lib/picks/nba-track-store";
import { live as liveParams, primeParams } from "@/lib/models/params-store";
import NFL_PARAMS from "@/lib/models/nfl/params.json";
import NBA_PARAMS from "@/lib/models/nba/params.json";
import type { NflParams } from "@/lib/models/nfl/props";
import type { NbaParams } from "@/lib/models/nba/props";
import { FRESH_LEAD_MS, applyFresh, freshKey, pricedAttd, pricedProps, repriceAttd, repriceNba, repriceNfl, type FreshQuote, type Priced } from "./fresh-core";
import { loadFreshQuotes } from "./fresh";
import { attdStakedBets, fbStaked, kotcStaked, lottoStaked, nbaPicksStaked, ourFtdStaked, ourPropsStaked, samFtdStaked, systemStaked, tidy, limitProps, type LiveEntry, type StakedBet } from "./staked-core";

export type { StakedBet } from "./staked-core";

const NFL_P = liveParams("nfl-props", NFL_PARAMS as NflParams);
const NBA_P = liveParams("nba-props", NBA_PARAMS as NbaParams);

// Today's staked bets outside football's picks, read from Redis (rules in
// staked-core.ts). Each section's learner state is read first, and its
// boards only when one of its slices is live, so a day with nothing live
// costs eleven small reads.

const nflSeasonOf = (d: Date) => (d.getUTCMonth() < 7 ? d.getUTCFullYear() - 1 : d.getUTCFullYear());

/** A section's slices as the views show them: a live slice past its weekly cap reads "paused". */
export function liveEntries(s: SectionState): LiveEntry[] {
  return Object.values(s.entries).map((e) => ({ id: e.id, label: e.label, status: e.status === "active" && e.pausedWeek !== undefined ? "paused" : e.status, activatedAt: e.activatedAt }));
}

const live = (es: LiveEntry[]) => es.some((e) => e.status === "active");

export interface StakedToday {
  bets: StakedBet[];
  /** Sections that couldn't be read; their bets are missing, not absent. */
  problems: string[];
}

/** Every prop a live learner slice bets today and that hasn't started, across all prop sections. */
export async function stakedPropsToday(at = new Date(), opts: { since?: Date } = {}): Promise<StakedToday> {
  const today = etDate(at);
  const nfl = nflSeasonOf(at);
  const nba = nbaSeasonOfDate(at);
  // "Not started" is judged at `since` (default: now). The Today tab passes the
  // start of the day so bets in play still show; graded games still drop out.
  const now = opts.since ?? at;
  const problems: string[] = [];
  const ids: [string, number][] = [
    [PROPS_SECTION.nfl, nfl],
    [PROPS_SECTION.nba, nba],
    [FTD_SECTION, nfl],
    [OUR_SECTION.nflProps, nfl],
    [OUR_SECTION.nflFirstTd, nfl],
    [SECTIONS.nflAttd, nfl],
    [OUR_SECTION.nbaProps, nba],
    [OUR_SECTION.nbaFirstBasket, nba],
    [SECTIONS.nbaLotto, nba],
    [SECTIONS.nbaKotc, nba],
  ];
  const states = await Promise.all(ids.map(([id, season]) => loadSection(id, season).catch((e) => (problems.push(`${id}: ${e instanceof Error ? e.message : String(e)}`), null))));
  const E = new Map(ids.map(([id], i) => [id, states[i] ? liveEntries(states[i]!) : []]));
  const on = (id: string) => live(E.get(id) ?? []);
  const guard = async <T,>(name: string, f: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await f();
    } catch (e) {
      problems.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  };
  const labels = (id: string) => Object.fromEntries((E.get(id) ?? []).map((e) => [e.id, e.label]));

  const nbaBoard = on(OUR_SECTION.nbaProps) || on(OUR_SECTION.nbaFirstBasket) || on(SECTIONS.nbaLotto) || on(SECTIONS.nbaKotc) ? getOurNbaView(nba, at).then((v) => v.board) : null;
  const ftdView = on(OUR_SECTION.nflFirstTd) || on(SECTIONS.nflAttd) ? getOurFtdView(nfl) : null;
  const ftdBoard = ftdView ? ftdView.then((v) => v.board) : null;
  // Venom's Anytime TD picks for the board's week, so a live Venom slice can stake (undefined: no board in, those slices keep nobody).
  const attdVenom: Promise<Set<string> | undefined> = on(SECTIONS.nflAttd) && ftdView
    ? ftdView.then((v) => (v.week ? loadVenomWeekPicks(nfl, v.week) : undefined)).catch(() => undefined)
    : Promise.resolve(undefined);
  // Kept for the fresh pre-lock check, which re-runs the same collectors on re-priced boards.
  let nflOurs: NflOurs | null = null;

  const parts = await Promise.all([
    on(PROPS_SECTION.nfl)
      ? guard("NFL props (Sam and David)", async () => {
          const v = await getPropsView(nfl);
          return systemStaked({ section: PROPS_SECTION.nfl, sectionName: "NFL props (Sam and David)", sport: "NFL", current: Object.values(v.current), david: v.david.games, sam: new Map(Object.entries(v.david.sam)), active: v.active, graded: v.graded, labels: labels(PROPS_SECTION.nfl), now, today, href: "/props" });
        })
      : [],
    on(PROPS_SECTION.nba)
      ? guard("NBA props (Sam)", async () => {
          const v = await getNbaPropsView(nba);
          return systemStaked({ section: PROPS_SECTION.nba, sectionName: "NBA props (Sam)", sport: "NBA", current: Object.values(v.current), active: v.active, graded: v.graded, labels: labels(PROPS_SECTION.nba), now, today, href: "/props?m=nba" });
        })
      : [],
    on(FTD_SECTION)
      ? guard("NFL First TD (Sam)", async () => {
          const v = await getFirstTdView(nfl);
          return samFtdStaked({ boards: Object.values(v.current?.games ?? {}), entries: E.get(FTD_SECTION)!, now, today, section: FTD_SECTION });
        })
      : [],
    on(OUR_SECTION.nflProps)
      ? guard("NFL props", async () => {
          const [v, venom] = await Promise.all([getOurNflView(nfl), loadVenomProps(nfl).catch(() => undefined)]);
          nflOurs = { boards: v.board, venom };
          return ourPropsStaked({ section: OUR_SECTION.nflProps, sectionName: "NFL props", sport: "NFL", boards: v.board, entries: E.get(OUR_SECTION.nflProps)!, now, today, venom, href: "/props" });
        })
      : [],
    on(OUR_SECTION.nflFirstTd) ? guard("NFL First TD", async () => ourFtdStaked({ boards: (await ftdBoard)!, entries: E.get(OUR_SECTION.nflFirstTd)!, now, today, section: OUR_SECTION.nflFirstTd })) : [],
    on(SECTIONS.nflAttd) ? guard("NFL Anytime TD", async () => attdStakedBets({ boards: (await ftdBoard)!, entries: E.get(SECTIONS.nflAttd)!, now, today, section: SECTIONS.nflAttd, venom: await attdVenom })) : [],
    on(OUR_SECTION.nbaProps)
      ? guard("NBA props", async () => ourPropsStaked({ section: OUR_SECTION.nbaProps, sectionName: "NBA props", sport: "NBA", boards: (await nbaBoard)!, entries: E.get(OUR_SECTION.nbaProps)!, now, today, cardGames: 3, href: "/props?m=nba" }))
      : [],
    on(OUR_SECTION.nbaFirstBasket) ? guard("NBA First Basket", async () => fbStaked({ boards: (await nbaBoard)!, entries: E.get(OUR_SECTION.nbaFirstBasket)!, now, today, section: OUR_SECTION.nbaFirstBasket })) : [],
    on(SECTIONS.nbaLotto)
      ? guard("NBA lottos", async () => {
          const rungs = rungsOf((await nbaBoard)!);
          return lottoStaked({ rungs, ticket: tickets(rungs).find((t) => t.date === today) ?? null, entries: E.get(SECTIONS.nbaLotto)!, now, today, section: SECTIONS.nbaLotto });
        })
      : [],
    on(SECTIONS.nbaKotc)
      ? guard("King of the Court", async () => {
          const nights = await getKotcNights(nba);
          const night = nights.find((n) => n.date === today && !n.result) ?? null;
          return kotcStaked({ night, boards: (await nbaBoard)!, entries: E.get(SECTIONS.nbaKotc)!, now, today, section: SECTIONS.nbaKotc });
        })
      : [],
  ]);
  // Today's staked props so far (remembered past kickoff), so the per-game and per-day caps hold across reads.
  const dayKey = `staked:v1:props-day:${today}`;
  const prior = ((await redis.smembers(dayKey).catch(() => [])) ?? []).flatMap((x) => {
    try {
      return [JSON.parse(String(x)) as { id: string; game: string; stake: number }];
    } catch {
      return [];
    }
  });
  const { bets: limited, cut } = limitProps(tidy(parts.flat()), prior);
  const added = limited.filter((b) => !prior.some((p) => p.id === b.id));
  if (added.length) {
    const [first, ...more] = added.map((b) => JSON.stringify({ id: b.id, game: `${b.sport}|${b.game}`, stake: b.stake }));
    await redis.sadd(dayKey, first, ...more).catch(() => 0);
    await redis.expire(dayKey, 3 * 86400).catch(() => 0);
  }
  // The fresh pre-lock check: each prop re-judged at its game's fresh quote, when there is one.
  const quotes = await loadFreshQuotes(limited.flatMap((b) => freshKey(b) ?? []));
  const re = await freshlyKept({ quotes, nflOurs, nbaBoard: on(OUR_SECTION.nbaProps) ? nbaBoard : null, ftdBoard: on(SECTIONS.nflAttd) ? ftdBoard : null, attdVenom: on(SECTIONS.nflAttd) ? await attdVenom : undefined, E, now, today }).catch((e) => {
    problems.push(`fresh check: ${e instanceof Error ? e.message : String(e)}`);
    return { bets: [] as StakedBet[], priced: new Map() as Priced };
  });
  const bets = applyFresh(limited, quotes, re.bets, re.priced);
  // A check still pending this close to lock means the read never landed: say so (it won't push).
  const late = at.getTime() + FRESH_LEAD_MS - 20 * 60_000;
  const held = bets.flatMap((b) => {
    const c = b.check;
    if (c?.state === "gone" || c?.state === "failed") return [`not pushed: ${b.pick}: ${c.note}`];
    if (c?.state === "pending" && Date.parse(b.kickoff) > at.getTime() && Date.parse(b.kickoff) < late) return [`not pushed: ${b.pick}: fresh price check still pending`];
    return [];
  });
  return { bets, problems: [...problems, ...cut.map((c) => `not staked: ${c}`), ...held] };
}

type NflOurs = { boards: Awaited<ReturnType<typeof getOurNflView>>["board"]; venom?: Awaited<ReturnType<typeof loadVenomProps>> };

/**
 * The collectors again, on each board re-priced at its game's fresh quote
 * (fresh-core.ts), plus the fresh price of every side the quotes priced.
 */
async function freshlyKept(x: {
  quotes: Map<string, FreshQuote>;
  nflOurs: NflOurs | null;
  nbaBoard: Promise<Awaited<ReturnType<typeof getOurNbaView>>["board"]> | null;
  ftdBoard: Promise<Awaited<ReturnType<typeof getOurFtdView>>["board"]> | null;
  attdVenom?: Set<string>;
  E: Map<string, LiveEntry[]>;
  now: Date;
  today: string;
}): Promise<{ bets: StakedBet[]; priced: Priced }> {
  if (![...x.quotes.values()].some((q) => q.ok)) return { bets: [], priced: new Map() };
  await primeParams();
  const quoteFor = (sport: "NFL" | "NBA", event: string | undefined, kickoff: string | undefined) => {
    if (!event || !kickoff) return null;
    return x.quotes.get(freshKey({ sport, kickoff, quote: { event } })!) ?? null;
  };
  const bets: StakedBet[] = [];
  const priced: Priced = new Map();
  const add = (p: Priced) => p.forEach((v, k) => priced.set(k, v));
  if (x.nflOurs) {
    const boards = x.nflOurs.boards.flatMap((b) => {
      const q = quoteFor("NFL", b.espnId, b.kickoff);
      return q?.ok && q.sport === "NFL" ? [repriceNfl(b, q.read, NFL_P)] : [];
    });
    if (boards.length) {
      bets.push(...ourPropsStaked({ section: OUR_SECTION.nflProps, sectionName: "NFL props", sport: "NFL", boards, entries: x.E.get(OUR_SECTION.nflProps)!, now: x.now, today: x.today, venom: x.nflOurs.venom, href: "/props" }));
      add(pricedProps(OUR_SECTION.nflProps, boards));
    }
  }
  if (x.nbaBoard) {
    const boards = (await x.nbaBoard).flatMap((b) => {
      const q = quoteFor("NBA", b.espnId, b.kickoff);
      return q?.ok && q.sport === "NBA" ? [repriceNba(b, new Map(q.lines), new Map(q.alts), NBA_P)] : [];
    });
    if (boards.length) {
      bets.push(...ourPropsStaked({ section: OUR_SECTION.nbaProps, sectionName: "NBA props", sport: "NBA", boards, entries: x.E.get(OUR_SECTION.nbaProps)!, now: x.now, today: x.today, cardGames: 3, href: "/props?m=nba" }));
      add(pricedProps(OUR_SECTION.nbaProps, boards));
    }
  }
  if (x.ftdBoard) {
    const boards = (await x.ftdBoard).flatMap((b) => {
      const q = quoteFor("NFL", b.espnId, b.kickoff);
      return q?.ok && q.sport === "NFL" ? [repriceAttd(b, q.read)] : [];
    });
    if (boards.length) {
      bets.push(...attdStakedBets({ boards, entries: x.E.get(SECTIONS.nflAttd)!, now: x.now, today: x.today, section: SECTIONS.nflAttd, venom: x.attdVenom }));
      add(pricedAttd(SECTIONS.nflAttd, boards));
    }
  }
  return { bets, priced };
}

/** NBA picks' staked tier bets today, not tipped (none unless the go-live gate is on). */
export async function stakedNbaToday(now = new Date()): Promise<StakedToday> {
  try {
    const v = await getNbaPicksView(nbaSeasonOfDate(now));
    return { bets: tidy(nbaPicksStaked({ games: v.games, live: v.gate.live, now, today: etDate(now) })), problems: [] };
  } catch (e) {
    return { bets: [], problems: [`NBA picks: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

/** Both: today's staked props and NBA bets, soonest first. */
export async function stakedToday(now = new Date()): Promise<StakedToday> {
  const [p, n] = await Promise.all([stakedPropsToday(now), stakedNbaToday(now)]);
  return { bets: tidy([...p.bets, ...n.bets]), problems: [...p.problems, ...n.problems] };
}
