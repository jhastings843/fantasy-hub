import { getNbaGameModelView } from "@/lib/models/nba/game-store";
import { GATE, SIGNALS, signalsOf } from "@/lib/models/nba/game-track";
import { kickoffEt } from "../ui";
import s from "../picks.module.css";

// Our own NBA game model (spreads and totals), a collapsed panel on the NBA
// research view. Tracked only: the backtest found no edge at the close, so
// this tests whether its leans beat the first price we had a number
// (lib/models/nba/game-track.ts).

const sp = (x: number) => (x === 0 ? "PK" : x > 0 ? `+${x}` : `${x}`);
const signed = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}`;
const r1 = (x: number) => Math.round(x * 10) / 10;

export async function NbaGameModelCard({ season }: { season: number }) {
  const v = await getNbaGameModelView(season).catch(() => null);
  if (!v) return <p className={`${s.notice} ${s.dim}`}>Couldn&apos;t load our NBA game model right now.</p>;
  const ahead = v.games.filter((g) => !g.final);
  const label = (id: string) => SIGNALS.find((x) => x.id === id)?.label ?? id;
  const name = (g: (typeof ahead)[number], side: string) => (side === "home" ? g.home : side === "away" ? g.away : side);
  return (
    <details className={s.details}>
      <summary>{`Our game model · spreads and totals, tracked only · ${v.games.length} game${v.games.length === 1 ? "" : "s"}`}</summary>
      <div className={s.detailsBody} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p className={s.p}>
          Built 2026-10-26. It starts from DraftKings&apos; number and adjusts for where NBA lines have missed: a results-only team rating,
          who is listed Out (our props model&apos;s projected points without them), rest and back-to-backs, the line&apos;s move since it
          opened, and last game&apos;s cover. Tested on 2025-26 with weights from 2024-25 only, it found no edge at the closing line (52.4%
          on every spread, break-even is 52.4%), and totals found nothing at all. But from the open to the close, lines moved toward its
          spread lean by about a third of a point on schedule spots alone (back-to-backs and rest), more once injuries were counted. So
          each game is judged at the first price we had a number, with the injury report as it stood then, and against the close.
        </p>
        <p className={s.p}>{`A signal earns a closer look at ${GATE.games}+ games over ${GATE.weeks}+ weeks with closing-line value above zero at t ${GATE.t}. Nothing here is bet.`}</p>
        <div className={s.tw}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Signal</th>
                <th>Games</th>
                <th>Record</th>
                <th>Units</th>
                <th>CLV</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {v.records.map((r) => (
                <tr key={r.id}>
                  <td>{r.label}</td>
                  <td className={s.num}>{`${r.games} · ${r.weeks} wk`}</td>
                  <td className={s.num}>{r.w + r.l + r.p ? `${r.w}-${r.l}${r.p ? `-${r.p}` : ""}` : "·"}</td>
                  <td className={s.num}>{r.w + r.l ? `${r.units >= 0 ? "+" : "−"}${Math.abs(r.units).toFixed(1)}u` : "·"}</td>
                  <td className={s.num}>{r.clv === null ? "·" : `${signed(r.clv)} pts${r.t !== null ? ` (t ${r.t.toFixed(1)})` : ""}`}</td>
                  <td>{r.verdict === "collecting" ? "Collecting" : r.verdict === "closer look" ? "Closer look" : "No edge"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ahead.length > 0 ? (
          <div className={s.tw}>
            <table className={s.table}>
              <caption className={s.caption}>Upcoming, at the first price we had a number</caption>
              <thead>
                <tr>
                  <th>Game</th>
                  <th>DK</th>
                  <th>Ours</th>
                  <th>Total</th>
                  <th>Signals</th>
                </tr>
              </thead>
              <tbody>
                {ahead.map((g) => (
                  <tr key={g.event}>
                    <td>
                      {`${g.away} at ${g.home}`}
                      <div className={s.dim}>{kickoffEt(g.tip)}</div>
                    </td>
                    <td className={s.num}>{`${g.home} ${sp(g.first.spread)}`}</td>
                    <td className={s.num}>{`${g.home} ${sp(r1(g.first.ours.spread))}`}</td>
                    <td className={s.num}>{`${g.first.total} · ours ${r1(g.first.ours.total)}`}</td>
                    <td>
                      {signalsOf(g.first, v.strong)
                        .filter((x) => x.id !== "lean")
                        .map((x) => `${label(x.id)}: ${name(g, x.side)}`)
                        .join(" · ") || `lean ${g.first.res > 0 ? g.home : g.away}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={`${s.notice} ${s.dim}`}>No upcoming games saved yet. A game gets our number once DraftKings posts its props, on the next NBA props run.</p>
        )}
      </div>
    </details>
  );
}
