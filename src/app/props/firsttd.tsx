// First TD: Sam's first touchdown model, saved before kickoff and graded
// after. This week, results, research (the trend checks). NFL only.
import { fairAmerican, type FtdGame } from "@/lib/firsttd/parse";
import type { Graded } from "@/lib/firsttd/grade";
import { getFirstTdView, type FirstTdView, type StoredGame } from "@/lib/firsttd/store";
import { MIN_GAMES, kalshiCost, kalshiFor, type PriceSlice, type Slice, type Verdict } from "@/lib/firsttd/trends";
import { whenEt } from "../picks/ui";
import s from "../picks/picks.module.css";

const SAM_FTD = "https://samthemodelman.smmodel.workers.dev/nfl/";
const p1 = (p: number) => `${(p * 100).toFixed(1)}%`;
const p0 = (p: number) => `${Math.round(p * 100)}%`;

async function load(season: number): Promise<FirstTdView | null> {
  return getFirstTdView(season).catch(() => null);
}

function Unavailable() {
  return <p className={s.calm}>The first TD tracker couldn&apos;t be read just now. Try again in a minute.</p>;
}

function Empty() {
  return (
    <p className={s.calm}>
      Nothing saved yet. Sam&apos;s first TD pages (Thursday&apos;s early in the week, Sunday and Monday&apos;s on Saturday) are saved before each kickoff and graded
      once ESPN has the final. His site only keeps the current week, so the record starts with Week 6.
    </p>
  );
}

function scorerLine(r: Graded): string {
  if (r.first.kind === "none") return r.first.detail;
  const f = r.first;
  const how = f.how === "pass" ? "catch" : f.how === "rush" ? "run" : "TD";
  return `${f.scorer} (${f.team}, ${how}, Q${f.period} ${f.clock})`;
}

function samHad(r: Graded): string {
  switch (r.bucket) {
    case "priced":
      return `Sam had him at ${p1(r.p!)}, #${r.rank} in the game`;
    case "thin":
      return "THIN on Sam's page (no number shown)";
    case "out":
      return "Sam had him ruled out";
    case "unlisted":
      return "Not on Sam's list (his \"any other\" share)";
    case "none":
      return `Sam had "no offensive first TD" at ${p1(r.pOutcome)}`;
  }
}

function Chip({ hit, label }: { hit: boolean | null; label: string }) {
  if (hit === null) return <span className={`${s.resChip} ${s.resP}`}>{`${label} n/a`}</span>;
  return <span className={`${s.resChip} ${hit ? `${s.resW}` : `${s.resL}`}`}>{`${label} ${hit ? "W" : "L"}`}</span>;
}

/** One side's full list: every priced player, then THIN, OUT and the remainder. */
function SideTable({ t, saved, hitKey }: { t: FtdGame["teams"][number]; saved: StoredGame; hitKey: string | null }) {
  const priced = t.players.filter((p) => p.p !== null && !p.out).sort((a, b) => b.p! - a.p!);
  const thin = t.players.filter((p) => p.thin && !p.out);
  const out = t.players.filter((p) => p.out);
  return (
    <div className={s.ftdSide}>
      <div className={s.ftdSideHead}>
        <b>{t.team}</b>
        <span className={s.num}>{`${p1(t.pFirst)} to score first`}</span>
      </div>
      <table className={s.ftdTable}>
        <thead>
          <tr>
            <th>Player</th>
            <th>Sam</th>
            <th>Fair</th>
            <th>Kalshi</th>
          </tr>
        </thead>
        <tbody>
          {priced.map((p) => {
            const k = kalshiFor(saved.kalshi, p.name);
            const cost = k?.ask ? kalshiCost(k.ask) : null;
            const edge = cost !== null ? p.p! - cost : null;
            return (
              <tr key={p.key} className={hitKey === p.key ? s.ftdHit : ""}>
                <td>
                  {p.name}
                  <span className={s.dim}>{` ${p.touches} tch · ${p.tds} TD`}</span>
                </td>
                <td className={s.num}>{p1(p.p!)}</td>
                <td className={`${s.num} ${s.dim}`}>{fairAmerican(p.p!)}</td>
                <td className={`${s.num} ${edge !== null && edge > 0 ? s.pos : s.dim}`} title="Kalshi ask plus fee">
                  {cost !== null ? `${Math.round(cost * 100)}¢${edge! > 0 ? ` +${(edge! * 100).toFixed(1)}` : ""}` : "–"}
                </td>
              </tr>
            );
          })}
          {t.rest > 0 && (
            <tr className={s.dim}>
              <td>Anyone else</td>
              <td className={s.num}>{p1(t.rest)}</td>
              <td />
              <td />
            </tr>
          )}
          {t.thin > 0 && (
            <tr className={s.dim}>
              <td>{`THIN (${thin.map((p) => p.name).join(", ")})`}</td>
              <td className={s.num}>{p1(t.thin)}</td>
              <td />
              <td />
            </tr>
          )}
        </tbody>
      </table>
      {out.length > 0 && <p className={`${s.ftdNote} ${s.dim}`}>{`Out: ${out.map((p) => p.name).join(", ")}`}</p>}
    </div>
  );
}

function GameRow({ g, saved }: { g: FtdGame; saved: StoredGame }) {
  const sides = [...g.teams].sort((a, b) => b.pFirst - a.pFirst);
  const r = saved.result;
  const value = g.teams
    .flatMap((t) => t.players)
    .filter((p) => {
      if (p.p === null || p.out) return false;
      const k = kalshiFor(saved.kalshi, p.name);
      return !!k?.ask && p.p > kalshiCost(k.ask);
    }).length;
  return (
    <li>
      <details className={s.ftdGame}>
        <summary className={s.ftdSum}>
          <span className={s.ftdWhen}>
            <b>{`${g.away} at ${g.home}`}</b>
            <span className={s.dim}>{saved.kickoff ? whenEt(saved.kickoff) : g.when}</span>
          </span>
          <span className={s.ftdPick}>
            <span className={s.ftdPickName}>{g.pick ? g.pick.name : "No pick"}</span>
            <span className={`${s.dim} ${s.num}`}>
              {g.pick ? `${g.pick.team} · ${p1(g.pick.p)} · ${fairAmerican(g.pick.p)}` : ""}
            </span>
          </span>
          <span className={`${s.ftdOdds} ${s.num}`}>{[...sides.map((t) => `${t.team} ${p0(t.pFirst)}`), `none ${p0(g.none)}`].join(" · ")}</span>
          <span className={s.ftdFlags}>
            {r ? <Chip hit={r.pickHit} label="Pick" /> : value > 0 ? <span className={s.pill} title="Players whose Kalshi price (with fee) is below Sam's chance">{`${value} Kalshi value`}</span> : null}
            <span className={s.chev} aria-hidden>›</span>
          </span>
        </summary>
        <div className={s.ftdBody}>
          {r && (
            <div className={s.ftdResult}>
              <div>
                <b>First TD: </b>
                {scorerLine(r)}
              </div>
              <div className={s.dim}>{samHad(r)}</div>
              <div className={s.ftdChips}>
                <Chip hit={r.pickHit} label="Pick" />
                <Chip hit={r.teamHit} label="Side" />
              </div>
            </div>
          )}
          <div className={s.ftdSides}>
            {sides.map((t) => (
              <SideTable key={t.team} t={t} saved={saved} hitKey={r?.key ?? null} />
            ))}
          </div>
          <p className={`${s.ftdNote} ${s.dim}`}>
            {`No offensive first TD (defense, special teams or none): ${p1(g.none)}. Saved ${whenEt(saved.capturedAt)}${
              saved.kalshi ? `, Kalshi prices from the same capture` : ", before Kalshi prices were saved"
            }.`}
          </p>
        </div>
      </details>
    </li>
  );
}

export async function FirstTdWeek({ season }: { season: number }) {
  const v = await load(season);
  if (!v) return <Unavailable />;
  const w = v.current;
  if (!w) return <Empty />;
  const games = Object.values(w.games).sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? "") || a.game.slug.localeCompare(b.game.slug));
  const done = games.filter((g) => g.result);
  return (
    <section className={s.section} aria-labelledby="ftd-week">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="ftd-week">{`Week ${w.week} first touchdown`}</h2>
        <p className={s.p}>
          {`Sam's model, saved before kickoff. Chances, not prices: the fair price is the break-even. Tap a game for every player. Kalshi is what one contract cost at the same moment (ask plus fee), green with the gap in points when Sam's chance is higher. ${done.length ? `${done.length} of ${games.length} games graded.` : "Each game is graded from ESPN once it's final."}`}
        </p>
      </div>
      <ol className={s.ftdGames}>
        {games.map((g) => (
          <GameRow key={g.game.slug} g={g.game} saved={g} />
        ))}
      </ol>
    </section>
  );
}

export async function FirstTdResults({ season }: { season: number }) {
  const v = await load(season);
  if (!v) return <Unavailable />;
  if (!v.graded.length) return <Empty />;
  const pick = v.trends.headline.find((x) => x.id === "pick")!;
  const side = v.trends.headline.find((x) => x.id === "side")!;
  const top3 = v.graded.filter((x) => x.result.rank !== null && x.result.rank <= 3).length;
  return (
    <section className={s.section} aria-labelledby="ftd-results">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="ftd-results">First TD results</h2>
        <p className={s.p}>Every saved game once it&apos;s final, graded against the copy saved before kickoff. Expected is the sum of Sam&apos;s own chances.</p>
      </div>
      <div className={s.tiles}>
        <div className={s.tile}>
          <span className={`${s.tileV} ${s.num}`}>{v.graded.length}</span>
          <span className={s.tileK}>games graded</span>
        </div>
        <div className={s.tile}>
          <span className={`${s.tileV} ${s.num}`}>{`${pick.actual}/${pick.n}`}</span>
          <span className={s.tileK}>{`Sam's pick scored first · ${pick.expected.toFixed(1)} expected`}</span>
        </div>
        <div className={s.tile}>
          <span className={`${s.tileV} ${s.num}`}>{`${side.actual}/${side.n}`}</span>
          <span className={s.tileK}>{`favored side scored first · ${side.expected.toFixed(1)} expected`}</span>
        </div>
        <div className={s.tile}>
          <span className={`${s.tileV} ${s.num}`}>{`${top3}/${v.graded.length}`}</span>
          <span className={s.tileK}>scorer was in Sam&apos;s top 3</span>
        </div>
      </div>
      <div className={s.tw}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Wk</th>
              <th>Game</th>
              <th>Sam&apos;s pick</th>
              <th>First TD</th>
              <th>Sam had</th>
              <th>Pick</th>
              <th>Side</th>
            </tr>
          </thead>
          <tbody>
            {v.graded.map(({ slug, week, game, result }) => (
              <tr key={slug}>
                <td className={s.num}>{week}</td>
                <td className={s.game}>{`${game.away} at ${game.home}`}</td>
                <td>{game.pick ? `${game.pick.name} ${p1(game.pick.p)}` : "none"}</td>
                <td>{result.first.kind === "offense" ? `${result.first.scorer} (${result.first.team})` : result.first.detail}</td>
                <td className={s.num}>
                  {result.bucket === "priced" ? `${p1(result.p!)} · #${result.rank}` : result.bucket === "none" ? p1(result.pOutcome) : result.bucket}
                </td>
                <td className={result.pickHit ? s.resW : s.resL}>{result.pickHit ? "W" : "L"}</td>
                <td className={result.teamHit === null ? s.resP : result.teamHit ? s.resW : s.resL}>{result.teamHit === null ? "n/a" : result.teamHit ? "W" : "L"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const VERDICT: { [v in Verdict]: string } = {
  early: "too early",
  "in-line": "in line",
  "lean-over": "leaning over",
  "lean-under": "leaning under",
  over: "trend: undersold",
  under: "trend: oversold",
};

function SliceTable({ title, rows, unit }: { title: string; rows: Slice[]; unit: string }) {
  return (
    <div className={s.tw}>
      <table className={s.table}>
        <caption className={s.caption}>{title}</caption>
        <thead>
          <tr>
            <th>Slice</th>
            <th>{unit}</th>
            <th>Actual</th>
            <th>Sam expected</th>
            <th>Read</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.id}>
              <td>{x.label}</td>
              <td className={s.num}>{x.n}</td>
              <td className={s.num}>{x.actual}</td>
              <td className={s.num}>{x.expected.toFixed(1)}</td>
              <td className={x.verdict === "over" || x.verdict === "lean-over" ? s.pos : x.verdict === "under" || x.verdict === "lean-under" ? s.neg : s.dim}>
                {VERDICT[x.verdict]}
                {x.z !== null && x.verdict !== "early" ? <span className={s.dim}>{` (z ${x.z.toFixed(1)})`}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PriceTable({ rows, games }: { rows: PriceSlice[]; games: number }) {
  return (
    <div className={s.tw}>
      <table className={s.table}>
        <caption className={s.caption}>{`Betting Sam's number at Kalshi's price (${games} games with prices saved)`}</caption>
        <thead>
          <tr>
            <th>Bet</th>
            <th>Bets</th>
            <th>Won</th>
            <th>Needed</th>
            <th>Units</th>
            <th>Read</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.id}>
              <td>{x.label}</td>
              <td className={s.num}>{x.bets}</td>
              <td className={s.num}>{x.w}</td>
              <td className={s.num}>{x.needed.toFixed(1)}</td>
              <td className={`${s.num} ${x.units > 0 ? s.pos : x.units < 0 ? s.neg : ""}`}>{`${x.units >= 0 ? "+" : ""}${x.units.toFixed(1)}u`}</td>
              <td className={x.verdict === "over" || x.verdict === "lean-over" ? s.pos : x.verdict === "under" || x.verdict === "lean-under" ? s.neg : s.dim}>
                {x.verdict === "over" ? "trend: profitable" : x.verdict === "under" ? "trend: losing" : VERDICT[x.verdict]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function FirstTdResearch({ season }: { season: number }) {
  const v = await load(season);
  if (!v) return <Unavailable />;
  if (!v.graded.length) return <Empty />;
  const t = v.trends;
  const ps = t.passShare;
  return (
    <section className={s.section} aria-labelledby="ftd-research">
      <div className={s.sectionHead}>
        <h2 className={s.h2} id="ftd-research">Where Sam&apos;s first TD model is right and wrong</h2>
        <p className={s.p}>
          {`Each row is a slice of his output: how often it scored the first TD against how often his own numbers said it would. A trend needs ${MIN_GAMES} graded games and a gap past the 90% bar (z 1.6); until then rows read "too early". ${t.games} of ${MIN_GAMES} games graded so far.`}
        </p>
      </div>
      {t.findings.length ? (
        <ul className={s.journal}>
          {t.findings.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : (
        <p className={s.calm}>
          {t.games < MIN_GAMES
            ? `No trends yet. ${MIN_GAMES - t.games} more graded games before any slice can be called; first TDs are long shots, so a few weeks of data can look like a pattern when it isn't one.`
            : "Nothing has cleared the bar: every slice is within normal luck of Sam's own numbers."}
        </p>
      )}
      <PriceTable rows={t.market} games={t.kalshiGames} />
      <SliceTable title="The headline checks" rows={t.headline} unit="Games" />
      <SliceTable title="Where the scorer sat in Sam's list" rows={t.rank} unit="Games" />
      <SliceTable title="By the size of Sam's number" rows={t.price} unit="Players" />
      <SliceTable title="Sam's two inputs: scoring rate against opportunity" rows={t.usage} unit="Players" />
      {ps && (
        <p className={s.notice}>
          {`Pass or run: ${ps.actual} of ${ps.n} offensive first TDs were catches. The defense table on Sam's pages (share of TDs allowed by pass, for the defense that was scored on) implies ${ps.expected.toFixed(1)}.`}
        </p>
      )}
      <p className={`${s.notice} ${s.dim}`}>
        {"Kalshi bets: 1 unit per player, bought at the saved ask plus Kalshi's fee; \"needed\" is the wins it takes to break even at those costs. Kalshi prices are saved from Week 6 Sunday on. A THIN scorer is charged his side's unprinted THIN share, split evenly (an estimate: Sam's page gives the group a share but no names). Defensive, return and no-TD games count as Sam's \"no offensive first TD\". Source: "}
        <a href={SAM_FTD}>Sam&apos;s Models</a>, first touchdown pages; results from ESPN.
      </p>
    </section>
  );
}
