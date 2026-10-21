import Link from "next/link";
import { etDay, getNbaBoard, NBA_SOURCES, type NbaBoard, type NbaBoardGame } from "@/lib/picks/nba-store";
import { getNbaPicksView, type NbaPicksView } from "@/lib/picks/nba-track-store";
import { nbaBets, NBA_GO_LIVE, NBA_LIMITS, tierOf, type NbaBet, type NbaCutRecord, type NbaTracked } from "@/lib/picks/nba-track";
import { readNba } from "@/lib/picks/nba";
import { CRITERIA } from "@/lib/picks/learning/model";
import { MIN_SAMPLE } from "@/lib/picks/engine";
import { href, kickoffEt, line, price, rec, units, NBA_VIEWS, whenEt, type View } from "../ui";
import s from "../picks.module.css";

// The NBA tab. One model (Sam) against the DraftKings line, tracked like
// football (nba-track.ts): saved before tip, graded, sliced into cuts, a rule
// chosen the football way and a weekly learning review. Not staked until the
// go-live gate clears, then under NBA's own limits; never in football's 30u.

const dayLabel = (day: string, today: string) => {
  const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)), 16));
  const label = d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });
  return day === today ? `Today · ${label}` : label;
};

function SamStatus({ b }: { b: NbaBoard }) {
  const sam = b.sam;
  if (sam.state === "live") {
    const n = b.days.flatMap((d) => d.games).filter((g) => g.read).length;
    return (
      <p className={s.notice}>
        {`Sam's NBA board is up: ${n} game${n === 1 ? "" : "s"} below carry his line. Every read is saved before tip and graded like football's. Nothing is staked or emailed until the go-live gate on Research clears; a game in the rule's tier is marked.`}
      </p>
    );
  }
  if (sam.state === "soon")
    return (
      <p className={s.notice}>
        {`Sam's NBA model isn't out yet (his page says: "${sam.note}"). The DraftKings lines are below; his line and edge fill in on each game as soon as the board goes up.`}
      </p>
    );
  if (sam.state === "unread")
    return (
      <p className={s.notice} role="alert">
        Sam&apos;s NBA page is up, but it isn&apos;t laid out like his NFL board, so this page can&apos;t read it yet. The parser in
        src/lib/picks/nba.ts needs updating for it.
      </p>
    );
  return <p className={s.notice} role="alert">{`Couldn't reach Sam's NBA page (${sam.error}). Lines below are DraftKings only.`}</p>;
}

/** Sam's spread bet on a board game, in the tracker's terms (for the rule's tiers). */
function boardBet(g: NbaBoardGame): NbaBet | null {
  if (!g.read) return null;
  const snap = { at: "", line: g.line?.home, homePrice: g.line?.homePrice, awayPrice: g.line?.awayPrice, model: g.read.model };
  return nbaBets({ id: g.id, day: g.day, week: 0, tip: g.tip, home: g.home.abbr, away: g.away.abbr, first: snap, last: snap }).find((b) => b.market === "ats") ?? null;
}

/**
 * Once a game tips, Sam drops it from his page and ESPN drops the odds, so a
 * live or final card shows the copy saved before tip: the numbers it is graded on.
 */
function asSaved(g: NbaBoardGame, t: NbaTracked | undefined): NbaBoardGame {
  if (g.state === "pre" || !t) return g;
  const s = t.last;
  const out: NbaBoardGame = {
    ...g,
    line: s.line !== undefined ? { home: s.line, homePrice: s.homePrice, awayPrice: s.awayPrice } : g.line,
    total: s.total !== undefined ? { points: s.total, overPrice: s.overPrice, underPrice: s.underPrice } : g.total,
    ml: s.mlHome !== undefined || s.mlAway !== undefined ? { home: s.mlHome, away: s.mlAway } : g.ml,
  };
  return { ...out, read: readNba(out, { home: g.home.abbr, away: g.away.abbr, model: s.model, vegas: s.line ?? NaN, ...(s.modelTotal !== undefined ? { total: s.modelTotal } : {}) }) };
}

/** Sam's spread and total results on a finished game, from the saved copy. */
function samResults(g: NbaBoardGame, t: NbaTracked | undefined): string | null {
  if (g.state !== "post" || !g.score || !t) return null;
  const bets = nbaBets({ ...t, final: t.final ?? g.score });
  const word = (m: "ats" | "ou", label: string) => {
    const b = bets.find((x) => x.market === m);
    return b?.result ? `${label} ${b.result === "W" ? "won" : b.result === "L" ? "lost" : "push"}` : null;
  };
  return [word("ats", "Spread"), word("ou", "Total")].filter(Boolean).join(" · ") || null;
}

function GameCard({ g: raw, v }: { g: NbaBoardGame; v: NbaPicksView | null }) {
  const saved = v?.games.find((x) => x.id === raw.id);
  const g = asSaved(raw, saved);
  const done = samResults(g, saved);
  const r = g.read;
  const bet = boardBet(g);
  const tier = bet && v && g.state === "pre" ? tierOf(bet, v.ats) : null;
  const tierRec = tier === 1 ? v?.ats.tier1 : tier === 2 ? v?.ats.tier2 : null;
  // The stake the running window gave it (set only once NBA is live).
  const stake = tier && tierRec && v?.gate.live ? (v.games.find((x) => x.id === g.id)?.stake ?? null) : null;
  const pickTeam = r ? (r.side === "home" ? g.home : g.away) : null;
  const pickLine = r && g.line ? (r.side === "home" ? g.line.home : -g.line.home) : null;
  const pickPrice = r && g.line ? (r.side === "home" ? g.line.homePrice : g.line.awayPrice) : undefined;
  const live = g.state !== "pre";
  return (
    <li className={s.card}>
      <div className={s.cardTop}>
        <div>
          <div className={s.cardPick}>{pickTeam && pickLine !== null ? `${pickTeam.short} ${line(pickLine)}` : `${g.away.short} at ${g.home.short}`}</div>
          <div className={s.cardMeta}>
            {pickTeam ? `${g.away.short} at ${g.home.short} · ` : ""}
            {live ? g.detail : kickoffEt(g.tip)}
          </div>
        </div>
        {g.score ? (
          <span className={`${s.statusChip} ${s.num}`}>{`${g.away.abbr} ${g.score.away}, ${g.home.abbr} ${g.score.home}`}</span>
        ) : r ? (
          <div className={s.stake}>
            <b className={s.num}>{stake ? `${stake}u` : `${r.edge.toFixed(1)} pts`}</b>
            <span className={s.num}>{`${stake ? `Tier ${tier} bet · ${r.edge.toFixed(1)} pts` : tier ? `Tier ${tier}, tracking · Sam's edge` : "Sam's edge"} · ${price(pickPrice)}`}</span>
          </div>
        ) : (
          <span className={s.statusChip}>{g.line ? "No model yet" : "No line yet"}</span>
        )}
      </div>
      <dl className={s.kv}>
        <dt>Spread</dt>
        <dd className={s.num}>
          {g.line ? `${g.home.short} ${line(g.line.home)} (${price(g.line.homePrice)} / ${price(g.line.awayPrice)})` : "not posted"}
        </dd>
        <dt>Total</dt>
        <dd className={s.num}>{g.total ? `${g.total.points} (o ${price(g.total.overPrice)} / u ${price(g.total.underPrice)})` : "not posted"}</dd>
        <dt>Moneyline</dt>
        <dd className={s.num}>{g.ml ? `${g.away.abbr} ${price(g.ml.away)} · ${g.home.abbr} ${price(g.ml.home)}` : "not posted"}</dd>
        {done && (
          <>
            <dt>Sam</dt>
            <dd className={s.num}>{done}</dd>
          </>
        )}
        {r && (
          <>
            <dt>Sam line</dt>
            <dd className={s.num}>{`${g.home.short} ${line(r.model)}`}</dd>
            {r.modelTotal !== undefined && (
              <>
                <dt>Sam total</dt>
                <dd className={s.num}>{`${r.modelTotal} (${r.totalSide} by ${r.totalEdge?.toFixed(1)})`}</dd>
              </>
            )}
          </>
        )}
      </dl>
    </li>
  );
}

const nbaHref = (v: View) => (v === "week" ? "/picks/nba" : `/picks/nba?v=${v}`);
const pctOf = (x: number) => `${(x * 100).toFixed(1)}%`;
const cls = (u: number) => (u > 0 ? s.pos : u < 0 ? s.neg : "");

function CutTable({ title, rows, v }: { title: string; rows: NbaCutRecord[]; v: NbaPicksView }) {
  const t1 = [v.ats.tier1?.id, v.ou.tier1?.id];
  const t2 = [v.ats.tier2?.id, v.ou.tier2?.id];
  return (
    <div className={s.tw}>
      <table className={s.table}>
        <caption className={s.caption}>{title}</caption>
        <thead>
          <tr>
            <th>Cut</th>
            <th>Record</th>
            <th>Win rate</th>
            <th>90% range</th>
            <th>Units</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.id}>
              <td>
                {x.label}
                {t1.includes(x.id) && <span className={s.pill}>tier 1</span>}
                {t2.includes(x.id) && <span className={s.pill}>tier 2</span>}
                {x.research && <span className={s.dim}>{v.activated.includes(x.id) ? " · research, activated" : " · research"}</span>}
              </td>
              <td className={s.num}>{rec(x)}</td>
              <td className={s.num}>{x.w + x.l ? pctOf(x.pct) : "–"}</td>
              <td className={s.num}>{x.w + x.l ? `${pctOf(x.lo)} to ${pctOf(x.hi)}` : "–"}</td>
              <td className={`${s.num} ${cls(x.units)}`}>{units(x.units)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NbaResults({ v }: { v: NbaPicksView }) {
  const done = v.games.filter((g) => g.final);
  if (!done.length)
    return <p className={s.calm}>Nothing graded yet. Sam&apos;s reads are saved before each tip and graded from ESPN&apos;s final overnight (2:30am ET run); opening night is October 20.</p>;
  const cut = (id: string) => v.cuts.find((c) => c.id === id)!;
  const tile = (value: string, label: string) => (
    <div className={s.tile}>
      <span className={`${s.tileV} ${s.num}`}>{value}</span>
      <span className={s.tileK}>{label}</span>
    </div>
  );
  return (
    <section className={s.section} aria-labelledby="nba-results">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="nba-results">NBA results</h2>
        <p className={s.p}>Every game Sam read before tip, graded at the DraftKings number and price saved then, 1 unit risked per bet. Not staked: this is the record the go-live gate reads.</p>
      </div>
      <div className={s.tiles}>
        {tile(units(cut("ats:all").units), `Spreads, every Sam side · ${rec(cut("ats:all"))}`)}
        {tile(v.ats.tier1 ? units(v.ats.tier1.units) : "none", v.ats.tier1 ? `Spread rule tier 1 · ${v.ats.tier1.label} · ${rec(v.ats.tier1)}` : "No spread cut qualifies yet")}
        {tile(rec(cut("su:all")), `Straight up · ${units(cut("su:all").units)} at the moneyline`)}
        {tile(units(cut("ou:all").units), `Totals, every Sam side · ${rec(cut("ou:all"))}`)}
      </div>
      <div className={s.tw}>
        <table className={s.table}>
          <caption className={s.caption}>Game by game</caption>
          <thead>
            <tr>
              <th>Date</th>
              <th>Game</th>
              <th>Final</th>
              <th>Spread</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {done.map((g) => {
              const bets = nbaBets(g);
              const cell = (m: "ats" | "ou") => {
                const b = bets.find((x) => x.market === m);
                if (!b) return <td className={s.dim}>–</td>;
                const what = m === "ats" ? `${b.side === "home" ? g.home : g.away} ${line(b.line)}` : `${b.side === "over" ? "Over" : "Under"} ${b.line}`;
                return <td className={b.result === "W" ? s.resW : b.result === "L" ? s.resL : s.resP}>{`${what} · ${b.result}`}</td>;
              };
              return (
                <tr key={g.id}>
                  <td className={s.num}>{whenEt(g.tip).split(",").slice(0, 2).join(",")}</td>
                  <td>{`${g.away} at ${g.home}`}</td>
                  <td className={s.num}>{`${g.final!.away}-${g.final!.home}`}</td>
                  {cell("ats")}
                  {cell("ou")}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function NbaResearch({ v }: { v: NbaPicksView }) {
  const by = (m: string) => v.cuts.filter((c) => c.market === m);
  return (
    <section className={s.section} aria-labelledby="nba-research">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="nba-research">Where Sam&apos;s NBA picks make money</h2>
        <p className={s.p}>
          {`The football rule, on NBA cuts: a cut needs ${MIN_SAMPLE}+ decided games and a win rate past 52.4%, and the one whose 90% range has the highest low end is tier 1; tier 2 is the best other cut judged only on the games it adds. Research cuts join only when the weekly review shows they beat their parent cut.`}
        </p>
      </div>

      <div className={s.tw}>
        <table className={s.table}>
          <caption className={s.caption}>{v.gate.live ? "Go-live gate: cleared. Tier bets now carry stakes under NBA's own limits." : "Go-live gate: NBA stays unstaked until all four clear"}</caption>
          <thead>
            <tr>
              <th>Check</th>
              <th>Now</th>
              <th>Needs</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {v.gate.checks.map((c) => (
              <tr key={c.label}>
                <td>{c.label}</td>
                <td className={s.num}>{c.have}</td>
                <td className={s.num}>{c.need}</td>
                <td className={c.ok ? s.pos : s.dim}>{c.ok ? "met" : "not yet"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`${s.notice} ${s.dim}`}>
        {`Set Oct 19, before any NBA record existed. Once live, NBA has its own limits, separate from football's 30u: ${NBA_LIMITS.MIN_STAKE}u to ${NBA_LIMITS.MAX_STAKE}u a bet (under ${NBA_LIMITS.MIN_STAKE}u is not a bet), ${NBA_LIMITS.PER_GAME}u a game, ${NBA_LIMITS.DAILY}u a day, and ${NBA_LIMITS.WINDOW_UNITS}u across any running ${NBA_LIMITS.WINDOW_DAYS} days (a bet's units come back a week after its game, not all at once on Monday, so a strong Sunday isn't left with nothing; when a day's room is short the biggest edges go first), quarter Kelly on the tier record pulled toward 50% over ${NBA_LIMITS.SHRINK_GAMES} games. Gate: ${NBA_GO_LIVE.MIN_GAMES}+ games over ${NBA_GO_LIVE.MIN_WEEKS}+ weeks.`}
      </p>

      {v.gate.live && (
        <p className={s.notice}>
          {`Today: ${v.room.today}u of ${NBA_LIMITS.DAILY}u used, ${v.room.window + v.room.today}u of ${NBA_LIMITS.WINDOW_UNITS}u in the running ${NBA_LIMITS.WINDOW_DAYS} days, ${v.room.room}u left today.${v.room.frees ? ` The oldest stake frees up ${v.room.frees.slice(4, 6)}/${v.room.frees.slice(6)}.` : ""}`}
        </p>
      )}

      <CutTable title="Spreads: every cut" rows={by("ats")} v={v} />
      <CutTable title="Totals: every cut" rows={by("ou")} v={v} />
      <CutTable title="Straight up" rows={by("su")} v={v} />

      <div className={s.tw}>
        <table className={s.table}>
          <caption className={s.caption}>Learning review: research cuts against their parent, games first seen after each was registered</caption>
          <thead>
            <tr>
              <th>Research cut</th>
              <th>Against</th>
              <th>Games</th>
              <th>Weeks</th>
              <th>Units a game</th>
              <th>t</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {v.hyps.length ? (
              v.hyps.map((h) => (
                <tr key={h.id}>
                  <td>{h.label}</td>
                  <td>{h.parentLabel}</td>
                  <td className={s.num}>{`${h.cmp.n} / ${CRITERIA.MIN_OPPORTUNITIES}`}</td>
                  <td className={s.num}>{`${h.cmp.weeks} / ${CRITERIA.MIN_WEEKS}`}</td>
                  <td className={`${s.num} ${cls(h.cmp.mean)}`}>{h.cmp.n ? `${h.cmp.mean > 0 ? "+" : ""}${h.cmp.mean.toFixed(2)}` : "–"}</td>
                  <td className={s.num}>{h.cmp.t ?? "–"}</td>
                  <td className={h.status === "active" ? s.pos : h.status === "rolled-back" ? s.neg : s.dim}>{h.status === "active" ? "in the rule" : h.status === "rolled-back" ? "rolled back" : "collecting"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className={s.dim}>Registered on the first run.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className={`${s.notice} ${s.dim}`}>
        {`Same bar as football's review: ${CRITERIA.MIN_OPPORTUNITIES}+ games over ${CRITERIA.MIN_WEEKS}+ weeks and t ${CRITERIA.MIN_T}+ to go in, at most one per review; rolled back when it trails its parent on ${CRITERIA.ROLLBACK_MIN_OPPORTUNITIES}+ games with t at or under -${CRITERIA.MIN_T}. ${v.lastReviewAt ? `Last review ${whenEt(v.lastReviewAt)}; it runs weekly.` : "Runs weekly."}`}
      </p>
      {v.journal.length > 0 && (
        <ul className={s.journal}>
          {v.journal.slice(0, 12).map((j) => (
            <li key={`${j.at}${j.text}`}>{`${whenEt(j.at)}: ${j.text}`}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function NbaView({ view = "week" }: { view?: View }) {
  const [b, v] = await Promise.all([view === "week" ? getNbaBoard().catch(() => null) : Promise.resolve(null), getNbaPicksView().catch(() => null)]);
  const today = etDay(new Date());
  const sportNav = (
    <nav className={s.subnav} aria-label="Sport">
      <Link href={href("nfl", "ats", "week")}>NFL</Link>
      <Link href={href("cfb", "ats", "week")}>College</Link>
      <Link href="/picks/nba" aria-current="page">
        NBA
      </Link>
    </nav>
  );

  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <header className={s.header}>
          <div className={s.headRow}>
            {sportNav}
            <span className={s.eyebrow}>NBA 2026-27</span>
          </div>
          <h1 className={s.h1}>Picks</h1>
          {b ? <SamStatus b={b} /> : null}
          <nav className={`${s.tabs} ${s.tabsSoft}`} aria-label="View">
            {NBA_VIEWS.map((x) => (
              <Link key={x.id} href={nbaHref(x.id)} aria-current={x.id === view ? "page" : undefined} className={s.tab}>
                {x.label}
              </Link>
            ))}
          </nav>
        </header>

        {view !== "week" ? (
          !v ? (
            <div className={s.error} role="alert">
              Couldn&apos;t load the NBA record right now. Try again in a few minutes.
            </div>
          ) : view === "results" ? (
            <NbaResults v={v} />
          ) : (
            <NbaResearch v={v} />
          )
        ) : !b ? (
          <div className={s.error} role="alert">
            Couldn&apos;t load the NBA slate right now. Try again in a few minutes.
          </div>
        ) : !b.days.length ? (
          <p className={s.calm}>No NBA games in the next week.</p>
        ) : (
          <section className={s.section} aria-labelledby="nba-slate">
            <div className={s.sectionHead}>
              <h2 className={s.h2} id="nba-slate">
                Today and next
              </h2>
              <p className={s.p}>
                {`${
                  b.sam.state === "live"
                    ? "Sorted by tip time. The big line is Sam's side at the DraftKings number; the edge is how far his line sits from it."
                    : "Sorted by tip time, with the current DraftKings spread, total and moneyline."
                } Games run every day, so there is no weekly reset: once a game tips its card keeps the numbers saved before tip, and last night's games sit at the bottom with Sam's results.`}
              </p>
            </div>
            <div className={s.days}>
              {b.days.map((d) => (
                <div key={d.day} className={s.day}>
                  <div className={`${s.dayHead} ${d.day === today ? s.dayToday : ""}`}>
                    <span>{dayLabel(d.day, today)}</span>
                    <span className={s.num}>{`${d.games.length} game${d.games.length === 1 ? "" : "s"}`}</span>
                  </div>
                  <ul className={s.cards}>
                    {d.games.map((g) => (
                      <GameCard key={g.id} g={g} v={v} />
                    ))}
                  </ul>
                </div>
              ))}
              {b.yesterday && (
                <details className={s.day}>
                  <summary className={s.dayHead}>
                    <span>{`Last night · ${dayLabel(b.yesterday.day, today).replace(/^Today · /, "")}`}</span>
                    <span className={s.num}>{`${b.yesterday.games.length} game${b.yesterday.games.length === 1 ? "" : "s"}`}</span>
                  </summary>
                  <ul className={s.cards}>
                    {b.yesterday.games.map((g) => (
                      <GameCard key={g.id} g={g} v={v} />
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </section>
        )}

        <footer className={s.footer}>
          <span>
            Sources: <a href={NBA_SOURCES.samBoard}>Sam&apos;s Models</a>. Lines: DraftKings via ESPN. Model output, not betting advice.
          </span>
          {b?.unmatched.length ? <span>{`Sam games not matched to ESPN: ${b.unmatched.join(", ")}`}</span> : null}
          {b?.problems.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </footer>
      </div>
    </main>
  );
}
