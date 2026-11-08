import type { Book, ResearchSwitch } from "@/lib/money/types";
import Link from "next/link";
import s from "../picks/picks.module.css";
import m from "./money.module.css";
import { Term } from "./Term";

// The TQQQ/SQQQ switch (trade-bot research_switch, a stock book since 2026-11-07):
// TQQQ when the /stocks outlook leans up, SQQQ when it leans down, BIL (T-bills)
// otherwise. Stock only, no options. Shown on Stock books and its own book page.

export const LEAN: Record<string, { label: string; cls: string }> = {
  TQQQ: { label: "Leans up", cls: s.readW },
  SQQQ: { label: "Leans down", cls: s.readL },
  BIL: { label: "No lean", cls: s.readTrack },
};

const LEAN_DEF =
  "Read from the /stocks daily outlook. Weeks call up or down at medium or high confidence (with the days call not pointing the other way), or days and weeks agreeing, counts as a lean. Anything else is no lean, and the book sits in T-bills (BIL) to avoid the drag 3x funds take in choppy markets.";

const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const pct = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n * 100).toFixed(2)}%`;

export const SWITCH_ID = "research-switch";

/** The research lean log behind the switch: what it held each morning and why. */
export function SwitchLean({ rs, book, rows = 10, link = false }: { rs?: ResearchSwitch | null; book?: Book | null; rows?: number; link?: boolean }) {
  const log = rs?.log ?? [];
  const hold = book ? book.positions.find((p) => p.symbol !== "BIL")?.symbol ?? "BIL" : null;
  const ret = book ? book.equity / book.start - 1 : null;
  const spy = book?.spyEquity != null ? book.spyEquity / book.start - 1 : null;
  return (
    <div className={m.panel}>
      <div className={m.panelHead}>
        <h2 className={m.panelTitle}>
          {"TQQQ/SQQQ switch: "}
          <Term label="research lean" def={LEAN_DEF} />
        </h2>
        {link && book ? (
          <Link className={m.panelLink} href={`/money/book/${SWITCH_ID}`}>Open the book</Link>
        ) : (
          <span className={m.foldMeta}>from the 6pm /stocks outlook</span>
        )}
      </div>
      {!book && <p className={m.sub}>Stock only: TQQQ, SQQQ, or T-bills (BIL), $100,000 paper. First trade at the next 6:30am run (Tuesday to Saturday).</p>}
      {book && ret !== null && (
        <p className={m.sub}>
          {`Holds ${hold}. Book `}
          <span className={ret > 0 ? s.pos : ret < 0 ? s.neg : ""}>{pct(ret)}</span>
          {spy !== null ? `, SPY ${pct(spy)} over the same days.` : "."}
        </p>
      )}
      {log.length ? (
        <ul className={m.grades}>
          {log.slice(0, rows).map((r) => {
            const l = LEAN[r.hold] ?? LEAN.BIL;
            return (
              <li key={r.as_of} className={m.grade}>
                <span className={s.play}>{shortDay(r.as_of)}</span>
                <span className={`${s.readChip} ${l.cls}`}>{`${l.label} · ${r.hold}`}</span>
                <span className={m.why}>{r.why}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={m.sub}>No reads yet. The switch logs one each morning at 6:30am, Tuesday to Saturday.</p>
      )}
      {rs?.rule && <p className={s.thin}>{`Rule: ${rs.rule}`}</p>}
    </div>
  );
}
