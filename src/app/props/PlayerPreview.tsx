// One player at a glance (Jack, 2026-11-04: "show last 5 game history for
// each prop, notable TDs or first basket/KOTC wins if applicable, and our most
// recent bet(s)"). Answer first: who he is and his game, this week's props
// with our lean, then each market's last five games, his touchdowns (NFL) or
// first baskets and King of the Court nights (NBA), then our bets on him.
// The full per-market cards (laid out like David's Prop Board, 2026-11-03:
// big numbers, a number line of his recent games, an over/under strip) and
// David's other markets sit behind a Disclosure; First TD stays in view.
// Before the game the result box waits; during it says so; after it grades.
import type { ReactNode } from "react";
import type { PlayerMarket, PlayerView } from "@/lib/search/player";
import type { OurBet, PlayerExtra } from "@/lib/search/player-extra";
import { TeamLogo } from "@/components/TeamLogo";
import { PopLink } from "@/components/hh/PopLink";
import { Chip, Disclosure, Empty, Num, Row, Section, type Tone } from "@/components/hh/ui";
import s from "../picks/picks.module.css";
import p from "../picks/game/preview.module.css";
import q from "./player.module.css";

const ET = "America/New_York";
const am = (x: number | null) => (x === null ? "·" : x > 0 ? `+${x}` : `${x}`);
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
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

/* ------------------------------------------------- new blocks (11-04) -- */

const LAST = 5;
/** A compact data row: hairline, no tap target (nothing in it is a control). */
const Line = ({ children }: { children: ReactNode }) => <div className="flex min-w-0 items-center justify-between gap-3 border-b border-hh-line py-1.5 text-sm last:border-b-0">{children}</div>;
const units = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}u`;
const gradeTone = (o: string | null): Tone => (o === "W" ? "pos" : o === "L" ? "neg" : "muted");
const failed = (what: string) => <Empty>{`Couldn't read ${what} just now.`}</Empty>;

type Past = PlayerMarket["history"][number];
const ouOf = (h: Past): "over" | "under" | "push" | "dnp" => (h.actual === null ? "dnp" : h.actual > h.line ? "over" : h.actual < h.line ? "under" : "push");

/** Five marks, newest first: accent over his line that day, gold under, outline for a push or a game he sat. */
function Strip({ games }: { games: Past[] }) {
  return (
    <span className="inline-flex gap-1" role="img" aria-label={`Newest first: ${games.map((h) => ouOf(h)).join(", ")}`}>
      {games.map((h, i) => {
        const o = ouOf(h);
        return <span key={i} className="size-2.5 rounded-[2px]" style={o === "over" ? { background: "var(--hh-accent)" } : o === "under" ? { background: "var(--hh-gold)" } : { border: "1.5px solid var(--hh-line)" }} />;
      })}
    </span>
  );
}

function LastFive({ m }: { m: PlayerMarket }) {
  const games = [...m.history].reverse().slice(0, LAST);
  const played = games.filter((h) => h.actual !== null && h.actual !== h.line);
  const overs = played.filter((h) => ouOf(h) === "over").length;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pb-1">
        <b className="text-[15px] font-semibold text-hh-ink">{m.stat}</b>
        {games.length > 0 ? (
          <span className="inline-flex items-center gap-2 text-xs text-hh-muted">
            <Strip games={games} />
            <span>
              over <Num>{`${overs}/${played.length}`}</Num>
            </span>
          </span>
        ) : null}
      </div>
      {games.length ? (
        games.map((h, i) => {
          const o = ouOf(h);
          return (
            <Line key={i}>
              <span className="min-w-0 truncate text-hh-ink-2">
                {short(h.at)} {h.home ? "vs" : "at"} {h.opp}
              </span>
              <span className="inline-flex shrink-0 items-center gap-2">
                <span className="text-hh-muted">
                  line <Num>{h.line}</Num>
                </span>
                <Num className="w-8 text-right font-semibold text-hh-ink">{h.actual ?? "DNP"}</Num>
                <span className="w-14 text-center">{o === "over" ? <Chip tone="accent">Over</Chip> : o === "under" ? <Chip tone="gold">Under</Chip> : <Chip tone="muted">{o === "push" ? "Push" : "Sat"}</Chip>}</span>
                <span className="w-7 text-center" title={h.ours ? "Our edge that day" : "No edge from us that day"}>
                  {h.ours ? <Chip tone={gradeTone(h.ours)}>{h.ours}</Chip> : <span className="text-hh-muted">·</span>}
                </span>
              </span>
            </Line>
          );
        })
      ) : (
        <Empty>No earlier games saved in this market yet.</Empty>
      )}
    </div>
  );
}

function Touchdowns({ x }: { x: NonNullable<PlayerExtra["tds"]> }) {
  if (x === "error") return <Section label="Touchdowns">{failed("his touchdown boards")}</Section>;
  if (!x.games.length) return <Section label="Touchdowns"><Empty>Not on our Anytime or First TD boards yet this season.</Empty></Section>;
  const known = x.games.filter((g) => g.tds !== undefined && g.tds !== null);
  const scored = known.filter((g) => (g.tds ?? 0) > 0);
  const firsts = x.games.filter((g) => g.first).length;
  return (
    <Section label="Touchdowns" aside="From our Anytime and First TD boards">
      <p className="pb-1 text-[15px] leading-snug text-hh-ink-2">
        {known.length ? (
          <>
            Scored in <Num className="font-semibold text-hh-ink">{scored.length}</Num> of <Num>{known.length}</Num> games we graded
          </>
        ) : (
          "No Anytime board graded for him yet"
        )}
        {firsts > 0 && (
          <>
            {" · first TD of the game "}
            <Num className="font-semibold text-hh-ink">{firsts}</Num>
            {firsts === 1 ? " time" : " times"}
          </>
        )}
      </p>
      {x.games.map((g) => (
        <Line key={g.slug}>
          <span className="min-w-0 truncate text-hh-ink-2">
            {"Wk "}
            <Num>{g.week}</Num> {g.home ? "vs" : "at"} {g.opp}
          </span>
          <span className="inline-flex shrink-0 items-center gap-2">
            {g.first && <Chip tone="pos">First TD</Chip>}
            {g.tds === undefined ? (
              <span className="text-hh-muted">{g.first === false ? "not first" : ""}</span>
            ) : g.tds === null ? (
              <span className="text-hh-muted">did not play</span>
            ) : (
              <span className={g.tds > 0 ? "font-semibold text-hh-ink" : "text-hh-muted"}>
                <Num>{g.tds}</Num> TD{g.tds === 1 ? "" : "s"}
              </span>
            )}
          </span>
        </Line>
      ))}
    </Section>
  );
}

function FirstBasket({ x }: { x: NonNullable<PlayerExtra["fb"]> }) {
  if (x === "error") return <Section label="First basket">{failed("our First Basket boards")}</Section>;
  if (!x.games.length) return <Section label="First basket"><Empty>Not on a graded First Basket board yet this season.</Empty></Section>;
  const hits = x.games.filter((g) => g.scored);
  const row = (g: (typeof x.games)[number], i: number) => (
    <Line key={i}>
      <span className="min-w-0 truncate text-hh-ink-2">
        {short(g.at)} {g.home ? "vs" : "at"} {g.opp}
      </span>
      <span className="inline-flex shrink-0 items-center gap-2 text-hh-muted">
        {g.scored && <Chip tone="pos">First basket</Chip>}
        <span>
          ours <Num>{pct(g.p)}</Num>
          {g.price !== null && (
            <>
              {" · "}
              <Num>{am(g.price)}</Num>
            </>
          )}
        </span>
      </span>
    </Line>
  );
  return (
    <Section label="First basket" aside="Graded boards, newest first">
      <p className="pb-1 text-[15px] leading-snug text-hh-ink-2">
        First basket in <Num className="font-semibold text-hh-ink">{hits.length}</Num> of his last <Num>{x.games.length}</Num> games on our board
      </p>
      {hits.map(row)}
      <Disclosure summary={`Every game on our board (${x.games.length})`}>{x.games.map(row)}</Disclosure>
    </Section>
  );
}

function Kings({ x }: { x: NonNullable<PlayerExtra["kotc"]> }) {
  if (x === "error") return <Section label="King of the Court">{failed("King of the Court nights")}</Section>;
  return (
    <Section label="King of the Court" aside="Most points + rebounds + assists on the slate">
      {x.wins.length ? (
        <>
          <p className="pb-1 text-[15px] leading-snug text-hh-ink-2">
            Led the slate on <Num className="font-semibold text-hh-ink">{x.wins.length}</Num> of <Num>{x.nights}</Num> graded nights
          </p>
          {x.wins.map((w) => (
            <Line key={w.date}>
              <span className="min-w-0 truncate text-hh-ink-2">
                {short(`${w.date}T16:00:00Z`)}
                {w.tied ? " (tied)" : ""}
              </span>
              <span className="inline-flex shrink-0 items-center gap-2 text-hh-muted">
                <span className="font-semibold text-hh-ink">
                  <Num>{w.pra}</Num> PRA
                </span>
                <span>{w.p !== null ? <>ours <Num>{pct(w.p)}</Num>{w.rank ? <>, #<Num>{w.rank}</Num></> : null}</> : "not on our board"}</span>
              </span>
            </Line>
          ))}
        </>
      ) : (
        <Empty>{x.nights ? `No King of the Court wins in ${x.nights} graded nights.` : "No King of the Court nights graded yet."}</Empty>
      )}
    </Section>
  );
}

function BetRow({ b }: { b: OurBet }) {
  return (
    <Row>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-semibold text-hh-ink">
          {b.pick === b.market || b.market.toLowerCase().startsWith(b.pick.toLowerCase()) ? b.market : `${b.pick} · ${b.market.replace(/ prop$/, "").toLowerCase()}`}
        </span>
        <span className="truncate text-xs text-hh-muted">
          {short(b.at)}
          {` · ${b.price}`}
          {b.staked !== undefined && (
            <>
              {" · staked "}
              <Num>{`${b.staked}u`}</Num>
            </>
          )}
        </span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-2">
        <Chip tone={b.result === "open" ? (b.staked !== undefined ? "accent" : "muted") : gradeTone(b.result)}>{b.result === "open" ? (b.staked !== undefined ? "Bet" : "Open") : b.result === "void" ? "Void" : b.result}</Chip>
        <Num className="w-14 text-right" tone={b.net === null ? "muted" : b.net > 0 ? "pos" : b.net < 0 ? "neg" : "muted"}>
          {b.net === null ? "·" : units(b.net)}
        </Num>
      </span>
    </Row>
  );
}

export function PlayerPreview({ v, x, now = new Date() }: { v: PlayerView; x?: PlayerExtra | null; now?: Date }) {
  const started = !!v.kickoff && new Date(v.kickoff) <= now;
  const status = v.final ? "Final" : started ? (v.clock ? `Live · ${v.clock}` : "In play") : v.kickoff ? new Date(v.kickoff).toLocaleString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  const wait = v.final ? "no result" : started ? "in play" : "after the game";
  const edges = v.markets.filter((m) => m.side).length;
  const davidCalls = v.markets.filter((m) => m.david !== null && m.david !== m.line && (m.side ?? m.lean));
  const agree = davidCalls.filter((m) => (m.david! > m.line) === ((m.side ?? m.lean) === "over")).length;
  const bets = v.markets.flatMap((m) => m.history).filter((h) => h.ours === "W" || h.ours === "L");
  const won = bets.filter((h) => h.ours === "W").length;
  const matchup = v.home ? `${v.opp} at ${v.team}` : `${v.team} at ${v.opp}`;
  const top = [...v.markets].filter((m) => m.side).sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0))[0];
  return (
    <div className={`${s.page} ${p.root}`}>
      <div className={`${q.head} pr-10`}>
        <TeamLogo league={v.league} team={v.team} size={60} />
        <div className={q.who}>
          <span className={q.name}>{v.name}</span>
          <span className={q.match}>
            {`${v.league.toUpperCase()}${x?.pos ? ` · ${x.pos}` : ""} · `}
            {x?.gameHref ? (
              <PopLink href={x.gameHref} className="text-hh-ink-2">
                {matchup}
              </PopLink>
            ) : (
              matchup
            )}
            {status ? ` · ${status}` : ""}
          </span>
        </div>
      </div>

      <Section label="This week" aside={v.markets.length ? `${v.markets.length} market${v.markets.length === 1 ? "" : "s"} our model prices` : undefined}>
        {v.markets.length > 0 ? (
          <>
            <p className="pb-1 text-[15px] leading-snug text-hh-ink-2">
              {top ? (
                <>
                  <b className="font-semibold text-hh-ink">
                    {`${word(top.side!)} `}
                    <Num>{top.line}</Num> {top.stat.toLowerCase()}
                  </b>
                  {" is our best edge: ours "}
                  <Num>{r1(top.ours)}</Num>
                  {top.edge !== null && (
                    <>
                      {", "}
                      <Num>{`+${(top.edge * 100).toFixed(1)}`}</Num> pts of win chance
                    </>
                  )}
                  .
                </>
              ) : (
                "No edge on him this game. Our leans are below."
              )}
            </p>
            {v.markets.map((m) => {
              const call = m.side ?? m.lean;
              const res = m.actual ?? m.live;
              return (
                <Row key={m.stat}>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-semibold text-hh-ink">{m.stat}</span>
                    <span className="text-xs text-hh-muted">
                      {"line "}
                      <Num>{m.line}</Num>
                      {" · ours "}
                      <Num>{r1(m.ours)}</Num>
                      {m.david !== null && (
                        <>
                          {" · David "}
                          <Num>{r1(m.david)}</Num>
                        </>
                      )}
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-2">
                    {res !== null && (
                      <span className="text-xs text-hh-muted">
                        {m.actual !== null ? "final " : "now "}
                        <Num className="font-semibold text-hh-ink">{res}</Num>
                      </span>
                    )}
                    {m.ourResult && m.actual !== null ? <Chip tone={gradeTone(m.ourResult)}>{m.ourResult}</Chip> : null}
                    <Chip tone={m.side ? "accent" : "muted"}>{m.side ? `${word(m.side)} edge` : call ? `Leans ${call}` : "No call"}</Chip>
                  </span>
                </Row>
              );
            })}
            <div className={`${q.summary} pt-3`}>
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
          </>
        ) : (
          <p className={q.note}>Our model doesn&apos;t price this player this game.</p>
        )}
      </Section>

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

      {v.attd && (
        <section aria-label="Anytime TD">
          <h3 className={p.h3}>Anytime TD</h3>
          <dl className={p.stats}>
            <div>
              <dt>Our chance</dt>
              <dd className={s.num}>{pct1(v.attd.ours)}</dd>
              {v.attd.edge && <small className={p.statSub}>our edge</small>}
            </div>
            <div>
              <dt>Venom</dt>
              <dd className={s.num}>{v.attd.venom !== null ? pct1(v.attd.venom) : "·"}</dd>
              <small className={p.statSub}>{v.attd.venom !== null ? `blend ${pct1(v.attd.blend!)}` : "not in his top 5"}</small>
            </div>
            <div>
              <dt>DK</dt>
              <dd className={s.num}>{v.attd.dk !== null ? (v.attd.dk > 0 ? `+${v.attd.dk}` : `${v.attd.dk}`) : "·"}</dd>
              {v.attd.breakEven !== null && <small className={p.statSub}>{`needs ${pct1(v.attd.breakEven)}`}</small>}
            </div>
            <div>
              <dt>Result</dt>
              <dd className={v.attd.tds ? s.pos : ""}>{v.attd.tds === undefined ? wait : v.attd.tds === null ? "Didn't play" : v.attd.tds > 0 ? `${v.attd.tds} TD${v.attd.tds === 1 ? "" : "s"}` : "No TD"}</dd>
            </div>
          </dl>
        </section>
      )}

      {v.markets.length > 0 && (
        <Section label="Last 5 games" aside="Each market, newest first: his line that day, what he did, our grade">
          <div className="flex flex-col gap-5">
            {v.markets.map((m) => (
              <LastFive key={m.stat} m={m} />
            ))}
          </div>
        </Section>
      )}

      {x?.tds !== undefined && <Touchdowns x={x.tds} />}
      {x?.fb !== undefined && <FirstBasket x={x.fb} />}
      {x?.kotc !== undefined && <Kings x={x.kotc} />}

      {x && (
        <Section label="Our bets on him" aside={`Newest first, up to 5 · units on 1 risked`}>
          {x.bets === "error" ? failed("our bets") : x.bets.length ? x.bets.map((b, i) => <BetRow key={i} b={b} />) : <Empty>No edges or bets on him saved this season.</Empty>}
        </Section>
      )}

      {(v.markets.length > 0 || v.davidOnly.length > 0) && (
        <Disclosure summary="Full cards: odds, chances, number lines and David">
          <div className="flex flex-col gap-[18px] pt-2">
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
          </div>
        </Disclosure>
      )}
    </div>
  );
}
