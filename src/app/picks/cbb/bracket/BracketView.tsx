"use client";

// The interactive optimizer: controls (kept in the URL), the summary, the
// bracket, the upset picks, leverage and the full odds table. The heavy part
// (simulations and per-scoring q tables) runs in a Web Worker; pool size and
// payout changes are recomputed here from the cached tables, which is instant.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TeamLogo } from "@/components/TeamLogo";
import {
  chalk,
  finalFour,
  mostLikely,
  oneIn,
  pickRows,
  poolValue,
  bestCandidate,
  prepare,
  ROUND_SHORT,
  ROUNDS,
  SCORING,
  SCORING_IDS,
  upsetRows,
  type Candidate,
  type PayoutId,
  type Picks,
  type PoolTable,
  type PoolValue,
  type Prepared,
  type ScoringId,
} from "@/lib/models/cbb/bracket";
import type { BracketField } from "@/lib/models/cbb/bracket-types";
import { SecHead, Stats } from "../../board";
import { BracketGraphic, pct, pts, TeamSheet } from "./Bracket";
import { nToPos, posToN, QUICK_N, toQuery, type BracketQuery, type Mode } from "./query";
import type { FromWorker, ToWorker } from "./optimizer.worker";
import b from "./bracket.module.css";

/** Simulated tournaments, public opponents (spread over champion groups) and the PRNG seed. */
// 8,000 tournaments: at 2,000 the recommended champion flipped with the random seed in big pools (2026-11-02). About 1s once per scoring system, in the worker.
const T_SIMS = 8000;
const K_OPP = 300;
const SEED = 2027;

const fmtN = (n: number) => n.toLocaleString("en-US");
const ordinal = (n: number) => {
  const r = Math.round(n);
  const s = r % 100 >= 11 && r % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][r % 10] ?? "th";
  return `${fmtN(r)}${s}`;
};
const listOf = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const winPct = (x: number) => (x >= 0.1 ? `${(x * 100).toFixed(0)}%` : x >= 0.01 ? `${(x * 100).toFixed(1)}%` : `${(x * 100).toFixed(2)}%`);

/** Rick Gehman's pool-size rule of thumb, in plain words. The simulation has the final say. */
function sizeGuide(n: number): string {
  const lead = `Rule of thumb for ${fmtN(n)} entries:`;
  if (n <= 25) return `${lead} mostly chalk. Coin-flip games are free to take either way.`;
  if (n <= 100) return `${lead} a strong core of favorites plus a few picks the public is light on.`;
  if (n < 1000) return `${lead} a champion or Final Four that most entries don't have.`;
  return `${lead} an uncommon but believable path to the title.`;
}

interface Opt {
  status: "idle" | "running" | "ready" | "error";
  cands: Candidate[] | null;
  tables: Partial<Record<ScoringId, Float32Array>>;
  T: number;
  K: number;
  error?: string;
  ms: { setup?: number; table?: Partial<Record<ScoringId, number>> };
}

/**
 * Runs the optimizer in a worker (or inline when workers aren't available) and
 * caches a q table per scoring system. One lifecycle per field: setup, the
 * current scoring's table, cleanup that terminates the worker and forgets what
 * was asked, so React Strict Mode's mount-unmount-mount (dev) and a new field
 * both start clean, and a message from an old run is ignored.
 */
function useOptimizer(field: BracketField, scoring: ScoringId, wanted: boolean): Opt {
  const [opt, setOpt] = useState<Opt>({ status: "idle", cands: null, tables: {}, T: T_SIMS, K: K_OPP, ms: {} });
  const worker = useRef<Worker | null>(null);
  const asked = useRef<Set<ScoringId>>(new Set());
  const inline = useRef<null | ((s: ScoringId) => void)>(null);
  const scoringNow = useRef(scoring);
  useEffect(() => {
    scoringNow.current = scoring;
  }, [scoring]);

  const ask = (s: ScoringId) => {
    if (asked.current.has(s)) return;
    if (worker.current) worker.current.postMessage({ type: "table", scoring: s } satisfies ToWorker);
    else if (inline.current) inline.current(s);
    else return;
    asked.current.add(s);
  };

  useEffect(() => {
    if (!wanted) return;
    let alive = true;
    asked.current = new Set();
    const onMsg = (m: FromWorker) => {
      if (!alive) return;
      if (m.type === "ready") setOpt((o) => ({ ...o, status: "running", cands: m.cands, K: m.K, tables: {}, ms: { setup: m.ms } }));
      else if (m.type === "table") setOpt((o) => ({ ...o, status: "ready", T: m.T, tables: { ...o.tables, [m.scoring]: m.q }, ms: { ...o.ms, table: { ...o.ms.table, [m.scoring]: m.ms } } }));
      else setOpt((o) => ({ ...o, status: "error", error: m.message }));
    };
    let w: Worker | null = null;
    try {
      w = new Worker(new URL("./optimizer.worker.ts", import.meta.url), { type: "module" });
    } catch {
      w = null;
    }
    if (w) {
      worker.current = w;
      w.onmessage = (e: MessageEvent<FromWorker>) => onMsg(e.data);
      w.onerror = () => alive && setOpt((o) => ({ ...o, status: "error", error: "The optimizer stopped. Reload the page to run it again." }));
      w.postMessage({ type: "setup", field, T: T_SIMS, K: K_OPP, seed: SEED } satisfies ToWorker);
      ask(scoringNow.current);
    } else {
      // No workers: same work on the main thread, after first paint.
      import("@/lib/models/cbb/bracket").then((lib) => {
        if (!alive) return;
        const t0 = performance.now();
        const p = lib.prepare(field);
        const sims = lib.simulate(p, { T: T_SIMS, K: K_OPP, seed: SEED });
        const cands = lib.buildCandidates(p);
        onMsg({ type: "ready", cands, ms: performance.now() - t0, K: sims.K });
        inline.current = (s) =>
          setTimeout(() => {
            if (!alive) return;
            const t1 = performance.now();
            const tab = lib.poolTable(p, sims, cands, s);
            onMsg({ type: "table", scoring: s, q: tab.q, T: tab.T, ms: performance.now() - t1 });
          }, 0);
        ask(scoringNow.current);
      });
    }
    return () => {
      alive = false;
      w?.terminate();
      worker.current = null;
      inline.current = null;
      asked.current = new Set();
    };
  }, [field, wanted]);

  useEffect(() => {
    if (wanted) ask(scoring);
  }, [scoring, wanted]);

  return opt;
}

export default function BracketView({ field, initial }: { field: BracketField; initial: BracketQuery }) {
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [n, setN] = useState(initial.n);
  const [score, setScore] = useState<ScoringId>(initial.score);
  const [pay, setPay] = useState<PayoutId>(initial.pay);
  const [sel, setSel] = useState<number | null>(null);

  const p = useMemo(() => prepare(field), [field]);
  const ml = useMemo(() => mostLikely(p), [p]);
  const ch = useMemo(() => chalk(p), [p]);
  const opt = useOptimizer(field, score, mode === "pool");

  useEffect(() => {
    window.history.replaceState(null, "", toQuery({ mode, n, score, pay }));
  }, [mode, n, score, pay]);

  const q = opt.tables[score];
  const best = useMemo(() => {
    if (!q || !opt.cands) return null;
    const tab: PoolTable = { scoring: score, C: opt.cands.length, T: opt.T, q, score: new Float32Array(0) };
    // Within the sims' noise of the top, the least aggressive bracket wins (bracket.ts bestCandidate).
    const { index, value } = bestCandidate(tab, n, pay, opt.cands);
    const mlKey = ml.picks.join();
    const mlIndex = Math.max(0, opt.cands.findIndex((c) => c.picks.join() === mlKey));
    // Other champions within 10% of this bracket's value: in big pools several title picks are close calls.
    const byChamp = new Map<number, number>();
    opt.cands.forEach((c, i) => {
      if (c.champion === opt.cands![index].champion) return;
      const x = poolValue(tab, i, n, pay).xAvg;
      if (x > (byChamp.get(c.champion) ?? -1)) byChamp.set(c.champion, x);
    });
    const close = [...byChamp].filter(([, x]) => x >= value.xAvg * 0.9).sort((a, z) => z[1] - a[1]).slice(0, 3).map(([champion, xAvg]) => ({ champion, xAvg }));
    return { cand: opt.cands[index], value, chalk: poolValue(tab, mlIndex, n, pay), close };
  }, [q, opt.cands, opt.T, score, n, pay, ml]);

  const pool = mode === "pool";
  const picks: Picks = pool && best ? best.cand.picks : ml.picks;
  const loading = pool && !best && opt.status !== "error";
  const onPick = useCallback((slot: number) => setSel(slot), []);
  const close = useCallback(() => setSel(null), []);

  return (
    <>
      <Controls mode={mode} setMode={setMode} n={n} setN={setN} score={score} setScore={setScore} pay={pay} setPay={setPay} />

      {opt.status === "error" && <p className={b.err}>{opt.error ?? "The optimizer hit an error."}</p>}

      {pool ? <PoolSummary p={p} picks={picks} best={best} n={n} pay={pay} loading={loading} onPick={onPick} /> : <PerfectSummary p={p} ml={ml} ch={ch} onPick={onPick} />}

      <section className={b.bwrap} aria-labelledby="bracket-h">
        <SecHead
          id="bracket-h"
          title={pool ? "Your bracket" : "The most likely bracket"}
          aside={loading ? "Simulating 2,000 tournaments against the public..." : pool ? `Best of ${opt.cands?.length ?? 40} brackets for ${fmtN(n)} entries, ${SCORING[score].short} scoring` : "Max joint chance across all 63 games"}
        />
        <div className={b.legend}>
          <span>
            <i className={b.kPick} />
            Picked to win
          </span>
          <span>
            <i className={b.kUpset} />
            Upset pick
          </span>
          <span>Percent: model chance to win that game. Tap a team for its odds by round.</span>
        </div>
        <div className={b.wide}>
          <BracketGraphic p={p} picks={picks} sel={sel} onPick={onPick} />
        </div>
      </section>

      {pool && <UpsetPicks p={p} picks={picks} loading={loading} onPick={onPick} estimated={p.pubEstimated} />}
      {!pool && <ClosestCalls p={p} picks={picks} onPick={onPick} />}

      <Leverage p={p} onPick={onPick} />
      <OddsTable p={p} picks={picks} onPick={onPick} />

      {pool && opt.ms.setup !== undefined && (
        <p className={b.foot}>
          {`Ran ${fmtN(T_SIMS)} simulated tournaments against ${fmtN(opt.K)} public brackets in your browser (${Math.round(opt.ms.setup + (opt.ms.table?.[score] ?? 0))} ms). Same seed every time, so a shared link shows the same bracket.`}
        </p>
      )}

      {sel !== null && <TeamSheet p={p} slot={sel} picks={picks} estimated={p.pubEstimated} onClose={close} />}
    </>
  );
}

/* ---------------------------------------------------------------- controls */

function Seg<T extends string>({ value, set, options, label, big }: { value: T; set: (v: T) => void; options: [T, string][]; label: string; big?: boolean }) {
  return (
    <div className={`${b.seg} ${big ? b.segBig : ""}`} role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => set(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Controls(props: { mode: Mode; setMode: (m: Mode) => void; n: number; setN: (n: number) => void; score: ScoringId; setScore: (s: ScoringId) => void; pay: PayoutId; setPay: (p: PayoutId) => void }) {
  const { mode, setMode, n, setN, score, setScore, pay, setPay } = props;
  const [pos, setPos] = useState(nToPos(n));
  return (
    <div className={b.controls}>
      <div className={b.ctlRow}>
        <Seg
          big
          label="Mode"
          value={mode}
          set={setMode}
          options={[
            ["pool", "Win my pool"],
            ["perfect", "Chasing perfection"],
          ]}
        />
      </div>
      {mode === "pool" && (
        <>
          <div className={b.sizeBox}>
            <div className={b.sizeNum} aria-live="polite">
              {fmtN(n)}
              <small>entries in the pool</small>
            </div>
            <div className={b.sizeRight}>
              <input
                className={b.slider}
                type="range"
                min={0}
                max={1000}
                step={1}
                value={pos}
                aria-label="Pool size"
                aria-valuetext={`${fmtN(posToN(pos))} entries`}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setPos(v);
                  setN(posToN(v));
                }}
              />
              <div className={b.quick} role="group" aria-label="Quick pool sizes">
                {QUICK_N.map((q) => (
                  <button key={q} type="button" aria-pressed={n === q} onClick={() => {
                      setN(q);
                      setPos(nToPos(q));
                    }}>
                    {q >= 10000 ? "10k" : fmtN(q)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className={b.ctlRow}>
            <span className={b.ctlLabel}>Scoring</span>
            <Seg label="Scoring" value={score} set={setScore} options={SCORING_IDS.map((id) => [id, SCORING[id].short] as [ScoringId, string])} />
            <span className={b.scoreNote}>{SCORING[score].note}</span>
          </div>
          <div className={b.ctlRow}>
            <span className={b.ctlLabel}>Payout</span>
            <Seg
              label="Payout"
              value={pay}
              set={setPay}
              options={[
                ["wta", "Winner take all"],
                ["top3", "Top 3 paid"],
              ]}
            />
            <span className={b.scoreNote}>{pay === "top3" ? "50%, 30% and 20% of the pot" : "First place takes the pot"}</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- summaries */

function Est({ on }: { on: boolean }) {
  return on ? <span className={b.est}>estimate</span> : null;
}

function ChampCard({ p, picks, verdict, onPick }: { p: Prepared; picks: Picks; verdict: string; onPick: (s: number) => void }) {
  const c = picks[62];
  const t = p.teams[c];
  const m = p.adv[5][c];
  const pu = p.pub[5][c];
  const max = Math.max(m, pu, 0.01);
  return (
    <div className={b.champ}>
      <div className={b.champTop}>
        <span className={b.champLogo}>
          <TeamLogo league="cfb" espnId={t.id} size={50} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className={b.champKicker}>Champion pick</div>
          <div className={b.champName}>{t.short}</div>
          <div className={b.champMeta}>{`${t.seed} seed, ${t.region} region`}</div>
        </div>
      </div>
      <div className={b.vs} aria-label={`Wins the title ${pct(m)} by the model, picked by ${pct(pu)} of the public`}>
        <div className={b.vsRow}>
          <span>Model title</span>
          <span className={b.vsTrack}>
            <span className={b.vsFill} style={{ width: `${((m / max) * 100).toFixed(2)}%` }} />
          </span>
          <b>{pct(m)}</b>
        </div>
        <div className={b.vsRow}>
          <span>Public picks</span>
          <span className={b.vsTrack}>
            <span className={`${b.vsFill} ${b.vsPub}`} style={{ width: `${((pu / max) * 100).toFixed(2)}%` }} />
          </span>
          <b>{pct(pu)}</b>
        </div>
      </div>
      <p className={b.champVerdict}>{verdict}</p>
      <div className={b.ff} aria-label="Final Four">
        {finalFour(picks).map((s) => (
          <button key={s} type="button" className={b.ffTeam} onClick={() => onPick(s)}>
            <span className={b.ffLogo}>
              <TeamLogo league="cfb" espnId={p.teams[s].id} size={22} />
            </span>
            <b>{p.teams[s].short}</b>
            <small>{`F4 ${pct(p.adv[3][s])}`}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function PoolSummary({ p, picks, best, n, pay, loading, onPick }: { p: Prepared; picks: Picks; best: { cand: Candidate; value: PoolValue; chalk: PoolValue; close: { champion: number; xAvg: number }[] } | null; n: number; pay: PayoutId; loading: boolean; onPick: (s: number) => void }) {
  const c = picks[62];
  const t = p.teams[c];
  const m = p.adv[5][c];
  const pu = p.pub[5][c];
  const ups = upsetRows(p, picks).filter((u) => u.round < 4);
  const ff = finalFour(picks);
  const pubWord = p.pubEstimated ? "an estimated " : "";
  const verdict =
    pu < m * 0.9
      ? `Wins the title ${pct(m)} of the time by the model, but only ${pubWord}${pct(pu)} of the public picks them. When they cut down the nets, most of the pool is already dead.`
      : pu > m * 1.1
        ? `The public is heavier on ${t.short} (${pubWord}${pct(pu)}) than the model (${pct(m)}), but in a pool this size the favorite still pays.`
        : `The model and the public agree on ${t.short} (${pct(m)} vs ${pubWord}${pct(pu)}). The rest of the bracket does the separating.`;
  const v = best?.value;
  const avg = pay === "wta" ? 1 / n : Math.min(1, 3 / n);
  const stat = (x: string | undefined) => (loading || x === undefined ? <span className={b.skel} style={{ width: 90, height: 28 }} /> : x);
  const ffOut = ff.filter((s) => p.pub[3][s] < p.adv[3][s]);
  return (
    <section className={b.summary} aria-label="Summary">
      <ChampCard p={p} picks={picks} verdict={loading ? "Working out the best champion for your pool..." : verdict} onPick={onPick} />
      <div className={b.side}>
        <Stats
          label="How this bracket does in your pool"
          items={[
            pay === "wta"
              ? { k: "Win the pool", v: stat(v && winPct(v.win)), sub: `avg entry ${winPct(avg)}` }
              : { k: "Top 3", v: stat(v && winPct(v.cash)), sub: v ? `wins it ${winPct(v.win)}` : "" },
            { k: "Vs average", v: stat(v && `${v.xAvg >= 10 ? v.xAvg.toFixed(0) : v.xAvg.toFixed(1)}x`), sub: "an average entry", tone: v && v.xAvg > 1 ? "up" : undefined },
            { k: "Avg finish", v: stat(v && ordinal(v.finish)), sub: `of ${fmtN(n)}` },
            { k: "Upsets", v: stat(v && String(ups.length)), sub: "before the F4" },
          ]}
        />
        <div className={b.wins}>
          <h3>How this bracket wins</h3>
          {loading ? (
            <>
              <span className={b.skel} style={{ height: 16, width: "90%" }} />
              <span className={b.skel} style={{ height: 16, width: "75%" }} />
              <span className={b.skel} style={{ height: 16, width: "82%" }} />
            </>
          ) : (
            <ul>
              <li>
                <span>
                  <b>{`${t.short} wins it all.`}</b> {`That happens in ${pct(m)} of tournaments; ${p.pubEstimated ? "about " : ""}${pct(pu)} of the public is on them.`}
                </span>
              </li>
              <li>
                <span>
                  <b>{`Final Four: ${ff.map((s) => p.teams[s].short).join(", ")}.`}</b>{" "}
                  {ffOut.length ? `${listOf(ffOut.map((s) => p.teams[s].short))} ${ffOut.length === 1 ? "is" : "are"} under-picked to get there.` : "The public backs all four at least as much as the model does."}
                </span>
              </li>
              <li>
                <span>
                  {ups.length ? (
                    <>
                      <b>{`${ups.length} upset ${ups.length === 1 ? "pick" : "picks"}.`}</b> {`The longest shot of them still wins its game ${pct(Math.min(...ups.map((u) => u.h2h)))} of the time. Each one you hit gains ground on most of the pool.`}
                    </>
                  ) : (
                    <>
                      <b>No upsets.</b> In a pool this size, picking against the favorites costs more than it gains.
                    </>
                  )}
                </span>
              </li>
              {best && best.close.length > 0 && (
                <li>
                  <span>
                    <b>{`Close calls: ${listOf(best.close.map((c) => `${p.teams[c.champion].short} (${c.xAvg >= 10 ? c.xAvg.toFixed(0) : c.xAvg.toFixed(1)}x)`))}.`}</b>{" "}
                    {"Brackets built around these champions score within 10% of this one, inside the simulation's noise. Any of them is a sound pick; going with a different one from your rivals is worth more than the gap."}
                  </span>
                </li>
              )}
              {best && best.chalk && (
                <li>
                  <span>
                    <b>{`${best.value.xAvg >= best.chalk.xAvg * 1.05 ? `${(best.value.xAvg / Math.max(1e-9, best.chalk.xAvg)).toFixed(1)}x` : "About"} the value of pure favorites.`}</b>{" "}
                    {`The most likely bracket would win this pool ${winPct(best.chalk.win)} of the time.`}
                  </span>
                </li>
              )}
            </ul>
          )}
          <p className={b.guide}>{sizeGuide(n)}</p>
        </div>
      </div>
    </section>
  );
}

function PerfectSummary({ p, ml, ch, onPick }: { p: Prepared; ml: { picks: Picks; prob: number }; ch: { picks: Picks; prob: number }; onPick: (s: number) => void }) {
  const same = ml.picks.every((x, i) => x === ch.picks[i]);
  const diff = ml.picks.reduce((a, x, i) => a + (x === ch.picks[i] ? 0 : 1), 0);
  const ratio = ml.prob / Math.max(1e-300, ch.prob);
  return (
    <section className={b.summary} aria-label="Summary">
      <ChampCard p={p} picks={ml.picks} verdict="The champion of the single most likely bracket. Even so, a perfect bracket is a lottery ticket: this is the best ticket, not a good one." onPick={onPick} />
      <div className={b.side}>
        <div className={b.odds}>
          <div className={`${b.oddCard} ${b.oddCardMain}`}>
            <span className={b.oddK}>Most likely bracket is perfect</span>
            <span className={b.oddV}>{oneIn(ml.prob)}</span>
            <p className={b.oddSub}>Every game chosen together for the highest chance that all 63 hit.</p>
          </div>
          <div className={b.oddCard}>
            <span className={b.oddK}>Pure chalk by seed</span>
            <span className={b.oddV}>{oneIn(ch.prob)}</span>
            <p className={b.oddSub}>{same ? "Same bracket for now: the projected field is seeded straight off the ratings. They split once the real seeds are out." : `Differs in ${diff} ${diff === 1 ? "game" : "games"}. The most likely bracket is ${ratio.toFixed(1)}x as likely to be perfect.`}</p>
          </div>
        </div>
        <div className={b.wins}>
          <h3>Why it is still a long shot</h3>
          <ul>
            <li>
              <span>
                <b>63 games, all at once.</b>{" "}Every game is a chance to miss, and one miss ends it. The closest calls are listed below the bracket.
              </span>
            </li>
            <li>
              <span>
                <b>It is a poor pool bracket.</b>{" "}It looks like most of the public&apos;s, so it rarely finishes alone at the top. To win a pool, switch to Win my pool.
              </span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- picks, leverage, odds */

function UpsetPicks({ p, picks, loading, onPick, estimated }: { p: Prepared; picks: Picks; loading: boolean; onPick: (s: number) => void; estimated: boolean }) {
  if (loading) return null;
  const ups = upsetRows(p, picks);
  return (
    <section className={b.bwrap} aria-labelledby="ups-h">
      <SecHead id="ups-h" title="Upset picks" aside={ups.length ? "Model chance vs how often the public makes the pick" : undefined} />
      {ups.length ? (
        <ul className={b.upsetList}>
          {ups.map((u) => {
            const t = p.teams[u.team];
            const o = p.teams[u.opp];
            return (
              <li key={u.game}>
                <button type="button" className={b.upsetCard} onClick={() => onPick(u.team)}>
                  <div className={b.upsetTop}>
                    <span>{u.round === 0 ? "First round" : ROUNDS[u.round - 1]}</span>
                    <span>{`${t.region}`}</span>
                  </div>
                  <div className={b.upsetWho}>
                    <TeamLogo league="cfb" espnId={t.id} size={26} />
                    <span>{`${t.seed} ${t.short}`}</span>
                    <small>{`over ${o.seed} ${o.short}`}</small>
                  </div>
                  <dl className={b.trio}>
                    <div>
                      <dt>Wins the game</dt>
                      <dd>{pct(u.h2h)}</dd>
                    </div>
                    <div>
                      <dt>
                        {`Public picks`}
                        {estimated ? "*" : ""}
                      </dt>
                      <dd>{pct(u.pub)}</dd>
                    </div>
                    <div>
                      <dt>Edge</dt>
                      <dd className={u.lev >= 0 ? b.pos : b.neg}>{pts(u.lev)}</dd>
                    </div>
                  </dl>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={b.foot}>No upsets in this bracket. At this pool size and scoring the favorites carry it.</p>
      )}
      {ups.length > 0 && <p className={b.foot}>{`Public picks: the share of brackets with this team winning that round${estimated ? " (*an estimate until Yahoo and ESPN post theirs)" : ""}. Edge: model chance to win that round minus the public share, in percentage points.`}</p>}
    </section>
  );
}

function ClosestCalls({ p, picks, onPick }: { p: Prepared; picks: Picks; onPick: (s: number) => void }) {
  const rows = pickRows(p, picks)
    .sort((a, c) => a.h2h - c.h2h)
    .slice(0, 6);
  return (
    <section className={b.bwrap} aria-labelledby="close-h">
      <SecHead id="close-h" title="Where it most likely breaks" aside="The six closest calls in the bracket" />
      <ul className={b.upsetList}>
        {rows.map((u) => {
          const t = p.teams[u.team];
          const o = p.teams[u.opp];
          return (
            <li key={u.game}>
              <button type="button" className={b.upsetCard} style={{ borderLeftColor: "var(--accent)" }} onClick={() => onPick(u.team)}>
                <div className={b.upsetTop}>
                  <span>{u.round === 0 ? "First round" : u.round === 5 ? "Title game" : u.round === 4 ? "Final Four" : ROUNDS[u.round - 1]}</span>
                  <span>{t.region}</span>
                </div>
                <div className={b.upsetWho}>
                  <TeamLogo league="cfb" espnId={t.id} size={26} />
                  <span>{`${t.seed} ${t.short}`}</span>
                  <small>{`over ${o.seed} ${o.short}`}</small>
                </div>
                <dl className={b.trio}>
                  <div>
                    <dt>Wins the game</dt>
                    <dd>{pct(u.h2h)}</dd>
                  </div>
                  <div>
                    <dt>Misses</dt>
                    <dd>{pct(1 - u.h2h)}</dd>
                  </div>
                  <div>
                    <dt>Rating gap</dt>
                    <dd>{`${(t.rating - o.rating).toFixed(1)}`}</dd>
                  </div>
                </dl>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LevRow({ p, s, onPick }: { p: Prepared; s: number; onPick: (s: number) => void }) {
  const t = p.teams[s];
  const m = p.adv[3][s];
  const pu = p.pub[3][s];
  const max = Math.max(m, pu, 0.01);
  const lev = m - pu;
  return (
    <button type="button" className={b.levRow} onClick={() => onPick(s)}>
      <TeamLogo league="cfb" espnId={t.id} size={20} />
      <span className={b.levWho}>
        <b>{t.short}</b>
        <small>{`${t.seed} seed, ${t.region}`}</small>
      </span>
      <span className={b.cmp} aria-label={`Final Four: model ${pct(m)}, public ${pct(pu)}`}>
        <span>
          <i className={b.cmpModel} style={{ width: `${((m / max) * 100).toFixed(2)}%` }} />
          {pct(m)}
        </span>
        <span>
          <i className={b.cmpPub} style={{ width: `${((pu / max) * 100).toFixed(2)}%` }} />
          {pct(pu)}
        </span>
      </span>
      <span className={`${b.levNum} ${lev >= 0 ? b.pos : b.neg}`}>{pts(lev)}</span>
    </button>
  );
}

function Leverage({ p, onPick }: { p: Prepared; onPick: (s: number) => void }) {
  const all = [...Array(64).keys()].map((s) => ({ s, lev: p.adv[3][s] - p.pub[3][s] }));
  const under = [...all].sort((a, c) => c.lev - a.lev).slice(0, 6);
  const over = [...all].sort((a, c) => a.lev - c.lev).slice(0, 6);
  return (
    <section className={b.bwrap} aria-labelledby="lev-h">
      <SecHead
        id="lev-h"
        title="Leverage in the field"
        aside={
          <>
            Final Four odds, model vs public
            <Est on={p.pubEstimated} />
          </>
        }
      />
      <div className={b.split}>
        <div className={b.levCard}>
          <h3>Under-picked</h3>
          <p>Reach the Final Four more often than the public expects. Where a big pool gets won.</p>
          {under.map((x) => (
            <LevRow key={x.s} p={p} s={x.s} onPick={onPick} />
          ))}
        </div>
        <div className={b.levCard}>
          <h3>Over-picked</h3>
          <p>The public has them there more than they get there. Fine to pick, costly to need.</p>
          {over.map((x) => (
            <LevRow key={x.s} p={p} s={x.s} onPick={onPick} />
          ))}
        </div>
      </div>
      <div className={b.sheetKey}>
        <span>
          <i className={b.cmpModel} />
          Model
        </span>
        <span>
          <i className={b.cmpPub} />
          Public
        </span>
        <span>Edge in percentage points</span>
      </div>
    </section>
  );
}

type SortKey = "seed" | "name" | "r0" | "r1" | "r2" | "r3" | "r4" | "r5" | "pub3" | "pub5" | "lev";

function OddsTable({ p, picks, onPick }: { p: Prepared; picks: Picks; onPick: (s: number) => void }) {
  const [key, setKey] = useState<SortKey>("r5");
  const [desc, setDesc] = useState(true);
  const mine = new Set(finalFour(picks));
  const val = (s: number, k: SortKey): number | string => {
    if (k === "seed") return p.teams[s].seed * 10 + (s >> 4);
    if (k === "name") return p.teams[s].short;
    if (k === "pub3") return p.pub[3][s];
    if (k === "pub5") return p.pub[5][s];
    if (k === "lev") return p.adv[5][s] - p.pub[5][s];
    return p.adv[Number(k.slice(1))][s];
  };
  const rows = [...Array(64).keys()].sort((a, c) => {
    const x = val(a, key);
    const y = val(c, key);
    const d = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
    return desc ? -d : d;
  });
  const sortBy = (k: SortKey) => {
    if (k === key) setDesc(!desc);
    else {
      setKey(k);
      setDesc(!(k === "seed" || k === "name"));
    }
  };
  const th = (k: SortKey, label: string, title?: string) => (
    <th key={k} aria-sort={key === k ? (desc ? "descending" : "ascending") : "none"} title={title}>
      <button type="button" className={b.thBtn} data-on={key === k} onClick={() => sortBy(k)}>
        {label}
        <span aria-hidden>{key === k ? (desc ? "↓" : "↑") : ""}</span>
      </button>
    </th>
  );
  return (
    <section className={b.bwrap} aria-labelledby="odds-h">
      <SecHead
        id="odds-h"
        title="Every team, every round"
        aside={
          <>
            Chance to reach each round. Public columns
            <Est on={p.pubEstimated} />
          </>
        }
      />
      <div className={b.tw}>
        <table className={b.table}>
          <thead>
            <tr>
              {th("seed", "Team", "Sort by seed")}
              {ROUND_SHORT.map((r, i) => th(`r${i}` as SortKey, r, ROUNDS[i]))}
              {th("pub3", "Public F4", "Public share picking them to reach the Final Four")}
              {th("pub5", "Public title", "Public share picking them to win it all")}
              {th("lev", "Title edge", "Model title chance minus public share, points")}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const t = p.teams[s];
              const lev = p.adv[5][s] - p.pub[5][s];
              return (
                <tr key={s} className={mine.has(s) ? b.mine : ""} onClick={() => onPick(s)}>
                  <td>
                    <span className={b.tTeam}>
                      <span className={b.tSeed}>{t.seed}</span>
                      <TeamLogo league="cfb" espnId={t.id} size={18} />
                      <span>
                        {t.short} <small>{t.region}</small>
                      </span>
                    </span>
                  </td>
                  {[0, 1, 2, 3, 4, 5].map((r) => (
                    <td key={r} className={r === 5 ? b.colTitle : ""}>
                      {pct(p.adv[r][s])}
                    </td>
                  ))}
                  <td className={b.muted}>{pct(p.pub[3][s])}</td>
                  <td className={b.muted}>{pct(p.pub[5][s])}</td>
                  <td className={Math.abs(lev) < 0.0005 ? b.muted : lev > 0 ? b.pos : b.neg}>{pts(lev)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={b.foot}>Tap a row for that team&apos;s odds by round. Shaded rows are this bracket&apos;s Final Four.</p>
    </section>
  );
}

