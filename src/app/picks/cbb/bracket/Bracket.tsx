"use client";

// The bracket graphic and the team sheet. Desktop: four regions flowing into
// the Final Four in the middle, with connector lines. Phones: one region at a
// time, round by round, plus a Final Four tab. Every team row is a button
// that opens the team's round-by-round odds against the public.

import { useEffect, useRef, useState } from "react";
import { TeamLogo } from "@/components/TeamLogo";
import { gameTeams, OFFSET, ROUND_OF, ROUNDS, type Picks, type Prepared } from "@/lib/models/cbb/bracket";
import b from "./bracket.module.css";

export const pct = (x: number) => {
  if (x >= 0.995) return ">99%";
  if (x > 0 && x < 0.001) return "<0.1%";
  if (x < 0.1) return `${(x * 100).toFixed(1)}%`;
  return `${Math.round(x * 100)}%`;
};
/** Whole percents for the bracket cells, where space is tight. */
const bpct = (x: number) => (x >= 0.995 ? ">99%" : x < 0.01 ? "<1%" : `${Math.round(x * 100)}%`);
export const pts = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}`;

const COL_NAMES = ["First round", "Second round", "Sweet 16", "Elite Eight"];

interface Ctx {
  p: Prepared;
  picks: Picks;
  sel: number | null;
  onPick: (slot: number) => void;
}

function Row({ ctx, k, slot, opp, big }: { ctx: Ctx; k: number; slot: number; opp: number; big?: boolean }) {
  const { p, picks, sel, onPick } = ctx;
  const t = p.teams[slot];
  const won = picks[k] === slot;
  const upset = won && t.seed > p.teams[opp].seed;
  const h2h = p.win[slot * 64 + opp];
  const cls = [b.team, won ? b.win : "", upset ? b.upset : "", sel === slot ? b.sel : ""].join(" ");
  const label = `${t.seed} ${t.short}, ${pct(h2h)} to beat ${p.teams[opp].short}${won ? (upset ? ", picked, upset" : ", picked") : ""}`;
  return (
    <button type="button" className={cls} onClick={() => onPick(slot)} aria-label={label} title={label}>
      <span className={b.seed}>{t.seed}</span>
      <TeamLogo league="cfb" espnId={t.id} size={big ? 20 : 16} className={b.logo} />
      <span className={b.tname}>
        {t.short}
        {upset && <span className={b.flag}>UPSET</span>}
      </span>
      <span className={b.pct}>{bpct(h2h)}</span>
    </button>
  );
}

function Game({ ctx, k, big }: { ctx: Ctx; k: number; big?: boolean }) {
  const [a, c] = gameTeams(k, ctx.picks);
  return (
    <div className={`${b.game} ${big ? b.centerGame : ""}`} role="group" aria-label={`${ROUNDS[ROUND_OF[k]] === "Champion" ? "Title game" : "Game"}: ${ctx.p.teams[a].short} vs ${ctx.p.teams[c].short}`}>
      <Row ctx={ctx} k={k} slot={a} opp={c} big={big} />
      <Row ctx={ctx} k={k} slot={c} opp={a} big={big} />
    </div>
  );
}

const regionGames = (ri: number, r: number) => Array.from({ length: 8 >> r }, (_, j) => OFFSET[r] + ri * (8 >> r) + j);

function Region({ ctx, ri, flip }: { ctx: Ctx; ri: number; flip?: boolean }) {
  const name = ctx.p.regions[ri];
  const winner = ctx.picks[OFFSET[3] + ri];
  return (
    <section className={flip ? b.flip : ""} aria-label={`${name} region`}>
      <div className={b.regionHead}>
        <b>{name}</b>
        <span>{`Winner: ${ctx.p.teams[winner].short}`}</span>
      </div>
      <div className={b.rounds} aria-hidden>
        {COL_NAMES.map((c) => (
          <span key={c} style={{ direction: "ltr" }}>
            {c}
          </span>
        ))}
      </div>
      <div className={b.region}>
        {[0, 1, 2, 3].map((r) => (
          <div key={r} className={b.col}>
            {regionGames(ri, r).map((k) => (
              <div key={k} className={b.slot}>
                <Game ctx={ctx} k={k} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function Trophy({ ctx }: { ctx: Ctx }) {
  const c = ctx.p.teams[ctx.picks[62]];
  return (
    <button type="button" className={b.trophy} onClick={() => ctx.onPick(ctx.picks[62])} aria-label={`Champion pick: ${c.short}`}>
      <small>Champion</small>
      <span className={b.trophyLogo}>
        <TeamLogo league="cfb" espnId={c.id} size={38} />
      </span>
      <b>{c.short}</b>
      <small>{`${c.seed} seed, ${c.region}`}</small>
    </button>
  );
}

function Center({ ctx }: { ctx: Ctx }) {
  const [r0, r1, r2, r3] = ctx.p.regions;
  return (
    <div className={b.center}>
      <div className={b.centerHead}>Final Four</div>
      <Trophy ctx={ctx} />
      <div>
        <div className={b.centerLabel}>{`Semifinal: ${r0} vs ${r1}`}</div>
        <Game ctx={ctx} k={60} big />
      </div>
      <div>
        <div className={b.centerLabel}>Title game</div>
        <Game ctx={ctx} k={62} big />
      </div>
      <div>
        <div className={b.centerLabel}>{`Semifinal: ${r2} vs ${r3}`}</div>
        <Game ctx={ctx} k={61} big />
      </div>
    </div>
  );
}

function Stack({ ctx, ri }: { ctx: Ctx; ri: number }) {
  return (
    <div className={b.stack}>
      {[0, 1, 2, 3].map((r) => (
        <div key={r} className={b.stackRound}>
          <h4>
            <span>{COL_NAMES[r]}</span>
            <span>{r === 3 ? `${ctx.p.regions[ri]} final` : `${8 >> r} games`}</span>
          </h4>
          <div className={`${b.stackGrid} ${r === 3 ? b.stackOne : ""}`}>
            {regionGames(ri, r).map((k) => (
              <Game key={k} ctx={ctx} k={k} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StackFinal({ ctx }: { ctx: Ctx }) {
  const [r0, r1, r2, r3] = ctx.p.regions;
  return (
    <div className={b.stack}>
      <div className={b.stackRound}>
        <h4>
          <span>Semifinals</span>
          <span>{`${r0} vs ${r1}, ${r2} vs ${r3}`}</span>
        </h4>
        <div className={b.stackGrid}>
          <Game ctx={ctx} k={60} />
          <Game ctx={ctx} k={61} />
        </div>
      </div>
      <div className={b.stackRound}>
        <h4>
          <span>Title game</span>
        </h4>
        <div className={`${b.stackGrid} ${b.stackOne}`}>
          <Game ctx={ctx} k={62} />
        </div>
      </div>
      <div style={{ maxWidth: 320 }}>
        <Trophy ctx={ctx} />
      </div>
    </div>
  );
}

export function BracketGraphic({ p, picks, sel, onPick }: Ctx) {
  const ctx: Ctx = { p, picks, sel, onPick };
  const [tab, setTab] = useState(0);
  const tabs = [...p.regions, "Final Four"];
  return (
    <>
      <div className={b.scroller}>
        <div className={`${b.full} ${sel !== null ? b.dimmed : ""}`}>
          <div className={b.half}>
            <Region ctx={ctx} ri={0} />
            <Region ctx={ctx} ri={1} />
          </div>
          <Center ctx={ctx} />
          <div className={b.half}>
            <Region ctx={ctx} ri={2} flip />
            <Region ctx={ctx} ri={3} flip />
          </div>
        </div>
      </div>
      <div className={b.phone}>
        <div className={b.tabs} role="tablist" aria-label="Region">
          {tabs.map((t, i) => (
            <button key={t} type="button" role="tab" aria-selected={tab === i} onClick={() => setTab(i)}>
              {t}
            </button>
          ))}
        </div>
        <div role="tabpanel" aria-label={tabs[tab]} className={sel !== null ? b.dimmed : ""}>
          {tab < 4 ? <Stack ctx={ctx} ri={tab} /> : <StackFinal ctx={ctx} />}
        </div>
      </div>
    </>
  );
}

/** One team's odds, round by round, against the public; marks the rounds this bracket has them winning. */
export function TeamSheet({ p, slot, picks, estimated, onClose }: { p: Prepared; slot: number; picks: Picks; estimated: boolean; onClose: () => void }) {
  const t = p.teams[slot];
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  let reach = -1;
  for (let k = 0; k < 63; k++) if (picks[k] === slot) reach = Math.max(reach, ROUND_OF[k]);
  const reachText = reach < 0 ? "This bracket has them losing their first game." : reach === 5 ? "This bracket has them winning it all." : `This bracket has them reaching the ${ROUNDS[reach]}.`;
  const max = Math.max(...p.adv.map((r) => r[slot]), ...p.pub.map((r) => r[slot]), 0.01);
  return (
    <>
      <div className={b.sheetBack} onClick={onClose} aria-hidden />
      <div className={b.sheet} role="dialog" aria-modal="true" aria-label={`${t.short}: odds by round`}>
        <div className={b.sheetHead}>
          <span className={b.sheetLogo}>
            <TeamLogo league="cfb" espnId={t.id} size={36} />
          </span>
          <div>
            <div className={b.sheetName}>{t.short}</div>
            <div className={b.sheetMeta}>{`${t.seed} seed in the ${t.region}, ${t.conf}. Rated ${t.rating >= 0 ? "+" : ""}${t.rating.toFixed(1)} pts vs an average team`}</div>
          </div>
          <button ref={ref} type="button" className={b.close} onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className={b.sheetNote}>{reachText}</p>
        <div className={b.sheetKey}>
          <span>
            <i className={b.cmpModel} />
            Model
          </span>
          <span>
            <i className={b.cmpPub} />
            {estimated ? "Public (estimate)" : "Public"}
          </span>
          <span style={{ marginLeft: "auto" }}>Chance to reach, edge in pts</span>
        </div>
        <div>
          {ROUNDS.map((name, r) => {
            const m = p.adv[r][slot];
            const pu = p.pub[r][slot];
            const lev = m - pu;
            return (
              <div key={name} className={b.rRow}>
                <b className={r <= reach ? b.rPicked : ""}>{name === "Champion" ? "Win title" : name}</b>
                <div className={b.cmp}>
                  <span>
                    <i className={b.cmpModel} style={{ width: `${((m / max) * 100).toFixed(2)}%` }} />
                    {pct(m)}
                  </span>
                  <span>
                    <i className={b.cmpPub} style={{ width: `${((pu / max) * 100).toFixed(2)}%` }} />
                    {pct(pu)}
                  </span>
                </div>
                <span className={`${b.rLev} ${Math.abs(lev) < 0.005 ? b.muted : lev > 0 ? b.pos : b.neg}`}>{pts(lev)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
