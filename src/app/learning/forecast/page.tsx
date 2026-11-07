import type { Metadata } from "next";
import Link from "next/link";
import { redisStore } from "@/lib/picks/learning/store";
import { getPicksCore } from "@/lib/picks/report";
import { getOurNflView } from "@/lib/models/nfl/store";
import { getAttdLearning, getOurFtdView } from "@/lib/models/nfl/ftd-store";
import { getPropsView } from "@/lib/props/store";
import { getNbaSectionLearning, getOurNbaView } from "@/lib/models/nba/store";
import { getCfbModelView } from "@/lib/models/cfb/store";
import { getCbbRecord } from "@/lib/models/cbb/store";
import { SECTIONS } from "@/lib/models/sections";
import { nbaSeasonOfDate } from "@/lib/props/parse";
import type { SectionView } from "@/lib/learning/engine";
import { byOutlook, forecast, SEASON_END, type Forecast, type ForecastInput, type Outlook, type Sport } from "@/lib/learning/forecast";
import { PageHead, Section, Stat, Disclosure, Chip } from "@/components/hh/ui";
import s from "../../picks/picks.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Go-live forecast · Hobby Hub",
  description: "Every slice still collecting: when it can meet its sample, and the estimated chance it clears its bar this season.",
};

const DAY = 86_400_000;
const seasonOf = (d: Date) => (d.getUTCMonth() < 7 ? d.getUTCFullYear() - 1 : d.getUTCFullYear());

interface Group {
  title: string;
  href: string;
  sport: Sport;
  rows: Forecast[];
  error?: string;
}

/** A shared-engine section's slices as forecast inputs. */
function engineInputs(v: SectionView, sport: Sport, now: Date): ForecastInput[] {
  const g = v.gate;
  const byId = new Map(v.entries.map((e) => [e.id, e]));
  return v.entries.map((e) => {
    const ev = e.ev;
    const parent = e.parent ? byId.get(e.parent) : undefined;
    return {
      id: `${v.section}:${e.id}`,
      label: e.label,
      sport,
      status: e.status === "paused" ? "active" : e.status,
      games: ev?.games ?? 0,
      weeks: ev?.weeks ?? 0,
      t: ev?.t ?? 0,
      bets: ev?.bets ?? 0,
      wins: ev?.wins ?? 0,
      days: Math.max(0, (now.getTime() - Date.parse(e.registeredAt)) / DAY),
      need: { games: g.minGames, weeks: g.minWeeks, t: g.minT, bets: g.minBets, wins: g.minWins || undefined },
      ...(e.parent
        ? { extra: `It must also beat ${(parent?.label ?? "its parent").toLowerCase()} (paired t ${ev?.pairedT ?? 0} now, needs ${g.minPairedT}).`, paired: { t: ev?.pairedT ?? 0, need: g.minPairedT } }
        : {}),
    };
  });
}

async function engineGroup(title: string, href: string, sport: Sport, load: () => Promise<SectionView>, now: Date, keep?: (id: string) => boolean): Promise<Group> {
  try {
    const v = await load();
    const view = keep ? { ...v, entries: v.entries.filter((e) => keep(e.id)) } : v;
    return { title, href, sport, rows: engineInputs(view, sport, now).map((x) => forecast(x, now)).sort(byOutlook) };
  } catch (e) {
    console.error(`[forecast] ${title}:`, e);
    return { title, href, sport, rows: [], error: "load" };
  }
}

const PICKS_STATUS: { [v: string]: string } = { retain: "collecting", promote: "collecting", reject: "rejected", retire: "retired" };

/** Football picks keep their own loop; its last review saved each idea's n, weeks and paired t. */
async function picksGroups(now: Date): Promise<Group[]> {
  try {
    const st = await redisStore.state();
    const ds = (st?.decisions ?? []).filter((d) => d.n !== undefined && d.t !== undefined && PICKS_STATUS[d.verdict]);
    return (["nfl", "cfb"] as const).map((l) => ({
      title: `${l === "nfl" ? "NFL" : "CFB"} picks (spreads, totals, sources)`,
      href: l === "nfl" ? "/picks?v=research" : "/picks/cfb?v=research",
      sport: l,
      rows: ds
        .filter((d) => d.id.startsWith(`${l}:`))
        .map((d) =>
          forecast(
            {
              id: d.id,
              label: d.label,
              sport: l,
              status: PICKS_STATUS[d.verdict],
              games: d.n!,
              weeks: d.weeks ?? 0,
              t: d.t!,
              days: (d.weeks ?? 0) * 7,
              need: { games: d.id.includes(":mkt:") ? 100 : 30, weeks: 3, t: 1.645 },
              extra: "Judged against the rule in force (paired t).",
            },
            now,
          ),
        )
        .sort(byOutlook),
    }));
  } catch (e) {
    console.error("[forecast] football picks:", e);
    return [{ title: "Football picks", href: "/picks?v=research", sport: "nfl", rows: [], error: "load" }];
  }
}

interface InForce {
  league: string;
  market: string;
  label: string;
  stakes: boolean;
  why: string;
  href: string;
}

/**
 * The rules behind the bets the 9am email actually sends (Jack, 2026-11-03: "don't we have some live stakes?").
 * These are the weekly spread rule, Tier 2 and the totals rule per league, each staking only once its
 * forward check passes (picks/forward.ts). They are not learner slices, so the forecast below doesn't list them.
 */
async function inForce(): Promise<{ rows: InForce[]; error?: string }> {
  const rows: InForce[] = [];
  const errs: string[] = [];
  for (const l of ["nfl", "cfb"] as const) {
    const L = l === "nfl" ? "NFL" : "CFB";
    const href = l === "nfl" ? "/picks" : "/picks/cfb";
    try {
      const c = (await getPicksCore(l)).value;
      if (!c) throw new Error("no picks data");
      const add = (market: string, r: { label: string; forward?: { stake: boolean; reason: string } } | null | undefined) =>
        r && rows.push({ league: L, market, label: r.label, stakes: !!r.forward?.stake, why: r.forward?.reason ?? "No forward check yet, so tracked only.", href });
      add("Spread rule (Tier 1)", c.strategies.rule);
      add("Spread Tier 2", c.strategies.second);
      add("Totals rule", c.totalsBacktest.rule);
    } catch (e) {
      console.error(`[forecast] in force ${L}:`, e);
      errs.push(L);
    }
  }
  return { rows, ...(errs.length ? { error: errs.join("; ") } : {}) };
}

const CHIP: { [k in Outlook]: { text: string; tone?: "pos" | "neg" } } = {
  live: { text: "live", tone: "pos" },
  likely: { text: "likely", tone: "pos" },
  possible: { text: "possible" },
  "long shot": { text: "long shot" },
  unlikely: { text: "unlikely", tone: "neg" },
  "no games": { text: "no games yet" },
  "out of time": { text: "out of time", tone: "neg" },
  retired: { text: "retired" },
};

const pct = (x: number | null) => (x === null ? "" : x < 0.01 ? "under 1%" : `${Math.round(x * 100)}%`);
const md = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const PICKS_KIND: { [k: string]: string } = { ats: "spread", ou: "total", su: "straight up", mkt: "spread, public betting and line moves", source: "spread, outside source" };

/** "NFL · spread" or "NBA · first basket, our model": which sport and bet a slice is, for lists that mix sections. */
function kindOf(f: Forecast, g: Group): string {
  const [league, kind] = f.id.split(":");
  if ((league === "nfl" || league === "cfb") && PICKS_KIND[kind] && g.title.includes("picks")) return `${league.toUpperCase()} · ${PICKS_KIND[kind]}`;
  // Engine groups are titled "NBA first basket (our model)": sport first, then the bet.
  const m = /^(NFL|NBA|CFB|CBB)\s+(.*)$/.exec(g.title);
  if (m && m[2].startsWith("model")) return `${m[1]} · our model`;
  return m ? `${m[1]} · ${m[2].replace(/\s*\((.*)\)$/, ", $1")}` : g.title;
}

function Row({ f, kind }: { f: Forecast; kind?: string }) {
  const c = CHIP[f.outlook];
  const showOdds = f.chance !== null && f.outlook !== "out of time";
  return (
    <li className="flex min-w-0 flex-col gap-1.5 border-b border-hh-line py-3">
      <div className={s.cardTop}>
        <span className="flex min-w-0 flex-col gap-0.5">
          {kind && <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-hh-muted">{kind}</span>}
          <b style={{ fontSize: 15, lineHeight: 1.3, overflowWrap: "anywhere" }}>{f.label}</b>
        </span>
        {showOdds && (
          <span className={s.stake}>
            <b className={c.tone ? s[c.tone] : undefined}>{pct(f.chance)}</b>
            <span className={s.dim} style={{ fontSize: 11 }}>est. chance</span>
          </span>
        )}
      </div>
      <span style={{ fontSize: 13 }}>
        <Chip tone={c.tone ?? "muted"}>{c.text}</Chip>{" "}
        {f.games > 0 && `${f.games} games, t ${f.t}`}
        {f.sampleBy && ` · sample met ${md(f.sampleBy)}`}
      </span>
      <span className={s.dim} style={{ fontSize: 12.5 }}>{f.why}</span>
    </li>
  );
}

export default async function ForecastPage() {
  const now = new Date();
  const season = seasonOf(now);
  const nbaSeason = nbaSeasonOfDate(now);
  const davidOnly = (id: string) => (id.startsWith("dplay:") || id.startsWith("dboard:")) && !id.includes("sam");
  const force = inForce();
  const groups = (
    await Promise.all([
      picksGroups(now),
      engineGroup("CFB model (our ratings)", "/picks/cfb?v=research", "cfb", async () => (await getCfbModelView(season)).section, now),
      engineGroup("CBB model (our blended rating)", "/picks/cbb?v=log", "cbb", async () => (await getCbbRecord(now)).section, now),
      engineGroup("NFL player props (our model)", "/props?v=results", "nfl", async () => (await getOurNflView(season)).learning, now),
      engineGroup("NFL player props (David)", "/props?v=research", "nfl", async () => (await getPropsView(season)).learning, now, davidOnly),
      engineGroup("NFL first TD (our model)", "/props?m=ftd&v=results", "nfl", async () => (await getOurFtdView(season)).learning, now),
      engineGroup("NFL anytime TD (our model)", "/props?m=attd&v=log", "nfl", () => getAttdLearning(season), now),
      engineGroup("NBA player props (our model)", "/props?m=nba&v=results", "nba", async () => (await getOurNbaView(nbaSeason, now)).learning, now),
      engineGroup("NBA first basket (our model)", "/props?m=fb&v=results", "nba", async () => (await getOurNbaView(nbaSeason, now)).fb.learning, now),
      engineGroup("NBA lottos (our model)", "/props?m=lotto&v=log", "nba", () => getNbaSectionLearning(SECTIONS.nbaLotto, nbaSeason), now),
      engineGroup("NBA King of the Court", "/props?m=kotc&v=log", "nba", () => getNbaSectionLearning(SECTIONS.nbaKotc, nbaSeason), now),
    ])
  ).flat();

  const live = await force;
  const staking = live.rows.filter((r) => r.stakes);
  const all = groups.flatMap((g) => g.rows);
  const count = (o: Outlook[]) => all.filter((f) => o.includes(f.outlook)).length;
  const groupOf = new Map(groups.flatMap((g) => g.rows.map((f) => [f, g] as const)));
  const top = all.filter((f) => f.outlook === "likely" || f.outlook === "possible").sort(byOutlook).slice(0, 5);
  const QUIET: Outlook[] = ["no games", "out of time", "retired", "unlikely"];

  return (
    <main className={s.page}>
      <div className="mx-auto flex w-full min-w-0 max-w-[1104px] flex-col gap-8">
        <PageHead title="What could go live" sub="See what is betting now and which collecting slices have the best chance this season." aside={<><Link href="/learning">Learning</Link> · Go-live forecast</>} />
        <Section label="Status">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label="rules staking now" value={staking.length} tone={staking.length ? "pos" : undefined} />
            <Stat label="learned slices live" value={count(["live"])} />
            <Stat label="likely or possible" value={count(["likely", "possible"])} />
            <Stat label="unlikely, out of time or retired" value={count(["unlikely", "out of time", "retired"])} tone="neg" />
          </div>
        </Section>


        <Section label="Betting now">
          <Disclosure summary="Which rules issue bets">
          <p className={s.p} style={{ marginBottom: 10 }}>
            The rules behind the bets the 9am email sends. Each league&apos;s weekly spread rule, Tier 2 and totals rule stake once their forward check passes;
            they are picked weekly from the best cuts, not learned slices, so they aren&apos;t in the forecast below. NBA picks aren&apos;t staked yet.
          </p>
          </Disclosure>
          {live.error && <p className={s.p}>Couldn&apos;t load what is in force just now. Try again in a minute.</p>}
          <ul className="grid min-w-0 grid-cols-1 gap-x-7 sm:grid-cols-2 lg:grid-cols-3">
            {live.rows.map((r) => (
              <li key={`${r.league}:${r.market}`} className="flex min-w-0 flex-col gap-1.5 border-b border-hh-line py-3">
                <div className={s.cardTop}>
                  <span className={s.dim} style={{ fontSize: 12 }}>
                    {r.league} · {r.market}
                  </span>
                  <Chip tone={r.stakes ? "pos" : "muted"}>{r.stakes ? "staking" : "tracked only"}</Chip>
                </div>
                <b style={{ fontSize: 15, lineHeight: 1.3 }}>
                  <Link href={r.href}>{r.label}</Link>
                </b>
                <span className={s.dim} style={{ fontSize: 12.5 }}>{r.why}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section label="Best bets to go live">
          {top.length ? (
            <ul className="grid min-w-0 grid-cols-1 gap-x-7 sm:grid-cols-2 lg:grid-cols-3">
              {top.map((f) => (
                <Row key={f.id} f={f} kind={groupOf.get(f) ? kindOf(f, groupOf.get(f)!) : undefined} />
              ))}
            </ul>
          ) : (
            <p className={s.p}>Nothing is better than a long shot yet. That is normal this early: most slices have a few weeks of games at most.</p>
          )}
        </Section>

        <Disclosure summary="How the forecast is estimated">
          <p className={s.p}>
            Every slice still collecting, with the date it meets its sample at its current pace and an estimated chance it clears its bar before the season ends.
            The estimate starts from &ldquo;no real edge&rdquo; (most betting edges are small or not there) and moves only partway toward what each slice has shown so far. A
            refinement is held to the lower of its own chance and its chance of beating its parent. Line-move and drawdown checks are not counted and can still block one.
          </p>
          <p className={s.p}>
            The chance is of going live, not of having a real edge. Every slice is checked after every slate, so some will clear their bar by luck; the rollback
            rule is what catches those.
          </p>
        </Disclosure>

        {groups.map((g) => {
          const loud = g.rows.filter((f) => !QUIET.includes(f.outlook));
          const quiet = g.rows.filter((f) => QUIET.includes(f.outlook));
          return (
            <Section key={g.title} label={<Link href={g.href}>{g.title}</Link>}>
              <span className={s.dim} style={{ fontSize: 12 }}>
                Season ends {md(SEASON_END[g.sport])} (estimate) · {g.rows.length} slices
              </span>
              {g.error && <p className={s.p}>Couldn&apos;t load this section just now. Try again in a minute.</p>}
              <Disclosure summary={`Slice detail · ${g.rows.length} slices`}>
              {loud.length > 0 && (
                <ul className="grid min-w-0 grid-cols-1 gap-x-7 sm:grid-cols-2 lg:grid-cols-3" style={{ marginTop: 8 }}>
                  {loud.map((f) => (
                    <Row key={f.id} f={f} />
                  ))}
                </ul>
              )}
              {!g.error && !loud.length && <p className={s.p}>Nothing in this section has a real shot yet.</p>}
              {quiet.length > 0 && (
                <details className={s.retired}>
                  <summary>
                    {quiet.length} unlikely, waiting or retired ({["unlikely", "no games", "out of time", "retired"].map((o) => `${quiet.filter((f) => f.outlook === o).length} ${CHIP[o as Outlook].text}`).filter((x) => !x.startsWith("0 ")).join(", ")})
                  </summary>
                  <ul className="grid min-w-0 grid-cols-1 gap-x-7 sm:grid-cols-2 lg:grid-cols-3" style={{ marginTop: 10 }}>
                    {quiet.map((f) => (
                      <Row key={f.id} f={f} />
                    ))}
                  </ul>
                </details>
              )}
              </Disclosure>
            </Section>
          );
        })}
      </div>
    </main>
  );
}
