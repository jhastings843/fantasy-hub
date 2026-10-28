// Anytime TD (NFL): our model (lib/models/nfl/anytime.ts) against DraftKings'
// Anytime and 2+ TD prices. Same layout as the other Props boards (week.tsx):
// tracked edges, every game, graded games, the four numbers and the gate.
// Paper only: edges are graded flat 1u until a learner slice clears its gate.
import { getOurFtdView, attdGraded, getAttdLearning } from "@/lib/models/nfl/ftd-store";
import { ATTD_EDGE, attdEdges, summarizeAttd, type AttdRow } from "@/lib/models/nfl/anytime";
import { implied, payout } from "@/lib/props/parse";
import { attdStaked } from "@/lib/models/sections";
import { Background, SecHead } from "../picks/board";
import { EdgeCard, Gate, GameTable, PropStats, endedOnEspn, type Edge, type GameRowData } from "./week";
import { LearnerLogBody } from "./top";
import { Tile } from "./ournba";
import s from "../picks/picks.module.css";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const u = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}u`;
const TOP = 6;
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
        we said in both test sets, so an edge has to clear DraftKings&apos; break-even by {Math.round(ATTD_EDGE * 100)} points to count.
      </p>
    </Background>
  );
}

/** A graded anytime edge, 1u at DK's price: null when the player had no priced anytime edge or the bet was void. */
function anytimeBet(r: AttdRow, t: number | null | undefined): { won: boolean; net: number } | null {
  if (r.dk === undefined || t === null || t === undefined || !attdEdges(r).some((x) => x.side === "anytime")) return null;
  return { won: t > 0, net: t > 0 ? payout(r.dk) : -1 };
}

function edgeResult(r: AttdRow, t: number | null | undefined) {
  const b = anytimeBet(r, t);
  if (!b) return <span className={s.dim}>·</span>;
  return <b className={b.won ? s.pos : s.neg}>{`${b.won ? "Won" : "Lost"} ${u(b.net)}`}</b>;
}

/** Finished games, newest first: each game's anytime edges as a W-L record at 1u. */
function gradedRowsOf(graded: Awaited<ReturnType<typeof attdGraded>>): GameRowData[] {
  return [...graded]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((g) => {
      const bets = g.rows.map((r) => anytimeBet(r, g.result[r.key])).filter((b): b is { won: boolean; net: number } => !!b);
      const won = bets.filter((b) => b.won).length;
      const units = bets.reduce((a, b) => a + b.net, 0);
      const scorers = g.rows.filter((r) => (g.result[r.key] ?? 0) > 0).length;
      const record = `${won}-${bets.length - won}`;
      return {
        key: g.slug,
        title: g.slug.split("_").slice(2).join(" at "),
        when: g.at,
        final: true,
        cells: [
          ["Edges W-L", bets.length ? record : "none"],
          ["Units", bets.length ? u(units) : "·"],
          ["Scored", `${scorers} of ${g.rows.length}`],
        ],
        read: !bets.length ? ["No edges", s.readPass] : [`${record} · ${u(units)}`, units > 0 ? s.readW : units < 0 ? s.readL : s.readPass],
        body: <PlayerTable rows={g.rows} result={g.result} />,
      };
    });
}

/** Every player on a board, ours against DK, as the game row's body. */
function PlayerTable({ rows, result }: { rows: AttdRow[]; result?: { [key: string]: number | null } }) {
  return (
    <div className={s.tw}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Player</th>
            <th>Ours</th>
            <th>DK</th>
            <th>Break-even</th>
            <th>2+ ours / DK</th>
            {result && <th>TDs</th>}
            {result && <th>Anytime edge</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const e = attdEdges(r);
            const t = result?.[r.key];
            return (
              <tr key={`${r.team}|${r.key}`}>
                <td>
                  {`${r.name} `}
                  <span className={s.dim}>{r.team}</span>
                  {e.length > 0 && <b className={s.pos}>{` · edge ${e.map((x) => `${x.side === "two" ? "2+" : "ATTD"} +${Math.round(x.gap * 100)}`).join(", ")}`}</b>}
                </td>
                <td className={s.num}>{pct(r.anytime)}</td>
                <td className={s.num}>{r.dk !== undefined ? am(r.dk) : "·"}</td>
                <td className={s.num}>{r.dk !== undefined ? pct(implied(r.dk)) : "·"}</td>
                <td className={s.num}>{`${pct(r.two)} / ${r.dk2 !== undefined ? am(r.dk2) : "·"}`}</td>
                {result && <td className={s.num}>{t === null || t === undefined ? "void" : t}</td>}
                {result && <td className={s.num}>{edgeResult(r, t)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The tab's edges, plus the anytime side when a live slice bets a player under the tab's edge rule. */
const withBet = (r: AttdRow, bet: boolean) => {
  const es = attdEdges(r);
  return bet && !es.some((x) => x.side === "anytime") ? [...es, ...attdEdges(r, -1).filter((x) => x.side === "anytime")] : es;
};

export async function AttdWeek({ season }: { season: number }) {
  const [v, graded, learning] = await Promise.all([getOurFtdView(season).catch(() => null), attdGraded(season).catch(() => []), getAttdLearning(season).catch(() => null)]);
  if (!v || !learning) return <p className={s.calm}>The Anytime TD board couldn&apos;t be read just now.</p>;
  const now = nowMs();
  const open = v.board.filter((g) => g.attd && !g.attdResult).sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? ""));
  const ahead = open.filter((g) => !g.kickoff || Date.parse(g.kickoff) > now);
  const edges: Edge[] = ahead
    .flatMap((g) =>
      g.attd!.rows.flatMap((r) =>
        withBet(r, attdStaked(learning.entries, g.kickoff, r.anytime, r.dk)).map(
          (x): Edge => ({
            staked: x.side === "anytime" && attdStaked(learning.entries, g.kickoff, r.anytime, r.dk),
            key: `${g.game.slug}|${r.key}|${x.side}`,
            player: `${r.name} ${r.team}`,
            game: `${g.game.away} at ${g.game.home}`,
            when: g.kickoff,
            bet: x.side === "two" ? "2+ TDs" : "Anytime TD",
            ours: x.ours,
            mkt: implied(x.price),
            mktLabel: "DK break-even",
            price: am(x.price),
            gap: x.gap,
            more: [
              ["Expected TDs", r.m.toFixed(2)],
              ["Anytime ours / DK", `${pct(r.anytime)} / ${r.dk !== undefined ? am(r.dk) : "·"}`],
              ["2+ ours / DK", `${pct(r.two)} / ${r.dk2 !== undefined ? am(r.dk2) : "·"}`],
            ],
          }),
        ),
      ),
    )
    .sort((a, b) => Number(!!b.staked) - Number(!!a.staked) || b.gap - a.gap);
  const live = learning.entries.filter((e) => e.status === "active").map((e) => e.label);
  const priced = (rows: AttdRow[]) => rows.filter((r) => r.dk !== undefined).length;
  const ended = await endedOnEspn(open.map((g) => ({ slug: g.game.slug, kickoff: g.kickoff, espnId: g.espnId, graded: g.attdResult })), "nfl");
  const rows: GameRowData[] = open.map((g) => {
    const e = g.attd!.rows.filter((r) => attdEdges(r).length);
    const top = g.attd!.rows[0];
    return {
      key: g.game.slug,
      title: `${g.game.away} at ${g.game.home}`,
      when: g.kickoff,
      live: !!g.kickoff && Date.parse(g.kickoff) <= now,
      final: ended.has(g.game.slug),
      cells: [
        ["Likeliest", top ? `${top.name} ${pct(top.anytime)}` : "·"],
        ["Priced", `${priced(g.attd!.rows)}`],
        ["Edges", priced(g.attd!.rows) ? `${e.length}` : "no prices"],
      ],
      read: e.length ? [`${e.length} edge${e.length === 1 ? "" : "s"}`, s.readTrack] : ["No edge", s.readPass],
      body: <PlayerTable rows={g.attd!.rows} />,
    };
  });
  const anytime = summarizeAttd(graded).edges.bySide.anytime;
  return (
    <section className={s.section} aria-labelledby="attd-week">
      <div className={s.pageFrame}>
        <SecHead id="attd-week" title="Tracked edges" aside={live.length ? `Bets live: ${live.join("; ")} · the rest tracked` : `Our chance beats DK's break-even by ${Math.round(ATTD_EDGE * 100)}+ points · no stakes`} />
        {edges.length > 0 ? (
          <ul className={s.edgeGrid} data-first-pick>
            {edges.slice(0, TOP).map((e) => (
              <EdgeCard key={e.key} e={e} />
            ))}
          </ul>
        ) : (
          <p className={s.calm}>{open.length ? "No edges on games still to play." : "No board yet: it is built at each First TD read once DraftKings posts a total and spread."}</p>
        )}
      </div>
      <div className={s.pageFrame}>
        <SecHead title="Every game" aside="Games still to finish, soonest first · open one for every player" />
        {rows.length ? <GameTable head={["Likeliest", "Priced", "Edges"]} rows={rows} /> : <p className={s.calm}>No games on the board.</p>}
      </div>
      <div className={s.pageFrame}>
        <SecHead title="How it is doing" aside={live.length ? "Edges at 1u; bets once a slice went live" : "Tracked, never staked"} />
        <PropStats edges={edges.length} graded={{ w: anytime.won, l: anytime.n - anytime.won, p: 0, units: anytime.net }} learning={learning} logHref="/props?m=attd&v=log" unit="on games still to play" />
      </div>
      <Gate learning={learning} label="Anytime TD" />
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
      <div className={s.pageFrame}>
        <SecHead id="attd-results" title="Record" aside="Since Oct 26, 2026 · every priced player graded against the box score" />
        <div className={s.tiles}>
          <Tile value={e.n ? u(e.net) : "·"} label={e.n ? `Every edge, 1u · ${e.won} of ${e.n}` : "Every edge · first grades pending"} />
          <Tile value={e.bySide.anytime.n ? u(e.bySide.anytime.net) : "·"} label={`Anytime edges · ${e.bySide.anytime.won} of ${e.bySide.anytime.n}`} />
          <Tile value={e.bySide.two.n ? u(e.bySide.two.net) : "·"} label={`2+ TD edges · ${e.bySide.two.won} of ${e.bySide.two.n}`} />
          <Tile value={p.n ? `${p.hits} of ${p.n}` : "·"} label={p.n ? `priced players scored · we said ${p.ours.toFixed(0)}, DK ${p.dk.toFixed(0)}` : "priced players scored"} />
        </div>
      </div>
      {graded.length > 0 && (
        <div className={s.pageFrame}>
          <SecHead title="Game by game" aside="Newest first · each anytime edge 1u at DK's price · open a game for every player" />
          <GameTable head={["Edges W-L", "Units", "Scored"]} rows={gradedRowsOf(graded)} />
        </div>
      )}
      {p.n > 0 && (
        <div className={s.pageFrame}>
          <SecHead title="Are our chances right?" aside="Priced players by the chance we gave them · DK's column carries its vig" />
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
