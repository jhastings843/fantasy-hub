// One player's props at a glance, laid out like David's Prop Board (Jack,
// 2026-11-03): one card per market with the line, ours, the gap and David's
// number big across, a number line of his recent games against the line, and
// an over/under strip of the games we saved. Then David's other markets and
// First TD (NFL).
// Before the game the result box waits; during it says so; after it grades.
import type { PlayerMarket, PlayerView } from "@/lib/search/player";
import { TeamLogo } from "@/components/TeamLogo";
import s from "../picks/picks.module.css";
import p from "../picks/game/preview.module.css";
import q from "./player.module.css";

const ET = "America/New_York";
const am = (x: number | null) => (x === null ? "·" : x > 0 ? `+${x}` : `${x}`);
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const word = (x: "over" | "under") => (x === "over" ? "Over" : "Under");
const tone = (o: string | null) => (o === "W" ? s.pos : o === "L" ? s.neg : "");
const said = (o: string | null) => (o === "W" ? "hit" : o === "L" ? "missed" : o === "P" ? "push" : "");

/** Where a value sits on the card's number line, as a percent. */
function scale(xs: number[]) {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const pad = Math.max((hi - lo) * 0.08, 0.5);
  const a = Math.max(0, lo - pad);
  const b = hi + pad;
  const f = (x: number) => ((x - a) / (b - a)) * 100;
  // Labels near either end anchor inward so they never clip.
  const label = (x: number) => ({ left: `${f(x).toFixed(2)}%`, transform: f(x) < 12 ? "translateX(-6px)" : f(x) > 88 ? "translateX(calc(-100% + 6px))" : "translateX(-50%)" });
  return { at: (x: number) => `${f(x).toFixed(2)}%`, label, lo: a, hi: b };
}
const r1 = (x: number) => Math.round(x * 10) / 10;
const signed = (x: number) => (x > 0 ? `+${r1(x)}` : x < 0 ? `−${r1(Math.abs(x))}` : "0");
const short = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: ET, month: "short", day: "numeric" }) : "");

function MarketCard({ m, wait }: { m: PlayerMarket; wait: string }) {
  const diff = m.ours - m.line;
  const played = m.history.filter((h) => h.actual !== null) as (PlayerMarket["history"][number] & { actual: number })[];
  const overs = played.filter((h) => h.actual > h.line).length;
  const pushes = played.filter((h) => h.actual === h.line).length;
  const decided = played.length - pushes;
  const ourBets = m.history.filter((h) => h.ours === "W" || h.ours === "L");
  const ourWins = ourBets.filter((h) => h.ours === "W").length;
  const sc = scale([m.line, m.ours, ...(m.david !== null ? [m.david] : []), ...played.map((h) => h.actual), ...(m.actual !== null ? [m.actual] : [])]);
  const call = m.side ?? m.lean;
  const davidSide = m.david === null ? null : m.david > m.line ? "over" : m.david < m.line ? "under" : null;
  return (
    <section className={`${q.card} ${m.side ? q.cardEdge : ""}`} aria-label={m.stat}>
      <div className={q.cardTop}>
        <span className={q.stat}>{m.stat}</span>
        <span className={`${q.chip} ${m.side ? q.chipEdge : ""}`}>{m.side ? `${word(m.side)} edge` : call ? `Leans ${call}` : "No call"}</span>
      </div>
      <dl className={q.nums}>
        <div>
          <dt>DK line</dt>
          <dd>{m.line}</dd>
          <small>{`o ${am(m.over)} · u ${am(m.under)}`}</small>
        </div>
        <div>
          <dt>Ours</dt>
          <dd>{r1(m.ours)}</dd>
          <small>{m.chance ? (call === "under" ? `${pct(m.chance.under)} under` : `${pct(m.chance.over)} over`) : "no chance saved"}</small>
        </div>
        <div>
          <dt>Diff</dt>
          <dd className={diff > 0 ? q.up : diff < 0 ? q.down : ""}>{signed(diff)}</dd>
          <small>{m.side && m.edge !== null ? `edge +${(m.edge * 100).toFixed(1)} pts` : "below our bar"}</small>
        </div>
        <div>
          <dt>David</dt>
          <dd>{m.david !== null ? r1(m.david) : "·"}</dd>
          <small>{m.david === null ? "no number" : !davidSide ? "on the line" : call ? (davidSide === call ? "agrees with us" : "against us") : `${davidSide}`}</small>
        </div>
      </dl>

      <div aria-hidden>
        <div className={q.track}>
          <div className={q.axis} />
          {played.map((h, i) => (
            <span key={i} className={`${q.dot} ${h.actual > h.line ? q.dotOver : q.dotUnder}`} style={{ left: sc.at(h.actual) }} title={`${short(h.at)} ${h.home ? "vs" : "at"} ${h.opp}: ${h.actual} on ${h.line}`} />
          ))}
          <span className={q.tick} style={{ left: sc.at(m.line) }} />
          <span className={q.tickLabel} style={sc.label(m.line)}>{`Line ${m.line}`}</span>
          {m.david !== null && <span className={`${q.mark} ${q.markDavid}`} style={{ left: sc.at(m.david) }} title={`David ${m.david}`} />}
          <span className={`${q.mark} ${q.markOurs}`} style={{ left: sc.at(m.ours) }} title={`Ours ${r1(m.ours)}`} />
          {(m.actual ?? m.live) !== null && (
            <>
              <span className={q.final} style={{ left: sc.at((m.actual ?? m.live)!) }} />
              <span className={q.markLabel} style={sc.label((m.actual ?? m.live)!)}>{`${m.actual !== null ? "Final" : "Now"} ${m.actual ?? m.live}`}</span>
            </>
          )}
        </div>
        <div className={q.ends}>
          <span>{r1(sc.lo)}</span>
          <span>{r1(sc.hi)}</span>
        </div>
      </div>

      <div className={q.strip}>
        <span className={q.stripText}>
          {decided ? (
            <>
              {"Over that day's line "}
              <b>{`${overs}/${decided}`}</b>
              {` · ${Math.round((overs / decided) * 100)}%`}
              {ourBets.length ? ` · our edges on him ${ourWins}-${ourBets.length - ourWins}` : ""}
            </>
          ) : (
            "No earlier games saved in this market yet"
          )}
        </span>
        {m.history.length > 0 && (
          <span className={q.boxes} role="img" aria-label={`Last ${m.history.length} saved games, oldest first`}>
            {m.history.map((h, i) => (
              <span key={i} className={`${q.box} ${h.actual === null || h.actual === h.line ? q.boxNone : h.actual > h.line ? q.boxOver : q.boxUnder}`} title={`${short(h.at)} ${h.home ? "vs" : "at"} ${h.opp}: ${h.actual === null ? "did not play" : `${h.actual} on ${h.line}`}`} />
            ))}
          </span>
        )}
      </div>

      <div className={q.result}>
        <span className={q.match}>{m.actual !== null ? "Final" : m.live !== null ? "Live" : "Result"}</span>
        <b className={tone(m.ourResult)}>{m.actual !== null ? m.actual : m.live !== null ? m.live : "·"}</b>
        <span>
          {m.actual !== null
            ? m.ourResult
              ? `our ${m.side ? "edge" : "lean"} ${said(m.ourResult)}${m.davidResult ? `, David ${said(m.davidResult)}` : ""}`
              : "graded"
            : m.live !== null
              ? m.live > m.line
                ? `over ${m.line} already`
                : `${r1(m.line - m.live)} to go on ${m.line}`
              : wait}
        </span>
      </div>
    </section>
  );
}

export function PlayerPreview({ v, now = new Date() }: { v: PlayerView; now?: Date }) {
  const started = !!v.kickoff && new Date(v.kickoff) <= now;
  const status = v.final ? "Final" : started ? (v.clock ? `Live · ${v.clock}` : "In play") : v.kickoff ? new Date(v.kickoff).toLocaleString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  const wait = v.final ? "no result" : started ? "in play" : "after the game";
  const edges = v.markets.filter((m) => m.side).length;
  const davidCalls = v.markets.filter((m) => m.david !== null && m.david !== m.line && (m.side ?? m.lean));
  const agree = davidCalls.filter((m) => (m.david! > m.line) === ((m.side ?? m.lean) === "over")).length;
  const bets = v.markets.flatMap((m) => m.history).filter((h) => h.ours === "W" || h.ours === "L");
  const won = bets.filter((h) => h.ours === "W").length;
  return (
    <div className={`${s.page} ${p.root}`}>
      <div className={q.head}>
        <TeamLogo league={v.league} team={v.team} size={60} />
        <div className={q.who}>
          <span className={q.name}>{v.name}</span>
          <span className={q.match}>{`${v.league.toUpperCase()} · ${v.home ? `${v.opp} at ${v.team}` : `${v.team} at ${v.opp}`}${status ? ` · ${status}` : ""}`}</span>
        </div>
      </div>

      {v.markets.length > 0 && (
        <div className={q.summary}>
          <span className={q.pill}>
            <b>{edges}</b>
            {`edge${edges === 1 ? "" : "s"} of ${v.markets.length} markets`}
          </span>
          {davidCalls.length > 0 && (
            <span className={q.pill}>
              {"David agrees on "}
              <b>{`${agree}/${davidCalls.length}`}</b>
            </span>
          )}
          {bets.length > 0 && (
            <span className={q.pill}>
              {"Our edges on him "}
              <b>{`${won}-${bets.length - won}`}</b>
            </span>
          )}
          <span className={q.pill}>No stake: tracked until a slice goes live</span>
        </div>
      )}
      {!v.markets.length && <p className={q.note}>Our model doesn&apos;t price this player this game.</p>}

      {v.markets.map((m) => (
        <MarketCard key={m.stat} m={m} wait={wait} />
      ))}

      {v.markets.length > 0 && (
        <div className={q.legend}>
          <span>
            <i className={q.key} style={{ background: "var(--ink)" }} />
            Ours
          </span>
          <span>
            <i className={q.key} style={{ border: "2px solid var(--david, var(--ink2))" }} />
            David
          </span>
          <span>
            <i className={q.key} style={{ background: "var(--accent)" }} />
            Earlier game, over that day&apos;s line
          </span>
          <span>
            <i className={q.key} style={{ background: "var(--gold)" }} />
            Under
          </span>
        </div>
      )}

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
