import type { SurvivorReport } from "@/lib/survivor/types";
import type { WeeklyLineups } from "@/lib/lineup/build";
import type { SlotAdvice } from "@/lib/lineup/weekly-advice";

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

const PALETTE = {
  ink: "#18181b",
  body: "#52525b",
  muted: "#a1a1aa",
  hairline: "#e4e4e7",
  surface: "#ffffff",
  page: "#fafaf9",
  accent: "#2563eb",
  good: "#047857",
  goodBg: "#ecfdf5",
  goodBorder: "#a7f3d0",
  warn: "#b45309",
  warnBg: "#fffbeb",
  warnBorder: "#fde68a",
};

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export interface ThursdayInput {
  survivor: SurvivorReport | null;
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
  const { survivor, lineups } = input;
  const week = survivor?.week ?? lineups.week;
  const pick = survivor ? `${survivor.bestTeam} over ${opponentOf(survivor)}` : "no survivor pick";
  const changes = totalChanges(lineups);
  const tail =
    changes === 0
      ? "lineups all set"
      : `${changes} lineup change${changes === 1 ? "" : "s"}`;
  return `Week ${week}: ${pick}, ${tail}`;
}

function opponentOf(survivor: SurvivorReport): string {
  const best = survivor.candidates.find((c) => c.team === survivor.bestTeam);
  return best?.opponent ?? "";
}

export function totalChanges(lineups: WeeklyLineups): number {
  return lineups.leagues.reduce((n, l) => n + l.advice.changes.length, 0);
}

function card(inner: string, tint?: { bg: string; border: string }): string {
  const bg = tint?.bg ?? PALETTE.surface;
  const border = tint?.border ?? PALETTE.hairline;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bg};border:1px solid ${border};border-radius:12px;margin-bottom:12px;">
  <tr><td style="padding:16px 18px;">${inner}</td></tr>
</table>`;
}

function label(text: string): string {
  return `<div style="font:600 10px/1.3 -apple-system,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${PALETTE.muted};padding-bottom:6px;">${escapeHtml(text)}</div>`;
}

function survivorBlock(input: ThursdayInput): string {
  const { survivor, survivorError } = input;

  if (!survivor) {
    return card(
      `${label("Survivor")}<div style="font:400 14px/1.55 -apple-system,sans-serif;color:${PALETTE.body};">No pick this week. ${escapeHtml(survivorError ?? "The report could not be built.")}</div>`,
      { bg: PALETTE.warnBg, border: PALETTE.warnBorder },
    );
  }

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

  return card(
    `${label("Survivor pick")}
<div style="font:700 22px/1.25 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${PALETTE.ink};letter-spacing:-.01em;">${escapeHtml(survivor.headline)}</div>
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

function statCell(name: string, value: string): string {
  return `<td width="25%" style="padding-right:8px;">
  <div style="font:600 16px/1.2 -apple-system,sans-serif;color:${PALETTE.ink};">${escapeHtml(value)}</div>
  <div style="font:400 10px/1.3 -apple-system,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};padding-top:2px;">${escapeHtml(name)}</div>
</td>`;
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
      { bg: PALETTE.warnBg, border: PALETTE.warnBorder },
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
      { bg: PALETTE.goodBg, border: PALETTE.goodBorder },
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
        { bg: PALETTE.warnBg, border: PALETTE.warnBorder },
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

  const week = input.survivor?.week ?? lineups.week;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(thursdaySubject(input))}</title>
</head>
<body style="margin:0;padding:0;background:${PALETTE.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(
    changes === 0 ? "Nothing to change in any league." : `${changes} slots to change before kickoff.`,
  )}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.page};padding:20px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr>
          <td style="padding-bottom:16px;">
            <div style="font:600 10px/1.3 -apple-system,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${PALETTE.muted};">
              Thursday &middot; Week ${escapeHtml(String(week ?? ""))}
            </div>
            <div style="font:600 20px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${PALETTE.ink};padding-top:4px;letter-spacing:-.01em;">
              Before kickoff
            </div>
          </td>
        </tr>
        <tr><td>${survivorBlock(input)}</td></tr>
        <tr><td style="padding-top:6px;">${lineupSection}</td></tr>
        <tr>
          <td style="padding-top:4px;">
            <a href="${escapeHtml(input.appUrl)}/survivor" style="display:inline-block;background:${PALETTE.accent};color:#ffffff;font:600 14px/1 -apple-system,sans-serif;padding:12px 18px;border-radius:10px;text-decoration:none;">Open survivor</a>
          </td>
        </tr>
        <tr>
          <td style="padding-top:18px;">
            ${provenance}
            <div style="font:400 11px/1.5 -apple-system,sans-serif;color:${PALETTE.muted};padding-top:6px;">
              Generated ${escapeHtml(new Date(input.generatedAt).toLocaleString("en-US", { timeZone: "America/New_York" }))} ET.
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
