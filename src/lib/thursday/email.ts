import type { SurvivorReport } from "@/lib/survivor/types";
import { poolMeta } from "@/lib/survivor/pools";
import type { WeeklyLineups } from "@/lib/lineup/build";
import type { SlotAdvice } from "@/lib/lineup/weekly-advice";
import type { StartableTarget } from "@/lib/waivers/rank";
import type { WaiverReview } from "@/lib/guillotine/waiver-review";
import { mergePickups, type MergedChange } from "@/lib/waivers/merge";
import {
  card,
  emailPage,
  escapeHtml,
  generatedLine,
  label,
  PALETTE,
  pct,
  statCell,
  statRow,
  money,
  BAD,
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
  /**
   * Free agents who would start over someone in the lineup, per league, with
   * the drop that makes room. Waivers have cleared by the time this sends, so
   * each is an instant add in Sleeper, no bid. Absent when the scan failed.
   */
  pickups?: { leagueId?: string; leagueName: string; targets: StartableTarget[] }[];
  /** The guillotine waiver run, graded. Absent when there was none or it failed. */
  waiverReviews?: WaiverReview[];
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
  const changes = totalChanges(lineups, input.pickups);
  const tail =
    changes === 0
      ? "lineups all set"
      : `${changes} lineup change${changes === 1 ? "" : "s"}`;
  const pick = subjectPick(survivors);
  return pick ? `Week ${week}: ${pick}, ${tail}` : `Week ${week}: ${tail}`;
}

/**
 * The pick half of the subject line.
 *
 * Both pools usually name the same team, and printing it twice reads as a bug
 * rather than as agreement, so agreement is stated once. Disagreement gets both
 * teams with the pool sizes attached, because which pool is which is the whole
 * question at that point.
 */
function subjectPick(all: SurvivorReport[]): string {
  if (all.length === 0) return "no survivor pick";
  const survivors = all.filter((s) => s.status.alive);
  if (survivors.length === 0) return "";

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

export function totalChanges(lineups: WeeklyLineups, pickups?: ThursdayInput["pickups"]): number {
  return lineups.leagues.reduce((n, l) => n + mergedFor(l, pickups).changes.length, 0);
}

/** Most pickups worth naming per league; past three it is a waiver page, not a lineup email. */
const PICKUPS_PER_LEAGUE = 3;

function pickupsFor(
  league: WeeklyLineups["leagues"][number],
  pickups: ThursdayInput["pickups"],
): StartableTarget[] {
  const entry = (pickups ?? []).find((p) =>
    p.leagueId ? p.leagueId === league.leagueId : p.leagueName === league.leagueName,
  );
  return (entry?.targets ?? []).slice(0, PICKUPS_PER_LEAGUE);
}

/** A league's changes with its free agents folded into the slots they take. */
function mergedFor(
  league: WeeklyLineups["leagues"][number],
  pickups: ThursdayInput["pickups"],
): ReturnType<typeof mergePickups> {
  if (league.error) return { changes: [], leftover: [] };
  return mergePickups(league.advice, pickupsFor(league, pickups));
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

  // A pool Jack is out of gets no card. He knows, and a weekly reminder of a
  // lost season is not information.
  return survivors
    .filter((s) => s.status.alive)
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

function dropText(t: StartableTarget): string {
  return t.dropFor === null
    ? "You have an open roster spot."
    : t.dropFor
      ? `Drop ${t.dropFor.name}.`
      : "Nobody on your bench is a safe drop, so pick one yourself.";
}

/**
 * A slot a free agent takes. Replaces the ordinary row for that slot, so the
 * email never says "start Pat" and then "sub Pat out for a pickup".
 */
function pickupChangeRow(slot: SlotAdvice, t: StartableTarget): string {
  const rank = t.player.positionalRank != null ? `${t.player.position}${t.player.positionalRank} this week` : "ranked this week";
  const over = t.displaces ? `, ahead of ${t.displaces.name}` : "";
  return `<div style="padding:8px 0;border-top:1px solid ${PALETTE.hairline};">
  <div style="font:600 13px/1.4 -apple-system,sans-serif;color:${PALETTE.ink};">
    <span style="display:inline-block;background:${PALETTE.goodBg};color:${PALETTE.good};border:1px solid ${PALETTE.goodBorder};border-radius:5px;padding:1px 6px;font:600 10px/1.5 -apple-system,sans-serif;letter-spacing:.04em;margin-right:6px;">${escapeHtml(slot.slot)}</span>
    Add ${escapeHtml(t.player.name)} <span style="font-weight:400;color:${PALETTE.muted};">free agent</span>
  </div>
  <div style="font:400 12px/1.5 -apple-system,sans-serif;color:${PALETTE.body};padding-top:3px;">${escapeHtml(`${rank}${over}. ${dropText(t)} Instant add in Sleeper, then start him here.`)}</div>
</div>`;
}

function mergedRow(c: MergedChange): string {
  return c.pickup ? pickupChangeRow(c.slot, c.pickup) : changeRow(c.slot);
}

function leagueBlock(
  league: WeeklyLineups["leagues"][number],
  pickups: ThursdayInput["pickups"],
): string {
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

  const { changes } = mergedFor(league, pickups);

  if (changes.length === 0) {
    return card(
      `${head}
<div style="font:600 13px/1.5 -apple-system,sans-serif;color:${PALETTE.good};padding-top:8px;">Nothing to change.</div>
${problems}${superflex}${ours}`,
      GOOD,
    );
  }

  return card(
    `${head}
<div style="padding-top:6px;">${changes.map(mergedRow).join("")}</div>
${problems}${superflex}${ours}`,
  );
}

function pickupRow(t: StartableTarget): string {
  const rank = t.player.positionalRank != null ? `${t.player.position}${t.player.positionalRank} this week` : "ranked this week";
  const over = t.displaces ? `, starting at ${t.slot} over ${t.displaces.name}` : ` at ${t.slot}`;
  const drop =
    t.dropFor === null
      ? "You have an open roster spot."
      : t.dropFor
        ? `Drop ${t.dropFor.name}.`
        : "Nobody on your bench is a safe drop, so pick one yourself or skip it.";
  return `<div style="font:400 13px/1.5 -apple-system,sans-serif;color:${PALETTE.body};padding-top:6px;">
  <span style="font-weight:600;color:${PALETTE.ink};">Add ${escapeHtml(t.player.name)}</span> (${escapeHtml(rank)})${escapeHtml(over)}. ${escapeHtml(drop)}
</div>`;
}

/**
 * Free agents that did not fold into a lineup slot above, which is rare: a
 * pickup with no starter to displace, or a league whose lineup could not be
 * read. Everything else already sits in its slot's row.
 */
function pickupsSection(input: ThursdayInput): string {
  if (!input.pickups) return "";
  const byLeague = input.lineups.leagues;
  const leagues = input.pickups
    .map((p) => {
      const league = byLeague.find((l) =>
        p.leagueId ? l.leagueId === p.leagueId : l.leagueName === p.leagueName,
      );
      const targets = league
        ? mergedFor(league, input.pickups).leftover
        : p.targets.slice(0, PICKUPS_PER_LEAGUE);
      return { leagueName: p.leagueName, targets };
    })
    .filter((l) => l.targets.length > 0);
  if (leagues.length === 0) return "";
  const blocks = leagues
    .map(
      (l) =>
        card(`<div style="font:600 14px/1.3 -apple-system,sans-serif;color:${PALETTE.ink};">${escapeHtml(l.leagueName)}</div>
${l.targets.map(pickupRow).join("")}`),
    )
    .join("");
  return `${label("Free agents to grab")}<div style="font:400 12px/1.5 -apple-system,sans-serif;color:${PALETTE.muted};padding-bottom:6px;">Instant adds in Sleeper, no bid.</div>${blocks}`;
}

/**
 * The guillotine waiver run, the morning after: what the room paid, what it
 * did to the field, and whether Tuesday's model saw it coming. Stacked rows,
 * not a table, because this is read on a phone.
 */
function waiverReviewSection(input: ThursdayInput): string {
  const reviews = input.waiverReviews ?? [];
  if (reviews.length === 0) return "";
  const line = (html: string, color: string = PALETTE.body) =>
    `<div style="font:400 13px/1.55 -apple-system,sans-serif;color:${color};padding-top:4px;">${html}</div>`;
  const strong = (t: string, color: string = PALETTE.ink) =>
    `<strong style="color:${color};">${escapeHtml(t)}</strong>`;

  return reviews
    .map((r) => {
      const me = r.me;
      const danger = me != null && me.rankAfter <= 2;
      const rankText = (n: number) => (n === 1 ? "lowest" : `${ordinal(n)} lowest`);
      const head = me
        ? `After the claims you project ${me.after.toFixed(1)}, ${rankText(me.rankAfter)} of ${r.teamsAlive}${me.rankAfter !== me.rankBefore ? ` (was ${rankText(me.rankBefore)})` : ""}.`
        : `${r.teamsAlive} teams alive.`;

      const lessons = r.lessons.map((l) => line(escapeHtml(l))).join("");

      const claims = r.claims
        .filter((c) => c.price > 0 || c.bidders > 1)
        .slice(0, 6)
        .map((c) =>
          line(
            `${strong(`${c.name} ${c.position}`)} ${strong(money(c.price))} to ${escapeHtml(c.winner)}` +
              `<span style="color:${PALETTE.muted};"> \u00b7 ${c.bidders} bid${c.bidders === 1 ? "" : "s"}${c.runnerUp != null ? `, next ${money(c.runnerUp)}` : ""}${c.myBid != null ? `, you ${money(c.myBid)}` : ""}${c.gain > 0 ? `, +${c.gain.toFixed(1)} to his lineup` : ""}</span>`,
          ),
        )
        .join("");

      const movers = r.field
        .filter((f) => !f.isMine && f.after - f.before >= 2)
        .sort((a, b) => b.after - b.before - (a.after - a.before))
        .slice(0, 4)
        .map((f) =>
          line(
            `${escapeHtml(f.name)} +${(f.after - f.before).toFixed(1)} <span style="color:${PALETTE.muted};">\u00b7 now ${f.after.toFixed(1)}, ${rankText(f.rankAfter)}</span>`,
          ),
        )
        .join("");

      const bottom = r.field
        .slice(0, 4)
        .map((f) =>
          line(
            `${f.rankAfter}. ${f.isMine ? strong(f.name) : escapeHtml(f.name)} <span style="color:${PALETTE.muted};">${f.after.toFixed(1)}</span>`,
            f.isMine ? PALETTE.ink : PALETTE.body,
          ),
        )
        .join("");

      const p = r.prediction;
      const check = p
        ? line(
            `Tuesday's room model, replayed: it had you ${rankText(p.predictedMyRank)} after the claims, actual ${rankText(p.actualMyRank)}. ${p.called} of ${p.predicted} players it expected to go were claimed${p.missed.length ? ` (not: ${escapeHtml(p.missed.slice(0, 3).join(", "))})` : ""}.`,
            PALETTE.muted,
          )
        : "";

      return card(
        `${label(`${r.leagueName} \u00b7 waiver run`)}
        <div style="font:600 16px/1.35 -apple-system,sans-serif;color:${danger ? PALETTE.bad : PALETTE.ink};">${escapeHtml(head)}</div>
        ${statRow([
          { name: "Room spent", value: money(r.roomSpent) },
          { name: "Claims", value: String(r.claims.length) },
          { name: "You won", value: String(r.myWins.length) },
          { name: "You lost", value: String(r.myLosses.length) },
        ])}
        ${lessons ? `<div style="padding-top:10px;">${lessons}</div>` : ""}
        ${claims ? `<div style="padding-top:12px;">${label("What went, and for how much")}${claims}</div>` : ""}
        ${movers ? `<div style="padding-top:12px;">${label("Who got better")}${movers}</div>` : ""}
        ${bottom ? `<div style="padding-top:12px;">${label("Bottom of the table now")}${bottom}</div>` : ""}
        ${check ? `<div style="padding-top:10px;">${check}</div>` : ""}`,
        danger ? BAD : undefined,
      );
    })
    .join("");
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

export function renderThursdayEmail(input: ThursdayInput): string {
  const { lineups } = input;
  const changes = totalChanges(input.lineups, input.pickups);

  const lineupSection = lineups.blocked
    ? card(
        `${label("Lineups")}<div style="font:400 14px/1.55 -apple-system,sans-serif;color:${PALETTE.body};">${escapeHtml(lineups.blocked)}</div>`,
        WARN,
      )
    : `${label(changes === 0 ? "Lineups, all set" : `Lineups, ${changes} to change`)}${lineups.leagues.map((l) => leagueBlock(l, input.pickups)).join("")}`;

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
    body: `${survivorSection(input)}<div style="padding-top:6px;">${lineupSection}</div><div style="padding-top:6px;">${pickupsSection(input)}</div><div style="padding-top:6px;">${waiverReviewSection(input)}</div>`,
    cta: input.survivors.length > 0 && input.survivors.every((s) => !s.status.alive)
      ? { href: input.appUrl, text: "Open fantasy hub" }
      : { href: `${input.appUrl}/survivor`, text: "Open survivor" },
    footnote: `${provenance}<div style="padding-top:6px;">${generatedLine(input.generatedAt)}</div>`,
  });
}

/**
 * One lineup change, named stably enough to tell whether Jack has already been
 * told about it. The slot index and the player going in: the same advice
 * reworded is the same key, a different player for that slot is a new one.
 */
export interface WatchItem {
  key: string;
  leagueId: string;
  leagueName: string;
  text: string;
}

export function watchItems(lineups: WeeklyLineups, pickups: ThursdayInput["pickups"]): WatchItem[] {
  return lineups.leagues.flatMap((league) =>
    mergedFor(league, pickups).changes.map((c) => {
      const who = c.pickup ? c.pickup.player : c.slot.recommended;
      const id = who?.playerId ?? "empty";
      return {
        key: `${league.leagueId}:${c.slot.index}:${c.pickup ? "fa:" : ""}${id}`,
        leagueId: league.leagueId,
        leagueName: league.leagueName,
        text: c.pickup
          ? `Add ${who?.name ?? "?"} at ${c.slot.slot}`
          : `Start ${who?.name ?? "nobody"} at ${c.slot.slot}`,
      };
    }),
  );
}

export function watchSubject(fresh: WatchItem[]): string {
  const first = `${fresh[0].text} (${fresh[0].leagueName})`;
  return fresh.length === 1 ? `Lineup update: ${first}` : `Lineup update: ${first}, +${fresh.length - 1} more`;
}

/**
 * The between-emails nudge: something moved since the last lineup email and
 * the lineup no longer matches. Only the leagues with something new, and each
 * league's full list of changes, because a new change sitting next to an old
 * one Jack has not made yet is still one trip into Sleeper.
 */
export function renderWatchEmail(input: ThursdayInput, fresh: WatchItem[]): string {
  const leagueIds = new Set(fresh.map((f) => f.leagueId));
  const leagues = input.lineups.leagues.filter((l) => leagueIds.has(l.leagueId));
  const newList = fresh
    .map(
      (f) =>
        `<div style="font:400 13px/1.5 -apple-system,sans-serif;color:${PALETTE.body};padding-top:4px;"><span style="font-weight:600;color:${PALETTE.ink};">${escapeHtml(f.text)}</span> <span style="color:${PALETTE.muted};">${escapeHtml(f.leagueName)}</span></div>`,
    )
    .join("");
  return emailPage({
    title: watchSubject(fresh),
    kicker: `Lineup check · Week ${input.lineups.week ?? ""}`,
    heading: fresh.length === 1 ? "One new change" : `${fresh.length} new changes`,
    preheader: fresh.map((f) => f.text).join(", "),
    body: `${card(`${label("New since your last email")}${newList}`, WARN)}<div style="padding-top:6px;">${label("Everything to change in these leagues")}${leagues.map((l) => leagueBlock(l, input.pickups)).join("")}</div>`,
    cta: { href: input.appUrl, text: "Open fantasy hub" },
    footnote: `<div style="font:400 11px/1.55 -apple-system,sans-serif;color:${PALETTE.muted};">Checked once a day from Thursday until the Sunday 1pm lock. No email means nothing new.</div><div style="padding-top:6px;">${generatedLine(input.generatedAt)}</div>`,
  });
}
