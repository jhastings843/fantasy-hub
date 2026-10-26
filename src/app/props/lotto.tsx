// Lottos (NBA): a paper-only shadow of the 3-leg "N+ points" parlays
// @TheModelManSam posts (Jack, 2026-10-26). Today: tonight's ticket from our
// props model and the best-value long rungs. Results: every long rung graded
// (do our long-shot chances beat DK's?) and every night's ticket.
import { allBoards } from "@/lib/models/nba/store";
import { LEGS, STAKE, rungsOf, summarize, tickets, type Rung, type Ticket } from "@/lib/models/nba/lotto";
import { etDate, implied } from "@/lib/props/parse";
import { Background, Hero, Stats } from "../picks/board";
import s from "../picks/picks.module.css";

const pct = (x: number) => (x >= 0.1 ? `${Math.round(x * 100)}%` : `${(x * 100).toFixed(1)}%`);
const am = (p: number) => (p > 0 ? `+${p.toLocaleString("en-US")}` : `${p}`);
const SHORT: { [k: string]: string } = { pts: "pts", reb: "reb", ast: "ast", threes: "threes" };
const leg = (r: Rung) => `${r.player} ${Math.ceil(r.line)}+ ${SHORT[r.stat] ?? r.stat}`;
const u = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}u`;
const ROWS = 15;

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
        last pregame read, so a late game&apos;s leg can carry news from after the first tip. Never emailed or bet.
      </p>
    </Background>
  );
}

function TicketCard({ t, title }: { t: Ticket; title: string }) {
  return (
    <div className={s.section}>
      <div className={s.sectionHead}>
        <h3 className={s.h2}>{title}</h3>
        <p className={s.p}>{`${am(t.price)} · we give it ${pct(t.chance)}, DraftKings ${pct(t.book)}${t.outcome ? ` · ${t.outcome === "W" ? "HIT" : "missed"}` : ""}`}</p>
      </div>
      <div className={s.tw}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Leg</th>
              <th>Price</th>
              <th>Ours</th>
              <th>DK</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {t.legs.map((r) => (
              <tr key={`${r.id}|${r.line}`}>
                <td>
                  {leg(r)} <span className={s.dim}>{r.matchup}</span>
                </td>
                <td className={s.num}>{am(r.over)}</td>
                <td className={s.num}>{pct(r.ours)}</td>
                <td className={s.num}>{pct(implied(r.over))}</td>
                <td className={s.num}>{r.hit === null ? "·" : r.hit === "void" ? "void" : `${r.actual} ${r.hit ? "✓" : "✗"}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export async function LottoToday({ season }: { season: number }) {
  const d = await load(season);
  if (!d) return <p className={s.calm}>Lottos couldn&apos;t be read just now.</p>;
  const today = etDate(new Date());
  const t = d.tickets.find((x) => x.date === today) ?? null;
  const top = d.rungs.filter((r) => r.date === today && r.hit === null && r.ev > 0).sort((a, b) => b.ev - a.ev).slice(0, ROWS);
  const last = d.tickets.find((x) => x.date < today && x.outcome);
  return (
    <section className={s.section} aria-labelledby="lotto-today">
      <Hero
        eyebrow={`Lottos · ${today} · paper only`}
        title={<span id="lotto-today">{t ? `Tonight's ticket: ${am(t.price)}` : "No ticket yet tonight"}</span>}
        sub={t ? `${LEGS} legs from ${LEGS} games. Updates with every props read until each game tips.` : `Needs a long rung with value in ${LEGS} different games; boards fill in as DraftKings posts its ladders (usually by mid-afternoon Eastern).`}
      />
      {t && <TicketCard t={t} title="The ticket" />}
      {last && <p className={s.calm}>{`${last.date}: ${last.legs.map(leg).join(", ")} at ${am(last.price)}, ${last.outcome === "W" ? "HIT" : `missed (${last.legs.filter((l) => l.hit === true).length} of ${LEGS} legs)`}.`}</p>}
      {top.length > 0 && (
        <div className={s.section}>
          <div className={s.sectionHead}>
            <h3 className={s.h2}>Best-value long rungs tonight</h3>
            <p className={s.p}>Value is our chance times DraftKings&apos; payout, less 1: +0.20 means 20 cents a dollar at our number. Players with 3+ games this season.</p>
          </div>
          <div className={s.tw}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Rung</th>
                  <th>Price</th>
                  <th>Ours</th>
                  <th>DK</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {top.map((r) => (
                  <tr key={`${r.id}|${r.line}`}>
                    <td>
                      {leg(r)} <span className={s.dim}>{r.matchup}</span>
                    </td>
                    <td className={s.num}>{am(r.over)}</td>
                    <td className={s.num}>{pct(r.ours)}</td>
                    <td className={s.num}>{pct(implied(r.over))}</td>
                    <td className={s.num}>{`${r.ev >= 0 ? "+" : ""}${r.ev.toFixed(2)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
  return (
    <section className={s.section} aria-labelledby="lotto-results">
      <Hero
        eyebrow="Lottos · results · paper only"
        title={<span id="lotto-results">{r.n ? `${r.n.toLocaleString("en-US")} long rungs graded` : "Nothing graded yet"}</span>}
        sub="Tracking started Oct 26, 2026. The rung record is the real test; the tickets will take most of a season to say anything."
      />
      <Stats
        label="Record"
        items={[
          { k: "Rungs hit", v: r.n ? `${r.hits} of ${r.n}` : "·", sub: r.n ? `we expected ${r.ours.toFixed(0)}, DK's prices ${r.book.toFixed(0)}` : "first grade pending" },
          { k: "Value rungs, 1u each", v: r.edge.n ? u(r.edge.net) : "·", sub: r.edge.n ? `${r.edge.hits} of ${r.edge.n} hit` : "", small: true },
          { k: "Tickets", v: t.n ? `${t.won} of ${t.n}` : "·", sub: t.n ? `we expected ${t.expected.toFixed(2)} hits` : "", small: true },
          { k: `Tickets at ${STAKE}u`, v: t.n ? u(t.net) : "·", sub: "", small: true },
        ]}
      />
      {r.n > 0 && (
        <div className={s.section}>
          <div className={s.sectionHead}>
            <h3 className={s.h2}>Are our long-shot chances right?</h3>
            <p className={s.p}>Rungs grouped by the chance we gave them. If ours sits closer to the actual hit rate than DraftKings&apos; does, the edge is real.</p>
          </div>
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
      {graded.slice(0, 10).map((x) => (
        <TicketCard key={x.date} t={x} title={x.date} />
      ))}
      <Explainer />
    </section>
  );
}
