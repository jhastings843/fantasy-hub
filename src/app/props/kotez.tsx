// King of the End Zone (NFL, DraftKings promo): our chance at each game's
// longest TD (lib/models/nfl/kotez.ts) off the Anytime TD board, against an
// estimated share of backers. Projections only: nothing saved or graded yet.
import { getOurFtdView } from "@/lib/models/nfl/ftd-store";
import { kotezGame, KOTEZ_SIMS, type KotezRow } from "@/lib/models/nfl/kotez";
import ATTD_PARAMS from "@/lib/models/nfl/attd-params.json";
import { implied } from "@/lib/props/parse";
import { Background, SecHead } from "../picks/board";
import { GameTable, type GameRowData } from "./week";
import { tvByEvent } from "@/lib/live/espn";
import { loadKotez } from "@/lib/models/nfl/kotez-store";
import { backers, payoutLine, type KotezPayout } from "@/lib/models/nfl/kotez-payout";
import { nameKey } from "@/lib/props/grade";
import { Tile } from "./ournba";
import s from "../picks/picks.module.css";
import { PopLink } from "@/components/hh/PopLink";
import { footballGameHref, playerPropHref } from "../picks/hrefs";

const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
const am = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const VALUE = 1.2;
const nowMs = () => Date.now();

function Table({ rows, game }: { rows: KotezRow[]; /** ESPN id or slug, for the player pop-up. */ game?: string }) {
  return (
    <div className={s.tw}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Player</th>
            <th>Longest TD</th>
            <th>Anytime ours / DK</th>
            <th>Backers (est.)</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.team}|${r.key}`} className={r.value !== undefined && r.value >= VALUE ? s.rowEdge : undefined}>
              <td>
                <PopLink href={playerPropHref("nfl", r.team, r.name, game)}>{r.name}</PopLink>{" "}
                <span className={s.dim}>{r.team}</span>
              </td>
              <td className={s.num}>{pct(r.longest)}</td>
              <td className={s.num}>{`${pct(r.anytime)} / ${r.dk !== undefined ? `${am(r.dk)} (${pct(implied(r.dk))})` : "·"}`}</td>
              <td className={s.num}>{r.crowd !== undefined ? pct(r.crowd) : "·"}</td>
              <td className={`${s.num} ${r.value !== undefined && r.value >= VALUE ? s.pos : ""}`}>{r.value !== undefined ? `${r.value.toFixed(2)}x` : "·"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function KotezWeek({ season }: { season: number }) {
  const v = await getOurFtdView(season).catch(() => null);
  if (!v) return <p className={s.calm}>The board couldn&apos;t be read just now.</p>;
  const now = nowMs();
  const games = v.board.filter((g) => g.attd && !g.attdResult && (!g.kickoff || Date.parse(g.kickoff) > now)).sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? ""));
  const [tv, saved] = await Promise.all([tvByEvent("nfl"), loadKotez(season).catch(() => [])]);
  const promo = saved.find((x) => x.week === v.week);
  const sims = games.map((g) => ({ g, k: kotezGame(g.attd!.rows, ATTD_PARAMS.other) }));
  const best = sims
    .flatMap(({ g, k }) => k.rows.filter((r) => r.value !== undefined && r.value >= VALUE && r.longest >= 0.03 && r.dk !== undefined && implied(r.dk) >= 0.1).map((r) => ({ r, game: `${g.game.away} at ${g.game.home}`, gameId: g.espnId ?? g.game.slug, gameHref: footballGameHref("nfl", g.game.away, g.game.home) })))
    .sort((a, b) => b.r.value! - a.r.value!)
    .slice(0, 6);
  const rows: GameRowData[] = sims.map(({ g, k }) => {
    const top = k.rows[0];
    const val = k.rows.filter((r) => r.value !== undefined && r.value >= VALUE && r.longest >= 0.03);
    return {
      key: g.game.slug,
      title: `${g.game.away} at ${g.game.home}`,
      match: { league: "nfl", away: g.game.away, home: g.game.home, tv: g.espnId ? tv.get(g.espnId) : undefined, href: footballGameHref("nfl", g.game.away, g.game.home) },
      when: g.kickoff,
      cells: [
        ["Likeliest", top ? `${top.name} ${pct(top.longest)}` : "·"],
        ["Value", val.length ? `${val[0].name} ${val[0].value!.toFixed(2)}x` : "none"],
        ["No TD", pct(k.noTd)],
      ],
      read: val.length ? [`${val.length} value`, s.readTrack] : ["No value", s.readPass],
      body: <Table rows={k.rows} game={g.espnId ?? g.game.slug} />,
    };
  });
  return (
    <section className={s.section} aria-labelledby="kotez-week">
      <div className={s.pageFrame}>
        <p className={s.thin}>{promo ? `This week's promo game: ${promo.game} (${promo.source === "dknetwork" ? "named by DK Network" : "the Monday game; DK Network hadn't named one"}). Tracked and graded; the other games are a view.` : "This week's promo game isn't known yet: it is saved on its game day, from DK Network or else the Monday game."}</p>
        <SecHead id="kotez-week" title="Best value" aside={`Our chance at the game's longest TD over the estimated share backing him · ${VALUE}x and up, 3%+ to win, DK +900 or shorter · projections only`} />
        {best.length ? (
          <div className={s.tw}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Longest TD</th>
                  <th>Backers (est.)</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {best.map(({ r, game, gameId, gameHref }) => (
                  <tr key={`${game}|${r.key}`}>
                    <td>
                      <PopLink href={playerPropHref("nfl", r.team, r.name, gameId)}>{r.name}</PopLink>{" "}
                      <span className={s.dim}>{r.team}</span>
                      <br />
                      <span className={s.dim}><PopLink href={gameHref}>{game}</PopLink></span>
                    </td>
                    <td className={s.num}>{pct(r.longest)}</td>
                    <td className={s.num}>{pct(r.crowd!)}</td>
                    <td className={`${s.num} ${s.pos}`}>{`${r.value!.toFixed(2)}x`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={s.calm}>{games.length ? "No player clears the value bar on games still to play." : "No games with an Anytime TD board still to play."}</p>
        )}
      </div>
      <div className={s.pageFrame}>
        <SecHead title="Every game" aside="Games still to start · DraftKings runs the promo on select games, so check the app for tonight's" />
        {rows.length ? <GameTable head={["Likeliest", "Value", "No TD"]} rows={rows} /> : <p className={s.calm}>No games on the board.</p>}
      </div>
      <Background title="How the number is built, and how far to trust it">
        <p className={s.p}>
          DraftKings pays everyone who backed the player with the game&apos;s longest TD (a thrown TD counts for the receiver). We simulate each game {KOTEZ_SIMS.toLocaleString()} times:
          each player&apos;s TDs come from our Anytime TD model, each TD is a run or a catch at his own mix, and its length is drawn from his own TDs since 2024, shrunk toward the
          league&apos;s. Returns, defensive TDs and players off the list can win too, and some games have no TD.
        </p>
        <p className={s.p}>
          Backers is an estimate, not data: DraftKings doesn&apos;t publish who people pick, so each player&apos;s share is set by his anytime price, squared, so favorites draw more
          than their price says. Value is our chance over that share: 1.5x means about 1.5 times his slice of the pool. Not yet graded: treat it as a guide.
        </p>
      </Background>
    </section>
  );
}

/** Our backers estimate for the winner beside DK's count: the record we will calibrate the price-squared share on. */
function BackersCheck({ payout }: { payout: KotezPayout }) {
  const n = backers(payout);
  const e = payout.est;
  return (
    <p className={s.thin}>
      {e
        ? `Backers on ${e.name}: we estimated ${pct(e.share)} of the field; DK ${payout.bettors ? "says" : "paid out to about"} ${n !== null ? n.toLocaleString("en-US") : "?"}.${e.impliedEntrants ? ` If our share was right, about ${(Math.round(e.impliedEntrants / 1000) * 1000).toLocaleString("en-US")} people entered.` : ""}`
        : `DK ${payout.bettors ? "says" : "paid out to about"} ${n !== null ? n.toLocaleString("en-US") : "?"} backers. We had no DraftKings price on him, so no estimate to compare.`}{" "}
      <a href={payout.source}>DK Network post</a>
    </p>
  );
}

/** Results: each promo game, frozen at kickoff, graded on the longest TD. */
export async function KotezResults({ season }: { season: number }) {
  const all = await loadKotez(season).catch(() => null);
  if (!all) return <p className={s.calm}>King of the End Zone results couldn&apos;t be read just now.</p>;
  const done = all.filter((x) => x.gradedAt);
  const ourOn = (x: (typeof all)[number]) =>
    x.result ? x.result.winners.reduce((a, w) => a + (w.dst ? 0 : (x.rows.find((r) => nameKey(r.name) === nameKey(w.name))?.longest ?? 0)), 0) : 0;
  const pickOf = (x: (typeof all)[number]) => [...x.rows].filter((r) => r.value !== undefined && r.value >= VALUE && r.longest >= 0.03).sort((a, b) => b.value! - a.value!)[0];
  const hits = done.filter((x) => {
    const p = pickOf(x);
    return p && x.result?.winners.some((w) => nameKey(w.name) === nameKey(p.name));
  }).length;
  const avg = done.length ? done.reduce((a, x) => a + ourOn(x), 0) / done.length : 0;
  const rows: GameRowData[] = all.map((x) => {
    const p = pickOf(x);
    const won = x.result?.winners.map((w) => (w.dst ? `${w.team} D/ST (${w.name})` : w.name)).join(", ");
    return {
      key: `${x.week}|${x.slug}`,
      title: `Week ${x.week} · ${x.game}`,
      when: x.kickoff,
      final: !!x.gradedAt,
      cells: [
        ["Longest TD", x.gradedAt ? (x.result ? `${won} ${x.result.yards} yd` : "no TD") : "·"],
        ["We gave him", x.gradedAt && x.result ? pct(ourOn(x)) : "·"],
        ["Our value pick", p ? `${p.name} ${p.value!.toFixed(2)}x` : "none"],
        ["DK paid", x.payout ? payoutLine(x.payout) : x.gradedAt && x.result ? "not posted yet" : "·"],
      ],
      read: !x.gradedAt ? ["Open", s.readTrack] : p && x.result?.winners.some((w) => nameKey(w.name) === nameKey(p.name)) ? ["Pick won", s.readW] : ["Pick missed", s.readPass],
      body: (
        <>
          {x.payout && <BackersCheck payout={x.payout} />}
          <Table rows={x.rows} game={x.slug} />
        </>
      ),
    };
  });
  return (
    <section className={s.section} aria-labelledby="kotez-results">
      <div className={s.pageFrame}>
        <SecHead id="kotez-results" title="Promo games" aside="One game a week, the one DraftKings runs it on · our board frozen at kickoff · since Nov 2, 2026" />
        <div className={s.tiles}>
          <Tile value={done.length ? `${hits} of ${done.length}` : "·"} label={done.length ? "our top value pick took the crown" : "first promo game pending"} />
          <Tile value={done.length ? pct(avg) : "·"} label="average chance we gave the winner" />
        </div>
        {rows.length ? <GameTable head={["Longest TD", "We gave him", "Our value pick", "DK paid"]} rows={rows} /> : <p className={s.calm}>No promo game saved yet. The next one is saved on its game day once DraftKings names it (or the Monday game if it doesn&apos;t).</p>}
      </div>
    </section>
  );
}
