// One CBB game at a glance, the NBA and football pop-ups' shape: matchup with
// logos and the score, win chance, then spread, total and straight up, each
// with our side, the edge, the chance and (once it ends) the result, and the
// numbers behind them. Before tip it reads today's line; once the game starts
// it shows the read we saved before tip, so the result grades what we said
// then and not a read that already knows the score (Jack, 2026-11-02).
import { CBB_PARAMS, type CbbBoardRow } from "@/lib/models/cbb/store";
import { coverChance, overChance } from "@/lib/models/cbb/model";
import { TeamLogo } from "@/components/TeamLogo";
import { line, price } from "../ui";
import s from "../picks.module.css";
import p from "../game/preview.module.css";

const ET = "America/New_York";
const pct = (x: number) => (x > 0.995 ? ">99%" : x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);
const signed = (x: number, d = 1) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)}`;
const when = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-US", { timeZone: ET, ...o });

/** The read this pop-up grades: today's before tip, the saved pregame copy after. */
interface Read {
  from: "now" | "saved" | "late";
  at?: string;
  spread: number | null;
  homePrice?: number;
  awayPrice?: number;
  total: number | null;
  overPrice?: number;
  underPrice?: number;
  mlHome?: number;
  mlAway?: number;
  openSpread: number | null;
  openTotal: number | null;
  ours: { spread: number; total: number; homeWin: number };
  homeCover: number | null;
  over: number | null;
}

export function readOfRow(x: CbbBoardRow): Read {
  const { g, read: r, saved } = x;
  // The first saved copy is the one the tracker grades.
  const snap = g.state === "pre" ? null : saved?.first;
  if (snap) {
    const margin = -snap.ours.spread;
    return {
      from: "saved",
      at: snap.at,
      spread: snap.spread,
      homePrice: snap.homePrice,
      awayPrice: snap.awayPrice,
      total: snap.total,
      overPrice: snap.overPrice,
      underPrice: snap.underPrice,
      mlHome: snap.mlHome,
      mlAway: snap.mlAway,
      openSpread: snap.open.spread,
      openTotal: snap.open.total,
      ours: snap.ours,
      homeCover: snap.spread !== null ? coverChance(margin, snap.spread, CBB_PARAMS.sigma) : null,
      over: snap.total !== null ? overChance(snap.ours.total, snap.total, CBB_PARAMS.sigmaTotal) : null,
    };
  }
  const l = r.line;
  return {
    from: g.state === "pre" ? "now" : "late",
    spread: l?.spread ?? null,
    homePrice: l?.homePrice,
    awayPrice: l?.awayPrice,
    total: l?.total ?? null,
    overPrice: l?.overPrice,
    underPrice: l?.underPrice,
    mlHome: l?.mlHome,
    mlAway: l?.mlAway,
    openSpread: l?.open.spread ?? null,
    openTotal: l?.open.total ?? null,
    ours: { spread: r.proj.spread, total: r.proj.total, homeWin: r.proj.homeWin },
    homeCover: r.homeCover,
    over: r.over,
  };
}

type Result = { text: string; tone: "W" | "L" | "P" } | null;
const resultBox = (r: Result, pending: string) => (r ? <dd className={`${s.num} ${r.tone === "W" ? s.pos : r.tone === "L" ? s.neg : ""}`}>{r.text}</dd> : <dd className={s.num}>{pending}</dd>);

function Market({ name, side, edge, chance, chanceWord, result, pending, note }: { name: string; side: string; edge: string; chance: string; chanceWord: string; result: Result; pending: string; note?: string }) {
  return (
    <section aria-label={name}>
      <h3 className={p.h3}>{name}</h3>
      <div className={p.statsWrap}>
        <dl className={p.stats}>
          <div>
            <dt>Our side</dt>
            <dd>{side}</dd>
          </div>
          <div>
            <dt>Edge</dt>
            <dd className={s.num}>{edge}</dd>
          </div>
          <div>
            <dt>{chanceWord}</dt>
            <dd className={s.num}>{chance}</dd>
          </div>
          <div>
            <dt>Result</dt>
            {resultBox(result, pending)}
          </div>
        </dl>
        {note && <p className={p.statNote}>{note}</p>}
      </div>
    </section>
  );
}

export function CbbGamePreview({ x }: { x: CbbBoardRow }) {
  const { g, read: now } = x;
  const r = readOfRow(x);
  const f = g.state !== "pre" && g.score ? g.score : null;
  const final = g.state === "post";
  const pending = g.state === "in" ? "in play" : "after the game";
  const name = (t: typeof g.home) => `${t.rank ? `${t.rank} ` : ""}${t.short}`;
  const margin = f ? f.home - f.away : null;
  const scoreLine = margin === null ? "" : margin === 0 ? (final ? "Tied" : "Tied right now") : `${(margin > 0 ? g.home : g.away).short} ${final ? "won" : "leads"} by ${Math.abs(margin)}`;

  // Spread
  const sEdge = r.spread === null ? null : r.spread - r.ours.spread; // > 0: home covers by our number
  const sHome = sEdge !== null && sEdge > 0;
  const sSide = sEdge === null || sEdge === 0 ? null : sHome ? `${g.home.short} ${line(r.spread!)}` : `${g.away.short} ${line(-r.spread!)}`;
  const sCov = sSide && margin !== null ? (margin + r.spread!) * (sHome ? 1 : -1) : null;
  const sRes: Result = sCov === null || !final ? null : sCov === 0 ? { text: "Push", tone: "P" } : sCov > 0 ? { text: `Covered by ${Math.abs(sCov)}`, tone: "W" } : { text: `Missed by ${Math.abs(sCov)}`, tone: "L" };

  // Total
  const tEdge = r.total === null ? null : r.ours.total - r.total;
  const over = tEdge !== null && tEdge > 0;
  const tSide = tEdge === null || tEdge === 0 ? null : `${over ? "Over" : "Under"} ${r.total}`;
  const pts = f ? f.home + f.away : null;
  const tRes: Result = !tSide || pts === null || !final ? null : pts === r.total ? { text: "Push", tone: "P" } : (pts > r.total!) === over ? { text: `${pts} scored`, tone: "W" } : { text: `${pts} scored`, tone: "L" };

  // Straight up
  const homeFav = r.ours.homeWin >= 0.5;
  const uRes: Result = !final || margin === null ? null : margin === 0 ? { text: "Tie", tone: "P" } : (margin > 0) === homeFav ? { text: "Won", tone: "W" } : { text: "Lost", tone: "L" };

  const status = final ? "Final" : g.state === "in" ? `Live · ${g.detail}` : `${when(g.tip, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${g.tv ? ` · ${g.tv}` : ""}`;
  const basis =
    r.from === "now"
      ? "Today's read against DraftKings' current line. It's saved as the game nears tip, and that saved copy is what gets graded."
      : r.from === "saved"
        ? `The read we first saved before tip (${when(r.at!, { weekday: "short", hour: "numeric", minute: "2-digit" })}), graded against the score.`
        : "No read was saved before tip (no line yet when the tracker looked), so this is today's read for reference. It isn't graded.";
  const lean = (h: boolean, a: string, b: string) => (h ? a : b);

  return (
    <div className={`${s.page} ${p.root}`}>
      <span className={s.eyebrow}>{`CBB · ${status}${g.neutral ? " · neutral site" : ""}`}</span>
      <div className={p.match}>
        {(["away", "home"] as const).map((side) => {
          const lost = final && f && f[side] < f[side === "home" ? "away" : "home"];
          return (
            <div key={side} className={`${p.team} ${side === "home" ? p.teamHome : ""}`}>
              <TeamLogo league="cfb" espnId={g[side].id} size={64} />
              <span className={p.teamName}>{name(g[side])}</span>
              {f ? <span className={`${p.score} ${s.num} ${lost ? p.scoreLose : ""}`}>{f[side]}</span> : <span className={`${p.proj} ${s.num}`}>{Math.round(side === "home" ? now.proj.homePts : now.proj.awayPts)}<small>proj</small></span>}
            </div>
          );
        })}
        <span className={p.at} aria-hidden>
          {final ? "final" : g.neutral ? "vs" : "at"}
        </span>
      </div>

      <div className={p.winWrap}>
        <div className={p.winBar} aria-hidden>
          <span className={homeFav ? p.winSide : p.winLead} style={{ width: `${(1 - r.ours.homeWin) * 100}%` }} />
          <span className={homeFav ? p.winLead : p.winSide} style={{ width: `${r.ours.homeWin * 100}%` }} />
        </div>
        <div className={p.winLabels}>
          <span>{pct(1 - r.ours.homeWin)}</span>
          <span>{final ? "our win chance before tip" : "our win chance"}</span>
          <span>{pct(r.ours.homeWin)}</span>
        </div>
      </div>

      <div className={p.verdict}>
        <span className={p.verdictLabel}>No stake</span>
        <span>{basis}</span>
      </div>

      <Market
        name="Spread"
        side={sSide ?? (r.spread === null ? "No line" : "None")}
        edge={sEdge !== null && sSide ? `${Math.abs(sEdge).toFixed(1)} pts` : "·"}
        chanceWord="Cover chance"
        chance={sSide && r.homeCover !== null ? pct(sHome ? r.homeCover : 1 - r.homeCover) : "·"}
        result={sRes}
        pending={sSide ? pending : "·"}
        note={r.spread !== null ? `DraftKings ${g.home.short} ${line(r.spread)}${r.openSpread !== null && r.openSpread !== r.spread ? ` (opened ${line(r.openSpread)})` : ""}; ours ${g.home.short} ${line(r.ours.spread)}.${scoreLine ? ` ${scoreLine}.` : ""}` : undefined}
      />
      <Market
        name="Total"
        side={tSide ?? (r.total === null ? "No line" : "None")}
        edge={tEdge !== null && tSide ? `${Math.abs(tEdge).toFixed(1)} pts` : "·"}
        chanceWord={over ? "Over chance" : "Under chance"}
        chance={tSide && r.over !== null ? pct(over ? r.over : 1 - r.over) : "·"}
        result={tRes}
        pending={tSide ? (pts !== null ? `${pts} so far` : pending) : "·"}
        note={r.total !== null ? `DraftKings ${r.total}${r.openTotal !== null && r.openTotal !== r.total ? ` (opened ${r.openTotal})` : ""}; ours ${r.ours.total}.` : undefined}
      />
      <Market
        name="Straight up"
        side={lean(homeFav, g.home.short, g.away.short)}
        edge={`by ${Math.abs(r.ours.spread).toFixed(1)}`}
        chanceWord="Win chance"
        chance={pct(homeFav ? r.ours.homeWin : 1 - r.ours.homeWin)}
        result={uRes}
        pending={pending}
        note={r.mlHome !== undefined || r.mlAway !== undefined ? `Moneyline ${g.away.abbr} ${price(r.mlAway)} · ${g.home.abbr} ${price(r.mlHome)}.` : undefined}
      />

      <section aria-label="Behind the number">
        <h3 className={p.h3}>Behind the number</h3>
        <dl className={s.kv}>
          <dt>Prices</dt>
          <dd className={s.num}>{[r.spread !== null ? `spread ${price(r.homePrice)} / ${price(r.awayPrice)}` : "", r.total !== null ? `total o ${price(r.overPrice)} / u ${price(r.underPrice)}` : ""].filter(Boolean).join(" · ") || "not posted"}</dd>
          <dt>Our ratings</dt>
          <dd className={s.num}>{`${g.home.short} ${signed(now.parts.ours.margin)}, total ${now.parts.ours.total.toFixed(1)}`}</dd>
          <dt>T-Rank</dt>
          <dd className={s.num}>{now.parts.trank ? `${g.home.short} ${signed(now.parts.trank.margin)}, total ${now.parts.trank.total.toFixed(1)}${now.rank.home || now.rank.away ? ` (ranks ${now.rank.away ?? "·"} at ${now.rank.home ?? "·"})` : ""}` : "not rated (non-Division I side)"}</dd>
          <dt>Blend</dt>
          <dd className={s.num}>{`${Math.round(CBB_PARAMS.blend.margin.ours * 100)}% ours, ${Math.round(CBB_PARAMS.blend.margin.trank * 100)}% T-Rank on the margin; ${g.home.short} ${line(now.proj.spread)}, total ${now.proj.total} today`}</dd>
          {(g.venue || g.note) && (
            <>
              <dt>Where</dt>
              <dd>{[g.note, g.venue, g.neutral ? "neutral site" : ""].filter(Boolean).join(" · ")}</dd>
            </>
          )}
        </dl>
      </section>
    </div>
  );
}

/** The game with this ESPN id on a board. */
export function findCbbRow(days: { rows: CbbBoardRow[] }[], id: string): CbbBoardRow | undefined {
  for (const d of days) {
    const x = d.rows.find((r) => r.g.id === id);
    if (x) return x;
  }
}
