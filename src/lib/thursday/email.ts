import type { SurvivorReport } from "@/lib/survivor/types";
import { poolMeta } from "@/lib/survivor/pools";
import type { WeeklyLineups } from "@/lib/lineup/build";
import type { SlotAdvice } from "@/lib/lineup/weekly-advice";
import {
  card,
  emailPage,
  escapeHtml,
  generatedLine,
  label,
  PALETTE,
  pct,
  statCell,
  GOOD,
  WARN,
} from "@/lib/email/shell";

// The Thursday morning email: this week's survivor pick, and the lineup slots
// that actually need touching.
//
// The shape follows the FAAB guide deliberately. Same palette, same 560px
// column, same habit of leading with the decision rather than the workings,
// because both land on the same phone and a second house style is a third
// thing to maintain.
//
// The rule this email keeps: it is short when there is nothing to do. Four
// leagues of full lineups every week is a wall nobody reads, so a league that
// is already right gets one line saying so. What is left is the part Jack has
// to act on before kickoff.



export interface ThursdayInput {
  /** One per pool, in the order the pools are configured. Empty when the report failed. */
  survivors: SurvivorReport[];
  survivorError: string | null;
  lineups: WeeklyLineups;
  generatedAt: string;
  appUrl: string;
}

/**
 * Subject line: the pick, then whether anything needs doing.
 *
 * Both halves in one line because the inbox list shows one line, and "nothing
 * to change" is genuinely useful information at 8am on a Thursday.
 */
export function thursdaySubject(input: ThursdayInput): string {
  const { survivors, lineups } = input;
  const week = survivors[0]?.week ?? lineups.week;
  const changes = totalChanges(lineups);
  const tail =
    changes === 0
      ? "lineups all set"
      : `${changes} lineup change${changes === 1 ? "" : "s"}`;
  return `Week ${week}: ${subjectPick(survivors)}, ${tail}`;
}

/**
 * The pick half of the subject line.
 *
 * Both pools usually name the same team, and printing it twice reads as a bug
 * rather than as agreement, so agreement is stated once. Disagreement gets both
 * teams with the pool sizes attached, because which pool is which is the whole
 * question at that point.
 */
function subjectPick(survivors: SurvivorReport[]): string {
  if (survivors.length === 0) return "no survivor pick";

  const first = survivors[0];
  const allAgree = survivors.every((s) => s.bestTeam === first.bestTeam);
  if (allAgree) {
    const pick = `${first.bestTeam} over ${opponentOf(first)}`;
    return survivors.length > 1 ? `${pick} in both pools` : pick;
  }

  return survivors
    .map((s) => `${s.bestTeam} (${poolMeta(s.poolId).short})`)
    .join(" / ");
}

function opponentOf(survivor: SurvivorReport): string {
  const best = survivor.candidates.find((c) => c.team === survivor.bestTeam);
  return best?.opponent ?? "";
}

export function totalChanges(lineups: WeeklyLineups): number {
  return lineups.leagues.reduce((n, l) => n + l.advice.changes.length, 0);
}



/**
 * Every pool's pick, one card each.
 *
 * The pool is named on the card whenever there is more than one, because a
 * screenshot of the wrong pool's board is indistinguishable from the right one
 * otherwise, and the two pools carry different burned teams.
 */
function survivorSection(input: ThursdayInput): string {
  const { survivors, survivorError } = input;

  if (survivors.length === 0) {
    return card(
      `${label("Survivor")}<div style="font:400 14px/1.55 -apple-system,sans-serif;color:${PALETTE.body};">No pick this week. ${escapeHtml(survivorError ?? "The report could not be built.")}</div>`,
      WARN,
    );
  }

  return survivors
    .map((s) => survivorBlock(s, survivors.length > 1 ? s.pool.name : null))
    .join("");
}

function survivorBlock(survivor: SurvivorReport, poolName: string | null): string {

  const best = survivor.candidates.find((c) => c.team === survivor.bestTeam);
  // "Wed 8:20p" rather than "Wed 8:20 PM". The stat cells are a quarter of a
  // 560px column and the longer form wraps onto two lines on a phone, which
  // pushes the row out of line with the three numbers beside it.
  const locks = survivor.locksAt
    ? new Date(survivor.locksAt)
        .toLocaleString("en-US", {
          timeZone: "America/New_York",
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        })
        .replace(/\s*AM$/, "a")
        .replace(/\s*PM$/, "p")
        .replace(",", "")
    : null;

  const stats = best
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
  <tr>
    ${statCell("Win", pct(best.winProb))}
    ${statCell("Field on it", pct(best.ownership))}
    ${statCell("Equity", `${best.equityMultiplier.toFixed(2)}x`)}
    ${locks ? statCell("Locks", locks) : ""}
  </tr>
</table>`
    : "";

  const why = survivor.reasoning
    .slice(0, 3)
    .map(
      (r) =>
        `<div style="font:400 13px/1.55 -apple-system,sans-serif;color:${PALETTE.body};padding-top:6px;">${escapeHtml(r)}</div>`,
    )
    .join("");

  // The two teams it was chosen over, and why each lost.
  //
  // "LAC wins 80.4% of the time" is a fact about LAC, not a reason to pick it.
  // The reason is always comparative: the alternatives are either less likely
  // to win, more heavily owned, or needed in a later week. Without them the
  // pick is an assertion.
  const runnersUp = survivor.candidates
    .filter((c) => c.team !== survivor.bestTeam)
    .slice(0, 2)
    .map((c, i) => {
      const bits = [`${pct(c.winProb)} win`, `${pct(c.ownership)} owned`];
      if (c.futureCost > 0 && c.bestFutureWeek) {
        bits.push(`wanted in week ${c.bestFutureWeek}`);
      }
      return `<div style="font:400 12px/1.5 -apple-system,sans-serif;color:${PALETTE.body};padding-top:${i === 0 ? 6 : 3}px;">
  <span style="font-weight:600;color:${PALETTE.ink};">${i + 2}. ${escapeHtml(c.team)}</span>
  <span style="color:${PALETTE.muted};"> over ${escapeHtml(c.opponent)}</span>
  &middot; ${escapeHtml(bits.join(", "))}
  &middot; ${escapeHtml(equityLine(c, best))}
</div>`;
    })
    .join("");

  const plan = survivor.plan
    .slice(1, 4)
    .map((p) => `W${p.week} ${escapeHtml(p.team)}`)
    .join(" &middot; ");

  // What the pool is playing for, which is what decided a tie if there was one.
  const posture = `<div style="font:400 12px/1.5 -apple-system,sans-serif;color:${PALETTE.muted};padding-top:4px;">${escapeHtml(survivor.posture.summary)}</div>`;

  return card(
    `${label(poolName ? `Survivor pick, ${poolName}` : "Survivor pick")}
<div style="font:700 22px/1.25 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${PALETTE.ink};letter-spacing:-.01em;">${escapeHtml(survivor.headline)}</div>
${posture}
${stats}
${why}
${runnersUp ? `<div style="padding-top:12px;margin-top:12px;border-top:1px solid ${PALETTE.hairline};">${label("What it beat")}${runnersUp}</div>` : ""}
${plan ? `<div style="font:400 12px/1.5 -apple-system,sans-serif;color:${PALETTE.muted};padding-top:12px;border-top:1px solid ${PALETTE.hairline};margin-top:12px;">Then: ${plan}</div>` : ""}`,
  );
}

/** Why this candidate lost to the pick, in one clause. */
function equityLine(
  c: SurvivorReport["candidates"][number],
  best: SurvivorReport["candidates"][number] | undefined,
): string {
  if (!best) return `${c.equityMultiplier.toFixed(2)}x equity`;
  if (c.winProb < best.winProb - 0.005) {
    const gap = (best.winProb - c.winProb) * 100;
    return `${gap.toFixed(1)} points less likely to win`;
  }
  if (c.equityMultiplier < best.equityMultiplier) {
    return `${c.equityMultiplier.toFixed(2)}x equity against ${best.equityMultiplier.toFixed(2)}x`;
  }
  if (c.futureCost > 0) return "worth more in a later week";
  return `${c.equityMultiplier.toFixed(2)}x equity`;
}


function changeRow(slot: SlotAdvice): string {
  return `<div style="padding:8px 0;border-top:1px solid ${PALETTE.hairline};">
  <div style="font:600 13px/1.4 -apple-system,sans-serif;color:${PALETTE.ink};">
    <span style="display:inline-block;background:${PALETTE.warnBg};color:${PALETTE.warn};border:1px solid ${PALETTE.warnBorder};border-radius:5px;padding:1px 6px;font:600 10px/1.5 -apple-system,sans-serif;letter-spacing:.04em;margin-right:6px;">${escapeHtml(slot.slot)}</span>
    ${escapeHtml(slot.recommended?.name ?? "(empty)")}
  </div>
  <div style="font:400 12px/1.5 -apple-system,sans-serif;color:${PALETTE.body};padding-top:3px;">${escapeHtml(slot.reason)}</div>
</div>`;
}

function leagueBlock(league: WeeklyLineups["leagues"][number]): string {
  const head = `<div style="font:600 14px/1.3 -apple-system,sans-serif;color:${PALETTE.ink};">${escapeHtml(league.leagueName)}</div>
<div style="font:400 11px/1.4 -apple-system,sans-serif;color:${PALETTE.muted};padding-top:2px;">${escapeHtml(league.scoringLabel)}</div>`;

  if (league.error) {
    return card(
      `${head}<div style="font:400 13px/1.5 -apple-system,sans-serif;color:${PALETTE.warn};padding-top:8px;">Could not be checked: ${escapeHtml(league.error)}</div>`,
      WARN,
    );
  }

  const problems = league.advice.problems
    .map(
      (p) =>
        `<div style="font:400 12px/1.5 -apple-system,sans-serif;color:${PALETTE.warn};padding-top:4px;">${escapeHtml(p.player.name)} is ${escapeHtml(p.why)}.</div>`,
    )
    .join("");

  const superflex = league.advice.superflexFellThrough
    ? `<div style="font:400 12px/1.5 -apple-system,sans-serif;color:${PALETTE.warn};padding-top:4px;">No second quarterback available, so superflex is taking a flex player.</div>`
    : "";

  // Said out loud, because the adjustment is not decoration. The lineup sorts
  // by the adjusted rank where there is one, so a number this app computed can
  // override the order he published, and Jack should never have to guess which
  // of the two picked a starter.
  const ours = league.advice.adjustmentDecided
    .map(
      (d) =>
        `<div style="font:400 12px/1.5 -apple-system,sans-serif;color:${PALETTE.body};padding-top:4px;">
  <span style="font-weight:600;">${escapeHtml(d.started.name)}</span> starts at ${escapeHtml(d.slot)} on our adjustment, not his ranking. He has him at FLEX ${escapeHtml(String(d.started.flexRank ?? "?"))}, and full PPR here moves him to ${escapeHtml(String(d.started.adjustedFlexRank ?? "?"))}${d.insteadOf ? `, ahead of ${escapeHtml(d.insteadOf.name)}` : ""}.
</div>`,
    )
    .join("");

  if (league.advice.changes.length === 0) {
    return card(
      `${head}
<div style="font:600 13px/1.5 -apple-system,sans-serif;color:${PALETTE.good};padding-top:8px;">Nothing to change.</div>
${problems}${superflex}${ours}`,
      GOOD,
    );
  }

  return card(
    `${head}
<div style="padding-top:6px;">${league.advice.changes.map(changeRow).join("")}</div>
${problems}${superflex}${ours}`,
  );
}

export function renderThursdayEmail(input: ThursdayInput): string {
  const { lineups } = input;
  const changes = totalChanges(input.lineups);

  const lineupSection = lineups.blocked
    ? card(
        `${label("Lineups")}<div style="font:400 14px/1.55 -apple-system,sans-serif;color:${PALETTE.body};">${escapeHtml(lineups.blocked)}</div>`,
        WARN,
      )
    : `${label(changes === 0 ? "Lineups, all set" : `Lineups, ${changes} to change`)}${lineups.leagues.map(leagueBlock).join("")}`;

  // Named once at the bottom rather than per league, because it is the same
  // sentence four times otherwise. The per-league scoring line above already
  // says which leagues it applies to.
  const skew = new Set(lineups.leagues.flatMap((l) => l.skewNotes));
  const provenance = lineups.blocked
    ? ""
    : `<div style="font:400 11px/1.55 -apple-system,sans-serif;color:${PALETTE.muted};padding-top:6px;">
  Lineups from ${escapeHtml(lineups.listTitle ?? "his weekly rankings")}${lineups.listUpdatedLabel ? `, which he last updated ${escapeHtml(lineups.listUpdatedLabel)}` : ""}. He ranks for ${escapeHtml((lineups.listScoring ?? "half_ppr").replace("_", " "))}.
  ${[...skew].map((n) => escapeHtml(n)).join(" ")}
</div>`;

  const week = input.survivors[0]?.week ?? lineups.week;

  return emailPage({
    title: thursdaySubject(input),
    kicker: `Thursday \u00b7 Week ${week ?? ""}`,
    heading: "Before kickoff",
    preheader:
      changes === 0
        ? "Nothing to change in any league."
        : `${changes} slots to change before kickoff.`,
    body: `${survivorSection(input)}<div style="padding-top:6px;">${lineupSection}</div>`,
    cta: { href: `${input.appUrl}/survivor`, text: "Open survivor" },
    footnote: `${provenance}<div style="padding-top:6px;">${generatedLine(input.generatedAt)}</div>`,
  });
}
