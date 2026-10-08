import Link from "next/link";
import {
  BREAK_EVEN,
  MIN_SAMPLE,
  type BoardGame,
  type CutResult,
  type Record as Rec,
  type Tier,
  cutResult,
  marginBand,
  marginLabel,
  needsPem,
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

const TIER_ORDER: Tier[] = ["t1", "t2", "wait", "fav", "pass", "split", "one"];
const TIER_LABEL: { [t in Tier]: string } = {
  t1: "Tier 1 · bet",
  t2: "Tier 2 · small",
  wait: "Needs PEM",
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
  const tiered = (g: BoardGame) => g.tier === "t1" || g.tier === "t2";
  const plays = board.filter((g) => tiered(g) && g.basis === "reference");
  const researchOnly = board.filter((g) => tiered(g) && g.basis === "source");
  const rest = board.filter((g) => !tiered(g));
  const count = (t: Tier) => board.filter((g) => g.tier === t).length;

  const suMethod = r.su.best?.id ?? "avg";
  const suList = r.board
    .flatMap((g) => {
      const p = suPick(suMethod, g.sam, g.david, g.ref?.line);
      return p ? [{ g, ...p }] : [];
    })
    .sort((a, b) => b.margin - a.margin);
  const band = (m: number) => marginBand(lg, m);
  const ref = r.reference;
  const refAt = ref?.fetchedAt
    ? new Date(ref.fetchedAt).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" })
    : null;
  const pemNeeded = !!(st.rule && needsPem(st.rule.test)) || !!(st.second && needsPem(st.second.test));

  const firstT1 = board.find((g) => g.tier === "t1" && g.sam && g.david);
  const example = firstT1?.sam && firstT1.david
    ? {
        vegas: firstT1.ref?.line ?? firstT1.david.market,
        sam: firstT1.sam.model,
        david: firstT1.david.model,
        pem: firstT1.pem?.model,
        label: `${name(firstT1.away)} at ${name(firstT1.home)}`,
      }
    : null;

  const live = r.live ?? [];
  const liveT1 = live.reduce((t, w) => ({ w: t.w + w.t1.w, l: t.l + w.t1.l, p: t.p + w.t1.p }), { w: 0, l: 0, p: 0 });

  const byWeek = st.byWeek;
  const bestWeek = byWeek.slice().sort((a, b) => b.record.pct - a.record.pct)[0];
  const worstWeek = byWeek.slice().sort((a, b) => a.record.pct - b.record.pct)[0];
  const dogs = st.baselines.find((b) => b.id === "dogs")!.record;
  const sam = st.baselines.find((b) => b.id === "sam")!.record;
  const david = st.baselines.find((b) => b.id === "david")!.record;

  const groups = [...new Set(st.cuts.filter((c) => c.group !== "Research").map((c) => c.group))];

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
            {r.posted && Object.keys(r.posted).length > 0 && (
              <span>
                {`Boards first seen: ${Object.entries(r.posted)
                  .map(([who, at]) => `${who === "pem" ? "PEM" : who[0].toUpperCase() + who.slice(1)} ${new Date(at).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" })}`)
                  .join(", ")} ET`}
              </span>
            )}
            <span>Emails: Tue evening card · Sat 9:30am college update · NFL update in the Sun 9am brief</span>
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
                <div className={s.eyebrow}>The rule right now · chosen on the source-line backtest</div>
                <h2 className={s.h2}>{st.rule.label}</h2>
                <p className={s.p}>
                  {`Picked automatically from history: of the cuts with at least ${MIN_SAMPLE} decided games (pushes don't count) and`}{" "}
                   a winning rate past break-even, this one has the highest low end of its 90% range (
                  {Math.round(st.rule.record.lo * 100)}%). That range is a statistical estimate from a small sample, not a
                  floor. The backtest judges each model at its own site&apos;s line and grades shared picks at the worse of
                  the two; this week&apos;s board judges every model at one current line.
                  {st.second
                    ? ` Tier 2: ${st.second.label.toLowerCase()}, judged only on the ${n(st.second.record)} decided games it adds outside Tier 1 (${rec(st.second.record)}; the whole cut is ${rec(st.second.fullRecord)}).`
                    : " No Tier 2: no other cut wins on the games Tier 1 leaves."}
                  {live.length ? " The record of what was actually sent is further down, kept apart from this." : ""}
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
            {plays.filter((g) => g.tier === "t1").length} Tier 1 and {plays.filter((g) => g.tier === "t2").length} Tier 2
            plays. Every model is judged at one current line per game
            {ref?.source ? ` (${ref.source}, read ${refAt} ET; ${ref.priced} of ${ref.games} games priced)` : ""}, so
            &quot;agree&quot; means agree at a number you can get. Re-check it before betting; if it has moved, run it
            through the checker below.
            {ref?.problem ? ` ${ref.problem}` : ""}
            {count("wait") ? ` ${count("wait")} game${count("wait") === 1 ? "" : "s"} can't be decided until PEM's card is on file.` : ""}
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
          {researchOnly.length > 0 && (
            <details className={s.details}>
              <summary>
                {researchOnly.length} research signal{researchOnly.length === 1 ? "" : "s"}: fit at the sites&apos; own lines, no
                current quote
              </summary>
              <p className={`${s.p} ${s.thin}`}>
                No current line was available for these, so each model is judged at its own site&apos;s number, the way the
                backtest is. Not a recommendation until a current quote confirms it.
              </p>
              <BoardTable games={researchOnly} name={name} withPem={lg === "cfb"} />
            </details>
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
            the projected margin; the bands describe that margin and are not calibrated probabilities.
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
                  <th>Margin band</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {suList.map(({ g, side, margin }, i) => {
                  const b = band(margin);
                  const pick = side === "home" ? g.home : g.away;
                  const opp = side === "home" ? g.away : g.home;
                  const mkt = g.ref?.line ?? g.david?.market ?? g.sam?.market ?? 0;
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
                        <span className={`${s.tier} ${b === "wide" ? s.lock : b === "clear" ? s.solid : s.toss}`}>
                          {marginLabel(lg, b)}
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

        {r.totals && <TotalsSection r={r} />}

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
              <h2 className={s.h2}>The plays as sent</h2>
            </div>
            <p className={s.p}>
              Only what the emails actually showed (Tuesday&apos;s card, plus anything new in the Saturday college or Sunday NFL update), each game once at the line it was first sent, under the rule in force that week.
              This is forward performance, separate from the backtest the rule was chosen on. Tier 1 so far:{" "}
              {rec(liveT1 as Rec)}.
            </p>
            <div className={s.tw}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Rule that week</th>
                    <th>Tier 1</th>
                    <th>Tier 2</th>
                    <th>Totals</th>
                    <th>Straight up</th>
                  </tr>
                </thead>
                <tbody>
                  {live.map((w) => (
                    <tr key={w.week}>
                      <td className={s.num}>{w.week}</td>
                      <td>
                        {w.rule ?? "none"}
                        {w.provenance === "recovered" && (
                          <details className={s.thin}>
                            <summary>Recovered from the delivered email, not recorded at send time</summary>
                            <ul>
                              {w.unverified.map((u) => (
                                <li key={u}>{u}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                      <td className={s.num}>{rec(w.t1)}</td>
                      <td className={s.num}>{rec(w.t2)}</td>
                      <td className={s.num}>{w.totals ? rec(w.totals) : "·"}</td>
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

        {r.clv && r.clv.matched > 0 && <ClvSection clv={r.clv} />}

        {r.research?.length > 0 && <ResearchSection r={r} />}

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
            second={
              st.second
                ? { label: st.second.label, test: st.second.test, record: `${rec(st.second.record)} on games outside Tier 1` }
                : null
            }
            example={example}
            pem={lg === "cfb"}
            pemNeeded={pemNeeded}
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

function ClvSection({ clv }: { clv: PicksReport["clv"] }) {
  const pts = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}`;
  const models = clv.models.filter((m) => m.n > 0);
  const plays = clv.plays.filter((m) => m.n > 0);
  const solo = models.filter((m) => ["sam", "david", "pem"].includes(m.id));
  const best = [...solo].sort((a, b) => b.avg - a.avg)[0];
  const row = (m: PicksReport["clv"]["models"][number]) => (
    <tr key={m.id}>
      <td>
        {m.label}
        {m.note && <div className={s.dim}>{m.note}</div>}
      </td>
      <td className={s.num}>{m.n}</td>
      <td className={`${s.num} ${m.avg > 0 ? s.pos : m.avg < 0 ? s.neg : ""}`}>{pts(m.avg)}</td>
      <td className={s.num}>{m.beat}</td>
      <td className={s.num}>{m.worse}</td>
    </tr>
  );
  return (
    <section className={s.section}>
      <div>
        <div className={s.eyebrow}>Faster than win-loss</div>
        <h2 className={s.h2}>Beating the closing line</h2>
      </div>
      <p className={s.p}>
        Every pick is checked against DraftKings&apos; spread at kickoff (from ESPN). If the line keeps moving toward a
        model after it posts, the market is coming around to what it saw, and that shows up long before a record does.
        Each model is graded at the number printed on its own site; shared picks at the worse of the two.
        {best && best.n >= 10
          ? ` So far ${best.label} is the one the market follows most (${pts(best.avg)} points a pick).`
          : ""}
      </p>
      <div className={s.tw}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Who</th>
              <th>Picks</th>
              <th>vs close</th>
              <th>Beat</th>
              <th>Worse</th>
            </tr>
          </thead>
          <tbody>
            {models.map(row)}
            {plays.length > 0 && (
              <tr>
                <td colSpan={5} className={s.dim}>
                  Since the tab went live
                </td>
              </tr>
            )}
            {plays.map(row)}
          </tbody>
        </table>
      </div>
      <p className={`${s.p} ${s.dim}`}>
        {`${clv.matched} of ${clv.games} graded games have a closing line on file. "vs close" is the average number of points better (+) or worse (−) than the closing spread; the rest landed on it exactly.`}
      </p>
    </section>
  );
}

function TotalsSection({ r }: { r: PicksReport }) {
  const t = r.totals;
  const name = (k: string) => r.names[k] ?? k;
  const sign = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}`;
  const order = { t1: 0, lean: 1, split: 2, one: 3, noline: 4 } as const;
  const games = t.board
    .slice()
    .sort((a, b) => order[a.tier] - order[b.tier] || (b.read?.minEdge ?? 0) - (a.read?.minEdge ?? 0));
  const leans = t.board.filter((g) => g.tier === "t1" || g.tier === "lean").length;
  const sa = t.backtest.samAlone;
  const status = (g: (typeof games)[number]) =>
    g.tier === "t1" ? "Play" : g.tier === "lean" ? "Both lean" : g.tier === "split" ? "Split" : g.tier === "one" ? "One model" : "No line";
  return (
    <section className={s.section} id="totals">
      <div>
        <div className={s.eyebrow}>Over/under</div>
        <h2 className={s.h2}>Totals</h2>
      </div>
      <p className={s.p}>
        {t.backtest.rule
          ? `Rule: ${t.backtest.rule.label.toLowerCase()}, ${rec(t.backtest.rule.record)} in the archive. Games that fit it are plays and go in the email.`
          : `Tracking only, nothing here is a play yet. Neither site keeps a history of its totals, so agreement is archived from now on: the first time both models' projected totals and a current line are on the board together, that game is saved and graded later. ${t.backtest.archived} graded so far; a cut becomes the rule at ${MIN_SAMPLE}+ decided games and a winning rate, the same test as spreads.`}{" "}
        {`Every model is judged at one current total (${r.reference?.source ?? "no source"}). This week: ${leans} game${leans === 1 ? "" : "s"} where both lean the same way.`}
      </p>
      <div className={s.tiles}>
        <div className={s.tile}>
          <div className={`${s.tileV} ${s.num}`}>{n(sa.record) ? rec(sa.record) : "none"}</div>
          <div className={s.tileK}>
            {`Sam alone vs the opening total, weeks ${sa.weeks.join(", ") || "none"}`}
            {sa.clv.n ? ` · ${sign(sa.clv.avg)} vs close (${sa.clv.n})` : ""}
          </div>
        </div>
        {t.backtest.archived === 0 && (
          <div className={s.tile}>
            <div className={`${s.tileV} ${s.num}`}>0 graded</div>
            <div className={s.tileK}>
              {`Agreement archive: ${t.archived} games saved so far, first grades after this week's games. Cuts: ${t.backtest.cuts.map((c) => c.label.toLowerCase()).join("; ")}.`}
            </div>
          </div>
        )}
        {t.backtest.archived > 0 && t.backtest.cuts.map((c) => (
          <div key={c.id} className={s.tile}>
            <div className={`${s.tileV} ${s.num}`}>{n(c.record) + c.record.p ? rec(c.record) : "none yet"}</div>
            <div className={s.tileK}>
              {c.label}
              {t.backtest.rule?.id === c.id ? " · the rule" : ""}
            </div>
          </div>
        ))}
      </div>
      <details className={s.details} open={t.backtest.rule !== null}>
        <summary>This week&apos;s totals ({t.board.length} games)</summary>
        <div className={s.tw}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Game</th>
                <th>Total now</th>
                <th>Lean</th>
                <th>Sam</th>
                <th>David</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <tr key={`${g.away}@${g.home}`}>
                  <td className={s.game}>
                    {name(g.away)} @ {name(g.home)}
                  </td>
                  <td className={s.num}>{g.ref ? g.ref.total : "·"}</td>
                  <td className={`${s.nw} ${g.tier === "t1" ? s.play : ""}`}>{g.side ? (g.side === "over" ? "Over" : "Under") : "·"}</td>
                  <td className={s.num}>{g.sam !== undefined ? g.sam.toFixed(1) : "·"}</td>
                  <td className={s.num}>{g.david !== undefined ? g.david.toFixed(1) : "·"}</td>
                  <td className={g.tier === "t1" ? "" : s.dim}>{status(g)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function ResearchSection({ r }: { r: PicksReport }) {
  const sign = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}`;
  const wk = (w: number[]) => (w.length ? (w.length > 1 ? `${w[0]}-${w[w.length - 1]}` : `${w[0]}`) : "none");
  const helps = (x: PicksReport["research"][number]) =>
    n(x.record) >= MIN_SAMPLE && n(x.excluded) >= 5 && x.record.pct > x.parent.record.pct + 0.03 && x.excluded.pct < BREAK_EVEN;
  const pc = r.pemCompare;
  return (
    <section className={s.section}>
      <div>
        <div className={s.eyebrow}>Research only · never the rule</div>
        <h2 className={s.h2}>Does being more specific help?</h2>
      </div>
      <p className={s.p}>
        Each refinement next to the cut it narrows, and the record of the parent&apos;s games it leaves out. If the left-out
        games won about as often, the narrower cut is the same signal on fewer games. Thresholds were fixed before grading:
        underdog bands at {r.league === "nfl" ? "3 and 7" : "7 and 14"}, edge at {r.league === "nfl" ? "2" : "3"} points,
        near-market agreement needing both models a point off. Source-line backtest, graded at −110.
      </p>
      <div className={s.tw}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Refinement</th>
              <th>W-L-P</th>
              <th>Units</th>
              <th>Weeks</th>
              <th>vs close (n)</th>
              <th>Parent</th>
              <th>Left out</th>
            </tr>
          </thead>
          <tbody>
            {r.research.map((x) => (
              <tr key={x.id}>
                <td>
                  {x.label}
                  {n(x.record) < MIN_SAMPLE && <div className={s.thin}>{n(x.record)} decided: too few to read</div>}
                  {helps(x) && <div className={s.thin}>Narrowing helps so far</div>}
                </td>
                <td className={`${s.num} ${s.nw}`}>
                  {rec(x.record)}
                  <div className={s.thin}>{n(x.record)} decided</div>
                </td>
                <td className={`${s.num} ${x.record.units >= 0 ? s.pos : s.neg}`}>{n(x.record) ? units(x.record) : "·"}</td>
                <td className={s.num}>{wk(x.weeks)}</td>
                <td className={`${s.num} ${s.nw}`}>{x.clv.n ? `${sign(x.clv.avg)} (${x.clv.n})` : "·"}</td>
                <td className={s.num}>
                  {rec(x.parent.record)}
                  <div className={s.thin}>{x.parent.label}</div>
                </td>
                <td className={`${s.num} ${n(x.excluded) && x.excluded.pct > BREAK_EVEN ? s.pos : ""}`}>
                  {n(x.excluded) + x.excluded.p ? rec(x.excluded) : "·"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pc && pc.games > 0 && (
        <>
          <h3 className={s.h3}>PEM on the same games</h3>
          <p className={s.p}>
            {`The ${pc.games} games all three models cover (Week${pc.weeks.length > 1 ? "s" : ""} ${wk(pc.weeks)}), every model`}{" "}
            judged and graded at one line: the average of Sam&apos;s and David&apos;s posted numbers. Comparable row to row,
            not to the backtest above.
          </p>
          <div className={s.tw}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>On these games</th>
                  <th>W-L-P</th>
                  <th>Units</th>
                  <th>vs close (n)</th>
                </tr>
              </thead>
              <tbody>
                {pc.rows.map((x) => (
                  <tr key={x.id}>
                    <td>{x.label}</td>
                    <td className={`${s.num} ${s.nw}`}>{n(x.record) + x.record.p ? rec(x.record) : "·"}</td>
                    <td className={`${s.num} ${x.record.units >= 0 ? s.pos : s.neg}`}>{n(x.record) ? units(x.record) : "·"}</td>
                    <td className={`${s.num} ${s.nw}`}>{x.clv.n ? `${sign(x.clv.avg)} (${x.clv.n})` : "·"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function matchesRule(g: PicksReport["graded"][number], rule: CutResult): boolean {
  return cutResult(g, rule) !== undefined;
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
            <th>Line now (home)</th>
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
            const play = g.side && g.homeLine !== undefined
              ? `${name(g.side === "home" ? g.home : g.away)} ${line(g.side === "home" ? g.homeLine : -g.homeLine)}`
              : g.tier === "split" || (g.tier === "wait" && !g.read?.agree)
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
                  {g.tier === "wait" && (
                    <div className={s.thin}>
                      {g.waitFor === "t1" ? "Tier 1" : "Tier 2"} if PEM agrees; PEM&apos;s line for this game isn&apos;t on file.
                    </div>
                  )}
                  {g.basis === "source" && (g.tier === "t1" || g.tier === "t2") && (
                    <div className={s.thin}>No current quote: judged at the sites&apos; own lines.</div>
                  )}
                  {moved && <div className={s.thin} style={{ color: "var(--gold)" }}>{moved}</div>}
                </td>
                <td className={s.num}>{g.read?.agree ? g.read.avgEdge.toFixed(1) : "·"}</td>
                <td className={`${s.num} ${s.nw}`}>{g.ref ? `${home} ${line(g.ref.line)}` : <span className={s.dim}>none</span>}</td>
                <td className={`${s.num} ${s.nw} ${s.dim}`}>{ml(home, g.sam)}</td>
                <td className={`${s.num} ${s.nw} ${s.dim}`}>{ml(home, g.david)}</td>
                {withPem && (
                  <td className={`${s.num} ${s.nw} ${s.dim}`}>
                    {g.pem ? `${home} ${line(g.pem.model)}${g.read?.pemSide ? ` · ${name(g.read.pemSide === "home" ? g.home : g.away)}` : ""}` : "missing"}
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
