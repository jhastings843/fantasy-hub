import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getPicksReport } from "@/lib/picks/report";
import { getCfbModelView } from "@/lib/models/cfb/store";
import { getCbbRecord } from "@/lib/models/cbb/store";
import { getOurNbaView, allBoards, getNbaSectionLearning } from "@/lib/models/nba/store";
import { getOurNflView } from "@/lib/models/nfl/store";
import { getOurFtdView, attdGraded, getAttdLearning } from "@/lib/models/nfl/ftd-store";
import { summarizeAttd } from "@/lib/models/nfl/anytime";
import { rungsOf, summarize, tickets } from "@/lib/models/nba/lotto";
import { SECTIONS } from "@/lib/models/sections";
import { ourSliceBets, record } from "@/lib/models/learn";
import type { SectionView } from "@/lib/learning/engine";
import { nbaSeasonOfDate } from "@/lib/props/parse";
import { ourFootballRecords, ourNbaGameModel } from "../picks/model-records";
import { ftdBestRecord } from "../props/week";
import { Chip, Disclosure, Empty, Num, PageHead, Section, Stat } from "@/components/hh/ui";
import { EdgeBar } from "@/components/hh/charts";

// Our models (Jack, 2026-11-04): every model we built, one headline record each,
// in one place. Each number comes from the same function the model's own page
// uses (cited per row); nothing new is computed here. Sam's and David's
// outside models are not on this page. Units are never added across rows: the
// bases differ (saved price, -110, Kalshi cost), so each row says its own.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Our models · Hobby Hub",
  description: "Every model we built, with its record at the saved price and whether it bets.",
};

const seasonOf = (d: Date) => (d.getMonth() < 7 ? d.getFullYear() - 1 : d.getFullYear());
const u = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(1)}u`;

type Rec = { w: number; l: number; p?: number; units?: number; clv?: number | null };

interface ModelRow {
  sport: "NFL" | "CFB" | "NBA" | "CBB";
  name: string;
  market: string;
  rec: Rec | null;
  /** What a unit is graded at. */
  basis: string;
  /** "live" when any learner slice stakes; "projections" when it never bets. */
  status: "live" | "tracked" | "projections";
  href: string;
  note?: string;
}

const live = (v: SectionView | null | undefined) => !!v?.entries.some((e) => e.status === "active");
const settle = <T,>(p: Promise<T>) => p.catch(() => null);

const gradedCount = (r: Rec | null) => (r ? r.w + r.l + (r.p ?? 0) : 0);

/** W-L(-P) over its hit rate; a model with nothing graded says so once, in the units column's place. */
function RecordCell({ r }: { r: Rec }) {
  const decided = r.w + r.l;
  return (
    <span className="flex flex-col items-start leading-tight sm:items-end">
      <span className="sr-only">Record </span>
      <Num className="text-[17px] font-semibold text-hh-ink">{`${r.w}-${r.l}${r.p ? `-${r.p}` : ""}`}</Num>
      {decided > 0 && <Num className="text-xs text-hh-muted">{`${Math.round((r.w / decided) * 100)}% won`}</Num>}
    </span>
  );
}

// Tracked is the default and is said once under each sport, not on every row
// (Jack, 2026-11-04: "fix how this all looks"). Only the exceptions get a chip.
const STATUS: Partial<Record<ModelRow["status"], { tone: "accent" | "gold"; text: string }>> = {
  live: { tone: "accent", text: "Betting live" },
  projections: { tone: "gold", text: "Projections only" },
};

/** Columns, desktop: model (status chip beside the name) | record | units | bar | chevron. Shared by the header row and every model row. */
const COLS = "sm:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_11rem_1rem]";

export default async function OurModelsPage() {
  const now = new Date();
  const season = seasonOf(now);
  const nbaSeason = nbaSeasonOfDate(now);

  const [nfl, cfb, cfbModel, cbb, nbaGame, nbaProps, nflProps, ftd, attd, attdLearn, lottoBoards, lottoLearn, kotcLearn] = await Promise.all([
    settle(getPicksReport("nfl")),
    settle(getPicksReport("cfb")),
    settle(getCfbModelView(season)),
    settle(getCbbRecord(now)),
    ourNbaGameModel(nbaSeason),
    settle(getOurNbaView(nbaSeason, now)),
    settle(getOurNflView(season)),
    settle(getOurFtdView(season)),
    settle(attdGraded(season)),
    settle(getAttdLearning(season)),
    settle(allBoards(nbaSeason)),
    settle(getNbaSectionLearning(SECTIONS.nbaLotto, nbaSeason)),
    settle(getNbaSectionLearning(SECTIONS.nbaKotc, nbaSeason)),
  ]);
  const nflOurs = nfl?.value ? await settle(ourFootballRecords("nfl", season, nfl.value)) : null;
  const cfbOurs = cfb?.value ? await settle(ourFootballRecords("cfb", season, cfb.value)) : null;

  const signal = (rs: { id: string; w: number; l: number; p: number; units: number; clv: number | null }[] | undefined, id: string) => rs?.find((x) => x.id === id) ?? null;
  const fb = nbaProps?.fb.graded.flatMap((g) => g.bets) ?? [];
  const attdSum = attd ? summarizeAttd(attd).edges : null;
  const lotto = lottoBoards ? summarize(rungsOf(lottoBoards), tickets(rungsOf(lottoBoards))) : null;

  const rows: ModelRow[] = [
    // NFL: spread from ours.tsx ("Our lean, any size"); total and straight up from the board report (model-records.tsx).
    { sport: "NFL", name: "Our spread model", market: "Spreads", rec: nflOurs?.spread ?? null, basis: "Every game, saved price", status: "tracked", href: "/picks?v=research" },
    { sport: "NFL", name: "Our totals", market: "Totals", rec: nflOurs?.total ?? null, basis: "Every game, saved price", status: "tracked", href: "/picks?m=ou&v=research" },
    { sport: "NFL", name: "Our straight-up pick", market: "Straight up", rec: nflOurs?.su ?? null, basis: "Winners picked, no price", status: "tracked", href: "/picks?m=su&v=research" },
    { sport: "NFL", name: "Player props", market: "Pass, rush, receiving yards and catches", rec: nflProps ? record(ourSliceBets(nflProps.graded, "edge:all")) : null, basis: "Every edge, 1u at the saved price", status: live(nflProps?.learning) ? "live" : "tracked", href: "/props?v=results" },
    { sport: "NFL", name: "First TD", market: "First touchdown scorer", rec: ftd ? ftdBestRecord(ftd.graded) : null, basis: "Edges, 1u at Kalshi's cost, fee in", status: live(ftd?.learning) ? "live" : "tracked", href: "/props?m=ftd&v=results" },
    { sport: "NFL", name: "Anytime TD", market: "Anytime and 2+ TD", rec: attdSum ? { w: attdSum.won, l: attdSum.n - attdSum.won, p: 0, units: attdSum.net } : null, basis: "Every edge, 1u at DraftKings", status: live(attdLearn) ? "live" : "tracked", href: "/props?m=attd&v=results" },
    { sport: "NFL", name: "King of the End Zone", market: "Longest TD promo", rec: null, basis: "Projection hit rate only, never priced", status: "projections", href: "/props?m=kotez&v=results", note: "No betting record: the Results page shows how often our top value pick took the crown." },
    // College football: our ratings model (cfb-model.tsx) and the board's own totals and straight up.
    { sport: "CFB", name: "Our ratings model", market: "Spreads", rec: cfbModel?.record ?? cfbOurs?.spread ?? null, basis: "Our side, every game, at -110", status: "tracked", href: "/picks/cfb?v=research" },
    { sport: "CFB", name: "Our totals", market: "Totals", rec: cfbOurs?.total ?? null, basis: "Every game, saved price", status: "tracked", href: "/picks/cfb?m=ou&v=research" },
    { sport: "CFB", name: "Our straight-up pick", market: "Straight up", rec: cfbOurs?.su ?? null, basis: "Winners picked, no price", status: "tracked", href: "/picks/cfb?m=su&v=research" },
    // NBA: the game model (game-model.tsx) and the props models (records page, ournba.tsx, lotto.tsx).
    { sport: "NBA", name: "Our game model", market: "Spreads", rec: signal(nbaGame?.records, "lean"), basis: "Every game, at -110", status: "tracked", href: "/picks/nba?v=research" },
    { sport: "NBA", name: "Our game model", market: "Totals", rec: signal(nbaGame?.records, "total"), basis: "Every game, at -110", status: "tracked", href: "/picks/nba?m=ou&v=research" },
    { sport: "NBA", name: "Player props", market: "Points, rebounds, assists and more", rec: nbaProps ? record(ourSliceBets(nbaProps.graded, "edge:all")) : null, basis: "Every edge, 1u at the saved DraftKings price", status: live(nbaProps?.learning) ? "live" : "tracked", href: "/props?m=nba&v=results" },
    { sport: "NBA", name: "First Basket", market: "First basket scorer", rec: nbaProps ? { w: fb.filter((b) => b.net > 0).length, l: fb.filter((b) => b.net <= 0).length, p: 0, units: fb.reduce((a, b) => a + b.net, 0) } : null, basis: "Every edge, 1u at the saved DraftKings price", status: live(nbaProps?.fb.learning) ? "live" : "tracked", href: "/props?m=fb&v=results" },
    { sport: "NBA", name: "Lottos", market: "Ladder rungs", rec: lotto ? { w: lotto.rungs.edge.hits, l: lotto.rungs.edge.n - lotto.rungs.edge.hits, p: 0, units: lotto.rungs.edge.net } : null, basis: "Every edge rung, 1u at the DraftKings over price", status: live(lottoLearn) ? "live" : "tracked", href: "/props?m=lotto&v=results", note: lotto ? `Parlay of the day, kept apart at 0.1u a ticket: ${lotto.tickets.won}-${lotto.tickets.n - lotto.tickets.won}, ${u(lotto.tickets.net)}.` : undefined },
    { sport: "NBA", name: "King of the Court", market: "Slate PRA leader", rec: null, basis: "Nightly calls; no season betting total", status: live(kotcLearn) ? "live" : "projections", href: "/props?m=kotc&v=results", note: "Results shows how often our favourite led and whether the king was in our top 5, night by night." },
    // College hoops (CbbView results hero, one per market).
    { sport: "CBB", name: "Our blended rating", market: "Spreads", rec: signal(cbb?.records, "lean"), basis: "Every game, saved price", status: "tracked", href: "/picks/cbb?v=results" },
    { sport: "CBB", name: "Our blended rating", market: "Totals", rec: signal(cbb?.records, "total"), basis: "Every game, saved price", status: "tracked", href: "/picks/cbb?m=ou&v=results" },
    { sport: "CBB", name: "Our blended rating", market: "Straight up", rec: signal(cbb?.records, "winner"), basis: "Every game, at the saved moneyline", status: "tracked", href: "/picks/cbb?m=su&v=results" },
  ];

  const graded = rows.filter((r) => r.rec && r.rec.w + r.rec.l + (r.rec.p ?? 0) > 0);
  const priced = graded.filter((r) => r.rec!.units !== undefined);
  const up = priced.filter((r) => (r.rec!.units ?? 0) > 0).length;
  const liveCount = rows.filter((r) => r.status === "live").length;
  // Capped so one runaway record (lottos) does not flatten every other bar; the exact number sits beside each bar.
  const maxUnits = Math.min(50, Math.max(1, ...priced.map((r) => Math.abs(r.rec!.units ?? 0))));
  const sports = (["NFL", "CFB", "NBA", "CBB"] as const).map((sp) => ({ sp, rows: rows.filter((r) => r.sport === sp) }));
  const SPORT_NAME = { NFL: "NFL", CFB: "College football", NBA: "NBA", CBB: "College hoops" } as const;

  return (
    <main className="hh-page-in mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pb-16 pt-6 sm:px-6 sm:pt-10 lg:px-8">
      <PageHead
        title="Our models"
        sub="Every model we built, with its record. Sam's and David's models are not here; their records sit on each board."
      />

      <Section label="At a glance">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat label="Models" value={rows.length} sub={`${graded.length} with graded games`} />
          <Stat label="Ahead at their price" value={`${up} of ${priced.length}`} sub="Units above zero" tone={up ? "pos" : undefined} />
          <Stat label="Betting now" value={liveCount} sub={liveCount ? "Have a live slice staking" : "Everything is tracked"} tone={liveCount ? "pos" : undefined} />
          <Stat label="Season" value={`${season}`} sub={`NBA ${nbaSeason}-${String(nbaSeason + 1).slice(2)}`} />
        </div>
        <Disclosure summary="How to read this page">
          <p>Each record is the broadest one the model&apos;s own page shows: every game or every edge, graded at the price saved before the game. Units are not added across rows, because they are graded at different prices (saved price, -110, or Kalshi&apos;s cost); each row says its own.</p>
          <p className="mt-1">Tracked means graded with no money on it. A model bets only once one of its slices clears its gate on Learning.</p>
        </Disclosure>
      </Section>

      {sports.map(({ sp, rows: rs }) => (
        <Section key={sp} id={`m-${sp}`} label={SPORT_NAME[sp]} aside={`${rs.length} models · tracked, no stakes unless marked`}>
          {/* Column labels, desktop only: on a phone each number carries its own small label. */}
          <div aria-hidden className={`hidden gap-x-5 border-b border-hh-line pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-hh-muted sm:grid ${COLS}`}>
            <span>Model</span>
            <span className="text-right">Record</span>
            <span className="text-right">Units</span>
            <span />
            <span />
          </div>
          <ul className="flex flex-col">
            {rs.map((r) => {
              const n = gradedCount(r.rec);
              const units = n > 0 ? r.rec?.units : undefined;
              const st = STATUS[r.status];
              return (
                <li key={`${r.name}-${r.market}`} className="border-b border-hh-line last:border-b-0">
                  <Link href={r.href} className={`group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 py-3.5 ${COLS}`}>
                    <span className="col-span-2 min-w-0 sm:col-span-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold text-hh-ink group-hover:text-hh-accent-ink">{r.name}</span>
                        {st && <Chip tone={st.tone}>{st.text}</Chip>}
                      </span>
                      <span className="block text-xs text-hh-muted">
                        {r.market}
                        {` · ${r.basis}`}
                        {r.rec?.clv != null && <Num className="ml-1">{`· CLV ${r.rec.clv > 0 ? "+" : ""}${r.rec.clv.toFixed(2)} pts`}</Num>}
                      </span>
                    </span>
                    {n > 0 ? (
                      <>
                        <span className="justify-self-start sm:justify-self-end">
                          <RecordCell r={r.rec!} />
                        </span>
                        <span className="justify-self-end text-right">
                          {units !== undefined ? (
                            <Num className={`text-[17px] font-semibold ${units > 0 ? "text-hh-pos" : units < 0 ? "text-hh-neg" : "text-hh-ink"}`}>
                              <span className="sr-only">Units </span>
                              {u(units)}
                            </Num>
                          ) : (
                            <span className="text-xs text-hh-muted">No price</span>
                          )}
                        </span>
                        <span className="hidden sm:block">
                          {units !== undefined && <EdgeBar value={units} max={maxUnits} label={`${r.name}, ${r.market}, units`} format={u} showValue={false} className="w-40" />}
                        </span>
                      </>
                    ) : (
                      <span className="col-span-2 text-sm text-hh-muted sm:col-span-3 sm:text-right">No graded games yet</span>
                    )}
                    <ChevronRight size={15} aria-hidden className="hidden text-hh-muted transition-transform group-hover:translate-x-0.5 sm:block" />
                  </Link>
                  {r.note && <p className="-mt-1 pb-3 text-xs text-hh-muted">{r.note}</p>}
                </li>
              );
            })}
          </ul>
          {!rs.length && <Empty>No models for this sport yet.</Empty>}
        </Section>
      ))}

      <p className="text-xs text-hh-muted">
        How the issued picks are built from Sam and David, step by step, is on{" "}
        <Link href="/picks/model" className="font-medium text-hh-accent-ink hover:underline">
          How our picks work
        </Link>
        .
      </p>
    </main>
  );
}
