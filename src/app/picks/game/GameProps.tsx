// Our props model's edges for the players in one game, in the NFL and NBA
// game pop-ups (Jack, 2026-11-02: "add prop boxes"). Same edges the Props
// page lists (a side that clears the vig; NBA only once the player has 3+
// games), the top 6 by edge, each as a compact box: our chance against the
// price's break-even and edge per unit. David's projection sits beside ours
// when the saved board already carries it. Tracked only, never staked.
import { PopLink } from "@/components/hh/PopLink";
import { playerPropHref } from "../hrefs";
import { cache } from "react";
import { implied, nbaSeasonOfDate, type PropMarket } from "@/lib/props/parse";
import { edgePerUnit } from "@/lib/picks/our-boxes";
import { getOurNbaView, type OurStoredProps } from "@/lib/models/nba/store";
import { getOurNflView, type OurNflStored } from "@/lib/models/nfl/store";
import { SHORT } from "@/app/props/week";
import { price as am } from "../ui";
import s from "../picks.module.css";
import p from "./preview.module.css";

const TOP = 6;
const NBA_CARD_GAMES = 3;
const pctOf = (x: number) => `${(x * 100).toFixed(1)}%`;
const r1 = (x: number) => `${Math.round(x * 10) / 10}`;

type Board = OurStoredProps | OurNflStored;

export interface PropBox {
  key: string;
  player: string;
  team: string;
  bet: string;
  price: number;
  assumed: boolean;
  ours: number;
  breakEven: number;
  edgePct: number;
  gap: number;
  proj: number;
  david?: number;
}

/** The board's prop edges as boxes, best gap first. Pure. */
export function propBoxes(b: Board, nba: boolean): PropBox[] {
  return b.game.markets
    .filter((m) => m.clears && m.side && m.gap !== null)
    .filter((m) => !nba || ((b as OurStoredProps).extra[m.id]?.games ?? 0) >= NBA_CARD_GAMES)
    .flatMap((m: PropMarket): PropBox[] => {
      const side = m.side!;
      const x = b.extra[m.id] as { over: number; under: number; median?: number; price?: string } | undefined;
      const ours = x?.[side];
      if (ours === undefined) return [];
      const posted = m.books[0]?.[side] ?? null;
      const assumed = posted === null || x?.price === "assumed";
      const price = posted ?? -110;
      return [
        {
          key: m.id,
          player: m.player,
          team: m.team,
          bet: `${side === "over" ? "Over" : "Under"} ${m.line} ${SHORT[m.stat ?? ""] ?? m.statLabel.toLowerCase()}`,
          price,
          assumed,
          ours,
          breakEven: implied(price),
          edgePct: edgePerUnit(ours, price),
          gap: m.gap!,
          proj: x?.median ?? m.model,
          david: b.david?.[m.id],
        },
      ];
    })
    .sort((a, c) => c.gap - a.gap);
}

const nbaView = cache((season: number) => getOurNbaView(season).catch(() => null));
const nflView = cache((season: number) => getOurNflView(season).catch(() => null));

function Boxes({ boxes, href, empty, player }: { boxes: PropBox[] | null; href: string; empty: string; /** A player's props pop-up, from name and team. */ player?: (name: string, team: string) => string }) {
  return (
    <section aria-label="Props">
      <h3 className={p.h3}>Props · our model</h3>
      {boxes && boxes.length ? (
        <>
          <ul className={p.props}>
            {boxes.slice(0, TOP).map((x) => (
              <li key={x.key} className={p.prop}>
                <div className={p.propHead}>
                  <span className={p.propWho}>
                    {player && x.team ? <PopLink href={player(x.player, x.team)}>{x.player}</PopLink> : x.player}{" "}
                    <span className={s.dim}>{x.team}</span>
                  </span>
                  <span className={p.propBet}>
                    {x.bet} <span className={`${p.propMeta} ${s.num}`}>{x.assumed ? "-110, assumed" : `${am(x.price)} DK`}</span>
                  </span>
                </div>
                <dl className={`${p.stats} ${p.ours}`}>
                  <div>
                    <dt>Our chance</dt>
                    <dd className={s.num}>{pctOf(x.ours)}</dd>
                  </div>
                  <div>
                    <dt>Break-even</dt>
                    <dd className={s.num}>{pctOf(x.breakEven)}</dd>
                  </div>
                  <div>
                    <dt>Edge per unit</dt>
                    <dd className={`${s.num} ${x.edgePct >= 0 ? s.pos : s.neg}`}>{`${x.edgePct >= 0 ? "+" : ""}${x.edgePct.toFixed(1)}%`}</dd>
                  </div>
                  <div>
                    <dt>Projection</dt>
                    <dd className={s.num}>{r1(x.proj)}</dd>
                    {x.david !== undefined && <small className={`${p.statSub} ${s.cDavid}`}>{`David ${r1(x.david)}`}</small>}
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <p className={p.statNote}>{`${boxes.length > TOP ? `Top ${TOP} of ${boxes.length} by edge. ` : ""}Our chance is the model's, an estimate. Tracked only, not staked.`}</p>
        </>
      ) : (
        <p className={p.statNote}>{empty}</p>
      )}
      <a href={href} className={p.more}>
        See all on Props ›
      </a>
    </section>
  );
}

/** NBA: our props board for this ESPN event. */
export async function NbaGameProps({ id }: { id: string }) {
  const v = await nbaView(nbaSeasonOfDate(new Date()));
  const b = v?.board.find((g) => g.espnId === id || g.game.slug === id);
  return <Boxes boxes={b ? propBoxes(b, true) : null} player={(n, t) => playerPropHref("nba", t, n, id)} href="/props?m=nba" empty={!v ? "Couldn't load our NBA props just now." : b ? "No prop edges from our model in this game." : "No props board from our model for this game yet."} />;
}

/** NFL: our props board for this week's game between these two teams. */
export async function NflGameProps({ season, home, away }: { season: number; home: string; away: string }) {
  const v = await nflView(season);
  const b = v?.board.find((g) => g.home === home && g.away === away);
  return <Boxes boxes={b ? propBoxes(b, false) : null} player={(n, t) => playerPropHref("nfl", t, n, b?.espnId ?? b?.game.slug)} href="/props?m=pp" empty={!v ? "Couldn't load our NFL props just now." : b ? "No prop edges from our model in this game." : "No props board from our model for this game yet."} />;
}
