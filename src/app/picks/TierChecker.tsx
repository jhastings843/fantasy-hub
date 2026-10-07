"use client";

import { useState } from "react";
import { type CutTest, matches, read } from "@/lib/picks/engine";
import s from "./picks.module.css";

// The same test the server ran on the record, run on three numbers typed in.
// For a game whose line has moved since the board was built, or a game the
// board does not have.

interface Props {
  rule: { label: string; test: CutTest; record: string } | null;
  second: { label: string; test: CutTest; record: string } | null;
  example: { vegas: number; sam: number; david: number; label: string } | null;
}

const fmt = (x: number) => (x === 0 ? "PK" : `${x > 0 ? "+" : ""}${x}`);

export default function TierChecker({ rule, second, example }: Props) {
  const [vg, setVg] = useState(example ? String(example.vegas) : "-3.5");
  const [sm, setSm] = useState(example ? String(example.sam) : "-1.0");
  const [dm, setDm] = useState(example ? String(example.david) : "-0.5");

  const v = parseFloat(vg);
  const a = parseFloat(sm);
  const d = parseFloat(dm);

  let cls = s.out;
  let title = "Enter all three lines";
  let body = "Use home-team spreads, like -3.5.";

  if (![v, a, d].some(Number.isNaN)) {
    const r = read({ market: v, model: a }, { market: v, model: d });
    if (!r.agree || r.line === undefined) {
      title = "Pass · split";
      body = `The models land on different sides of ${fmt(v)}.`;
    } else {
      const who = `${r.side === "home" ? "Home" : "Away"} ${r.dog ? "dog" : "favorite"} ${fmt(r.line)}, avg edge ${r.avgEdge.toFixed(1)}.`;
      if (rule && matches(r, rule.test)) {
        cls = `${s.out} ${s.outT1}`;
        title = "Tier 1 · bet";
        body = `${who} Fits the current rule (${rule.label}, ${rule.record}).`;
      } else if (second && matches(r, second.test)) {
        cls = `${s.out} ${s.outT2}`;
        title = "Tier 2 · small";
        body = `${who} Fits the runner-up cut (${second.label}, ${second.record}).`;
      } else {
        title = r.dog ? "Pass" : "Pass · favorite";
        body = `${who} Both agree, but it fits neither the rule nor the runner-up.`;
      }
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
      <div className={cls} aria-live="polite">
        <b>{title}</b>
        <span>{body}</span>
      </div>
      <div className={s.hint}>
        Use home-team spreads: negative means the home team is favored. Both models must sit on the same side of the Vegas
        number to count as agreement.{example ? ` Prefilled with ${example.label}.` : ""}
      </div>
    </div>
  );
}
