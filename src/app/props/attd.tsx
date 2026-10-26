// Anytime TD (NFL): our model (lib/models/nfl/anytime.ts) against DraftKings'
// Anytime and 2+ TD prices from ESPN's odds feed. Paper only for now: edges
// are graded flat 1u so a record exists before it makes picks or parlays.
import { getOurFtdView, attdGraded, getAttdLearning } from "@/lib/models/nfl/ftd-store";
import { LearnerLogBody } from "./top";
import { ATTD_EDGE, attdEdges, summarizeAttd, type AttdRow } from "@/lib/models/nfl/anytime";
import { implied } from "@/lib/props/parse";
import { Background, Hero, Stats } from "../picks/board";
import { whenEt } from "../picks/ui";
import s from "../picks/picks.module.css";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const u = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}u`;
const ROWS = 40;
const nowMs = () => Date.now();

function Explainer() {
  return (
    <Background title="How the number is built, and how far to trust it">
      <p className={s.p}>
        Each team&apos;s rushing and receiving TDs are expected at 0.109 per implied point (from DraftKings&apos; total and spread: a
        24-point team expects 2.6). A player gets his share from his TD history this season and last, shrunk toward his share of the
        team&apos;s carries and targets, the same shares our First TD model uses. Anytime = at least one; 2+ = at least two.
      </p>
      <p className={s.p}>
        Tested walk forward on 2,852 player-games of 2025 weeks 10 to 18 and 1,801 of 2026 that the fit never saw: log loss 0.431 and
        0.448 against 0.474 and 0.487 for a flat rate. One known miss: players we give 30 to 50% scored about 8 points less often than
        we said in both test sets (we said 44%, they scored 36%), so an edge has to clear DraftKings&apos; break-even by{" "}
        {Math.round(ATTD_EDGE * 100)} points to count. DraftKings&apos; prices were never archived before 2026-10-26, so whether this
        beats the price is what the Results view will show.
      </p>
    </Background>
  );
}

function Rows({ rows, matchup }: { rows: (AttdRow & { matchup: string })[]; matchup: boolean }) {
  return (
    <div className={s.tw}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Player</th>
            <th>Ours</th>
            <th>DK</th>
            <th>DK break-even</th>
            <th>2+ ours / DK</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const e = attdEdges(r);
            return (
              <tr key={`${r.team}|${r.key}`}>
                <td>
                  {r.name} <span className={s.dim}>{matchup ? `${r.team} · ${r.matchup}` : r.team}</span>
                  {e.length > 0 && <span className={s.dim}>{` · edge ${e.map((x) => `${x.side === "two" ? "2+" : "ATTD"} +${Math.round(x.gap * 100)}`).join(", ")}`}</span>}
                </td>
                <td className={s.num}>{pct(r.anytime)}</td>
                <td className={s.num}>{r.dk !== undefined ? am(r.dk) : "·"}</td>
                <td className={s.num}>{r.dk !== undefined ? pct(implied(r.dk)) : "·"}</td>
                <td className={s.num}>{`${pct(r.two)} / ${r.dk2 !== undefined ? am(r.dk2) : "·"}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export async function AttdWeek({ season }: { season: number }) {
  const v = await getOurFtdView(season).catch(() => null);
  if (!v) return <p className={s.calm}>The Anytime TD board couldn&apos;t be read just now.</p>;
  const now = nowMs();
  const games = v.board.filter((g) => g.attd && (!g.kickoff || Date.parse(g.kickoff) > now - 4 * 3_600_000));
  const all = games.flatMap((g) => g.attd!.rows.map((r) => ({ ...r, matchup: `${g.game.away}@${g.game.home}` })));
  const edges = all.filter((r) => attdEdges(r).length).sort((a, b) => Math.max(...attdEdges(b).map((x) => x.gap)) - Math.max(...attdEdges(a).map((x) => x.gap)));
  const priced = all.filter((r) => r.dk !== undefined).length;
  return (
    <section className={s.section} aria-labelledby="attd-week">
      <Hero
        eyebrow={`Anytime TD · Week ${v.week ?? "?"} · paper only`}
        title={<span id="attd-week">{games.length ? `${edges.length} edge${edges.length === 1 ? "" : "s"} on ${games.length} game${games.length === 1 ? "" : "s"}` : "No board yet this week"}</span>}
        sub={games.length ? `${priced} players priced by DraftKings. Updates with every read until kickoff; next kickoff ${whenEt(games.find((g) => g.kickoff && Date.parse(g.kickoff) > now)?.kickoff ?? games[0].kickoff ?? "")}.` : "Boards start with the next First TD read (the model needs DraftKings' total and spread, and its Anytime TD prices to find edges)."}
      />
      {edges.length > 0 && (
        <div className={s.section}>
          <div className={s.sectionHead}>
            <h3 className={s.h2}>Edges</h3>
            <p className={s.p}>Our chance beats DraftKings&apos; break-even by {Math.round(ATTD_EDGE * 100)}+ points. Graded flat 1u; not bet.</p>
          </div>
          <Rows rows={edges} matchup />
        </div>
      )}
      {games.map((g) => (
        <Background key={g.game.slug} title={`${g.game.away} at ${g.game.home} · ${g.kickoff ? whenEt(g.kickoff) : ""}`}>
          <Rows rows={g.attd!.rows.slice(0, ROWS).map((r) => ({ ...r, matchup: "" }))} matchup={false} />
        </Background>
      ))}
      <Explainer />
    </section>
  );
}

export async function AttdResults({ season }: { season: number }) {
  const graded = await attdGraded(season).catch(() => null);
  if (!graded) return <p className={s.calm}>Anytime TD results couldn&apos;t be read just now.</p>;
  const sum = summarizeAttd(graded);
  const p = sum.priced;
  const e = sum.edges;
  return (
    <section className={s.section} aria-labelledby="attd-results">
      <Hero
        eyebrow="Anytime TD · results · paper only"
        title={<span id="attd-results">{graded.length ? `${graded.length} game${graded.length === 1 ? "" : "s"} graded` : "Nothing graded yet"}</span>}
        sub="Tracking started Oct 26, 2026. Every player DraftKings priced is graded, edge or not, against the box score (rushing, receiving and return TDs)."
      />
      <Stats
        label="Record"
        items={[
          { k: "Edges, 1u each", v: e.n ? u(e.net) : "·", sub: e.n ? `${e.won} of ${e.n} won` : "first grade pending" },
          { k: "Anytime edges", v: e.bySide.anytime.n ? u(e.bySide.anytime.net) : "·", sub: e.bySide.anytime.n ? `${e.bySide.anytime.won} of ${e.bySide.anytime.n}` : "", small: true },
          { k: "2+ TD edges", v: e.bySide.two.n ? u(e.bySide.two.net) : "·", sub: e.bySide.two.n ? `${e.bySide.two.won} of ${e.bySide.two.n}` : "", small: true },
          { k: "Priced players scored", v: p.n ? `${p.hits} of ${p.n}` : "·", sub: p.n ? `we said ${p.ours.toFixed(0)}, DK's prices ${p.dk.toFixed(0)}` : "", small: true },
        ]}
      />
      {p.n > 0 && (
        <div className={s.section}>
          <div className={s.sectionHead}>
            <h3 className={s.h2}>Are our chances right?</h3>
            <p className={s.p}>Priced players grouped by the chance we gave them. DraftKings&apos; column carries its vig, so it should read a little high.</p>
          </div>
          <div className={s.tw}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Our chance</th>
                  <th>Players</th>
                  <th>Scored</th>
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
                      <td className={s.num}>{pct(b.dk / b.n)}</td>
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

export async function AttdLog({ season }: { season: number }) {
  const learning = await getAttdLearning(season).catch(() => null);
  if (!learning) return <p className={s.calm}>The Anytime TD learner couldn&apos;t be read just now.</p>;
  return <LearnerLogBody want="Anytime TD" items={[{ name: "Anytime TD", learning }]} gateText="30+ games over 3+ weeks, 100+ bets and 25+ winners" />;
}
