import { loadForecasts } from "@/lib/picks/forecasts";
import { closingLines } from "@/lib/picks/closing-store";
import { GATE, SIGNALS, signalRecords, trackedGames } from "@/lib/models/nfl/spread-track";
import s from "./picks.module.css";

// Our own NFL spread model, a collapsed panel on the NFL research view.
// Tracked only (no stakes): the backtest found no edge against the closing
// line, so this tests whether its leans beat the earlier price we could have
// bet (lib/models/nfl/spread-track.ts).

const sp = (x: number) => (x === 0 ? "PK" : x > 0 ? `+${x}` : `${x}`);
const signed = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}`;

export async function OurSpreadCard({ season }: { season: number }) {
  const snaps = await loadForecasts("nfl", season).catch(() => []);
  const pre = trackedGames(snaps, []);
  const { closes } = pre.length ? await closingLines("nfl", season, pre).catch(() => ({ closes: new Map() })) : { closes: new Map() };
  const games = trackedGames(snaps, [...closes.values()]);
  const recs = signalRecords(games);
  const ahead = games.filter((g) => !g.final).sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? ""));
  const label = (id: string) => SIGNALS.find((x) => x.id === id)?.label ?? id;
  return (
    <details className={s.details}>
      <summary>{`Our spread model · forward test, tracked only · ${games.length} game${games.length === 1 ? "" : "s"}`}</summary>
      <div className={s.detailsBody} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p className={s.p}>
          Built 2026-10-21. It starts from the market&apos;s line and adjusts for where lines have been wrong before: the scoreboard against
          the market, the market&apos;s own week-over-week move, last week&apos;s cover, rest and a new starting QB. Tested on 3,121 games
          from 2015 on, it found no edge against the closing line (51.1% betting every game), but fading the market&apos;s biggest moves and
          the biggest last-week covers ran 51.5 to 52.4% in both eras. That small overreaction may be worth more at earlier prices,
          which old data can&apos;t test. So each game is judged at the first price we had a number, and against the close.
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
              {recs.map((r) => (
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
        {ahead.length > 0 && (
          <div className={s.tw}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Game</th>
                  <th>DK</th>
                  <th>Ours</th>
                  <th>Signals</th>
                </tr>
              </thead>
              <tbody>
                {ahead.map((g) => (
                  <tr key={`${g.week}|${g.home}`}>
                    <td>{`${g.away} at ${g.home}`}</td>
                    <td className={s.num}>{`${g.home} ${sp(g.line)}`}</td>
                    <td className={s.num}>{`${g.home} ${sp(Math.round(g.ours * 10) / 10)}`}</td>
                    <td>{g.signals.filter((x) => x.id !== "lean").map((x) => `${label(x.id)}: ${x.side === "home" ? g.home : g.away}`).join(" · ") || "lean only"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}
