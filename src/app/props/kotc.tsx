// King of the Court (NBA): DraftKings' promo where a tagged prop bet on the
// night's points + rebounds + assists leader splits a pool of bonus bets.
// Today: our chance for every player to lead the slate (lib/models/nba/kotc),
// the prop of his we'd attach, and how to read the pool. Results: every
// graded night against the board as it stood at the first tip.
import type { PropMarket } from "@/lib/props/parse";
import { getOurNbaView, type OurStoredProps } from "@/lib/models/nba/store";
import { getKotcNights, type KotcNight } from "@/lib/models/nba/kotc-store";
import { whenEt } from "../picks/ui";
import { Background, Hero, Stats } from "../picks/board";
import s from "../picks/picks.module.css";

const pct = (x: number) => (x >= 0.1 ? `${Math.round(x * 100)}%` : `${(x * 100).toFixed(1)}%`);
const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const SHORT: { [k: string]: string } = { pts: "pts", reb: "reb", ast: "ast", threes: "threes" };
/** DK's rule: the tagged prop must be priced -200 or longer. */
const QUALIFIES = -200;
/** NBA games a player needs this season before his prop edge counts (as on the props board). */
const CARD_GAMES = 3;
const ROWS = 20;
const nowMs = () => Date.now();

/** His best qualifying prop: our edge side at -200 or longer, biggest edge first. */
function attach(boards: OurStoredProps[], name: string): { text: string; gap: number } | null {
  let best: { m: PropMarket; price: number; gap: number } | null = null;
  for (const g of boards)
    for (const m of g.game.markets) {
      if (m.player !== name || !m.clears || !m.side || m.gap === null) continue;
      if ((g.extra[m.id]?.games ?? 0) < CARD_GAMES) continue;
      const price = m.books[0][m.side];
      if (price === null || price < QUALIFIES) continue;
      if (!best || m.gap > best.gap) best = { m, price, gap: m.gap };
    }
  if (!best) return null;
  return { text: `${best.m.side === "over" ? "Over" : "Under"} ${best.m.line} ${SHORT[best.m.stat ?? ""] ?? best.m.statLabel} ${am(best.price)}`, gap: best.gap };
}

function Explainer() {
  return (
    <Background title="How the promo pays, and how to read this board">
      <p className={s.p}>
        Opt in on DraftKings&apos; promotions page, bet any player prop priced -200 or longer and tag it as your King of the Court bet. If
        that player has the most points + rebounds + assists on the night, everyone who tagged him splits the pool in bonus bets (ties
        split it across every tied player&apos;s backers). The prop itself wins or loses on its own. Check the terms in the app for a
        per-winner cap before trusting the math below.
      </p>
      <p className={s.p}>
        The pool is shared, so the best tag is not simply the likeliest king. Your share is worth about: his chance × pool ÷ the number
        of people on him × 0.70 (a bonus bet converts to roughly 70 cents of cash). If 25% of everyone tags a player we give 25%, his
        tag is average value. A player we give 6% that only 2% of people tag is worth three times as much per entry. Crowd sizes
        aren&apos;t public before the night; that column comes once enough posted payouts are logged.
      </p>
      <p className={s.p}>
        Chances come from 20,000 runs of the whole slate on our props model&apos;s projections: each game&apos;s pace is shared by both
        teams, and every player gets the box score&apos;s own spread around his number. Whole-number PRA, so ties happen and are split.
      </p>
    </Background>
  );
}

function Backtest() {
  // From scripts/fit-kotc.mts (.cache/fit-kotc.txt), run 2026-10-21.
  return (
    <Background title="How it tested on last season">
      <p className={s.p}>
        Replayed night by night on 2025-26 with only what was known before each night, fit on nights before Jan 15 (52) and judged on the
        55 after it, which the fit never saw. Our favorite led 30% of those nights; we had given him 32% on average. The winning PRA
        averaged 50.5, and our median for it averaged 50.5. Players we gave 7 to 15% led 11.3% of the time (n 137); 30%+ led 45.7%
        against 45.5% given (n 23). Log loss 2.480 against 2.487 for a plain ranking on projected PRA: the game-level shocks add a
        little, so the projections carry most of it, and the edge on this promo is in the crowd, not the ranking.
      </p>
    </Background>
  );
}

export async function KotcWeek({ season }: { season: number }) {
  const [nights, v] = await Promise.all([getKotcNights(season).catch(() => null), getOurNbaView(season).catch(() => null)]);
  if (!nights) return <p className={s.calm}>King of the Court couldn&apos;t be read just now.</p>;
  const now = nowMs();
  const n = [...nights].sort((a, b) => a.date.localeCompare(b.date)).find((x) => !x.result && Date.parse(x.firstTip) > now - 6 * 3_600_000) ?? null;
  const last = nights.find((x) => x.result);
  if (!n)
    return (
      <section className={s.section} aria-labelledby="kotc-today">
        <Hero eyebrow="King of the Court" title={<span id="kotc-today">No slate saved yet</span>} sub="The board is built from our props model once DraftKings posts the night's props (usually by mid-afternoon Eastern) and freezes at the first tip." />
        {last && <LastNight n={last} />}
        <Explainer />
      </section>
    );
  const boards = (v?.board ?? []).filter((g) => n.games.some((x) => x.id === g.espnId));
  const top = n.board.rows[0];
  const started = Date.parse(n.firstTip) <= now;
  const rows = n.board.rows.slice(0, ROWS);
  return (
    <section className={s.section} aria-labelledby="kotc-today">
      <Hero
        eyebrow={`King of the Court · ${n.date}`}
        title={<span id="kotc-today">{`${top.name} leads at ${pct(top.p)}`}</span>}
        sub={`${n.games.length} game${n.games.length === 1 ? "" : "s"}${n.slateGames > n.games.length ? ` of ${n.slateGames} on the slate (the rest had no props yet)` : ""}, ${n.board.rows.length} players. ${started ? "Frozen at the first tip" : `Updates until the first tip, ${whenEt(n.firstTip)}`}; saved ${whenEt(n.at)}.`}
      />
      <Stats
        label="Tonight's slate"
        items={[
          { k: "Favorite", v: pct(top.p), sub: top.name },
          { k: "Winning PRA", v: `${n.board.winning.p50}`, sub: `middle 80%: ${n.board.winning.p10} to ${n.board.winning.p90}` },
          { k: "Top 5 combined", v: pct(n.board.rows.slice(0, 5).reduce((a, r) => a + r.p, 0)), sub: "the rest of the field takes the other share", small: true },
          { k: "Last night", v: last?.result ? `${last.result.kings[0]?.name.split(" ").slice(-1)[0]} ${last.result.pra}` : "·", sub: last?.result ? `we had him ${pct(last.result.p)}` : "first grade pending", small: true },
        ]}
      />
      <div className={s.section}>
        <div className={s.sectionHead}>
          <h3 className={s.h2}>Chance to be king</h3>
          <p className={s.p}>Top {ROWS} by chance to lead the slate in PRA. Ceiling is his 90th percentile night. The prop is his biggest model edge at -200 or longer (it qualifies for the promo); a dash means none, so any qualifying prop of his works.</p>
        </div>
        <div className={s.tw}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Player</th>
                <th>King</th>
                <th>Top 3</th>
                <th>Proj PRA</th>
                <th>Ceiling</th>
                <th>Prop to tag</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const g = n.games.find((x) => x.id === r.game);
                const a = attach(boards, r.name);
                return (
                  <tr key={r.id}>
                    <td>
                      {r.name} <span className={s.dim}>{`${r.team}${g ? ` · ${g.away} at ${g.home}` : ""}`}</span>
                    </td>
                    <td className={s.num}>{pct(r.p)}</td>
                    <td className={s.num}>{pct(r.top3)}</td>
                    <td className={s.num}>{r.pra.toFixed(1)}</td>
                    <td className={s.num}>{r.p90}</td>
                    <td className={s.num}>{a ? `${a.text} · edge ${Math.round(a.gap * 100)} pts` : "·"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {last && <LastNight n={last} />}
      <Explainer />
      <Backtest />
    </section>
  );
}

function LastNight({ n }: { n: KotcNight }) {
  const r = n.result!;
  return (
    <p className={s.calm}>
      {`${n.date}: ${r.kings.map((k) => `${k.name} (${k.team})`).join(" and ")} led with ${r.pra} PRA. We gave ${r.kings.length > 1 ? "them" : "him"} ${pct(r.p)}${r.rank ? `, ${ordinal(r.rank)} on our board` : ", off our board"}. Our favorite, ${r.favorite.name}, had ${r.favorite.pra ?? "no"} PRA.`}
    </p>
  );
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

export async function KotcResults({ season }: { season: number }) {
  const nights = await getKotcNights(season).catch(() => null);
  if (!nights) return <p className={s.calm}>King of the Court couldn&apos;t be read just now.</p>;
  const graded = nights.filter((x) => x.result);
  const n = graded.length;
  const favWon = graded.filter((x) => x.result!.kings.some((k) => k.id === x.board.rows[0]?.id)).length;
  const favP = n ? graded.reduce((a, x) => a + x.result!.favorite.p, 0) / n : 0;
  const ll = n ? graded.reduce((a, x) => a + x.result!.logLoss, 0) / n : 0;
  const flat = n ? graded.reduce((a, x) => a + Math.log(Math.max(1, x.board.rows.length)), 0) / n : 0;
  const top5 = graded.filter((x) => x.result!.rank > 0 && x.result!.rank <= 5).length;
  return (
    <section className={s.section} aria-labelledby="kotc-results">
      <Hero
        eyebrow="King of the Court · results"
        title={<span id="kotc-results">{n ? `${n} night${n === 1 ? "" : "s"} graded` : "No nights graded yet"}</span>}
        sub="Every night with a saved board is graded, promo or not, against the board as it stood at the first tip."
      />
      <Stats
        label="Record"
        items={[
          { k: "Favorite led", v: n ? `${favWon} of ${n}` : "·", sub: n ? `we gave him ${pct(favP)} on average` : "first grade pending" },
          { k: "King in our top 5", v: n ? `${top5} of ${n}` : "·", sub: "nights" },
          { k: "Log loss", v: n ? ll.toFixed(2) : "·", sub: n ? `everyone equal would be ${flat.toFixed(2)}; lower is better` : "", small: true },
          { k: "Backtest", v: "30% / 32%", sub: "favorite led vs chance given, 55 nights of 2025-26", small: true },
        ]}
      />
      {n > 0 && (
        <div className={s.tw}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Night</th>
                <th>King</th>
                <th>PRA</th>
                <th>We gave</th>
                <th>Our rank</th>
                <th>Our favorite</th>
              </tr>
            </thead>
            <tbody>
              {graded.map((x) => (
                <tr key={x.date}>
                  <td className={s.num}>{x.date}</td>
                  <td>{x.result!.kings.map((k) => k.name).join(", ")}</td>
                  <td className={s.num}>{x.result!.pra}</td>
                  <td className={s.num}>{pct(x.result!.p)}</td>
                  <td className={s.num}>{x.result!.rank || "·"}</td>
                  <td>
                    {x.result!.favorite.name} <span className={s.dim}>{`${pct(x.result!.favorite.p)} · ${x.result!.favorite.pra ?? "·"} PRA`}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Backtest />
    </section>
  );
}
