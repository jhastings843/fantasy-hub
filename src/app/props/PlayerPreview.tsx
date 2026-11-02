// One player's props at a glance, the game pop-ups' shape: who and when, then
// every market as a four-box strip (DraftKings, ours, our side, result) with
// David's number under it, then David's other markets and First TD (NFL).
// Before the game the result box waits; during it says so; after it grades.
import type { PlayerView } from "@/lib/search/player";
import { TeamLogo } from "@/components/TeamLogo";
import s from "../picks/picks.module.css";
import p from "../picks/game/preview.module.css";

const ET = "America/New_York";
const am = (x: number | null) => (x === null ? "·" : x > 0 ? `+${x}` : `${x}`);
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const word = (x: "over" | "under") => (x === "over" ? "Over" : "Under");
const tone = (o: string | null) => (o === "W" ? s.pos : o === "L" ? s.neg : "");
const said = (o: string | null) => (o === "W" ? "hit" : o === "L" ? "missed" : o === "P" ? "push" : "");

export function PlayerPreview({ v, now = new Date() }: { v: PlayerView; now?: Date }) {
  const started = !!v.kickoff && new Date(v.kickoff) <= now;
  const status = v.final ? "Final" : started ? (v.clock ? `Live · ${v.clock}` : "In play") : v.kickoff ? new Date(v.kickoff).toLocaleString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  const wait = v.final ? "no result" : started ? "in play" : "after the game";
  const edges = v.markets.filter((m) => m.side).length;
  return (
    <div className={`${s.page} ${p.root}`}>
      <span className={s.eyebrow}>{`${v.league.toUpperCase()} props · ${v.home ? `${v.opp} at ${v.team}` : `${v.team} at ${v.opp}`}${status ? ` · ${status}` : ""}`}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <TeamLogo league={v.league} team={v.team} size={56} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span className={p.teamName} style={{ textAlign: "left" }}>{v.name}</span>
          <span className={p.statSub}>{`${v.team} ${v.home ? "vs" : "at"} ${v.opp}`}</span>
        </div>
      </div>
      <div className={p.verdict}>
        <span className={p.verdictLabel}>No stake</span>
        <span>
          {v.markets.length
            ? `${edges ? `${edges} edge${edges === 1 ? "" : "s"} from our model` : "No edges from our model, only leans"}. Props are tracked until a learner slice clears its gate.`
            : "Our model doesn't price this player this game."}
        </span>
      </div>

      {v.markets.map((m) => (
        <section key={m.stat} aria-label={m.stat}>
          <h3 className={p.h3}>{m.stat}</h3>
          <div className={p.statsWrap}>
            <dl className={p.stats}>
              <div>
                <dt>DraftKings</dt>
                <dd className={s.num}>{m.line}</dd>
                <small className={p.statSub}>{`o ${am(m.over)} / u ${am(m.under)}`}</small>
              </div>
              <div>
                <dt>Ours</dt>
                <dd className={s.num}>{m.ours}</dd>
                {m.chance && <small className={p.statSub}>{`over ${pct(m.chance.over)}`}</small>}
              </div>
              <div>
                <dt>{m.side ? "Our edge" : "Our lean"}</dt>
                <dd>{m.side ? `${word(m.side)} ${m.line}` : m.lean ? `${word(m.lean)} ${m.line}` : "None"}</dd>
                <small className={p.statSub}>{m.side && m.edge !== null ? `edge +${(m.edge * 100).toFixed(1)} pts` : "no edge"}</small>
              </div>
              <div>
                <dt>Result</dt>
                <dd className={`${s.num} ${tone(m.ourResult)}`}>{m.actual !== null ? `${m.actual}` : m.live !== null ? `${m.live} so far` : wait}</dd>
                {m.actual !== null && m.ourResult && <small className={p.statSub}>{`our ${m.side ? "edge" : "lean"} ${said(m.ourResult)}`}</small>}
                {m.actual === null && m.live !== null && <small className={p.statSub}>{`${m.live > m.line ? "over" : `${Math.round((m.line - m.live) * 10) / 10} to go`} on ${m.line}`}</small>}
              </div>
            </dl>
            <p className={p.statNote}>
              {m.david !== null
                ? `David: ${m.david} (${m.david > m.line ? "over" : m.david < m.line ? "under" : "on the line"})${m.davidResult ? `, ${said(m.davidResult)}` : ""}.${m.side && m.david !== m.line ? ` ${(m.david > m.line) === (m.side === "over") ? "He agrees with our edge." : "He's against our edge."}` : ""}`
                : "No number from David on this one."}
            </p>
          </div>
        </section>
      ))}

      {v.davidOnly.length > 0 && (
        <section aria-label="David's other markets">
          <h3 className={p.h3}>David&apos;s other markets</h3>
          <ul className={p.calls}>
            {v.davidOnly.map((d) => (
              <li key={d.stat} className={`${p.call} ${p[`tone_${d.outcome ?? (d.side ? "lean" : "pass")}`]}`}>
                <span className={p.callMk}>{d.stat}</span>
                <span className={p.callTx}>
                  {`${d.side ? `${word(d.side)} ${d.line}` : `At ${d.line}`} · his ${d.projection}${d.lower !== null && d.upper !== null ? ` (80% range ${d.lower} to ${d.upper})` : ""}${d.actual !== null ? ` · went ${d.actual}` : ""}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {v.ftd && (
        <section aria-label="First TD">
          <h3 className={p.h3}>First TD</h3>
          <dl className={p.stats}>
            <div>
              <dt>Our chance</dt>
              <dd className={s.num}>{`${(v.ftd.p * 100).toFixed(1)}%`}</dd>
              {v.ftd.pick && <small className={p.statSub}>our likeliest</small>}
            </div>
            <div>
              <dt>Kalshi cost</dt>
              <dd className={s.num}>{v.ftd.kalshi !== null ? `${Math.round(v.ftd.kalshi * 100)}¢` : "·"}</dd>
            </div>
            <div>
              <dt>Value</dt>
              <dd>{v.ftd.kalshi !== null ? (v.ftd.p > v.ftd.kalshi ? "Yes" : "No") : "·"}</dd>
            </div>
            <div>
              <dt>Result</dt>
              <dd className={v.ftd.scored ? s.pos : ""}>{v.ftd.scored === null ? wait : v.ftd.scored ? "Scored first" : "Didn't"}</dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}
