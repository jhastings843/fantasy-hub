// Straight up (pick'em, not a wager) and totals: this week, results, research.
import { marginBand, marginLabel, suPick } from "@/lib/picks/engine";
import type { PicksReport } from "@/lib/picks/report";
import { kickoffEt, n, price, rec, units } from "./ui";
import s from "./picks.module.css";

// ------------------------------------------------------------- straight up

// Sleeper and ESPN spell a few teams differently (pool-store.ts canon).
const POOL_CANON: { [abbr: string]: string } = { WSH: "WAS", LA: "LAR", JAC: "JAX" };

export function SuWeek({ r, poolShares }: { r: PicksReport; poolShares?: { entries: number; shares: Record<string, number> } | null }) {
  const name = (k: string) => r.names[k] ?? k;
  const method = r.su.best?.id ?? "avg";
  const list = r.board
    .flatMap((g) => {
      const p = suPick(method, g.sam, g.david, g.ref?.line);
      return p ? [{ g, ...p }] : [];
    })
    .sort((a, b) => b.margin - a.margin);
  const upcoming = list.filter((x) => !x.g.final);
  const done = list.filter((x) => x.g.final);
  const won = (x: (typeof list)[number]) => {
    const f = x.g.final!;
    return f.home === f.away ? "P" : (f.home > f.away) === (x.side === "home") ? "W" : "L";
  };
  const doneW = done.filter((x) => won(x) === "W").length;
  return (
    <section className={s.section} aria-labelledby="su-week">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="su-week">
          {r.week ? `Week ${r.week} straight-up picks` : "Straight-up picks"}
        </h2>
        <p className={s.p}>
          {`${r.league === "nfl" ? "For the Weekly payout pool, use the entry above. This list is ranked" : "Ranked"} for a confidence pool, most sure first. Follows ${r.su.best?.label.toLowerCase() ?? "the average of both models"}${r.su.best ? ` (${r.su.best.w}-${r.su.best.l}, its best record)` : ""}. Pick'em only: no stake, and not counted in units. Bands describe the projected margin, not a probability.`}
        </p>
      </div>
      {upcoming.length === 0 && (
        <p className={s.calm} data-first-pick>
          {done.length ? "Every game on the board has been played. Results are below." : "No games on the board yet."}
        </p>
      )}
      <ol className={s.cards} data-first-pick>
        {upcoming.map(({ g, side, margin }, i) => {
          const pick = side === "home" ? g.home : g.away;
          const opp = side === "home" ? g.away : g.home;
          const band = marginBand(r.league, margin);
          return (
            <li key={`${g.away}@${g.home}`} className={s.card}>
              <div className={s.cardTop}>
                <div>
                  <div className={s.cardPick}>
                    <span className={`${s.num} ${s.rank}`}>{upcoming.length - i}</span>
                    {name(pick)}
                  </div>
                  <div className={s.cardMeta}>{`over ${name(opp)} · ${kickoffEt(g.ref?.kickoff)}`}</div>
                </div>
                <span className={`${s.tier} ${band === "wide" ? s.lock : band === "clear" ? s.solid : s.toss}`}>{`${marginLabel(r.league, band)} · ${margin.toFixed(1)}`}</span>
              </div>
            </li>
          );
        })}
      </ol>
      {done.length > 0 && (
        <div className={s.finished}>
          <div className={s.finHead}>
            <h3 className={s.h3}>{`Finished (${done.length})`}</h3>
            <span className={`${s.num} ${s.finTally}`}>{`Picks ${doneW}-${done.length - doneW}`}</span>
          </div>
          <ul className={s.finList}>
            {done.map((x) => {
              const f = x.g.final!;
              const res = won(x);
              return (
                <li key={`${x.g.away}@${x.g.home}`} className={s.finRow}>
                  <div className={s.finScore}>
                    <span className={f.away > f.home ? s.finWinner : undefined}>{`${name(x.g.away)} ${f.away}`}</span>
                    <span className={s.muted}> at </span>
                    <span className={f.home > f.away ? s.finWinner : undefined}>{`${name(x.g.home)} ${f.home}`}</span>
                  </div>
                  <div className={s.finCall}>
                    <span className={s.finPick}>{`${name(x.side === "home" ? x.g.home : x.g.away)} to win`}</span>
                    <span className={`${s.resChip} ${res === "W" ? s.resW : res === "L" ? s.resL : s.resP}`}>{res}</span>
                  </div>
                  {(() => {
                    if (!poolShares || f.home === f.away) return null;
                    const winner = f.home > f.away ? x.g.home : x.g.away;
                    const loser = winner === x.g.home ? x.g.away : x.g.home;
                    const shareOf = (t: string) => poolShares.shares[POOL_CANON[t.toUpperCase()] ?? t.toUpperCase()];
                    // A team nobody picked isn't in the counts: its share is what the other side left.
                    const share = shareOf(winner) ?? (shareOf(loser) !== undefined ? 1 - shareOf(loser)! : undefined);
                    return share === undefined ? null : (
                      <div className={s.thin}>{`${Math.round(share * 100)}% of the pool had ${name(winner)}`}</div>
                    );
                  })()}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

export function SuResults({ r }: { r: PicksReport }) {
  const total = r.live.reduce((t, w) => ({ w: t.w + w.su.w, l: t.l + w.su.l }), { w: 0, l: 0 });
  return (
    <section className={s.section} aria-labelledby="su-results">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="su-results">Straight-up results</h2>
        <p className={s.p}>Winners picked in the emails, as listed. Accuracy only: pick&apos;em has no stake.</p>
      </div>
      <div className={s.tiles}>
        <div className={s.tile}>
          <div className={`${s.tileV} ${s.num}`}>{total.w + total.l ? `${total.w}-${total.l}` : "none yet"}</div>
          <div className={s.tileK}>Picked winners, as sent</div>
        </div>
        {r.su.methods
          .filter((m) => ["avg", "vegas"].includes(m.id))
          .map((m) => (
            <div key={m.id} className={s.tile}>
              <div className={`${s.tileV} ${s.num}`}>{`${m.w}-${m.l}`}</div>
              <div className={s.tileK}>{`${m.label} (backtest)`}</div>
            </div>
          ))}
      </div>
      <div className={s.tw}>
        <table className={s.table}>
          <caption className={s.caption}>As sent, by week</caption>
          <thead>
            <tr>
              <th>Week</th>
              <th>Straight up</th>
            </tr>
          </thead>
          <tbody>
            {r.live.map((w) => (
              <tr key={w.week}>
                <td className={s.num}>{w.week}</td>
                <td className={s.num}>{`${w.su.w}-${w.su.l}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function SuResearch({ r }: { r: PicksReport }) {
  return (
    <section className={s.section} aria-labelledby="su-research">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="su-research">Straight-up research</h2>
        <p className={s.p}>Every way of picking winners, on the graded history. The list follows the best full-slate method.</p>
      </div>
      <div className={s.tw}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Method</th>
              <th>Record</th>
              <th>Rate</th>
            </tr>
          </thead>
          <tbody>
            {[...r.su.methods, ...r.su.bands].map((m) => (
              <tr key={m.id}>
                <td>
                  {m.label}
                  {r.su.best?.id === m.id && <span className={`${s.tag} ${s.tagRule}`}>followed</span>}
                </td>
                <td className={s.num}>{`${m.w}-${m.l}`}</td>
                <td className={s.num}>{m.w + m.l ? `${Math.round(m.pct * 100)}%` : "·"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ totals

export function TotalsWeek({ r }: { r: PicksReport }) {
  const t = r.totals;
  const name = (k: string) => r.names[k] ?? k;
  const order = { t1: 0, lean: 1, split: 2, one: 3, noline: 4 } as const;
  const finalOf = new Map(r.board.filter((g) => g.final).map((g) => [`${g.away}@${g.home}`, g.final!]));
  const all = t.board.slice().sort((a, b) => order[a.tier] - order[b.tier] || (b.read?.minEdge ?? 0) - (a.read?.minEdge ?? 0));
  const games = all.filter((g) => !finalOf.has(`${g.away}@${g.home}`));
  const done = all.filter((g) => finalOf.has(`${g.away}@${g.home}`));
  // Over/under on the total the board judged it at; no side, no result.
  const ouResult = (g: (typeof all)[number]): "W" | "L" | "P" | undefined => {
    const f = finalOf.get(`${g.away}@${g.home}`)!;
    const at = g.ref?.total;
    if (!g.side || at === undefined) return undefined;
    const pts = f.home + f.away;
    return pts === at ? "P" : (pts > at) === (g.side === "over") ? "W" : "L";
  };
  const bets = games.filter((g) => g.stake);
  const leans = games.filter((g) => !g.stake && (g.tier === "t1" || g.tier === "lean"));
  const other = games.filter((g) => !bets.includes(g) && !leans.includes(g));
  const card = (g: (typeof games)[number]) => (
    <li key={`${g.away}@${g.home}`} className={`${s.card} ${g.stake ? s.cardBet : ""}`}>
      <div className={s.cardTop}>
        <div>
          <div className={s.cardPick}>{g.side ? `${g.side === "over" ? "Over" : "Under"} ${g.ref?.total ?? ""}` : `${name(g.away)} at ${name(g.home)}`}</div>
          <div className={s.cardMeta}>{`${g.side ? `${name(g.away)} at ${name(g.home)} · ` : ""}${kickoffEt(g.ref?.kickoff)}`}</div>
        </div>
        {g.stake ? (
          <div className={s.stake}>
            <b className={s.num}>{g.stake}u</b>
            <span className={s.num}>{price(g.price)}</span>
          </div>
        ) : (
          <span className={s.statusChip}>{g.tier === "lean" ? "Tracking only" : g.tier === "t1" ? "Priced out" : g.tier === "split" ? "Split" : g.tier === "one" ? "One model" : "No line"}</span>
        )}
      </div>
      <details className={s.why}>
        <summary>Why</summary>
        <dl className={s.kv}>
          <dt>Total now</dt>
          <dd className={s.num}>{g.ref ? `${g.ref.total} · ${g.ref.source}` : "none"}</dd>
          <dt>Sam total</dt>
          <dd className={s.num}>{g.sam !== undefined ? g.sam.toFixed(1) : "not posted"}</dd>
          <dt>David total</dt>
          <dd className={s.num}>{g.david !== undefined ? g.david.toFixed(1) : "not posted"}</dd>
          {g.p !== undefined && (
            <>
              <dt>Win chance</dt>
              <dd className={s.num}>{`${(g.p * 100).toFixed(1)}% (estimate)`}</dd>
            </>
          )}
        </dl>
      </details>
    </li>
  );
  return (
    <section className={s.section} aria-labelledby="ou-week">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="ou-week">
          {r.week ? `Week ${r.week} totals` : "Totals"}
        </h2>
        <p className={s.p}>
          {t.backtest.rule
            ? `Rule: ${t.backtest.rule.label.toLowerCase()} (${rec(t.backtest.rule.record)} in the archive). ${bets.length} bet${bets.length === 1 ? "" : "s"}.`
            : `Tracking only: no totals cut has 10+ decided games and a winning rate yet, so nothing here is a bet. ${t.backtest.archived} archived games graded so far.`}
        </p>
      </div>
      {bets.length > 0 ? (
        <ul className={s.cards} data-first-pick>
          {bets.map(card)}
        </ul>
      ) : (
        <p className={s.calm} data-first-pick>
          {t.backtest.rule ? "No totals bets this week." : "No totals bets until the agreement archive earns a rule."}
        </p>
      )}
      {leans.length > 0 && (
        <details className={s.details}>
          <summary>{`Where both models lean the same way (${leans.length})`}</summary>
          <ul className={`${s.cards} ${s.cardsInset}`}>{leans.map(card)}</ul>
        </details>
      )}
      {other.length > 0 && (
        <details className={s.details}>
          <summary>{`Every other game (${other.length})`}</summary>
          <ul className={`${s.cards} ${s.cardsInset}`}>{other.map(card)}</ul>
        </details>
      )}
      {done.length > 0 && (
        <div className={s.finished}>
          <div className={s.finHead}>
            <h3 className={s.h3}>{`Finished (${done.length})`}</h3>
          </div>
          <ul className={s.finList}>
            {done.map((g) => {
              const f = finalOf.get(`${g.away}@${g.home}`)!;
              const res = ouResult(g);
              return (
                <li key={`${g.away}@${g.home}`} className={s.finRow}>
                  <div className={s.finScore}>{`${name(g.away)} ${f.away} at ${name(g.home)} ${f.home}`}</div>
                  <div className={s.finCall}>
                    <span className={s.finPick}>
                      {g.side && g.ref ? `${g.side === "over" ? "Over" : "Under"} ${g.ref.total} · ${f.home + f.away} scored` : `${f.home + f.away} scored`}
                    </span>
                    {res && <span className={`${s.resChip} ${res === "W" ? s.resW : res === "L" ? s.resL : s.resP}`}>{res}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

export function TotalsResults({ r }: { r: PicksReport }) {
  const l = r.units.byTier.totals;
  const sent = r.clv.plays.find((x) => x.id === "ou");
  return (
    <section className={s.section} aria-labelledby="ou-results">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="ou-results">Totals results</h2>
        <p className={s.p}>Returns on totals the emails recommended. Recommendation returns, not confirmed bets.</p>
      </div>
      <div className={s.tiles}>
        <div className={`${s.tile} ${l.w + l.l ? (l.units >= 0 ? s.good : s.bad) : ""}`}>
          <div className={`${s.tileV} ${s.num}`}>{l.w + l.l + l.p ? units(l.units) : "none yet"}</div>
          <div className={s.tileK}>{l.bets ? `${rec(l)}${l.pending ? `, ${l.pending} pending` : ""}` : "No totals sent yet"}</div>
        </div>
        <div className={s.tile}>
          <div className={`${s.tileV} ${s.num}`}>{sent?.n ? `${sent.avg > 0 ? "+" : ""}${sent.avg.toFixed(2)}` : "·"}</div>
          <div className={s.tileK}>{`vs closing total (${sent?.n ?? 0} with a close)`}</div>
        </div>
      </div>
    </section>
  );
}

export function TotalsResearch({ r }: { r: PicksReport }) {
  const bt = r.totals.backtest;
  return (
    <section className={s.section} aria-labelledby="ou-research">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="ou-research">Totals research</h2>
        <p className={s.p}>
          {`Neither site keeps totals history, so two-model agreement is archived going forward: the first time both models' totals and a current line meet, that game is saved and never rewritten. ${r.totals.archived} archived, ${bt.archived} graded. Thresholds were fixed before grading (both ${r.totals.edge}+ off).`}
        </p>
      </div>
      <div className={s.tw}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Cut</th>
              <th>Record</th>
              <th>Weeks</th>
            </tr>
          </thead>
          <tbody>
            {bt.cuts.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.label}
                  {bt.rule?.id === c.id && <span className={`${s.tag} ${s.tagRule}`}>rule</span>}
                </td>
                <td className={s.num}>{n(c.record) + c.record.p ? rec(c.record) : "none yet"}</td>
                <td className={s.num}>{c.weeks.join(", ") || "·"}</td>
              </tr>
            ))}
            <tr>
              <td>Sam alone vs the opening total (history)</td>
              <td className={s.num}>{n(bt.samAlone.record) ? rec(bt.samAlone.record) : "none"}</td>
              <td className={s.num}>{bt.samAlone.weeks.join(", ") || "·"}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className={s.thin}>
        {bt.samAlone.clv.n
          ? `Sam alone vs the closing total: ${bt.samAlone.clv.avg > 0 ? "+" : ""}${bt.samAlone.clv.avg.toFixed(2)} on ${bt.samAlone.clv.n}; flattered if he posted after the line moved.`
          : ""}
      </p>
    </section>
  );
}
