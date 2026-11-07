import Link from "next/link";
import { Fragment } from "react";
import { ScopeScroll } from "./ScopeScroll";
import s from "./picks.module.css";

// The picks and props headers, folded (UX pass item 3, 2026-11-06). Before:
// sport, market, view and "How it works" were four wrapping rows that filled a
// phone's first screen. Now:
//   row 1  NFL CFB NBA CBB | Spreads Straight up Totals   (one line, scrolls sideways)
//   row 2  Board  Results  Lab
//   Lab    Research · Learner log · How it works            (only while in Lab)
// Old ?v=research and ?v=log links still work; they open inside Lab.

export interface Tab {
  key: string;
  label: string;
  href: string;
  current?: boolean;
}

export function ScopeRow({ groups, label = "Sport and market" }: { groups: Tab[][]; label?: string }) {
  return (
    <ScopeScroll className={`${s.chips} ${s.scopeRow}`} label={label}>
      {groups
        .filter((g) => g.length)
        .map((g, i) => (
          <Fragment key={i}>
            {i > 0 && <span className={s.scopeSep} aria-hidden />}
            {g.map((t) => (
              <Link key={t.key} href={t.href} aria-current={t.current ? "page" : undefined} className={s.chip}>
                {t.label}
              </Link>
            ))}
          </Fragment>
        ))}
    </ScopeScroll>
  );
}

/** Board, Results, Lab. `lab` is every research-type page; Lab opens the first. */
export function ViewTabs({ board, results, lab }: { board: Tab; results?: Tab; lab: Tab[] }) {
  const inLab = lab.some((t) => t.current);
  return (
    <div className={s.viewStack}>
      <nav className={s.chips} aria-label="View">
        {[board, ...(results ? [results] : [])].map((t) => (
          <Link key={t.key} href={t.href} aria-current={t.current ? "page" : undefined} className={s.chip}>
            {t.label}
          </Link>
        ))}
        {lab.length > 0 && (
          <Link href={lab[0].href} aria-current={inLab ? "page" : undefined} className={s.chip}>
            Lab
          </Link>
        )}
      </nav>
      {inLab && (
        <nav className={s.labRow} aria-label="Lab">
          {lab.map((t) => (
            <Link key={t.key} href={t.href} aria-current={t.current ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
