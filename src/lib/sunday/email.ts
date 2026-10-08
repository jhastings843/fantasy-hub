import { changeDetail, confirmedDetails } from "@/lib/email/lineup-detail";
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
// useful thing to have said. The 12:15 alarm is "something is wrong and you
// have 45 minutes", and it only exists at all when there is something in it.
//
// They share a house style and share nothing else. Merging them would mean the
// alarm inherits the brief's calm layout, and the whole value of the alarm is
// that its arrival is the message.

const pctText = (n: number) => `${(n * 100).toFixed(1)}%`;

export interface SundayInput {
  survivors: SurvivorReport[];
  lineups: WeeklyLineups;
  /** The engine's pick per pool in Thursday's email, keyed by poolId. */
  thursdayCalls?: Record<string, string | null>;
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
  // A pool Jack is out of has nothing to pick, so it cannot hold the all-clear back.
  if (survivors.some((s) => s.status.alive && !s.myPick)) return false;
  return true;
}

/** "JAX in both pools", or each pool named when they differ. */
function pickPhrase(survivors: SurvivorReport[], thursdayCalls: Record<string, string | null> = {}): string {
  const picked = survivors.filter((s) => s.myPick);
  if (picked.length === 0) {
    // The subject is the one line he is sure to read, so it names the team.
    const best = survivors.map((s) => s.bestTeam ?? null);
    if (best.some((b) => !b)) return "no pick logged";
    const switched = survivors.some((s) => {
      const was = thursdayCalls[s.poolId];
      return was && was !== s.bestTeam;
    });
    const verb = switched ? "switch to" : "take";
    const where =
      best.every((b) => b === best[0])
        ? `${best[0]}${survivors.length > 1 ? " in both pools" : ""}`
        : survivors.map((s) => `${s.bestTeam} (${s.pool.name.replace(/-entry pool$/, "")})`).join(" / ");
    return `${verb} ${where}, no pick logged`;
  }

  const first = picked[0].myPick;
  if (picked.length === survivors.length && picked.every((s) => s.myPick === first)) {
    return survivors.length > 1 ? `${first} in both pools` : `${first}`;
  }
  return picked.map((s) => `${s.myPick} (${s.pool.name.replace(/-entry pool$/, "")})`).join(" / ");
}

/** Pools still worth a word. Out pools drop off the email entirely. */
const livePools = (survivors: SurvivorReport[]) => survivors.filter((s) => s.status.alive);

export function sundaySubject(input: SundayInput): string {
  const week = input.survivors[0]?.week ?? input.lineups.week;
  const live = livePools(input.survivors);
  const left = outstanding(input.lineups);
  const tail =
    left > 0
      ? `${left} lineup change${left === 1 ? "" : "s"} left`
      : allClear(input)
        ? "lineups set"
        : "needs a look";
  // Out of every pool: the subject is about lineups and nothing else.
  if (input.survivors.length > 0 && live.length === 0) return `Week ${week} Sunday: ${tail}`;
  return `Week ${week} Sunday: ${pickPhrase(live, input.thursdayCalls)}, ${tail}`;
}

function poolCard(report: SurvivorReport, showName: boolean, thursdayCall: string | null): string {
  if (!report.myPick) {
    const best = report.candidates.find((c) => c.team === report.bestTeam);
    const switched = !!thursdayCall && !!report.bestTeam && thursdayCall !== report.bestTeam;
    return card(
      `${label(showName ? report.pool.name : "Survivor")}
${headline(report.bestTeam ? `Take ${report.bestTeam}${best ? ` over ${best.opponent}` : ""}` : "No pick logged")}
${best ? statRow([
  { name: "Win", value: pctText(best.winProb) },
  { name: "Field on it", value: pctText(best.ownership) },
]) : ""}
${switched ? paragraph(`Changed from Thursday's email, which said ${thursdayCall}. ${report.crossPool?.kind === "split" ? report.reasoning[0] : (report.reasoning[1] ?? "")}`.trim()) : ""}
${paragraph(`No pick is logged yet. A pool with no pick is a strike, so this is the one thing on this page worth doing now.`)}`,
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
${report.myPickNote ? small(report.myPickNote, PALETTE.body) : ""}
${report.reasoning.length ? small(report.myPick === report.bestTeam ? "Why the model favors this pick:" : `Model recommendation: ${report.bestTeam ?? "not available"}. Your logged pick remains ${report.myPick}.`, PALETTE.body) : ""}
${report.reasoning.slice(0, 2).map(r => small(r, PALETTE.body)).join("")}
${report.candidates.filter(other => other.team !== report.myPick).slice(0, 1).map(other => small(`Another option: ${other.team} over ${other.opponent}, ${pctText(other.winProb)} win probability, ${pctText(other.ownership)} of the field on it.`)).join("")}`,
    GOOD,
  );
}

function leagueLine(league: WeeklyLineups["leagues"][number]): string {
  if (league.error) {
    return `<div style="padding:7px 0;border-top:1px solid ${PALETTE.hairline};font:400 13px/1.5 -apple-system,sans-serif;color:${PALETTE.warn};">${escapeHtml(league.leagueName)}: could not be checked.</div>`;
  }

  const changes = league.advice.changes;
  return `<div style="padding:14px 0;border-top:1px solid ${PALETTE.hairline}">
  <div style="font-size:15px;font-weight:600;color:${PALETTE.ink}">${escapeHtml(league.leagueName)}</div>
  ${small(league.scoringLabel)}
  ${changes.length ? changes.map(changeDetail).join("") : small("No lineup changes recommended.", PALETTE.good)}
  ${confirmedDetails(league.advice.slots)}
  </div>`;
}

export function renderSundayBrief(input: SundayInput): string {
  const { survivors, lineups } = input;
  const week = survivors[0]?.week ?? lineups.week;
  const left = outstanding(lineups);
  const clear = allClear(input);

  const live = livePools(survivors);
  const survivorCards =
    survivors.length === 0
      ? card(`${label("Survivor")}${paragraph("The board could not be built this morning.")}`, WARN)
      : live.map((s) => poolCard(s, survivors.length > 1, input.thursdayCalls?.[s.poolId] ?? null)).join("");

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
      ? live.length > 0
        ? "Picks are in and every lineup is set."
        : "Every lineup is set."
      : left > 0
        ? `${left} lineup change${left === 1 ? "" : "s"} before 1pm.`
        : "Something could not be checked. Worth opening.",
    body: `${survivorCards}${lineupCard}`,
    cta:
      survivors.length > 0 && live.length === 0
        ? { href: input.appUrl, text: "Open fantasy hub" }
        : { href: `${input.appUrl}/survivor`, text: "Open survivor" },
    footnote: `<div>Inactives land around 11:30. If anything breaks after that you will get one more email at 12:15, and silence means nothing did.</div>
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
    kicker: `Sunday 12:15 · Week ${input.week ?? ""}`,
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
