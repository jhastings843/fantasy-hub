"use client";

import { useState } from "react";
import { type CutTest, type StrategyBoard, tierBoard } from "@/lib/picks/engine";
import s from "./picks.module.css";

// The board's own tiering (tierBoard), run on numbers typed in: one current
// line, each model's line, and PEM's on the college tab. For a game whose line
// has moved since the board was built, or a game the board does not have.
// Because it is the same function, the checker and the board cannot disagree.

interface Props {
  rule: { label: string; test: CutTest; record: string } | null;
  second: { label: string; test: CutTest; record: string } | null;
  example: { vegas: number; sam: number; david: number; pem?: number; label: string } | null;
  /** College: show PEM's line. */
  pem?: boolean;
  /** The rule or Tier 2 depends on PEM. */
  pemNeeded?: boolean;
}

const fmt = (x: number) => (x === 0 ? "PK" : `${x > 0 ? "+" : ""}${x}`);

export default function TierChecker({ rule, second, example, pem = false, pemNeeded = false }: Props) {
  const [vg, setVg] = useState(example ? String(example.vegas) : "-3.5");
  const [sm, setSm] = useState(example ? String(example.sam) : "-1.0");
  const [dm, setDm] = useState(example ? String(example.david) : "-0.5");
  const [pm, setPm] = useState(example?.pem !== undefined ? String(example.pem) : "");

  const v = parseFloat(vg);
  const a = parseFloat(sm);
  const d = parseFloat(dm);
  const p = parseFloat(pm);

  let cls = s.out;
  let title = "Enter all three lines";
  let body = "Use home-team spreads, like -3.5.";

  if (![v, a, d].some(Number.isNaN)) {
    const strategies = {
      rule: rule ? { test: rule.test } : null,
      second: second ? { test: second.test } : null,
    } as unknown as StrategyBoard;
    const [g] = tierBoard(
      pem ? "cfb" : "nfl",
      [
        {
          home: "home",
          away: "away",
          sam: { market: v, model: a },
          david: { market: v, model: d },
          pem: pem && !Number.isNaN(p) ? { model: p } : undefined,
          ref: { line: v, source: "typed", fetchedAt: "" },
        },
      ],
      strategies,
    );
    const r = g.read!;
    const side = (x: "home" | "away") => (x === "home" ? "Home" : "Away");
    const who =
      g.side && g.homeLine !== undefined
        ? `${side(g.side)} ${fmt(g.side === "home" ? g.homeLine : -g.homeLine)}${r.agree ? `, avg edge ${r.avgEdge.toFixed(1)}` : ""}.`
        : "";
    if (g.tier === "t1") {
      cls = `${s.out} ${s.outT1}`;
      title = "Tier 1 · 1u bet";
      body = `${who} ${g.pemPick ? "PEM breaks the split. " : ""}Fits the current rule (${rule!.label}, ${rule!.record}).`;
    } else if (g.tier === "t2") {
      cls = `${s.out} ${s.outT2}`;
      title = "Tier 2 · 0.5u bet";
      body = `${who} Fits Tier 2 (${second!.label}, ${second!.record}).`;
    } else if (g.tier === "wait") {
      title = "Needs PEM's line";
      body = `${who} ${g.waitFor === "t1" ? "Tier 1" : "Tier 2"} if PEM agrees. Enter PEM's line to decide it.`;
    } else if (!r.agree) {
      title = "Pass · split";
      body = `The models land on different sides of ${fmt(v)}.`;
    } else {
      title = r.dog ? "Pass" : "Pass · favorite";
      body = `${who} Both agree, but it fits neither Tier 1 nor Tier 2.`;
    }
  }

  return (
    <div className={s.checker}>
      <label className={s.label} htmlFor="pk-vegas">
        Vegas line (home team)
        <input id="pk-vegas" className={s.input} type="number" step="0.5" inputMode="decimal" value={vg} onChange={(e) => setVg(e.target.value)} />
      </label>
      <label className={s.label} htmlFor="pk-sam">
        Sam&apos;s model line (home)
        <input id="pk-sam" className={s.input} type="number" step="0.1" inputMode="decimal" value={sm} onChange={(e) => setSm(e.target.value)} />
      </label>
      <label className={s.label} htmlFor="pk-david">
        David&apos;s model line (home)
        <input id="pk-david" className={s.input} type="number" step="0.1" inputMode="decimal" value={dm} onChange={(e) => setDm(e.target.value)} />
      </label>
      {pem && (
        <label className={s.label} htmlFor="pk-pem">
          PEM&apos;s line (home){pemNeeded ? "" : ", optional"}
          <input id="pk-pem" className={s.input} type="number" step="0.1" inputMode="decimal" value={pm} placeholder="not on file" onChange={(e) => setPm(e.target.value)} />
        </label>
      )}
      <div className={cls} aria-live="polite">
        <b>{title}</b>
        <span>{body}</span>
      </div>
      <div className={s.hint}>
        Use home-team spreads: negative means the home team is favored. Every model is judged at the one current line you
        enter, the same way the board is. Both must sit on the same side of it to count as agreement.{example ? ` Prefilled with ${example.label}.` : ""}
      </div>
    </div>
  );
}
