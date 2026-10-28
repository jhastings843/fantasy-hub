// King of the Court (NBA): DraftKings' promo where a tagged prop bet on the
// night's points + rebounds + assists leader splits a pool of bonus bets.
// Today: our chance for every player to lead the slate (lib/models/nba/kotc),
// the prop of his we'd attach, and how to read the pool. Results: every
// graded night against the board as it stood at the first tip.
import { allBoards, getNbaSectionLearning, getOurNbaView, type OurStoredProps } from "@/lib/models/nba/store";
import { bestTag, gradeTag, type KotcTag } from "@/lib/models/nba/kotc-tag";
import KOTC from "@/lib/models/nba/kotc-params.json";
import { implied, payout } from "@/lib/props/parse";
import { SECTIONS, kotcStakedTop } from "@/lib/models/sections";
import { LearnerLogBody } from "./top";
import { getKotcNights, type KotcNight } from "@/lib/models/nba/kotc-store";
import { whenEt } from "../picks/ui";
import { Background, Hero, SecHead, Stats } from "../picks/board";
import { GameTable, type GameRowData } from "./week";
import s from "../picks/picks.module.css";
import k from "./props.module.css";

const pct = (x: number) => (x >= 0.1 ? `${Math.round(x * 100)}%` : `${(x * 100).toFixed(1)}%`);
const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const SHORT: { [k: string]: string } = { pts: "pts", reb: "reb", ast: "ast", threes: "threes" };
const ROWS = 30;
/** Cards up top: the best tags tonight. */
const CARDS = 3;
/** DK's standard pool, the minimum tagged bet, and what a bonus bet converts to (estimate, see the explainer). */
const POOL = 1_000_000;
const STAKE_USD = 5;
const BONUS_CASH = 0.7;
const nowMs = () => Date.now();
const usd = (x: number) => `${x < 0 ? "−" : ""}$${Math.abs(x).toFixed(2)}`;
const tagText = (t: KotcTag) => `${t.side === "over" ? "Over" : "Under"} ${t.m.line} ${SHORT[t.m.stat ?? ""] ?? t.m.statLabel}`;

/**
 * Who the crowd backs, from the fit on DK's posted payouts (kotc-params.json
 * crowd: backers per pool = e^a x chance^b, 18 paid nights). Each player's share
 * of tonight's tags is his e^a x p^b over the slate's total. Estimate.
 */
function crowdShares(rows: { id: string; p: number }[]): Map<string, number> {
  const w = rows.map((r) => Math.pow(Math.max(r.p, 1e-6), KOTC.crowd.b));
  const tot = w.reduce((a, x) => a + x, 0) || 1;
  return new Map(rows.map((r, i) => [r.id, w[i] / tot]));
}

/** What one $5 tag is worth (estimate): the bonus-bet pool share if he is king, plus the prop's own expected profit. */
function tagValue(p: number, t: KotcTag | null): { bonus: number; prop: number; total: number } {
  const backers = Math.exp(KOTC.crowd.a) * Math.pow(Math.max(p, 1e-6), KOTC.crowd.b);
  const bonus = (BONUS_CASH * POOL * p) / Math.max(backers, 1);
  const prop = t ? STAKE_USD * (t.ours * (1 + payout(t.price)) - 1) : 0;
  return { bonus, prop, total: bonus + prop };
}

/** Our chance and the crowd's share as two bars on one scale. */
function KingBars({ ours, crowd, top }: { ours: number; crowd: number; top: number }) {
  const w = (x: number) => `${Math.max(2, Math.min(90, (x / top) * 90)).toFixed(0)}px`;
  return (
    <span className={k.kBars} aria-label={`Ours ${pct(ours)}, crowd ${pct(crowd)} (estimate)`}>
      <span className={k.kBarRow}>
        <i className={k.kBarOurs} style={{ width: w(ours) }} />
        <b>{pct(ours)}</b>
      </span>
      <span className={k.kBarRow}>
        <i className={k.kBarCrowd} style={{ width: w(crowd) }} />
        <span>{pct(crowd)}</span>
      </span>
    </span>
  );
}

function Explainer() {
  return (
    <Background title="How the promo pays, and how to read this board">
      <p className={s.p}>
        Opt in on DraftKings&apos; promotions page, bet any player prop (or a same-player parlay) priced -200 or longer on every leg, $5
        or more, and tag it as your King of the Court bet. One token per customer. If that player has the most points + rebounds +
        assists on the night, everyone who tagged him splits the pool in bonus bets (ties split it across every tied player&apos;s
        backers), paid within 24 hours and good for 7 days. The prop itself wins or loses on its own. No per-winner cap: past payouts
        run to $2,174.
      </p>
      <p className={s.p}>
        The pool is shared, so the likeliest king is not automatically the best tag. On the 18 paid nights we could match to last
        season&apos;s replay, the number of people backing the winner rose almost exactly in step with the chance we had given him
        (backers ≈ 92,000 × our chance on a $1M pool, R² 0.66). So on average the crowd prices the favorites right and every tag is
        worth about the same: roughly $7.60 of bonus-bet cash value per $1M of pool (a bonus bet converts to about 70 cents; estimate).
        The edge is in single players the crowd misses: Banchero (we gave 14%, 2,466 backers, paid $811) against Wembanyama (we
        gave 4.6%, 15,873 backers). Lesser names with a big chance are the tags to look for; a household name at the same chance is
        likely over-backed.
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
        Replayed night by night on 2025-26 with only what was known before each night: fit on the 76 nights before Jan 15, judged on
        the 82 after it, which the fit never saw. Chances from 0 to 30% landed close (players we gave 3 to 7% led 5.0% of the time,
        n 402; 15 to 30% led 21.9% against 21.3%, n 73). Favorites ran hot: our favorite led 22% of nights against 29% given, and
        players we gave 30%+ led 35% against 40% (n 31), so read a big favorite&apos;s number a few points lower. The winning PRA
        averaged 54.9 against our median of 55.5. Log loss 2.677, level with independent players (2.676) and better than a plain
        ranking on projected PRA (2.775).
      </p>
    </Background>
  );
}

export async function KotcWeek({ season }: { season: number }) {
  const [nights, v, learning] = await Promise.all([getKotcNights(season).catch(() => null), getOurNbaView(season).catch(() => null), getNbaSectionLearning(SECTIONS.nbaKotc, season).catch(() => null)]);
  if (!nights) return <p className={s.calm}>King of the Court couldn&apos;t be read just now.</p>;
  const now = nowMs();
  const n = [...nights].sort((a, b) => a.date.localeCompare(b.date)).find((x) => !x.result && Date.parse(x.firstTip) > now - 6 * 3_600_000) ?? null;
  const last = nights.find((x) => x.result);
  if (!n || !n.board.rows.length)
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
  const crowd = crowdShares(n.board.rows);
  // Every player in our top 30 gets a prop to tag (Jack, 2026-10-27), edge or not: a tag only counts with a bet on him.
  const rows = n.board.rows.slice(0, ROWS).map((r, i) => {
    const t = bestTag(boards, r.name);
    return { r, i, t, crowd: crowd.get(r.id) ?? 0, value: tagValue(r.p, t) };
  });
  // Cards come from reads with 3+ games this season when there are any: earlier numbers lean on last season, and their big "edges" are mostly that.
  const settled = rows.filter((x) => x.t && !x.t.early);
  const best = [...(settled.length >= CARDS ? settled : rows.filter((x) => x.t))].sort((a, b) => b.value.total - a.value.total).slice(0, CARDS);
  const scale = Math.max(top.p, ...rows.map((x) => x.crowd));
  // A live learner slice turns our top N's tagged props into bets (Jack, 2026-10-26).
  const betTop = learning ? kotcStakedTop(learning.entries, n.firstTip) : 0;
  const tagged = rows.filter((x) => x.t).length;
  return (
    <section className={s.section} aria-labelledby="kotc-today">
      <Hero
        eyebrow={`King of the Court · ${n.date}`}
        title={<span id="kotc-today">{best[0] ? `Best tag: ${best[0].r.name}, ${tagText(best[0].t!)}` : `${top.name} leads at ${pct(top.p)}`}</span>}
        sub={`${n.games.length} game${n.games.length === 1 ? "" : "s"}${n.slateGames > n.games.length ? ` of ${n.slateGames} on the slate (the rest had no props yet)` : ""}, ${n.board.rows.length} players. ${started ? "Frozen at the first tip" : `Updates until the first tip, ${whenEt(n.firstTip)}`}; saved ${whenEt(n.at)}.`}
      />
      <Stats
        label="Tonight's slate"
        items={[
          { k: "Favorite", v: pct(top.p), sub: top.name },
          { k: "Winning PRA", v: `${n.board.winning.p50}`, sub: `middle 80%: ${n.board.winning.p10} to ${n.board.winning.p90}` },
          { k: "Top 30 with a tag", v: `${tagged} of ${rows.length}`, sub: "a prop at -200 or longer", small: true },
          { k: "Last night", v: last?.result ? `${last.result.kings[0]?.name.split(" ").slice(-1)[0]} ${last.result.pra}` : "·", sub: last?.result ? `we had him ${pct(last.result.p)}` : "first grade pending", small: true },
        ]}
      />
      {best.length > 0 && (
        <div className={s.pageFrame}>
          <SecHead title="Best tags tonight" aside={betTop ? `A learner slice is live: our top ${betTop === 1 ? "pick's" : `${betTop}'s`} props are bets` : "Tracked only · ranked by what one $5 tag is worth (estimate)"} />
          <ul className={k.kCards} data-first-pick>
            {best.map((x, j) => (
              <li key={x.r.id} className={`${k.kCard} ${j === 0 ? k.kCardTop : ""}`}>
                <div className={k.kCardHead}>
                  <span className={k.kRank}>{`#${j + 1} tag`}</span>
                  <span className={k.kMeta}>{`${x.r.team} · our #${x.i + 1} to be king`}</span>
                </div>
                <div className={k.kWho}>{x.r.name}</div>
                <div className={k.kTag}>
                  {tagText(x.t!)} <span className={k.kPrice}>{am(x.t!.price)}</span>
                </div>
                <dl className={k.kTrio}>
                  <div>
                    <dt>King, ours / crowd</dt>
                    <dd>{`${pct(x.r.p)} / ${pct(x.crowd)}`}</dd>
                  </div>
                  <div>
                    <dt>Prop, ours / DK</dt>
                    <dd>{`${pct(x.t!.ours)} / ${pct(x.t!.fair ?? implied(x.t!.price))}`}</dd>
                  </div>
                  <div>
                    <dt>$5 tag worth</dt>
                    <dd className={x.value.total >= 0 ? s.pos : s.neg}>{usd(x.value.total)}</dd>
                  </div>
                </dl>
                <p className={k.kNote}>{`${x.t!.edge ? "A tracked edge on the props board" : x.t!.gap > 0 ? "Above DK's break-even, though not an edge the props board tracks" : "No edge; the least bad qualifying prop"} (${x.t!.gap >= 0 ? "+" : ""}${(x.t!.gap * 100).toFixed(1)} vs break-even)${x.t!.early ? ", read from under 3 games this season" : ""}. Bonus share ${usd(x.value.bonus)}, prop ${usd(x.value.prop)}.`}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className={s.pageFrame}>
        <SecHead title="Top 30: chance to be king and the prop to tag" aside="Ours in color, the crowd's share in gold (estimate) · edge is ours minus DK's break-even" />
        <div className={s.tw}>
          <table className={`${s.table} ${k.kTable}`}>
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>King: ours / crowd</th>
                <th className={s.hideSm}>Proj PRA</th>
                <th>Prop to tag</th>
                <th>Ours / DK no-vig</th>
                <th>Edge</th>
                <th className={s.hideSm}>$5 tag</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                const g = n.games.find((y) => y.id === x.r.game);
                const hot = best.some((b) => b.r.id === x.r.id);
                return (
                  <tr key={x.r.id} className={hot ? k.kHot : undefined}>
                    <td className={s.num}>{x.i + 1}</td>
                    <td>
                      <b>{x.r.name}</b>
                      <div className={s.dim}>{`${x.r.team}${g ? ` · ${g.away} at ${g.home}` : ""}`}</div>
                    </td>
                    <td>
                      <KingBars ours={x.r.p} crowd={x.crowd} top={scale} />
                    </td>
                    <td className={`${s.num} ${s.hideSm}`}>
                      {x.r.pra.toFixed(1)}
                      <div className={s.dim}>{`ceiling ${x.r.p90}`}</div>
                    </td>
                    <td className={s.num}>
                      {x.t ? (
                        <>
                          <b>{tagText(x.t)}</b> <span className={s.dim}>{am(x.t.price)}</span>
                          {x.i < betTop && <b className={s.pos}> · Bet</b>}
                        </>
                      ) : (
                        <span className={s.dim}>no prop at -200 or longer yet</span>
                      )}
                    </td>
                    <td className={s.num}>{x.t ? `${pct(x.t.ours)} / ${x.t.fair !== null ? pct(x.t.fair) : "·"}` : "·"}</td>
                    <td className={s.num}>{x.t ? <span className={`${k.kEdge} ${x.t.gap > 0 ? k.kEdgePos : k.kEdgeNeg}`}>{`${x.t.gap >= 0 ? "+" : "−"}${Math.abs(x.t.gap * 100).toFixed(1)}`}</span> : "·"}</td>
                    <td className={`${s.num} ${s.hideSm} ${x.value.total >= 0 ? s.pos : s.neg}`}>{x.t ? usd(x.value.total) : "·"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className={s.thin}>
          {`Crowd share and tag value are estimates: the crowd from DraftKings' posted payouts on 18 nights (backers rose in step with our chance, R² ${KOTC.crowd.r2}), the bonus at a $1M pool and 70 cents a bonus dollar, the prop at our chance and DK's price on a $5 bet. The crowd fit can't see fame: a household name is likely backed more than shown.${betTop ? "" : " Tracked only: no prop here is a bet until a learner slice clears its gate."}`}
        </p>
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

/** One graded night: who was king, and our top 10's tagged props as a W-L at 1u. */
function nightRow(x: KotcNight, boards: OurStoredProps[]): GameRowData {
  const r = x.result!;
  const mine = boards.filter((b) => x.games.some((g) => g.id === b.espnId));
  const tags = x.board.rows.slice(0, 10).map((row, i) => {
    const t = bestTag(mine, row.name);
    return { row, i, t, g: t ? gradeTag(t) : null };
  });
  const done = tags.filter((y) => y.g);
  const won = done.filter((y) => y.g!.outcome === "W").length;
  const lost = done.filter((y) => y.g!.outcome === "L").length;
  const units = done.reduce((a, y) => a + y.g!.net, 0);
  const kingIn = r.rank > 0 && r.rank <= 10;
  return {
    key: x.date,
    title: new Date(`${x.date}T16:00:00Z`).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }),
    final: true,
    cells: [
      ["King", `${r.kings.map((kk) => kk.name.split(" ").slice(-1)[0]).join(", ")} ${r.pra}`],
      ["We gave", `${pct(r.p)}${r.rank ? ` (#${r.rank})` : ""}`],
      ["Top 10 tags", done.length ? `${won}-${lost}${done.length - won - lost ? `-${done.length - won - lost}` : ""}, ${units >= 0 ? "+" : "−"}${Math.abs(units).toFixed(1)}u` : "none graded"],
    ],
    read: kingIn ? [`King was our #${r.rank}`, s.readW] : [r.rank ? `King was our #${r.rank}` : "King off our board", s.readL],
    body: (
      <div className={s.tw}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>We gave</th>
              <th>Prop tagged</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {tags.map((y) => (
              <tr key={y.row.id}>
                <td className={s.num}>{y.i + 1}</td>
                <td>
                  {y.row.name}
                  {r.kings.some((kk) => kk.id === y.row.id) && <b className={s.pos}> · king</b>}
                </td>
                <td className={s.num}>{pct(y.row.p)}</td>
                <td className={s.num}>{y.t ? `${tagText(y.t)} ${am(y.t.price)}` : <span className={s.dim}>none qualified</span>}</td>
                <td className={s.num}>{y.g ? <b className={y.g.outcome === "W" ? s.pos : y.g.outcome === "L" ? s.neg : undefined}>{`${y.g.outcome === "W" ? "Won" : y.g.outcome === "L" ? "Lost" : "Push"} ${y.g.net >= 0 ? "+" : "−"}${Math.abs(y.g.net).toFixed(2)}u`}</b> : <span className={s.dim}>{y.t ? "void" : "·"}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  };
}

export async function KotcResults({ season }: { season: number }) {
  const [nights, boards] = await Promise.all([getKotcNights(season).catch(() => null), allBoards(season).catch(() => [] as OurStoredProps[])]);
  if (!nights) return <p className={s.calm}>King of the Court couldn&apos;t be read just now.</p>;
  const graded = nights.filter((x) => x.result).sort((a, b) => b.date.localeCompare(a.date));
  const n = graded.length;
  const favWon = graded.filter((x) => x.result!.kings.some((kk) => kk.id === x.board.rows[0]?.id)).length;
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
          { k: "Backtest", v: "22% / 29%", sub: "favorite led vs chance given, 82 nights of 2025-26", small: true },
        ]}
      />
      {n > 0 && (
        <div className={s.pageFrame}>
          <SecHead title="Night by night" aside="Newest first · our top 10's tagged props at 1u · open a night for each tag" />
          <GameTable head={["King", "We gave", "Top 10 tags"]} rows={graded.map((x) => nightRow(x, boards))} />
        </div>
      )}
      <Backtest />
    </section>
  );
}

export async function KotcLog({ season }: { season: number }) {
  const learning = await getNbaSectionLearning(SECTIONS.nbaKotc, season).catch(() => null);
  if (!learning) return <p className={s.calm}>The King of the Court learner couldn&apos;t be read just now.</p>;
  return (
    <LearnerLogBody
      want="King of the Court (the prop we would tag)"
      items={[{ name: "King of the Court", learning }]}
      gateText="30+ nights over 3+ weeks and 100+ tagged props"
      breakEven={0.524}
    />
  );
}
