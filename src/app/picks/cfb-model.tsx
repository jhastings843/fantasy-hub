import { getCfbModelView } from "@/lib/models/cfb/store";
import { signalOf } from "@/lib/models/cfb/track";
import s from "./picks.module.css";

// Our college model, a collapsed panel on the college research view, next to
// John Harris. Tracked and learning, never staked (lib/models/cfb/track.ts):
// this week's projected scores against DraftKings, the forward test, and the
// edge hunt's slices on the shared learning engine.

const sp = (x: number) => (x === 0 ? "PK" : x > 0 ? `+${x}` : `${x}`);
const signed = (x: number, d = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const STATUS = { collecting: "Collecting", active: "Live", paused: "Paused this week", "rolled-back": "Rolled back" } as const;

export async function CfbModelCard({ season }: { season: number }) {
  const v = await getCfbModelView(season).catch(() => null);
  if (!v) return null;
  const { record: r, section, ahead } = v;
  const entries = [...section.entries].sort((a, b) => (a.status === "active" ? -1 : 0) - (b.status === "active" ? -1 : 0) || (b.ev?.t ?? 0) - (a.ev?.t ?? 0));
  const n = r.w + r.l + r.p;
  return (
    <details className={s.details}>
      <summary>{`Our college model · tracked and learning · ${r.games} game${r.games === 1 ? "" : "s"}`}</summary>
      <div className={s.detailsBody} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p className={s.p}>
          Built 2026-10-28. A power rating from every FBS score (margin and points, with home field), giving a projected score, spread,
          total and win chance for each game. Tested on 2024 and 2025, which the fit never saw, it does not beat the line at -110 (49.5% on
          our side at the opener), but the line moved our way from open to close: +0.35 pts on games where we were 3+ pts off (t 4.6). That
          is too small to bet alone, so the model hunts for where it does have an edge.
        </p>
        <p className={s.p}>
          {`Each slice below is a paper bet, 1u at -110, on games after the slice was first seen. One goes live only after ${section.gate.minGames}+ games over ${section.gate.minWeeks}+ weeks at t ${section.gate.minT} (and must beat the slice it narrows), and is rolled back if it then loses. The learner also tests combinations of its strongest slice. Nothing here is bet with money.`}
        </p>
        <div className={s.tw}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Forward test</th>
                <th>Record</th>
                <th>Units</th>
                <th>CLV</th>
                <th>Avg miss</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Our side, every game, at the first line we saw</td>
                <td className={s.num}>{n ? `${r.w}-${r.l}${r.p ? `-${r.p}` : ""}` : "·"}</td>
                <td className={s.num}>{n ? `${signed(r.units)}u` : "·"}</td>
                <td className={s.num}>{r.clv === null ? "·" : `${signed(r.clv, 2)} pts${r.clvT !== null ? ` (t ${r.clvT.toFixed(1)})` : ""}`}</td>
                <td className={s.num}>{r.maeOurs === null ? "·" : `${r.maeOurs.toFixed(1)} vs line ${r.maeLine!.toFixed(1)}`}</td>
              </tr>
              <tr>
                <td>Straight up, our favorite</td>
                <td className={s.num}>{r.suW + r.suL ? `${r.suW}-${r.suL}` : "·"}</td>
                <td />
                <td />
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <div className={s.tw}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Slice</th>
                <th>Games</th>
                <th>Record</th>
                <th>Units</th>
                <th>t</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr>
                  <td colSpan={6}>Slices register at the next college data run.</td>
                </tr>
              )}
              {entries.map((e) => {
                const ev = e.ev;
                const w = ev?.wins ?? 0;
                const l = ev ? ev.bets - ev.wins : 0;
                return (
                  <tr key={e.id}>
                    <td>{e.label}</td>
                    <td className={s.num}>{ev ? `${ev.games} · ${ev.weeks} wk` : "·"}</td>
                    <td className={s.num}>{ev && ev.bets ? `${w}-${l}` : "·"}</td>
                    <td className={s.num}>{ev && ev.bets ? `${signed(ev.units)}u` : "·"}</td>
                    <td className={s.num}>{ev && ev.bets ? ev.t.toFixed(2) : "·"}</td>
                    <td>{STATUS[e.status]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {ahead.length > 0 && (
          <div className={s.tw}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Game</th>
                  <th>Projected</th>
                  <th>Ours</th>
                  <th>DK</th>
                  <th>Total</th>
                  <th>Lean</th>
                </tr>
              </thead>
              <tbody>
                {ahead.map((g) => {
                  const p = g.last.proj;
                  const sig = signalOf({ first: g.last });
                  const lean = sig ? `${sig.side === "home" ? g.home : g.away} by ${sig.edge.toFixed(1)}` : "on the line";
                  return (
                    <tr key={`${g.week}|${g.home}|${g.away}`}>
                      <td>{`${g.away} at ${g.home}${g.neutral ? " (neutral)" : ""}`}</td>
                      <td className={s.num}>{`${Math.round(p.awayPts)}-${Math.round(p.homePts)} · ${g.home} ${pct(p.homeWin)}`}</td>
                      <td className={s.num}>{`${g.home} ${sp(p.spread)}`}</td>
                      <td className={s.num}>{`${g.home} ${sp(g.last.line)}`}</td>
                      <td className={s.num}>{g.last.total !== undefined ? `${p.total.toFixed(1)} vs ${g.last.total}` : p.total.toFixed(1)}</td>
                      <td>{g.live.length ? `${lean} · live: ${g.live.join(", ")}` : lean}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}
