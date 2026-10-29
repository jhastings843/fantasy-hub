// Lottos (NBA): a paper-only shadow of the 3-leg "N+ points" parlays
// @TheModelManSam posts (Jack, 2026-10-26). Same layout as the other Props
// boards (week.tsx): tonight's ticket and the best-value long rungs as edge
// cards, every game, graded nights, the four numbers and the gate. Results:
// every long rung graded (do our long-shot chances beat DK's?).
import { allBoards, getNbaSectionLearning } from "@/lib/models/nba/store";
import { SECTIONS, rungStaked, ticketStaked } from "@/lib/models/sections";
import { LEGS, STAKE, recipeRecords, rungsOf, summarize, tickets, type Rung, type Ticket } from "@/lib/models/nba/lotto";
import { etDate, implied, payout } from "@/lib/props/parse";
import { Background, SecHead } from "../picks/board";
import { EdgeCard, Gate, GameTable, PropStats, type Edge, type GameRowData } from "./week";
import { LearnerLogBody } from "./top";
import { Tile } from "./ournba";
import s from "../picks/picks.module.css";

const pct = (x: number) => (x >= 0.1 ? `${Math.round(x * 100)}%` : `${(x * 100).toFixed(1)}%`);
const am = (p: number) => (p > 0 ? `+${p.toLocaleString("en-US")}` : `${p}`);
const SHORT: { [k: string]: string } = { pts: "pts", reb: "reb", ast: "ast", threes: "threes" };
const leg = (r: Rung) => `${r.player} ${Math.ceil(r.line)}+ ${SHORT[r.stat] ?? r.stat}`;
const u = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}u`;
const TOP = 6;
const nowMs = () => Date.now();

async function load(season: number) {
  const boards = await allBoards(season).catch(() => null);
  if (!boards) return null;
  const rungs = rungsOf(boards);
  return { rungs, tickets: tickets(rungs) };
}

function Explainer() {
  return (
    <Background title="What this is, and why it is paper only">
      <p className={s.p}>
        Sam&apos;s lottos are three &quot;N+ points&quot; legs from three games at +300 to +800 each, multiplied into a +18,000 to
        +23,000 ticket: DraftKings&apos; own odds put a hit near 1 in 200. Books take their biggest cut on long shots, so with a
        10 to 20% cut per leg and no edge, a ticket loses 25 to 42 cents on the dollar on average (computed). It only pays over time if
        our chances on those long rungs beat DraftKings&apos;.
      </p>
      <p className={s.p}>
        So the real test is the rung table on Results: every long rung DraftKings posts (+250 to +2000 on the full-game ladder) graded
        against the box score, thousands a week. The nightly ticket is the fun part: the best-value rung in each game (our chance times
        DK&apos;s payout), one per player, top {LEGS} games, {STAKE}u at the product of the prices. It is built from each game&apos;s
        last pregame read, so a late game&apos;s leg can carry news from after the first tip. Never emailed, and not a bet until its learner slice goes live.
      </p>
    </Background>
  );
}

/** A rung as an edge card: our chance against DK's break-even, value = chance x payout - 1. */
const rungEdge = (r: Rung, tag?: string): Edge => ({
  key: `${tag ?? "r"}|${r.game}|${r.id}|${r.line}`,
  player: r.player,
  game: r.matchup.replace("@", " at "),
  when: r.at,
  bet: `${Math.ceil(r.line)}+ ${SHORT[r.stat] ?? r.stat}${tag ? ` · ${tag}` : ""}`,
  ours: r.ours,
  mkt: implied(r.over),
  mktLabel: "DK break-even",
  price: am(r.over),
  gap: r.ours - implied(r.over),
  more: [
    ["Value (chance x payout - 1)", `${r.ev >= 0 ? "+" : ""}${r.ev.toFixed(2)}`],
    ["Model before the pull toward DK", pct(r.raw)],
  ],
  ...(r.hit !== null ? { result: { won: r.hit === "void" ? null : r.hit, text: r.hit === "void" ? "Void" : r.hit ? `Hit · ${r.actual}` : `Missed · ${r.actual}` } } : {}),
});

/** Every rung of a game, as the game row's body. */
function RungTable({ rungs }: { rungs: Rung[] }) {
  return (
    <div className={s.tw}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Rung</th>
            <th>Price</th>
            <th>Ours</th>
            <th>Break-even</th>
            <th>Value</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {rungs.map((r) => (
            <tr key={`${r.id}|${r.line}`}>
              <td>{leg(r)}</td>
              <td className={s.num}>{am(r.over)}</td>
              <td className={s.num}>{pct(r.ours)}</td>
              <td className={s.num}>{pct(implied(r.over))}</td>
              <td className={`${s.num} ${r.ev > 0 ? s.pos : s.dim}`}>{`${r.ev >= 0 ? "+" : ""}${r.ev.toFixed(2)}`}</td>
              <td className={s.num}>{r.hit === null ? "·" : r.hit === "void" ? "void" : `${r.actual} ${r.hit ? "hit" : "missed"}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ticketRow(t: Ticket): GameRowData {
  const legsHit = t.legs.filter((l) => l.hit === true).length;
  return {
    key: `ticket|${t.date}`,
    title: `Ticket ${t.date}`,
    when: t.legs[0]?.at,
    cells: [
      ["Price", am(t.price)],
      ["Ours / DK", `${pct(t.chance)} / ${pct(t.book)}`],
      ["Legs hit", t.outcome ? `${legsHit} of ${t.legs.length}` : "·"],
    ],
    read: !t.outcome ? ["Open", s.readTrack] : t.outcome === "W" ? ["Hit", s.readW] : ["Missed", s.readL],
    body: <RungTable rungs={t.legs} />,
  };
}

/** One graded night: the singles record (every edge rung at 1u) and the parlay of the day, side by side. */
function nightRows(rungs: Rung[], all: Ticket[]): GameRowData[] {
  const byDate = new Map<string, Rung[]>();
  for (const r of rungs) if (r.ev > 0 && (r.hit === true || r.hit === false)) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
  const dates = [...new Set([...byDate.keys(), ...all.filter((t) => t.outcome).map((t) => t.date)])].sort().reverse();
  return dates.map((date) => {
    const singles = (byDate.get(date) ?? []).sort((a, b) => b.ev - a.ev);
    const hits = singles.filter((r) => r.hit === true).length;
    const net = singles.reduce((a, r) => a + (r.hit === true ? payout(r.over) : -1), 0);
    const t = all.find((x) => x.date === date && x.outcome);
    const tNet = t ? (t.outcome === "W" ? STAKE * payout(t.price) : -STAKE) : 0;
    const total = net + tNet;
    return {
      key: `night|${date}`,
      title: new Date(`${date}T16:00:00Z`).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }),
      final: true,
      cells: [
        ["Singles W-L", singles.length ? `${hits}-${singles.length - hits}` : "none"],
        ["Singles units", singles.length ? u(net) : "·"],
        ["Parlay", t ? `${t.outcome === "W" ? "Hit" : "Missed"} ${u(tNet)}` : "none"],
      ],
      read: [`${u(total)} night`, total > 0 ? s.readW : total < 0 ? s.readL : s.readPass],
      body: (
        <>
          {t && (
            <>
              <p className={s.thin}>{`Parlay of the day at ${am(t.price)}: ${t.legs.filter((l) => l.hit === true).length} of ${t.legs.length} legs hit.`}</p>
              <RungTable rungs={t.legs} />
            </>
          )}
          {singles.length > 0 && (
            <>
              <p className={s.thin}>{`Every edge rung as a single, 1u each: ${hits} of ${singles.length} hit, ${u(net)}.`}</p>
              <RungTable rungs={singles} />
            </>
          )}
        </>
      ),
    };
  });
}

export async function LottoToday({ season }: { season: number }) {
  const [d, learning] = await Promise.all([load(season), getNbaSectionLearning(SECTIONS.nbaLotto, season).catch(() => null)]);
  if (!d || !learning) return <p className={s.calm}>Lottos couldn&apos;t be read just now.</p>;
  const now = nowMs();
  const today = etDate(new Date());
  const t = d.tickets.find((x) => x.date === today) ?? null;
  const todays = d.rungs.filter((r) => r.date === today);
  // A live slice's rungs are bets and always shown; tracked rungs fill the rest of the top.
  const open = todays.filter((r) => r.hit === null && r.ev > 0 && Date.parse(r.at) > now);
  const bets = open.filter((r) => rungStaked(learning.entries, r)).length;
  const best = open.sort((a, b) => Number(rungStaked(learning.entries, b)) - Number(rungStaked(learning.entries, a)) || b.ev - a.ev).slice(0, Math.max(TOP, bets));
  const ticketBet = !!t && ticketStaked(learning.entries, t.legs[0]?.at);
  const live = learning.entries.filter((e) => e.status === "active").map((e) => e.label);
  const byGame = new Map<string, Rung[]>();
  for (const r of todays) byGame.set(r.game, [...(byGame.get(r.game) ?? []), r]);
  // Games still to be graded; graded nights live on Results (Jack, 2026-10-27).
  const games: GameRowData[] = [...byGame.values()]
    .filter((rs) => rs.some((r) => r.hit === null))
    .sort((a, b) => a[0].at.localeCompare(b[0].at))
    .map((rs) => {
      const value = rs.filter((r) => r.ev > 0).sort((a, b) => b.ev - a.ev);
      return {
        key: rs[0].game,
        title: rs[0].matchup.replace("@", " at "),
        ...(rs[0].matchup.includes("@") ? { match: { league: "nba" as const, away: rs[0].matchup.split("@")[0].trim(), home: rs[0].matchup.split("@")[1].trim() } } : {}),
        when: rs[0].at,
        live: Date.parse(rs[0].at) <= now && rs.every((r) => r.hit === null),
        cells: [
          ["Rungs", `${rs.length}`],
          ["With value", `${value.length}`],
          ["Best", value[0] ? `${leg(value[0])} ${am(value[0].over)}` : "·"],
        ],
        read: value.length ? [`${value.length} with value`, s.readTrack] : ["No value", s.readPass],
        body: <RungTable rungs={[...rs].sort((a, b) => b.ev - a.ev)} />,
      };
    });
  const sum = summarize(d.rungs, d.tickets);
  const tk = sum.tickets;
  return (
    <section className={s.section} aria-labelledby="lotto-today">
      <div className={s.pageFrame}>
        <SecHead id="lotto-today" title={t ? `Tonight's ticket · ${am(t.price)}` : "Tonight's ticket"} aside={t ? `We give it ${pct(t.chance)}, DraftKings ${pct(t.book)} · ${STAKE}u, ${ticketBet ? "a bet (its slice is live)" : "paper only"}` : "Needs a rung with value in 3 games"} />
        {t ? (
          <ul className={s.edgeGrid} data-first-pick>
            {t.legs.map((r, i) => (
              <EdgeCard key={`leg${i}`} e={{ ...rungEdge(r, `leg ${i + 1}`), staked: ticketBet }} />
            ))}
          </ul>
        ) : (
          <p className={s.calm}>No ticket yet tonight. Boards fill in as DraftKings posts its ladders, usually by mid-afternoon Eastern.</p>
        )}
      </div>
      <div className={s.pageFrame}>
        <SecHead title={bets ? "Bets and tracked edges" : "Tracked edges"} aside={bets ? `${bets} bet${bets === 1 ? "" : "s"} from live slices (${live.join("; ")}) · the rest tracked` : "Best-value long rungs tonight · no stakes"} />
        {best.length ? (
          <ul className={s.edgeGrid}>
            {best.map((r) => (
              <EdgeCard key={`${r.game}|${r.id}|${r.line}`} e={{ ...rungEdge(r), staked: rungStaked(learning.entries, r) }} />
            ))}
          </ul>
        ) : (
          <p className={s.calm}>No long rung with value on games still to tip.</p>
        )}
      </div>
      <div className={s.pageFrame}>
        <SecHead title="Every game" aside="Tonight's games until graded, soonest first · open one for every long rung" />
        {games.length ? <GameTable head={["Rungs", "With value", "Best"]} rows={games} /> : <p className={s.calm}>No long rungs saved for tonight yet.</p>}
      </div>
      <div className={s.pageFrame}>
        <SecHead title="How it is doing" aside={live.length ? "Value rungs at 1u; bets once a slice went live" : "Tracked, never staked"} />
        <PropStats
          edges={best.length}
          graded={{ w: sum.rungs.edge.hits, l: sum.rungs.edge.n - sum.rungs.edge.hits, p: 0, units: sum.rungs.edge.net }}
          learning={learning}
          logHref="/props?m=lotto&v=log"
          unit="value rungs still to tip"
          extra={{ k: "Parlay of the day", v: tk.n ? u(tk.net) : "0-0", sub: tk.n ? `${tk.won}-${tk.n - tk.won} at ${STAKE}u a ticket` : "first ticket pending", tone: tk.n ? (tk.net >= 0 ? "up" : "down") : undefined }}
        />
      </div>
      <Gate learning={learning} label="lotto" />
      <Explainer />
    </section>
  );
}

export async function LottoResults({ season }: { season: number }) {
  const d = await load(season);
  if (!d) return <p className={s.calm}>Lottos couldn&apos;t be read just now.</p>;
  const sum = summarize(d.rungs, d.tickets);
  const r = sum.rungs;
  const t = sum.tickets;
  const graded = d.tickets.filter((x) => x.outcome);
  const nights = nightRows(d.rungs, d.tickets);
  return (
    <section className={s.section} aria-labelledby="lotto-results">
      <div className={s.pageFrame}>
        <SecHead id="lotto-results" title="Two records" aside="Since Oct 26, 2026 · the singles record is the real test; the parlay needs most of a season" />
        <div className={s.tiles}>
          <Tile value={r.edge.n ? u(r.edge.net) : "·"} label={r.edge.n ? `Singles: every edge rung at 1u · ${r.edge.hits}-${r.edge.n - r.edge.hits}` : "Singles: every edge rung at 1u · first grades pending"} />
          <Tile value={t.n ? u(t.net) : "·"} label={t.n ? `Parlay of the day at ${STAKE}u · ${t.won}-${t.n - t.won}, we expected ${t.expected.toFixed(2)} hits` : `Parlay of the day at ${STAKE}u · first ticket pending`} />
          <Tile value={r.n ? `${r.hits} of ${r.n}` : "·"} label={r.n ? `every long rung hit · we expected ${r.ours.toFixed(0)}, DK's prices ${r.book.toFixed(0)}` : "every long rung · first grades pending"} />
        </div>
      </div>
      {nights.length > 0 && (
        <div className={s.pageFrame}>
          <SecHead title="Night by night" aside="Newest first · both records each night · open a night for the ticket and every edge rung" />
          <GameTable head={["Singles W-L", "Singles units", "Parlay"]} rows={nights} />
        </div>
      )}
      {r.n > 0 && (
        <div className={s.pageFrame}>
          <SecHead title="Are our long-shot chances right?" aside="Rungs grouped by the chance we gave them" />
          <div className={s.tw}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Our chance</th>
                  <th>Rungs</th>
                  <th>Hit</th>
                  <th>Ours said</th>
                  <th>DK said</th>
                </tr>
              </thead>
              <tbody>
                {sum.bands
                  .filter((b) => b.n)
                  .map((b) => (
                    <tr key={b.band}>
                      <td>{b.band}</td>
                      <td className={s.num}>{b.n}</td>
                      <td className={s.num}>{pct(b.hits / b.n)}</td>
                      <td className={s.num}>{pct(b.ours / b.n)}</td>
                      <td className={s.num}>{pct(b.book / b.n)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <RecipeTable rungs={d.rungs} />
      {graded.length > 0 && (
        <div className={s.pageFrame}>
          <SecHead title="Every parlay of the day" aside="Newest first · open one for its legs" />
          <GameTable head={["Price", "Ours / DK", "Legs hit"]} rows={graded.map(ticketRow)} />
        </div>
      )}
      <Explainer />
    </section>
  );
}

export async function LottoLog({ season }: { season: number }) {
  const learning = await getNbaSectionLearning(SECTIONS.nbaLotto, season).catch(() => null);
  if (!learning) return <p className={s.calm}>The lotto learner couldn&apos;t be read just now.</p>;
  return <LearnerLogBody want="Lottos" items={[{ name: "Lottos", learning }]} gateText="60+ games over 4+ weeks and 12+ winners (long prices)" />;
}

/** Every ticket recipe side by side (lotto.ts RECIPES): tracked only, fixed up front, the original first. */
function RecipeTable({ rungs }: { rungs: Rung[] }) {
  const rows = recipeRecords(rungs, etDate(new Date()));
  return (
    <div className={s.pageFrame}>
      <SecHead title="Ticket recipes" aside={`${rows.length} built every night, paper only, ${STAKE}u each`} />
      <p className={s.p}>
        Same rungs, different ways to build the ticket: 2 to 5 legs, each leg the game&apos;s best value, likeliest or longest price
        (value rungs only). The list was fixed before any results, so the winner can&apos;t be picked after the fact. Two Sam-style
        tickets joined on Oct 28: 3 points legs at +300 to +700 picked on our raw model (near +20,000), and a watered-down copy with the
        same players on their shortest points rung. With this many recipes one will look good by luck: trust a recipe only when its hits
        run ahead of what our chances expected over many nights.
      </p>
      <div className={s.tw}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Recipe</th>
              <th>Hit</th>
              <th>Net</th>
              <th>Tonight</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x, i) => (
              <tr key={x.recipe.id}>
                <td>
                  {x.recipe.label}
                  {i === 0 && <div className={s.thin}>the original</div>}
                </td>
                <td className={s.num}>
                  {x.n ? `${x.won} of ${x.n}` : "·"}
                  {x.n > 0 && <div className={s.thin}>{`expected ${x.expected.toFixed(2)}`}</div>}
                </td>
                <td className={`${s.num} ${x.net > 0 ? s.pos : x.net < 0 ? s.neg : ""}`}>{x.n ? u(x.net) : "·"}</td>
                <td className={s.num}>{x.tonight !== undefined ? am(x.tonight) : "·"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
