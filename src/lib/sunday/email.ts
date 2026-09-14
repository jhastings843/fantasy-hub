import type { SurvivorReport } from "@/lib/survivor/types";
import type { WeeklyLineups } from "@/lib/lineup/build";
import type { AlarmReason } from "./alarm";
import {
  card,
  emailPage,
  escapeHtml,
  generatedLine,
  headline,
  label,
  paragraph,
  PALETTE,
  small,
  statRow,
  BAD,
  GOOD,
  WARN,
} from "@/lib/email/shell";

// Two Sunday emails, because they are answering two different questions.
//
// The 9am brief is "is everything where I left it on Thursday", and it is
// allowed to be boring: most Sundays it says yes in four lines and that is a
// useful thing to have said. The 11:45 alarm is "something is wrong and you
// have 75 minutes", and it only exists at all when there is something in it.
//
// They share a house style and share nothing else. Merging them would mean the
// alarm inherits the brief's calm layout, and the whole value of the alarm is
// that its arrival is the message.

const pctText = (n: number) => `${(n * 100).toFixed(1)}%`;

export interface SundayInput {
  survivors: SurvivorReport[];
  lineups: WeeklyLineups;
  generatedAt: string;
  appUrl: string;
}

function outstanding(lineups: WeeklyLineups): number {
  return lineups.leagues.reduce((n, l) => n + l.advice.changes.length, 0);
}

/**
 * Whether "nothing needs doing" is a thing this email is entitled to say.
 *
 * Zero outstanding changes is not the same as everything being fine. A league
 * that could not be read has zero changes. A board that failed to build has
 * zero changes. A pool with no pick logged has zero changes and is a strike.
 * Reassurance has to be earned by having actually checked.
 */
function allClear(input: SundayInput): boolean {
  const { survivors, lineups } = input;
  if (outstanding(lineups) > 0) return false;
  if (lineups.blocked) return false;
  if (lineups.leagues.length === 0) return false;
  if (lineups.leagues.some((l) => l.error)) return false;
  if (survivors.length === 0) return false;
  if (survivors.some((s) => !s.myPick)) return false;
  return true;
}

/** "JAX in both pools", or each pool named when they differ. */
function pickPhrase(survivors: SurvivorReport[]): string {
  const picked = survivors.filter((s) => s.myPick);
  if (picked.length === 0) return "no pick logged";

  const first = picked[0].myPick;
  if (picked.length === survivors.length && picked.every((s) => s.myPick === first)) {
    return survivors.length > 1 ? `${first} in both pools` : `${first}`;
  }
  return picked.map((s) => `${s.myPick} (${s.pool.name.replace(/-entry pool$/, "")})`).join(" / ");
}

export function sundaySubject(input: SundayInput): string {
  const week = input.survivors[0]?.week ?? input.lineups.week;
  const left = outstanding(input.lineups);
  const tail =
    left > 0
      ? `${left} lineup change${left === 1 ? "" : "s"} left`
      : allClear(input)
        ? "lineups set"
        : "needs a look";
  return `Week ${week} Sunday: ${pickPhrase(input.survivors)}, ${tail}`;
}

function poolCard(report: SurvivorReport, showName: boolean): string {
  if (!report.myPick) {
    return card(
      `${label(showName ? report.pool.name : "Survivor")}
${headline("No pick logged")}
${paragraph(`The engine would take ${report.bestTeam ?? "nothing"}. A pool with no pick is a strike, so this is the one thing on this page worth doing now.`)}`,
      BAD,
    );
  }

  const c = report.myPickCandidate;
  const locks = report.locksAt
    ? new Date(report.locksAt)
        .toLocaleString("en-US", {
          timeZone: "America/New_York",
          hour: "numeric",
          minute: "2-digit",
        })
        .replace(/\s*AM$/, "a")
        .replace(/\s*PM$/, "p")
    : null;

  return card(
    `${label(showName ? report.pool.name : "Survivor")}
${headline(`${report.myPick}${c ? ` over ${c.opponent}` : ""}`)}
${statRow(
  [
    c ? { name: "Win", value: pctText(c.winProb) } : null,
    c ? { name: "Field on it", value: pctText(c.ownership) } : null,
    c ? { name: "Equity", value: `${c.equityMultiplier.toFixed(2)}x` } : null,
    locks ? { name: "Locks", value: locks } : null,
  ].filter((s): s is { name: string; value: string } => s !== null),
)}
${report.myPickNote ? small(report.myPickNote, PALETTE.body) : ""}`,
    GOOD,
  );
}

function leagueLine(league: WeeklyLineups["leagues"][number]): string {
  if (league.error) {
    return `<div style="padding:7px 0;border-top:1px solid ${PALETTE.hairline};font:400 13px/1.5 -apple-system,sans-serif;color:${PALETTE.warn};">${escapeHtml(league.leagueName)}: could not be checked.</div>`;
  }

  const changes = league.advice.changes;
  const colour = changes.length === 0 ? PALETTE.good : PALETTE.warn;
  const text =
    changes.length === 0
      ? "set"
      : changes
          .map((c) => `${c.slot} ${c.recommended?.name ?? "(empty)"}`)
          .join(", ");

  return `<div style="padding:7px 0;border-top:1px solid ${PALETTE.hairline};font:400 13px/1.5 -apple-system,sans-serif;color:${PALETTE.body};">
  <span style="font-weight:600;color:${PALETTE.ink};">${escapeHtml(league.leagueName)}</span>
  <span style="color:${colour};"> &middot; ${escapeHtml(text)}</span>
</div>`;
}

export function renderSundayBrief(input: SundayInput): string {
  const { survivors, lineups } = input;
  const week = survivors[0]?.week ?? lineups.week;
  const left = outstanding(lineups);
  const clear = allClear(input);

  const survivorCards =
    survivors.length === 0
      ? card(`${label("Survivor")}${paragraph("The board could not be built this morning.")}`, WARN)
      : survivors.map((s) => poolCard(s, survivors.length > 1)).join("");

  const lineupCard = lineups.blocked
    ? card(`${label("Lineups")}${paragraph(lineups.blocked)}`, WARN)
    : card(
        `${label(left === 0 ? "Lineups, all set" : `Lineups, ${left} still to change`)}
${lineups.leagues.map(leagueLine).join("")}`,
        clear ? GOOD : undefined,
      );

  return emailPage({
    title: sundaySubject(input),
    kicker: `Sunday · Week ${week ?? ""}`,
    heading: clear ? "Nothing needs doing" : "Before the 1pm lock",
    preheader: clear
      ? "Picks are in and every lineup is set."
      : left > 0
        ? `${left} lineup change${left === 1 ? "" : "s"} before 1pm.`
        : "Something could not be checked. Worth opening.",
    body: `${survivorCards}${lineupCard}`,
    cta: { href: `${input.appUrl}/survivor`, text: "Open survivor" },
    footnote: `<div>Inactives land around 11:30. If anything breaks after that you will get one more email at 11:45, and silence means nothing did.</div>
<div style="padding-top:6px;">${generatedLine(input.generatedAt)}</div>`,
  });
}

export interface AlarmInput {
  reasons: AlarmReason[];
  week: number | null;
  generatedAt: string;
  appUrl: string;
}

export function alarmSubject(input: AlarmInput): string {
  const n = input.reasons.length;
  if (n === 0) return "";
  if (n === 1) return `Before 1pm: ${input.reasons[0].text.replace(/\.$/, "")}`;
  return `Before 1pm: ${n} things to fix`;
}

export function renderLockAlarm(input: AlarmInput): string {
  const rows = input.reasons
    .map(
      (r, i) => `<div style="padding:${i === 0 ? 0 : 10}px 0 0;">
  <div style="font:600 15px/1.45 -apple-system,sans-serif;color:${PALETTE.ink};">${escapeHtml(r.text)}</div>
</div>`,
    )
    .join("");

  return emailPage({
    title: alarmSubject(input),
    kicker: `Sunday 11:45 · Week ${input.week ?? ""}`,
    heading: "This needs you now",
    preheader: input.reasons[0]?.text ?? "",
    body: `${card(`${label("Since Thursday")}${rows}`, BAD)}${card(
      small(
        "You are getting this because something changed after the inactive reports. Nothing else in the app needs you this morning.",
        PALETTE.body,
      ),
    )}`,
    cta: { href: `${input.appUrl}/survivor`, text: "Open survivor" },
    footnote: generatedLine(input.generatedAt),
  });
}
