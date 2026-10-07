import Link from "next/link";
import {
  BREAK_EVEN,
  MIN_SAMPLE,
  SU_BANDS,
  type BoardGame,
  type CutResult,
  type Record as Rec,
  type Tier,
  matches,
  suPick,
} from "@/lib/picks/engine";
import { SOURCES, getPicksReport, type PicksReport } from "@/lib/picks/report";
import type { League } from "@/lib/picks/parse";
import TierChecker from "./TierChecker";
import s from "./picks.module.css";

// One view for both tabs. Every number on it comes out of the report, and
// every sentence that carries a number is built from it, so the page reads
// right in Week 12 without anyone editing it.

const LEAGUE_NAME: { [k in League]: string } = { nfl: "NFL", cfb: "College football" };

const rec = (r: Rec) => `${r.w}-${r.l}${r.p ? `-${r.p}` : ""}`;
const pct = (r: Rec) => `${Math.round(r.pct * 100)}%`;
const units = (r: Rec) => `${r.units >= 0 ? "+" : "−"}${Math.abs(r.units).toFixed(1)}u`;
const line = (x: number) => (x === 0 ? "PK" : `${x > 0 ? "+" : ""}${x}`);
const n = (r: Rec) => r.w + r.l;

const TIER_ORDER: Tier[] = ["t1", "t2", "fav", "pass", "split", "one"];
const TIER_LABEL: { [t in Tier]: string } = {
  t1: "Tier 1 · bet",
  t2: "Tier 2 · small",
  fav: "Pass · favorite",
  pass: "Pass",
  split: "Pass · split",
  one: "One model only",
};

function TierChip({ t }: { t: Tier }) {
  const cls = t === "t1" ? s.t1 : t === "t2" ? s.t2 : s.tPass;
  return <span className={`${s.tier} ${cls}`}>{TIER_LABEL[t]}</span>;
}

function StrategyRow({ label, r, mark }: { label: string; r: Rec; mark?: "rule" | "second" }) {
  const good = r.pct > BREAK_EVEN;
  const tip = `${label}: ${rec(r)}, ${pct(r)} ATS, ${units(r)} at −110. 90% likely range ${Math.round(r.lo * 100)}% to ${Math.round(r.hi * 100)}%.`;
  return (
    <div className={`${s.srow} ${mark === "rule" ? s.star : mark === "second" ? s.second : ""}`} title={tip} tabIndex={0}>
      <div className={s.sname}>
        {label}
        {mark === "rule" && <span className={s.pill}>the rule</span>}
        {mark === "second" && <span className={`${s.pill} ${s.pillSoft}`}>tier 2</span>}
        {n(r) > 0 && n(r) < MIN_SAMPLE && <span className={s.thin}> · small sample</span>}
      </div>
      <div className={`${s.right} ${s.num}`}>{n(r) ? rec(r) : "none"}</div>
      <div className={s.sbar}>
        <div className={s.track}>
          {n(r) > 0 && (
            <>
              <span className={s.ci} style={{ left: `${r.lo * 100}%`, width: `${(r.hi - r.lo) * 100}%` }} />
              <span className={`${s.fill} ${good ? s.fillPos : s.fillNeg}`} style={{ width: `${r.pct * 100}%` }} />
            </>
          )}
          <span className={s.be} />
        </div>
      </div>
      <div className={`${s.right} ${s.num} ${s.hideSm}`}>{n(r) ? pct(r) : ""}</div>
      <div className={`${s.right} ${s.num} ${good ? s.pos : s.neg}`}>{n(r) ? units(r) : ""}</div>
    </div>
  );
}

export default async function PicksView({ league }: { league: League }) {
  const fresh = await getPicksReport(league).catch(() => null);
  const r = fresh?.value ?? null;
  const other: League = league === "nfl" ? "cfb" : "nfl";

  const subnav = (
    <nav className={s.subnav} aria-label="League">
      {(["nfl", "cfb"] as const).map((l) => (
        <Link key={l} href={l === "nfl" ? "/picks" : "/picks/cfb"} aria-current={l === league ? "page" : undefined}>
          {LEAGUE_NAME[l]}
        </Link>
      ))}
    </nav>
  );

  if (!r) {
    return (
      <main className={s.page}>
        <div className={s.wrap}>
          {subnav}
          <div className={s.error}>
            Couldn&apos;t load either model&apos;s pages right now, and there&apos;s no saved copy yet. Try again in a few
            minutes. The <Link href={other === "nfl" ? "/picks" : "/picks/cfb"}>{LEAGUE_NAME[other]}</Link> tab may still load.
          </div>
        </div>
      </main>
    );
  }

  return <Report r={r} subnav={subnav} stale={fresh?.stale ?? false} at={fresh?.at ?? r.generatedAt} />;
}

function Report({ r, subnav, stale, at }: { r: PicksReport; subnav: React.ReactNode; stale: boolean; at: string }) {
  const lg = r.league;
  const st = r.strategies;
  const cut = (id: string) => st.cuts.find((c) => c.id === id) as CutResult;
  const name = (k: string) => r.names[k] ?? k;
  const big = lg === "nfl" ? 6.5 : 14;
  const e0 = lg === "nfl" ? 2 : 3;
  const weeks = r.weeksCovered;
  const games = r.graded.length;
  const updated = new Date(at).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const board = r.board
    .slice()
    .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || (b.read?.avgEdge ?? 0) - (a.read?.avgEdge ?? 0));
  const plays = board.filter((g) => g.tier === "t1" || g.tier === "t2");
  const rest = board.filter((g) => g.tier !== "t1" && g.tier !== "t2");
  const count = (t: Tier) => board.filter((g) => g.tier === t).length;

  const suMethod = r.su.best?.id ?? "avg";
  const suList = r.board
    .flatMap((g) => {
      const p = suPick(suMethod, g.sam, g.david);
      return p ? [{ g, ...p }] : [];
    })
    .sort((a, b) => b.margin - a.margin);
  const bands = SU_BANDS[lg];
  const band = (m: number) => (m >= bands.lock ? "lock" : m >= bands.solid ? "solid" : "toss");

  const firstT1 = board.find((g) => g.tier === "t1" && g.sam && g.david);
  const example = firstT1?.sam && firstT1.david
    ? {
        vegas: firstT1.david.market,
        sam: firstT1.sam.model,
        david: firstT1.david.model,
        label: `${name(firstT1.away)} at ${name(firstT1.home)}`,
      }
    : null;

  const live = r.live.filter((w) => n(w.t1) + n(w.t2) + w.su.w + w.su.l > 0);
  const liveT1 = live.reduce((t, w) => ({ w: t.w + w.t1.w, l: t.l + w.t1.l, p: t.p + w.t1.p }), { w: 0, l: 0, p: 0 });

  const byWeek = st.byWeek;
  const bestWeek = byWeek.slice().sort((a, b) => b.record.pct - a.record.pct)[0];
  const worstWeek = byWeek.slice().sort((a, b) => a.record.pct - b.record.pct)[0];
  const dogs = st.baselines.find((b) => b.id === "dogs")!.record;
  const sam = st.baselines.find((b) => b.id === "sam")!.record;
  const david = st.baselines.find((b) => b.id === "david")!.record;

  const groups = [...new Set(st.cuts.map((c) => c.group))];

  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <header className={s.header}>
          {subnav}
          <div className={s.eyebrow}>
            {LEAGUE_NAME[lg]} {r.season} · against the spread{r.week ? ` · Week ${r.week} board` : ""}
          </div>
          <h1 className={s.h1}>Two-Model Picks</h1>
          <p className={s.p}>
            When David Sasser&apos;s model and Sam&apos;s Models land on the same side, how often does it cover, and which
            version of agreement is worth betting? Rebuilt from both sites every few hours; the rule is whichever cut is
            winning.
          </p>
          <div className={s.src}>
            <span>
              Sources: <a href={SOURCES[lg].davidBoard}>David Sasser</a> (board and history sheet) and{" "}
              <a href={SOURCES[lg].samRecord}>Sam&apos;s Models record</a>
            </span>
            <span>Updated {updated} ET</span>
            <span>Graded at −110</span>
          </div>
          <div className={s.scope}>
            <span>
              <b>
                {games} games both models graded, Week{weeks.length > 1 ? "s" : ""} {weeks.length > 1 ? `${weeks[0]} to ${weeks[weeks.length - 1]}` : weeks[0]}.
              </b>{" "}
              Each model only publishes graded games from the weeks it has covered. Treat small samples as an early read.
            </span>
            {lg === "cfb" && (
              <span>
                PEM (Jay, @FansOfCFB) is a third model here:{" "}
                {r.pem.length
                  ? r.pem.map((w) => `Week ${w.week}${w.verified ? "" : " (failed its check, left out)"}`).join(", ")
                  : "no cards on file yet"}
                . Its cards arrive from X on Tuesday.
              </span>
            )}
            {stale && <span>Showing the last good copy: one of the sites didn&apos;t load on the latest try.</span>}
            {r.errors.map((e) => (
              <span key={e}>Couldn&apos;t read {e}</span>
            ))}
          </div>
        </header>

        <section className={s.section}>
          {st.rule ? (
            <div className={s.rule}>
              <div>
                <div className={s.eyebrow}>The rule right now</div>
                <h2 className={s.h2}>{st.rule.label}</h2>
                <p className={s.p}>
                  Picked automatically: of every cut with at least {MIN_SAMPLE} graded games, this one has the best worst
                  case (the low end of its 90% likely range, {Math.round(st.rule.record.lo * 100)}%). Shared picks are graded
                  at the worse of the two sites&apos; lines.
                  {st.second ? ` Tier 2 is the runner-up: ${st.second.label.toLowerCase()} (${rec(st.second.record)}).` : ""}
                </p>
              </div>
              <div className={`${s.big} ${s.num}`}>
                {rec(st.rule.record)}
                <small>
                  {pct(st.rule.record)} ATS · {units(st.rule.record)}
                </small>
              </div>
            </div>
          ) : (
            <div className={s.rule}>
              <div>
                <div className={s.eyebrow}>The rule right now</div>
                <h2 className={s.h2}>No cut qualifies yet</h2>
                <p className={s.p}>
                  None of the cuts has {MIN_SAMPLE}+ graded games and a winning record. Everything on the board is a pass
                  until one does.
                </p>
              </div>
            </div>
          )}
          <div className={s.tiles}>
            <div className={`${s.tile} ${cut("agree").record.pct > BREAK_EVEN ? s.good : s.bad}`}>
              <div className={`${s.tileV} ${s.num}`}>{rec(cut("agree").record)}</div>
              <div className={s.tileK}>All {cut("agree").games} games where both agree ({pct(cut("agree").record)})</div>
            </div>
            <div className={`${s.tile} ${cut("fav").record.pct > BREAK_EVEN ? s.good : s.bad}`}>
              <div className={`${s.tileV} ${s.num}`}>{rec(cut("fav").record)}</div>
              <div className={s.tileK}>Agreement on the favorite ({pct(cut("fav").record)})</div>
            </div>
            <div className={s.tile}>
              <div className={`${s.tileV} ${s.num}`}>{rec(dogs)}</div>
              <div className={s.tileK}>Every underdog, no model at all ({pct(dogs)})</div>
            </div>
            <div className={s.tile}>
              <div className={`${s.tileV} ${s.num}`}>{rec(st.splits.sam)}</div>
              <div className={s.tileK}>Splits: Sam&apos;s side. David&apos;s side went {rec(st.splits.david)}.</div>
            </div>
          </div>
        </section>

        <section className={s.section} id="board">
          <div>
            <div className={s.eyebrow}>This week</div>
            <h2 className={s.h2}>{r.week ? `Week ${r.week} board` : "This week's board"}</h2>
          </div>
          <p className={s.p}>
            {count("t1")} Tier 1, {count("t2")} Tier 2, {board.length - count("t1") - count("t2")} passes. &quot;Play&quot; uses
            the worse of the two sites&apos; lines. Re-check the live number before betting; if it has moved, run it through
            the checker below.
            {!r.boardUpdated.sam || !r.boardUpdated.david
              ? ` ${!r.boardUpdated.sam ? "Sam" : "David"} hasn't posted this week's board yet, so every game is single-model for now.`
              : ""}
          </p>
          {plays.length > 0 ? (
            <BoardTable games={plays} name={name} withPem={lg === "cfb"} />
          ) : (
            <div className={s.tile}>
              <div className={s.tileK}>No games fit the rule or the runner-up this week.</div>
            </div>
          )}
          {rest.length > 0 && (
            <details className={s.details}>
              <summary>The other {rest.length} games</summary>
              <BoardTable games={rest} name={name} withPem={lg === "cfb"} />
            </details>
          )}
        </section>

        <section className={s.section} id="straight-up">
          <div>
            <div className={s.eyebrow}>Pick&apos;em</div>
            <h2 className={s.h2}>Straight-up winners</h2>
          </div>
          <p className={s.p}>
            Ranked for a confidence pool, most sure first. Picks follow the best straight-up method so far:{" "}
            <b>{r.su.best?.label.toLowerCase() ?? "average of both models"}</b>
            {r.su.best ? ` (${r.su.best.w}-${r.su.best.l}, ${Math.round(r.su.best.pct * 100)}%)` : ""}. Confidence comes from
            the projected margin.
          </p>
          <div className={s.tiles}>
            {r.su.bands.map((b) => (
              <div key={b.id} className={s.tile}>
                <div className={`${s.tileV} ${s.num}`}>
                  {b.w}-{b.l}
                </div>
                <div className={s.tileK}>{b.label}</div>
              </div>
            ))}
            {r.su.methods
              .filter((m) => m.id === "vegas")
              .map((m) => (
                <div key={m.id} className={s.tile}>
                  <div className={`${s.tileV} ${s.num}`}>
                    {m.w}-{m.l}
                  </div>
                  <div className={s.tileK}>Just taking the Vegas favorite</div>
                </div>
              ))}
          </div>
          <div className={s.tw}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Pick</th>
                  <th>Over</th>
                  <th>Margin</th>
                  <th>Confidence</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {suList.map(({ g, side, margin }, i) => {
                  const b = band(margin);
                  const pick = side === "home" ? g.home : g.away;
                  const opp = side === "home" ? g.away : g.home;
                  const mkt = g.david?.market ?? g.sam?.market ?? 0;
                  const vegasDog = mkt !== 0 && (side === "home") !== mkt < 0;
                  const split = g.sam && g.david && Math.sign(g.sam.model) !== Math.sign(g.david.model);
                  return (
                    <tr key={`${g.away}@${g.home}`}>
                      <td className={s.num}>{suList.length - i}</td>
                      <td className={s.play}>
                        {name(pick)}
                        {side === "home" ? "" : <span className={s.dim}> (away)</span>}
                      </td>
                      <td>{name(opp)}</td>
                      <td className={s.num}>{margin.toFixed(1)}</td>
                      <td>
                        <span className={`${s.tier} ${b === "lock" ? s.lock : b === "solid" ? s.solid : s.toss}`}>
                          {b === "lock" ? "Lock" : b === "solid" ? "Solid" : "Toss-up"}
                        </span>
                      </td>
                      <td className={s.thin}>
                        {[vegasDog ? "Vegas underdog" : "", split ? "models split" : "", !g.sam || !g.david ? "one model" : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className={`${s.p} ${s.thin}`}>
            Rank is confidence points: the top pick gets {suList.length}. Straight-up record by method:{" "}
            {r.su.methods.map((m) => `${m.label.toLowerCase()} ${m.w}-${m.l}`).join(", ")}.
          </p>
        </section>

        <section className={s.section}>
          <div>
            <div className={s.eyebrow}>Strategy leaderboard</div>
            <h2 className={s.h2}>Every cut tested</h2>
          </div>
          <p className={s.p}>
            Each row is a filter on the {games} graded games. The bar is ATS win rate, the shaded band is the 90% likely
            range given the sample size, and the black tick is 52.4%, break-even at −110. Hover or tap a row for detail.
          </p>
          <div className={s.board}>
            <div className={s.legend}>
              <span><i style={{ background: "var(--pos)" }} />Above break-even</span>
              <span><i style={{ background: "var(--neg)" }} />Below</span>
              <span><i style={{ background: "var(--ci)" }} />90% likely range</span>
              <span><i style={{ background: "var(--ink)", width: 2, height: 12 }} />52.4% break-even</span>
            </div>
            <div className={s.grp}>Baselines</div>
            {st.baselines.map((b) => (
              <StrategyRow key={b.id} label={b.label} r={b.record} />
            ))}
            <StrategyRow label="Models split: Sam's side" r={st.splits.sam} />
            <StrategyRow label="Models split: David's side" r={st.splits.david} />
            {groups.map((g) => (
              <div key={g}>
                <div className={s.grp}>{g}</div>
                {st.cuts
                  .filter((c) => c.group === g)
                  .map((c) => (
                    <StrategyRow
                      key={c.id}
                      label={c.label}
                      r={c.record}
                      mark={st.rule?.id === c.id ? "rule" : st.second?.id === c.id ? "second" : undefined}
                    />
                  ))}
              </div>
            ))}
            <div className={s.grp}>By week (all agreements)</div>
            {byWeek.map((w) => (
              <StrategyRow key={w.week} label={`Week ${w.week}`} r={w.record} />
            ))}
          </div>
        </section>

        {live.length > 0 && (
          <section className={s.section}>
            <div>
              <div className={s.eyebrow}>Since the tab went live</div>
              <h2 className={s.h2}>The plays as made</h2>
            </div>
            <p className={s.p}>
              Each week&apos;s board is frozen when the Wednesday email goes out and graded later at those lines. This is
              the real record, separate from the backtest. Tier 1 so far: {rec(liveT1 as Rec)}.
            </p>
            <div className={s.tw}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Rule that week</th>
                    <th>Tier 1</th>
                    <th>Tier 2</th>
                    <th>Straight up</th>
                  </tr>
                </thead>
                <tbody>
                  {live.map((w) => (
                    <tr key={w.week}>
                      <td className={s.num}>{w.week}</td>
                      <td>
                        {w.rule ?? "none"}
                        {!w.frozen && <span className={s.dim}> (not frozen yet)</span>}
                      </td>
                      <td className={s.num}>{rec(w.t1)}</td>
                      <td className={s.num}>{rec(w.t2)}</td>
                      <td className={s.num}>
                        {w.su.w}-{w.su.l}
                        {w.pending ? <span className={s.dim}> · {w.pending} pending</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className={s.section}>
          <div>
            <div className={s.eyebrow}>Your three ideas</div>
            <h2 className={s.h2}>How each one is holding up</h2>
          </div>
          <div className={s.tiles} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            {[
              { q: "Bet whenever their picks match", c: cut("agree") },
              { q: "Both model lines within ±4 of Vegas", c: cut("near-vegas") },
              { q: `They agree and the dog gets +${big} or more`, c: cut(`dog-${big}`) },
            ].map(({ q, c }) => (
              <div key={q} className={s.tile}>
                <div className={s.tileK} style={{ fontWeight: 600, color: "var(--ink)" }}>{q}</div>
                <div className={`${s.tileV} ${s.num}`}>{n(c.record) ? rec(c.record) : "none yet"}</div>
                <div className={s.tileK}>
                  {n(c.record) < MIN_SAMPLE
                    ? `Only ${n(c.record)} decided games. Too few to call.`
                    : c.record.pct > cut("agree").record.pct + 0.03
                      ? `${pct(c.record)}, better than plain agreement (${pct(cut("agree").record)}).`
                      : c.id === "agree"
                        ? `${pct(c.record)}. Sam alone is ${rec(sam)}, David ${rec(david)}.`
                        : `${pct(c.record)}, no better than plain agreement (${pct(cut("agree").record)}).`}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={s.section}>
          <div>
            <div className={s.eyebrow}>Use it every week</div>
            <h2 className={s.h2}>Tier checker</h2>
          </div>
          <TierChecker
            rule={st.rule ? { label: st.rule.label, test: st.rule.test, record: rec(st.rule.record) } : null}
            second={st.second ? { label: st.second.label, test: st.second.test, record: rec(st.second.record) } : null}
            example={example}
          />
        </section>

        <section className={s.section}>
          <div>
            <div className={s.eyebrow}>What to watch</div>
            <h2 className={s.h2}>Correlations to track</h2>
          </div>
          <div className={s.watch}>
            <div className={s.wcard}>
              <h3>Dogs vs. favorites</h3>
              <p>
                Agreement on an underdog is {rec(cut("dog").record)}; on a favorite, {rec(cut("fav").record)}. Road dogs{" "}
                {rec(cut("road-dog").record)}, home dogs {rec(cut("home-dog").record)}.
              </p>
            </div>
            <div className={s.wcard}>
              <h3>Edge size</h3>
              <p>
                Dogs with an average edge of {e0}+ are {rec(cut(`dog-e${e0}`).record)}; under {e0}, {rec(cut(`dog-lt${e0}`).record)}.
                If the small-edge bucket keeps up, edge size isn&apos;t adding anything.
              </p>
            </div>
            <div className={s.wcard}>
              <h3>When the models disagree with each other</h3>
              <p>
                Model lines within 3 points of each other: {rec(cut("gap3").record)}. Three or more apart:{" "}
                {rec(cut("gap3plus").record)}. In splits, Sam&apos;s side is {rec(st.splits.sam)}, David&apos;s{" "}
                {rec(st.splits.david)}.
              </p>
            </div>
            <div className={s.wcard}>
              <h3>Both models pick the dog outright</h3>
              <p>
                {rec(cut("flip").record)} so far. This week:{" "}
                {board.filter((g) => g.read?.flip).map((g) => `${name(g.away)} at ${name(g.home)}`).join(", ") || "none"}.
              </p>
            </div>
            {bestWeek && worstWeek && bestWeek.week !== worstWeek.week && (
              <div className={`${s.wcard} ${s.warn}`}>
                <h3>Week-to-week swings</h3>
                <p>
                  Agreements went {rec(bestWeek.record)} in Week {bestWeek.week} and {rec(worstWeek.record)} in Week{" "}
                  {worstWeek.week}. Every underdog, with no model, is {pct(dogs)} against a long-run norm near 50%. Expect
                  hot cuts to cool.
                </p>
              </div>
            )}
            <div className={`${s.wcard} ${s.warn}`}>
              <h3>Line timing</h3>
              <p>
                Sam grades against the first line his model saw; David posts later. Part of Sam&apos;s record ({rec(sam)})
                is an opening number you may not be able to bet. When a line moves a lot, recheck it with the checker.
              </p>
            </div>
          </div>
        </section>

        <details className={s.details}>
          <summary>Game log: all {games} graded games</summary>
          <div className={s.tw}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Wk</th>
                  <th>Game</th>
                  <th>Final</th>
                  <th>Shared pick (worse line)</th>
                  <th>Avg edge</th>
                  <th>Result</th>
                  <th>Tags</th>
                </tr>
              </thead>
              <tbody>
                {r.graded
                  .slice()
                  .sort((a, b) => b.week - a.week || Number(b.read.agree) - Number(a.read.agree))
                  .map((g) => {
                    const team = g.read.side === "home" ? g.home : g.away;
                    return (
                      <tr key={`${g.week}:${g.away}@${g.home}`}>
                        <td className={s.num}>{g.week}</td>
                        <td className={s.game}>
                          {name(g.away)} @ {name(g.home)}
                        </td>
                        <td className={s.num}>
                          {g.final.away}–{g.final.home}
                        </td>
                        <td>
                          {g.read.agree && g.read.line !== undefined ? (
                            `${name(team)} ${line(g.read.line)}`
                          ) : (
                            <span className={s.dim}>
                              Split: Sam {name(g.read.samSide === "home" ? g.home : g.away)} ({g.samResult}), David{" "}
                              {name(g.read.davidSide === "home" ? g.home : g.away)} ({g.davidResult})
                            </span>
                          )}
                        </td>
                        <td className={s.num}>{g.read.agree ? g.read.avgEdge.toFixed(1) : "·"}</td>
                        <td>
                          {g.result ? (
                            <span className={g.result === "W" ? s.w : g.result === "L" ? s.l : s.pu}>{g.result}</span>
                          ) : (
                            <span className={s.dim}>·</span>
                          )}
                        </td>
                        <td>
                          {g.read.dog && <span className={s.tag}>dog</span>}
                          {st.rule && matchesRule(g, st.rule) && <span className={`${s.tag} ${s.tagRule}`}>rule</span>}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </details>

        <footer className={s.footer}>
          <span>
            Method: both models&apos; graded games joined by week and teams. &quot;Avg edge&quot; is the gap between the
            average of the two model lines and the average of the two Vegas lines. Shared picks are graded at the worse of
            the two posted lines, so a few results differ from each site&apos;s own grading. Units assume risking 1.1 to
            win 1.
          </span>
          {r.notes.map((t) => (
            <span key={t}>{t}</span>
          ))}
          <span>Model output and a backtest. Not betting advice.</span>
        </footer>
      </div>
    </main>
  );
}

function matchesRule(g: PicksReport["graded"][number], rule: CutResult): boolean {
  return matches(g.read, rule.test);
}

function BoardTable({ games, name, withPem }: { games: BoardGame[]; name: (k: string) => string; withPem: boolean }) {
  const ml = (team: string, m?: { market: number; model: number }) =>
    m ? `${team} ${line(m.market)} / ${line(Math.round(m.model * 10) / 10)}` : "not posted";
  return (
    <div className={s.tw}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Tier</th>
            <th>Game</th>
            <th>Play</th>
            <th>Avg edge</th>
            <th>Sam: Vegas / model</th>
            <th>David: Vegas / model</th>
            {withPem && <th>PEM</th>}
          </tr>
        </thead>
        <tbody>
          {games.map((g) => {
            const home = name(g.home);
            const moved =
              g.sam && g.david && Math.abs(g.sam.market - g.david.market) >= 3
                ? `The sites' Vegas lines differ by ${Math.abs(g.sam.market - g.david.market)} points. The line has likely moved; recheck it.`
                : "";
            const play = g.read?.agree && g.read.line !== undefined
              ? `${name(g.read.side === "home" ? g.home : g.away)} ${line(g.read.line)}`
              : g.tier === "split"
                ? `Sam: ${name(g.read!.samSide === "home" ? g.home : g.away)} · David: ${name(g.read!.davidSide === "home" ? g.home : g.away)}`
                : g.play;
            return (
              <tr key={`${g.away}@${g.home}`}>
                <td>
                  <TierChip t={g.tier} />
                </td>
                <td className={s.game}>
                  {name(g.away)} @ {home}
                </td>
                <td className={`${s.play} ${g.tier === "t1" || g.tier === "t2" ? "" : s.dim}`}>
                  {play}
                  {g.pemPick && <div className={s.thin}>Sam and David split; PEM breaks it.</div>}
                  {moved && <div className={s.thin} style={{ color: "var(--gold)" }}>{moved}</div>}
                </td>
                <td className={s.num}>{g.read?.agree ? g.read.avgEdge.toFixed(1) : "·"}</td>
                <td className={`${s.num} ${s.nw} ${s.dim}`}>{ml(home, g.sam)}</td>
                <td className={`${s.num} ${s.nw} ${s.dim}`}>{ml(home, g.david)}</td>
                {withPem && (
                  <td className={`${s.num} ${s.nw} ${s.dim}`}>
                    {g.pem ? `${home} ${line(g.pem.model)}${g.read?.pemSide ? ` · ${name(g.read.pemSide === "home" ? g.home : g.away)}` : ""}` : "·"}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
