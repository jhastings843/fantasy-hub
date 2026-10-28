import type { Metadata } from "next";
import Link from "next/link";
import { redisStore } from "@/lib/picks/learning/store";
import { loadActivePolicy } from "@/lib/picks/policy-store";
import { sourceState, suInForce, type PicksPolicy, type Source } from "@/lib/picks/policy";
import { getNbaPicksView } from "@/lib/picks/nba-track-store";
import { loadSection } from "@/lib/learning/store";
import { PROPS_SECTION } from "@/lib/props/learn";
import { OUR_SECTION } from "@/lib/models/learn";
import { SECTIONS } from "@/lib/models/sections";
import { CFB_SECTION } from "@/lib/models/cfb/track";
import { nbaSeasonOfDate } from "@/lib/props/parse";
import type { SectionState } from "@/lib/learning/engine";
import type { ReviewState } from "@/lib/picks/learning/review";
import { whenEt } from "../picks/ui";
import s from "../picks/picks.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Learning · Hobby Hub",
  description: "Every Picks and Props section, its own evidence, and where its self-improving loop stands.",
};

// One page that accounts for every section: which loop it runs on, what is
// live, what is collecting, when it last reviewed. Read-only.

const seasonOf = (d: Date) => (d.getUTCMonth() < 7 ? d.getUTCFullYear() - 1 : d.getUTCFullYear());
const SU_LABEL: { [k: string]: string } = { avg: "models' average", sam: "Sam's winner", david: "David's winner", vegas: "Vegas favorite" };

interface Row {
  name: string;
  loop: string;
  live: string;
  collecting: string;
  last: string | null;
  href: string;
  waiting?: boolean;
}

function picksMarket(state: ReviewState | null, policy: PicksPolicy, league: "nfl" | "cfb", market: "ats" | "ou" | "su"): Pick<Row, "live" | "collecting" | "last"> {
  const ds = (state?.decisions ?? []).filter((d) => d.id.startsWith(`${league}:`) && (market === "su" ? d.id.includes(":su:") : market === "ou" ? d.id.includes(":ou:") : !d.id.includes(":su:") && !d.id.includes(":ou:") && !d.id.includes(":mkt:")));
  const count = (v: string) => ds.filter((d) => d.verdict === v).length;
  const live =
    market === "su"
      ? `Method in force: ${SU_LABEL[suInForce(policy, league)] ?? suInForce(policy, league)}`
      : market === "ou"
        ? (policy.totalsCandidates ?? []).filter((x) => x.startsWith(`${league}:`)).length
          ? `Agreement plus ${(policy.totalsCandidates ?? []).filter((x) => x.startsWith(`${league}:`)).map((x) => x.split(":")[1]).join(", ")}`
          : "Agreement cut only"
        : policy.atsCandidates.filter((x) => x.startsWith(`${league}:`)).length
          ? `Built-in cuts plus ${policy.atsCandidates.filter((x) => x.startsWith(`${league}:`)).length} activated`
          : "Built-in cuts only";
  return {
    live,
    collecting: ds.length ? `${count("retain")} collecting${count("reject") ? `, ${count("reject")} rejected` : ""}${count("report") ? `, ${count("report")} report only` : ""}` : "Registers at the next review",
    last: state?.lastReviewAt ?? null,
  };
}

const STATE_TEXT = { out: "Not used", cuts: "Its agreement cuts can be the rule; no veto", veto: "Veto: a college rule bet it disagrees with is skipped" } as const;

function sourceRow(state: ReviewState | null, policy: PicksPolicy, src: Source): Pick<Row, "live" | "collecting" | "last"> {
  const d = state?.decisions?.find((x) => x.id === `cfb:source:${src}`);
  return {
    live: STATE_TEXT[sourceState(policy, src)],
    collecting: d ? d.why : "Registers at the next review",
    last: state?.lastReviewAt ?? null,
  };
}

function engineRow(st: SectionState): Pick<Row, "live" | "collecting" | "last"> {
  const es = Object.values(st.entries);
  const live = es.filter((e) => e.status === "active");
  const back = es.filter((e) => e.status === "rolled-back").length;
  return {
    live: live.length ? live.map((e) => e.label).join("; ") : "Nothing live yet",
    collecting: es.length ? `${es.filter((e) => e.status === "collecting").length} collecting${back ? `, ${back} rolled back` : ""}` : "Registers at its next scheduled run",
    last: st.lastReviewAt ?? null,
  };
}

export default async function LearningPage() {
  const season = seasonOf(new Date());
  const nbaSeason = nbaSeasonOfDate(new Date());
  const [state, policy, nba, nflProps, ourNbaProps, ourFb, ourNflProps, ourFtd, attd, lotto, kotc, cfbModel] = await Promise.all([
    redisStore.state().catch(() => null),
    loadActivePolicy(),
    getNbaPicksView().catch(() => null),
    loadSection(PROPS_SECTION.nfl, season),
    loadSection(OUR_SECTION.nbaProps, nbaSeason),
    loadSection(OUR_SECTION.nbaFirstBasket, nbaSeason),
    loadSection(OUR_SECTION.nflProps, season),
    loadSection(OUR_SECTION.nflFirstTd, season),
    loadSection(SECTIONS.nflAttd, season),
    loadSection(SECTIONS.nbaLotto, nbaSeason),
    loadSection(SECTIONS.nbaKotc, nbaSeason),
    loadSection(CFB_SECTION, season),
  ]);
  // David's slices only: the NFL props section also holds Sam's, no longer shown (paywalled 2026-10-21).
  const davidOnly = { ...nflProps, entries: Object.fromEntries(Object.entries(nflProps.entries).filter(([id]) => (id.startsWith("dplay:") || id.startsWith("dboard:")) && !id.includes("sam"))) };
  const PICKS = "Picks review: 7am ET after each slate (Fri, Sun, Mon, Tue), one change per part per week, paired t 1.645 vs the parent or method in force, 30+ games over 3+ weeks, CLV and drawdown checks, rollback";
  const ENGINE = "Shared engine: reviewed after every slate, new live slices capped per week, judged per game, t 2.33, refinements must beat their parent, rollback";
  const nbaCount = (m: string) => (nba?.hyps ?? []).filter((h) => h.id.startsWith(`${m}:`));
  const nbaRow = (m: "ats" | "ou"): Pick<Row, "live" | "collecting" | "last"> => ({
    live: nbaCount(m).filter((h) => h.status === "active").length ? `Core cuts plus ${nbaCount(m).filter((h) => h.status === "active").map((h) => h.label).join(", ")}` : "Core cuts only",
    collecting: `${nbaCount(m).filter((h) => h.status === "collecting").length} collecting; no stakes until the go-live gate clears`,
    last: nba?.lastReviewAt ?? null,
  });

  const groups: { title: string; rows: Row[] }[] = [
    {
      title: "Football picks",
      rows: (["nfl", "cfb"] as const).flatMap((l) => {
        const L = l === "nfl" ? "NFL" : "College";
        const base = l === "nfl" ? "/picks" : "/picks/cfb";
        return [
          { name: `${L} spreads`, loop: PICKS, href: `${base}?v=research`, ...picksMarket(state, policy, l, "ats") },
          { name: `${L} totals`, loop: PICKS, href: `${base}?m=ou&v=research`, ...picksMarket(state, policy, l, "ou") },
          { name: `${L} straight up`, loop: `${PICKS} (+1 right, −1 wrong per game)`, href: `${base}?m=su&v=research`, ...picksMarket(state, policy, l, "su") },
        ];
      }),
    },
    {
      title: "Outside sources (college)",
      rows: (["pem", "harris"] as const).map((src) => ({
        name: src === "pem" ? "PEM (@FansOfCFB)" : "John Harris (@jhnhrris)",
        loop: "Picks review: does skipping the rule bets it disagrees with gain? Gain at t 1.645 over 30+ bets and 3+ weeks adds it as a veto; a loss on the same bar drops it. Retested from every switch.",
        href: "/picks/cfb?v=research",
        ...sourceRow(state, policy, src),
      })),
    },
    {
      title: "Our college model",
      rows: [
        {
          name: "College spreads and totals (our ratings model)",
          loop: "Shared engine, college model gate: paper bets at -110 on its own slices (edge size, home or road, favorite or dog, conference, line move, totals) and the learner's combinations; 30+ games over 3+ weeks at t 2.33, must beat its parent, rollback. Judged as a source; nothing staked",
          href: "/picks/cfb?v=research",
          ...engineRow(cfbModel),
        },
      ],
    },
    {
      title: "Public betting and line moves (report only)",
      rows: (["nfl", "cfb"] as const).map((l) => {
        const ds = (state?.decisions ?? []).filter((d) => d.id.startsWith(`${l}:mkt:`));
        return {
          name: `${l === "nfl" ? "NFL" : "College"}: reverse line moves, public side, sharp money`,
          loop: "Picks review: does skipping the rule bets each signal flags gain? Splits from Action Network's public feed, saved with every pregame snapshot since Oct 21. Report only: nothing changes a bet until Jack says so.",
          href: l === "nfl" ? "/picks?v=research" : "/picks/cfb?v=research",
          live: "Not used on any bet",
          collecting: ds.length ? ds.map((d) => `${d.id.split(":mkt:")[1]}: ${d.why}`).join(" · ") : "Registers at the next review",
          last: state?.lastReviewAt ?? null,
        };
      }),
    },
    {
      title: "NBA picks",
      rows: [
        { name: "NBA spreads", loop: "NBA review: games are daily, so evidence grows every night; the review runs daily after each night's games with one change per market a week, Picks criteria on NBA games only, own limits", href: "/picks/nba?v=research", ...nbaRow("ats") },
        { name: "NBA totals", loop: "NBA review: games are daily, so evidence grows every night; the review runs daily after each night's games with one change per market a week, Picks criteria on NBA games only, own limits", href: "/picks/nba?v=research", ...nbaRow("ou") },
        {
          name: "NBA straight up",
          loop: "Record only",
          live: "Sam's winner is graded every game",
          collecting: "No loop: nothing uses an NBA straight-up pick (no pool, no moneyline bets). Gets one if that changes.",
          last: null,
          href: "/picks/nba?v=results",
          waiting: true,
        },
      ],
    },
    {
      title: "Props",
      rows: [
        { name: "NFL player props (our model)", loop: ENGINE, href: "/props?v=results", ...engineRow(ourNflProps) },
        { name: "NFL first TD (our model)", loop: "Shared engine, First TD gate: 60 games over 4 weeks, 12+ winners at Kalshi's ask, t 2.33", href: "/props?m=ftd&v=results", ...engineRow(ourFtd) },
        { name: "NFL player props (David)", loop: ENGINE, href: "/props?v=research", ...engineRow(davidOnly) },
        { name: "NBA player props (our model)", loop: `${ENGINE}. Games are daily and graded overnight; the cap on new live slices runs Monday to Sunday`, href: "/props?m=nba&v=results", ...engineRow(ourNbaProps) },
        { name: "NBA first basket (our model)", loop: "Shared engine, First TD gate: 60 games over 4 weeks, 12+ winners at DraftKings' price, t 2.33", href: "/props?m=nba&v=results", ...engineRow(ourFb) },
        { name: "NFL anytime TD (our model)", loop: "Shared engine, Anytime TD gate: 30+ games over 3+ weeks, 100+ bets and 25+ winners. A live slice's players are marked as bets", href: "/props?m=attd&v=log", ...engineRow(attd) },
        { name: "NBA lottos (our model)", loop: "Shared engine, long-price gate: 60+ games over 4+ weeks, 12+ winners. A live slice's rungs, or the nightly ticket, are marked as bets", href: "/props?m=lotto&v=log", ...engineRow(lotto) },
        { name: "NBA King of the Court (our model)", loop: `${ENGINE}. Judged per night; a live slice marks the tagged props of our top N as bets`, href: "/props?m=kotc&v=log", ...engineRow(kotc) },
      ],
    },
  ];

  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <header className={s.header}>
          <span className={s.eyebrow}>{`Every section · ${season}`}</span>
          <h1 className={s.h1}>Learning</h1>
          <p className={s.p}>
            Each section learns from its own games only: an NFL totals edge never borrows from college spreads, and NBA props never borrow from NFL props. The rules are
            the same everywhere: a change is tested on games after it was first tracked, goes live only when it clears its section&apos;s bar, and is rolled back if it
            loses after that.
          </p>
        </header>
        {groups.map((g) => (
          <section key={g.title} className={s.section}>
            <h2 className={s.h2}>{g.title}</h2>
            <ul className={s.cards}>
              {g.rows.map((r) => (
                <li key={r.name} className={s.card}>
                  <b>
                    <Link href={r.href}>{r.name}</Link>
                    {r.waiting && <span className={s.tag} style={{ marginLeft: 6 }}>not running</span>}
                  </b>
                  <span className={s.dim} style={{ fontSize: 13 }}>{r.loop}</span>
                  <span style={{ fontSize: 14 }}>
                    <span className={s.tag}>live</span>
                    {r.live}
                  </span>
                  <span style={{ fontSize: 14 }}>
                    <span className={s.tag}>testing</span>
                    {r.collecting}
                  </span>
                  <span className={s.dim} style={{ fontSize: 12 }}>{r.last ? `Last review ${whenEt(r.last)}` : r.waiting ? "" : "No review yet"}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
