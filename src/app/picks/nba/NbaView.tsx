import Link from "next/link";
import { etDay, getNbaBoard, NBA_SOURCES, type NbaBoard, type NbaBoardGame } from "@/lib/picks/nba-store";
import { href, kickoffEt, line, price } from "../ui";
import s from "../picks.module.css";

// The NBA tab. One model (Sam) against the DraftKings line, shown and never
// staked: no rule, tiers, budget or emails until his NBA picks have a record.

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
        {`Sam's NBA board is up: ${n} game${n === 1 ? "" : "s"} below carry his line. One model only, so these are reads, not bets. Nothing here is staked or emailed until his NBA picks build a record.`}
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

function GameCard({ g }: { g: NbaBoardGame }) {
  const r = g.read;
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
            <b className={s.num}>{`${r.edge.toFixed(1)} pts`}</b>
            <span className={s.num}>{`Sam's edge · ${price(pickPrice)}`}</span>
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

export default async function NbaView() {
  const b = await getNbaBoard().catch(() => null);
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
        </header>

        {!b ? (
          <div className={s.error} role="alert">
            Couldn&apos;t load the NBA slate right now. Try again in a few minutes.
          </div>
        ) : !b.days.length ? (
          <p className={s.calm}>No NBA games in the next week.</p>
        ) : (
          <section className={s.section} aria-labelledby="nba-slate">
            <div className={s.sectionHead}>
              <h2 className={s.h2} id="nba-slate">
                Next games
              </h2>
              <p className={s.p}>
                {b.sam.state === "live"
                  ? "Sorted by tip time. The big line is Sam's side at the DraftKings number; the edge is how far his line sits from it."
                  : "Sorted by tip time, with the current DraftKings spread, total and moneyline."}
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
                      <GameCard key={g.id} g={g} />
                    ))}
                  </ul>
                </div>
              ))}
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
