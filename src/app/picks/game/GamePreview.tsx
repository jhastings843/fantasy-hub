// One game at a glance, for the pop-up the header search opens (Jack,
// 2026-10-30: "click this and it opens a window of the game preview showing
// all the info... logos, stats, lines, edges, bets"). Matchup with logos and
// our projected score, the market against every model with each one's edge,
// then our call in each market worded exactly as the cards and search word it.
import type { BoardGame } from "@/lib/picks/engine";
import type { PicksReport } from "@/lib/picks/report";
import { TeamLogo } from "@/components/TeamLogo";
import { decimal } from "@/lib/picks/staking";
import { MarketLine } from "../board";
import { picksSearchIndex } from "../search";
import { gameHref, statusOf, suWhy } from "../ats";
import { kickoffEt, line, price, rec } from "../ui";
import s from "../picks.module.css";
import p from "./preview.module.css";

const r1 = (x: number) => Math.round(x * 10) / 10;

export function GamePreview({ g, r }: { g: BoardGame; r: PicksReport }) {
  const name = (k: string) => r.names[k] ?? k;
  const home = name(g.home);
  const away = name(g.away);
  const lg = r.league === "nfl" ? "nfl" : "cfb";
  const q = g.ref ?? g.lastRef;
  const tot = r.totals.board.find((t) => t.home === g.home && t.away === g.away);
  const entry = picksSearchIndex(r).find((e) => e.key === `${g.away}@${g.home}`);
  const st = statusOf(g);
  const f = g.final;

  // Home-side spread as the favorite would say it: "UConn -1.5".
  const spread = (x: number) => (Math.abs(x) < 0.05 ? "PK" : x < 0 ? `${home} ${line(r1(x))}` : `${away} ${line(-r1(x))}`);
  const market = q?.line ?? g.david?.market ?? g.sam?.market;
  const total = tot?.ref?.total ?? q?.total;
  // Points of value against the market: the side the model likes, and by how much.
  const spreadEdge = (x?: number) => (x === undefined || market === undefined ? null : Math.abs(x - market) < 0.05 ? "on the number" : `${x < market ? home : away} +${r1(Math.abs(x - market))}`);
  const totalEdge = (x?: number) => (x === undefined || total === undefined ? null : Math.abs(x - total) < 0.05 ? "on the number" : `${x > total ? "Over" : "Under"} +${r1(Math.abs(x - total))}`);

  const spreadRows: { who: string; v?: number; cls?: string }[] = [
    { who: "Sam", v: g.sam?.model, cls: s.cSam },
    { who: "David", v: g.david?.model, cls: s.cDavid },
    ...(r.league === "cfb" ? [{ who: "PEM", v: g.pem?.model }] : []),
    { who: "Our model", v: g.ours?.spread },
  ];
  const totalRows: { who: string; v?: number; cls?: string }[] = [
    { who: "Sam", v: tot?.sam ?? g.samTotal, cls: s.cSam },
    { who: "David", v: tot?.david ?? g.davidTotal, cls: s.cDavid },
    { who: "Our model", v: tot?.ours ?? g.ours?.total },
  ];

  const o = g.ours;
  const proj = o?.total !== undefined ? { away: (o.total + o.spread) / 2, home: (o.total - o.spread) / 2 } : null;
  const win = o?.homeWin;
  const cut = g.tier === "t1" ? r.strategies.rule : g.tier === "t2" ? r.strategies.second : null;
  const usedPrice = st === "sent" ? g.issued?.price : g.price;
  const edgePct = g.p !== undefined && usedPrice !== undefined ? (g.p * decimal(usedPrice) - 1) * 100 : null;
  const when = `${kickoffEt(q?.kickoff)}${q?.tv ? ` · ${q.tv}` : ""}`;
  const bet = ["bet", "sent", "early"].includes(st) || !!tot?.stake || !!tot?.issued;

  return (
    <div className={`${s.page} ${p.root}`}>
      <span className={s.eyebrow}>{`${r.league === "nfl" ? "NFL" : "College"}${r.week ? ` · Week ${r.week}` : ""} · ${f ? "Final" : g.basis === "started" ? "Started" : when}`}</span>

      {/* Matchup */}
      <div className={p.match}>
        {(["away", "home"] as const).map((side) => (
          <div key={side} className={`${p.team} ${side === "home" ? p.teamHome : ""}`}>
            <TeamLogo league={lg} team={g[side]} espnId={side === "home" ? q?.homeId : q?.awayId} size={64} />
            <span className={p.teamName}>{name(g[side])}</span>
            {f ? (
              <span className={`${p.score} ${s.num} ${f[side] > f[side === "home" ? "away" : "home"] ? "" : p.scoreLose}`}>{f[side]}</span>
            ) : proj ? (
              <span className={`${p.proj} ${s.num}`}>
                {r1(proj[side]).toFixed(1)}
                <small>proj</small>
              </span>
            ) : null}
          </div>
        ))}
        <span className={p.at} aria-hidden>
          {f ? "final" : "at"}
        </span>
      </div>

      {win !== undefined && (
        <div className={p.winWrap}>
          <div className={p.winBar} role="img" aria-label={`Our model: ${away} ${Math.round((1 - win) * 100)}%, ${home} ${Math.round(win * 100)}% to win`}>
            <span className={`${p.winSide} ${win < 0.5 ? p.winLead : ""}`} style={{ width: `${(1 - win) * 100}%` }} />
            <span className={`${p.winSide} ${win > 0.5 ? p.winLead : ""}`} style={{ width: `${win * 100}%` }} />
          </div>
          <div className={p.winLabels}>
            <span className={s.num}>{`${Math.round((1 - win) * 100)}%`}</span>
            <span>win chance, our model</span>
            <span className={s.num}>{`${Math.round(win * 100)}%`}</span>
          </div>
        </div>
      )}

      {/* The bet, or that there isn't one */}
      <div className={`${p.verdict} ${bet ? p.verdictBet : ""}`}>
        <span className={p.verdictLabel}>{bet ? "On the card" : "No bet"}</span>
        <span>
          {bet
            ? entry?.rows.filter((x) => x.tone === "bet" || (st === "early" && x.market === "Spread")).map((x) => x.text).join(" · ") || entry?.rows[0]?.text
            : g.read && !g.read.agree
              ? "Sam and David are on different sides of the spread."
              : cut
                ? "In the rule, but no stake at this price."
                : "Outside the rule and Tier 2, so tracked only."}
        </span>
      </div>

      {/* Lines and edges */}
      <div className={p.grid}>
        <section className={p.card} aria-label="Spread">
          <header className={p.cardHead}>
            <h3>Spread</h3>
            <b className={s.num}>{market !== undefined ? spread(market) : "no line"}</b>
          </header>
          {q?.homePrice !== undefined && q?.awayPrice !== undefined && <p className={p.prices}>{`${away} ${price(q.awayPrice)} · ${home} ${price(q.homePrice)}`}</p>}
          <table className={p.tbl}>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Line</th>
                <th scope="col">Edge</th>
              </tr>
            </thead>
            <tbody>
              {spreadRows.map((x) => (
                <tr key={x.who}>
                  <th scope="row" className={x.cls}>{x.who}</th>
                  <td className={s.num}>{x.v !== undefined ? spread(x.v) : "·"}</td>
                  <td className={s.num}>{spreadEdge(x.v) ?? "·"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {g.close && (g.close.open !== null || g.close.close !== null) && (
            <p className={p.note}>{`Opened ${g.close.open !== null ? spread(g.close.open) : "?"}, closed ${g.close.close !== null ? spread(g.close.close) : "?"}`}</p>
          )}
        </section>

        <section className={p.card} aria-label="Total">
          <header className={p.cardHead}>
            <h3>Total</h3>
            <b className={s.num}>{total !== undefined ? `${total}` : "no line"}</b>
          </header>
          {tot?.ref?.overPrice !== undefined && tot?.ref?.underPrice !== undefined && <p className={p.prices}>{`Over ${price(tot.ref.overPrice)} · Under ${price(tot.ref.underPrice)}`}</p>}
          <table className={p.tbl}>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Total</th>
                <th scope="col">Edge</th>
              </tr>
            </thead>
            <tbody>
              {totalRows.map((x) => (
                <tr key={x.who}>
                  <th scope="row" className={x.cls}>{x.who}</th>
                  <td className={s.num}>{x.v !== undefined ? r1(x.v).toFixed(1) : "·"}</td>
                  <td className={s.num}>{totalEdge(x.v) ?? "·"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {f && <p className={p.note}>{`${f.home + f.away} scored`}</p>}
        </section>
      </div>

      {market !== undefined && (g.sam || g.david) && (
        <div className={p.chart}>
          <MarketLine market={market} sam={g.sam ? r1(g.sam.model) : undefined} david={g.david ? r1(g.david.model) : undefined} pem={r.league === "cfb" && g.pem ? g.pem.model : undefined} fmt={(x) => `${home} ${line(x)}`} pk={{ below: home, above: away }} />
        </div>
      )}

      {/* Our call in every market */}
      {entry && (
        <section aria-label="Our calls">
          <h3 className={p.h3}>Our calls</h3>
          <ul className={p.calls}>
            {entry.rows.map((x) => (
              <li key={x.market} className={`${p.call} ${p[`tone_${x.tone}`] ?? ""}`}>
                <span className={p.callMk}>{x.market}</span>
                <span className={p.callTx}>{x.text}</span>
                {x.result && <span className={`${s.resChip} ${x.result === "W" ? s.resW : x.result === "L" ? s.resL : s.resP}`}>{x.result}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The numbers behind the spread call */}
      <dl className={p.stats}>
        <div>
          <dt>Models</dt>
          <dd>{g.read ? (g.read.agree ? "Agree" : "Split") : "One or none"}</dd>
        </div>
        <div>
          <dt>Avg edge</dt>
          <dd className={s.num}>{g.read?.agree ? `${g.read.avgEdge.toFixed(1)} pts` : "·"}</dd>
        </div>
        <div>
          <dt>Cover chance</dt>
          <dd className={s.num}>{g.p !== undefined ? `${(g.p * 100).toFixed(1)}%` : "·"}</dd>
        </div>
        <div>
          <dt>Edge per unit</dt>
          <dd className={`${s.num} ${edgePct !== null ? (edgePct >= 0 ? s.pos : s.neg) : ""}`}>{edgePct !== null ? `${edgePct >= 0 ? "+" : ""}${edgePct.toFixed(1)}%` : "·"}</dd>
        </div>
      </dl>
      {cut && <p className={p.note}>{`${g.tier === "t1" ? "The rule" : "Tier 2"}: ${cut.label} (${rec(cut.record)}). Cover chance is that record pulled toward 50%, an estimate.`}</p>}
      {g.su && <p className={p.note}>{suWhy(g, name)}</p>}

      {/* A plain link, so it loads the full page rather than reopening this window. */}
      <a href={gameHref(r, g)} className={p.more}>
        Full breakdown: every step of the call ›
      </a>
    </div>
  );
}
