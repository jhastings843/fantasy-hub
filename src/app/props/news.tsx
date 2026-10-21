// NBA injury news (lib/models/nba/news.ts): today's rulings that moved our
// teammate props, with DraftKings' price at the news; and the record of
// whether DK then moved our way before tip.
import { getNewsEvents, type NewsEvent } from "@/lib/models/nba/news-store";
import { etDate } from "@/lib/props/parse";
import { whenEt } from "../picks/ui";
import { Stats } from "../picks/board";
import s from "../picks/picks.module.css";

const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const SHORT: { [k: string]: string } = { pts: "pts", reb: "reb", ast: "ast", threes: "threes" };
const nowMs = () => Date.now();

function Moves({ e }: { e: NewsEvent }) {
  if (!e.affected.length) return <p className={s.p}>No saved board for this game yet, so nothing to compare.</p>;
  return (
    <div className={s.tw}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Prop</th>
            <th>Ours</th>
            <th>DK at the news</th>
            <th>Our chance</th>
            {e.after && <th>DK by tip</th>}
          </tr>
        </thead>
        <tbody>
          {e.affected.slice(0, 10).map((a) => {
            const f = e.after?.[a.id];
            return (
              <tr key={a.id}>
                <td>
                  {`${a.player} ${a.side} ${a.line} ${SHORT[a.stat] ?? a.stat}`} {a.edge && <strong>· edge</strong>}
                </td>
                <td className={s.num}>{`${a.before} → ${a.after}`}</td>
                <td className={s.num}>{a.price !== null ? `${am(a.price)}${a.fair !== null ? ` (${pct(a.fair)} no vig)` : ""}` : "·"}</td>
                <td className={s.num}>{pct(a.chance)}</td>
                {e.after && <td className={s.num}>{f?.line == null ? "·" : `${f.line}${f.lineMove ? ` (${f.lineMove > 0 ? "+" : ""}${f.lineMove} our way)` : f.fairMove ? ` (${f.fairMove > 0 ? "+" : ""}${Math.round(f.fairMove * 100)} pts our way)` : ""}${f.outcome ? ` · ${f.outcome}` : ""}`}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Today's news block for the NBA props board. */
export async function NbaNewsToday({ season }: { season: number }) {
  const evs = await getNewsEvents(season).catch(() => null);
  if (!evs) return null;
  const today = etDate(new Date(nowMs()));
  const mine = evs.filter((e) => e.date === today);
  return (
    <div className={s.section}>
      <div className={s.sectionHead}>
        <h3 className={s.h2}>Injury news</h3>
        <p className={s.p}>
          Checked every 15 minutes. When a rotation player is ruled out or comes back, his game is repriced with his minutes handed out,
          and every teammate prop that moved is logged at DraftKings&apos; price right then. Edges go to your phone. The test: does DK move
          our way before tip?
        </p>
      </div>
      {mine.length ? (
        mine.map((e) => (
          <details key={e.id} className={s.details} open={mine.length <= 2}>
            <summary>{`${e.news.name} (${e.news.team}) ${e.news.change === "out" ? "ruled out" : "back"} · ${e.away} at ${e.home} · ${whenEt(e.at)} · ${e.affected.filter((a) => a.edge).length} edges`}</summary>
            <div className={s.detailsBody}>
              <p className={s.p}>{e.news.comment}</p>
              <Moves e={e} />
            </div>
          </details>
        ))
      ) : (
        <p className={s.calm}>No rotation news yet today.</p>
      )}
    </div>
  );
}

/** The record: how DK moved after our news reads, and how the edges did. */
export async function NbaNewsResults({ season }: { season: number }) {
  const evs = await getNewsEvents(season).catch(() => null);
  if (!evs) return null;
  const done = evs.filter((e) => e.after);
  const rows = done.flatMap((e) => e.affected.map((a) => ({ a, f: e.after![a.id] })));
  const edges = rows.filter((r) => r.a.edge);
  const moved = (xs: typeof rows) => {
    const m = xs.filter((r) => r.f && (r.f.lineMove !== null || r.f.fairMove !== null));
    const toward = m.filter((r) => (r.f.lineMove ?? 0) > 0 || (r.f.lineMove === 0 && (r.f.fairMove ?? 0) > 0)).length;
    const away = m.filter((r) => (r.f.lineMove ?? 0) < 0 || (r.f.lineMove === 0 && (r.f.fairMove ?? 0) < 0)).length;
    return { toward, away, n: m.length };
  };
  const all = moved(rows);
  const e = moved(edges);
  const rec = edges.reduce((acc, r) => ({ w: acc.w + (r.f?.outcome === "W" ? 1 : 0), l: acc.l + (r.f?.outcome === "L" ? 1 : 0) }), { w: 0, l: 0 });
  return (
    <div className={s.section}>
      <div className={s.sectionHead}>
        <h3 className={s.h2}>Injury news record</h3>
        <p className={s.p}>Every prop our number moved on after a ruling, judged at DraftKings&apos; last pregame line. If DK keeps moving our way after we read the news, we are early; if it doesn&apos;t, the book was already there.</p>
      </div>
      <Stats
        label="Injury news record"
        items={[
          { k: "News events graded", v: `${done.length}`, sub: `${evs.length} logged` },
          { k: "DK moved our way", v: all.n ? `${all.toward} of ${all.n}` : "·", sub: all.n ? `${all.away} moved against` : "first grades after tip" },
          { k: "On our edges", v: e.n ? `${e.toward} of ${e.n}` : "·", sub: "props that cleared DK's price at the news", small: true },
          { k: "Edges, record", v: rec.w + rec.l ? `${rec.w}-${rec.l}` : "·", sub: "at DK's price when the news hit", small: true },
        ]}
      />
    </div>
  );
}
