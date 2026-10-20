import type { Metadata } from "next";
import Link from "next/link";
import { redisStore } from "@/lib/picks/learning/store";
import { loadActivePolicy } from "@/lib/picks/policy-store";
import { sourceState, suInForce, type PicksPolicy, type Source } from "@/lib/picks/policy";
import { getNbaPicksView } from "@/lib/picks/nba-track-store";
import { loadSection } from "@/lib/learning/store";
import { PROPS_SECTION } from "@/lib/props/learn";
import { FTD_SECTION } from "@/lib/firsttd/learn";
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
  const ds = (state?.decisions ?? []).filter((d) => d.id.startsWith(`${league}:`) && (market === "su" ? d.id.includes(":su:") : market === "ou" ? d.id.includes(":ou:") : !d.id.includes(":su:") && !d.id.includes(":ou:")));
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
    collecting: ds.length ? `${count("retain")} collecting${count("reject") ? `, ${count("reject")} rejected` : ""}${count("report") ? `, ${count("report")} report only` : ""}` : "Registers at the next Tuesday review",
    last: state?.lastReviewAt ?? null,
  };
}

const STATE_TEXT = { out: "Not used", cuts: "Its agreement cuts can be the rule; no veto", veto: "Veto: a college rule bet it disagrees with is skipped" } as const;

function sourceRow(state: ReviewState | null, policy: PicksPolicy, src: Source): Pick<Row, "live" | "collecting" | "last"> {
  const d = state?.decisions?.find((x) => x.id === `cfb:source:${src}`);
  return {
    live: STATE_TEXT[sourceState(policy, src)],
    collecting: d ? d.why : "Registers at the next Tuesday review",
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
  const [state, policy, nba, nflProps, nbaProps, ftd] = await Promise.all([
    redisStore.state().catch(() => null),
    loadActivePolicy(),
    getNbaPicksView().catch(() => null),
    loadSection(PROPS_SECTION.nfl, season),
    loadSection(PROPS_SECTION.nba, season),
    loadSection(FTD_SECTION, season),
  ]);
  const PICKS = "Picks review: Tuesday 7am, paired t 1.645 vs the parent or method in force, 30+ games over 3+ weeks, CLV and drawdown checks, rollback";
  const ENGINE = "Shared engine: weekly, judged per game, t 2.33, refinements must beat their parent, rollback";
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
      title: "NBA picks",
      rows: [
        { name: "NBA spreads", loop: "NBA review: weekly, the Picks criteria on NBA games only, own limits", href: "/picks/nba?v=research", ...nbaRow("ats") },
        { name: "NBA totals", loop: "NBA review: weekly, the Picks criteria on NBA games only, own limits", href: "/picks/nba?v=research", ...nbaRow("ou") },
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
        { name: "NFL player props (Sam and David)", loop: ENGINE, href: "/props?v=research", ...engineRow(nflProps) },
        { name: "NFL first TD", loop: "Shared engine, First TD gate: 60 games over 4 weeks, 12+ winners at Kalshi's ask, t 2.33", href: "/props?m=ftd&v=research", ...engineRow(ftd) },
        { name: "NBA player props (Sam)", loop: ENGINE, href: "/props?m=nba&v=research", ...engineRow(nbaProps) },
        {
          name: "NBA first basket",
          loop: "Shared engine, First TD gate (planned)",
          live: "Not built",
          collecting: "Waiting on Sam's first basket page (locked on his board). Plugs into the engine as its own section once it posts.",
          last: null,
          href: "/props?m=nba",
          waiting: true,
        },
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
