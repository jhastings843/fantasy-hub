import { type BoardGame, type Record as Rec } from "./engine";
import { type EmailSelection, selectForEmail } from "./issued";
import type { UpdateDiff } from "./update";
import type { JournalEntry } from "./learning/review";
import type { Push } from "@/lib/notify/pushover";
import { fmtUnits } from "./units";

/** A quoted price; an unquoted one is said so, never shown as -110. */
const price = (p?: number) => (p === undefined ? "no price" : p > 0 ? `+${p}` : `${p}`);

/** "Thursday night", "Saturday", "Sunday", "Monday night": which slate a kickoff belongs to. */
export function slateOf(kickoff?: string): { label: string; order: number } {
  if (!kickoff) return { label: "Kickoff time not listed", order: 9e15 };
  const d = new Date(kickoff);
  const day = d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" });
  const hour = Number(d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }));
  const night = hour >= 17 && day !== "Saturday" && day !== "Sunday";
  return { label: night ? `${day} night` : day, order: d.getTime() };
}

const when = (kickoff?: string) =>
  kickoff
    ? new Date(kickoff).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" })
    : "";
import type { PicksReport } from "./report";
import { PALETTE, card, emailPage, escapeHtml, generatedLine, label, paragraph, small } from "@/lib/email/shell";

// Two emails (Jack, 2026-10-08: stakes only on the day of the game).
//   - Tuesday update: what the app learned, the rules in force, whether every
//     model and line came in, last week, and the week's early looks. No stakes.
//   - Today's bets, 9am ET on each game day: the bets for that day's games at
//     that morning's line, issued with stakes, plus anything sent that is off.
// Everything here is read off the same report the page renders.

const rec = (r: Rec) => `${r.w}-${r.l}${r.p ? `-${r.p}` : ""}`;
const line = (x: number) => (x === 0 ? "PK" : `${x > 0 ? "+" : ""}${x}`);
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

/** How stakes are sized under the policy in force, for the footnote. */
function sizingNote(r: PicksReport | null): string {
  const gate = "A pick is a bet only if a quarter-Kelly bet on its rule's record, pulled toward 50% (as if it had already gone 50-50 over 100 games), comes to 1u or more at the price shown.";
  if (r?.policy?.staking?.kind === "flat") {
    return `${gate} Every such bet is ${r.policy.staking.flatUnits}u, with 1u = 1% of bankroll. Larger quarter-Kelly stakes are tracked in shadow and come back only if forward results and calibration support them.`;
  }
  return `${gate} Stakes run 1u to 5u at that quarter-Kelly size (anything under 1u is not a bet), with 1u = 1% of bankroll.`;
}

/** The bet card: every bet, grouped by slate in kickoff order, with stake and price. */
function playRows(r: PicksReport, games: BoardGame[]): string {
  const name = (k: string) => r.names[k] ?? k;
  const sorted = games.slice().sort((a, b) => slateOf(a.ref?.kickoff).order - slateOf(b.ref?.kickoff).order);
  let last = "";
  return sorted
    .map((g) => {
      const team = g.side === "home" ? g.home : g.away;
      const opp = g.side === "home" ? g.away : g.home;
      const lineFor = g.side === "home" ? g.homeLine! : -g.homeLine!;
      const slate = slateOf(g.ref?.kickoff).label;
      const head =
        slate !== last
          ? `<tr><td colspan="3" style="padding:12px 0 4px;font:600 10px/1.3 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${PALETTE.muted};">${escapeHtml(slate)}</td></tr>`
          : "";
      last = slate;
      const p = g.price;
      const chip = `<span style="background:${g.tier === "t1" ? PALETTE.accent : PALETTE.goodBg};color:${g.tier === "t1" ? "#fff" : PALETTE.accent};border:1px solid ${g.tier === "t1" ? PALETTE.accent : PALETTE.goodBorder};border-radius:4px;padding:1px 6px;font:600 11px/1.4 ${FONT};">${g.stake}U</span>`;
      return `${head}<tr>
  <td style="padding:7px 0;border-top:1px solid ${PALETTE.hairline};width:52px;">${chip}</td>
  <td style="padding:7px 8px;border-top:1px solid ${PALETTE.hairline};font:600 14px/1.35 ${FONT};color:${PALETTE.ink};">${escapeHtml(`${name(team)} ${line(lineFor)} (${price(p)})`)}<div style="font:400 12px/1.4 ${FONT};color:${PALETTE.muted};">vs ${escapeHtml(name(opp))}${g.ref?.kickoff ? ` · ${escapeHtml(when(g.ref.kickoff))}` : ""}</div></td>
  <td align="right" style="padding:7px 0;border-top:1px solid ${PALETTE.hairline};font:400 12px/1.4 ${FONT};color:${PALETTE.muted};white-space:nowrap;">${g.tier === "t1" ? "Tier 1" : "Tier 2"}${g.pemPick ? " · PEM" : ""}</td>
</tr>`;
    })
    .join("");
}

function suRows(r: PicksReport, sel: EmailSelection): string {
  const name = (k: string) => r.names[k] ?? k;
  const total = sel.su.length;
  return sel.su
    .slice(0, sel.shownSu)
    .map(({ g, side, margin, band }, i) => {
      const pick = side === "home" ? g.home : g.away;
      const opp = side === "home" ? g.away : g.home;
      return `<tr>
  <td style="padding:5px 0;border-top:1px solid ${PALETTE.hairline};font:600 12px/1.4 ${FONT};color:${PALETTE.muted};width:28px;">${total - i}</td>
  <td style="padding:5px 6px;border-top:1px solid ${PALETTE.hairline};font:600 14px/1.35 ${FONT};color:${PALETTE.ink};">${escapeHtml(name(pick))} <span style="font-weight:400;color:${PALETTE.muted};font-size:12px;">over ${escapeHtml(name(opp))}</span></td>
  <td align="right" style="padding:5px 0;border-top:1px solid ${PALETTE.hairline};font:400 12px/1.4 ${FONT};color:${PALETTE.muted};white-space:nowrap;">${escapeHtml(band)} · ${margin.toFixed(1)}</td>
</tr>`;
    })
    .join("");
}

function totalsBlock(r: PicksReport, sel: EmailSelection): string {
  const t = r.totals;
  if (!t) return "";
  const name = (k: string) => r.names[k] ?? k;
  if (!t.backtest.rule) {
    return `<div style="padding-top:14px;">${small(
      `Totals: tracking only. Agreement on over/under has ${t.backtest.archived} graded game${t.backtest.archived === 1 ? "" : "s"} so far; it becomes a play once a cut has 10+ decided games and wins.`,
    )}</div>`;
  }
  const rows = sel.totals
    .slice(0, sel.shownTotals)
    .map(
      (g) => `<tr>
  <td style="padding:6px 0;border-top:1px solid ${PALETTE.hairline};font:600 14px/1.35 ${FONT};color:${PALETTE.ink};">${escapeHtml(g.play!)}<div style="font:400 12px/1.4 ${FONT};color:${PALETTE.muted};">${escapeHtml(`${name(g.away)} at ${name(g.home)}`)}</div></td>
  <td align="right" style="padding:6px 0;border-top:1px solid ${PALETTE.hairline};font:400 12px/1.4 ${FONT};color:${PALETTE.muted};white-space:nowrap;">${g.stake}u · ${price(g.price)}</td>
</tr>`,
    )
    .join("");
  return `<div style="padding-top:16px;">${label("Totals")}</div>
${small(`Rule: ${t.backtest.rule.label.toLowerCase()}, ${rec(t.backtest.rule.record)} in the archive.`)}
${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;">${rows}</table>` : small("No totals fit this week.")}`;
}

/** Early looks, grouped by slate: the pick and today's line, no stake. */
function earlyRows(r: PicksReport, games: BoardGame[]): string {
  const name = (k: string) => r.names[k] ?? k;
  const sorted = games.slice().sort((a, b) => slateOf(a.ref?.kickoff).order - slateOf(b.ref?.kickoff).order);
  let last = "";
  return sorted
    .map((g) => {
      const slate = slateOf(g.ref?.kickoff).label;
      const head =
        slate !== last
          ? `<tr><td colspan="2" style="padding:10px 0 2px;font:600 10px/1.3 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${PALETTE.muted};">${escapeHtml(slate)}</td></tr>`
          : "";
      last = slate;
      const team = g.side === "home" ? g.home : g.away;
      const opp = g.side === "home" ? g.away : g.home;
      return `${head}<tr>
  <td style="padding:5px 0;border-top:1px solid ${PALETTE.hairline};font:600 14px/1.35 ${FONT};color:${PALETTE.ink};">${escapeHtml(`${name(team)} ${line(g.side === "home" ? g.homeLine! : -g.homeLine!)}`)} <span style="font-weight:400;color:${PALETTE.muted};font-size:12px;">vs ${escapeHtml(name(opp))}${g.ref?.kickoff ? ` · ${escapeHtml(when(g.ref.kickoff))}` : ""}</span></td>
  <td align="right" style="padding:5px 0;border-top:1px solid ${PALETTE.hairline};font:400 12px/1.4 ${FONT};color:${PALETTE.muted};white-space:nowrap;">${g.tier === "t1" ? "Tier 1" : "Tier 2"}</td>
</tr>`;
    })
    .join("");
}

/** Did every model board and the lines come in? */
export function feedsLine(r: PicksReport): string {
  const posted = (ok: boolean) => (ok ? "in" : "not posted yet");
  const pem = r.league === "cfb" ? (r.pem ?? []).find((p) => p.week === r.week) : undefined;
  const parts = [
    `Sam ${posted(r.boardUpdated.sam)}`,
    `David ${posted(r.boardUpdated.david)}`,
    r.league === "cfb" ? `PEM ${pem ? (pem.verified ? `in (${pem.games} games)` : "in, not verified") : "not posted yet"}` : "",
    r.reference.games
      ? `lines for ${r.reference.priced} of ${r.reference.games} games${r.reference.source ? ` (${r.reference.source})` : ""}${r.reference.stale ? ", stale" : ""}`
      : "no lines yet",
    r.errors.length ? `${r.errors.length} read error${r.errors.length === 1 ? "" : "s"}: ${r.errors.slice(0, 2).join("; ")}` : "",
  ].filter(Boolean);
  return `Feeds this week: ${parts.join(", ")}.`;
}

/** The season's unit total for this sport, from bets that went out with a stake. */
function unitsLine(r: PicksReport): string {
  const u = r.units?.total;
  if (!u || !u.bets) return small("No staked bets settled yet this season.", PALETTE.body);
  const rec = `${u.w}-${u.l}${u.p ? `-${u.p}` : ""}`;
  return `<div style="font:600 15px/1.4 ${FONT};color:${u.units >= 0 ? PALETTE.good : PALETTE.bad};padding-bottom:2px;">${escapeHtml(
    `Season: ${fmtUnits(u.units)} on ${rec}${u.risked ? `, ${Math.round(u.roi * 100)}% return` : ""}`,
  )}</div>${u.pending ? small(`${u.pending} bet${u.pending === 1 ? "" : "s"} still to settle.`) : ""}`;
}

/** Last week as sent, once its games are graded. */
function lastWeekLine(r: PicksReport): string {
  const w = (r.live ?? []).filter((x) => r.week !== null && x.week < r.week).sort((a, b) => b.week - a.week)[0];
  if (!w) return "";
  const n = (x: Rec) => x.w + x.l + x.p;
  const parts = [
    n(w.t1) ? `Tier 1 ${rec(w.t1)}` : "",
    n(w.t2) ? `Tier 2 ${rec(w.t2)}` : "",
    w.totals && n(w.totals) ? `totals ${rec(w.totals)}` : "",
    w.su.w + w.su.l ? `straight up ${w.su.w}-${w.su.l}` : "",
  ].filter(Boolean);
  if (!parts.length) return "";
  return small(`Last week as sent (Week ${w.week}): ${parts.join(", ")}${w.pending ? `, ${w.pending} still to grade` : ""}.`, PALETTE.body);
}

function leagueCard(r: PicksReport, sel: EmailSelection, appUrl: string): string {
  const st = r.strategies;
  const league = r.league === "nfl" ? "NFL" : "College";
  const ruleLine = st.rule
    ? `Rule: ${st.rule.label.toLowerCase()}, ${rec(st.rule.record)} in the backtest.${st.second ? ` Tier 2: ${st.second.label.toLowerCase()}, ${rec(st.second.record)} on the games it adds beyond Tier 1.` : " No Tier 2: nothing else wins on the games Tier 1 leaves."}`
    : "No cut has a big enough winning sample yet, so nothing is a bet.";
  const caveats = [
    sel.sourceOnly
      ? `${sel.sourceOnly} more fit at the sites' own lines but have no current quote, so they are research only, not plays.`
      : "",
    sel.waiting ? `${sel.waiting} ${sel.waiting === 1 ? "game is" : "games are"} waiting on PEM's card.` : "",
    sel.pricedOut.length
      ? `Priced out (fits the rule, but the quoted price sizes it under the 1u minimum, or there is no quoted price): ${sel.pricedOut
          .map((g) => `${r.names[g.side === "home" ? g.home : g.away] ?? (g.side === "home" ? g.home : g.away)} ${g.price !== undefined ? price(g.price) : "(no price)"}`)
          .join(", ")}.`
      : "",
    sel.overBudget.length
      ? `Left out by the limits (worth a bet, but no room left): ${sel.overBudget
          .map((g) => `${r.names[g.side === "home" ? g.home : g.away] ?? (g.side === "home" ? g.home : g.away)}${g.limited ? ` (${g.limited})` : ""}`)
          .join(", ")}.`
      : "",
  ].filter(Boolean);
  const su = r.su.best ? `Straight up follows ${r.su.best.label.toLowerCase()} (${r.su.best.w}-${r.su.best.l}).` : "";
  return card(`${label(`${league} · Week ${r.week ?? "?"}`)}
${unitsLine(r)}
${lastWeekLine(r)}
${paragraph(ruleLine)}
${small(feedsLine(r))}
<div style="padding-top:14px;">${label("Early looks: no stakes, not bets yet")}</div>
${
  sel.early.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:4px;">${earlyRows(r, sel.early)}</table>${small("Each becomes a bet at 9am ET on its game day if it still fits at that morning's line and price, in that day's email and push.")}`
    : paragraph("Nothing fits the rule at today's lines.", PALETTE.muted)
}
${caveats.map((c) => small(c)).join("")}
${totalsBlock(r, sel)}
<div style="padding-top:16px;">${label("Straight up, most confident first")}</div>
${small(su)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;">${suRows(r, sel)}</table>
<div style="padding-top:10px;font:400 13px/1.4 ${FONT};"><a href="${escapeHtml(`${appUrl}/picks${r.league === "cfb" ? "/cfb" : ""}`)}" style="color:${PALETTE.accent};">Full ${league} board and backtest</a></div>`);
}

export interface PicksEmail {
  html: string;
  subject: string;
  /** Exactly what the email shows; the issued record is built from this. */
  selections: { nfl: EmailSelection | null; cfb: EmailSelection | null };
}

// Every bet goes in the email: a bet only on the page is not a bet anyone was given.
const LIMITS = { nfl: { plays: 99, su: 16 }, cfb: { plays: 99, su: 15 } } as const;

/** What the strategy review did lately: the latest review plus any change, proposal or alert in the last week. */
function learningCard(journal: JournalEntry[], now: Date, harris?: string): string {
  const harrisLine = harris ? small(harris) : "";
  if (!journal.length) return card(`${label("What the app learned")}${paragraph("No strategy review on file yet.", PALETTE.muted)}${harrisLine}`);
  const recent = journal.filter((e) => now.getTime() - new Date(e.at).getTime() < 7 * 86400000);
  const review = journal.find((e) => e.kind === "review");
  const changes = recent.filter((e) => ["activate", "rollback", "retain", "reject", "retire", "proposal", "ops"].includes(e.kind));
  const clip = (s: string, n = 260) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
  const rows = changes
    .slice(0, 6)
    .map(
      (e) => `<tr><td style="padding:5px 0;border-top:1px solid ${PALETTE.hairline};font:600 13px/1.4 ${FONT};color:${PALETTE.ink};">${escapeHtml(e.title)}<div style="font:400 12px/1.4 ${FONT};color:${PALETTE.muted};">${escapeHtml(clip(e.why, 200))}</div></td></tr>`,
    )
    .join("");
  return card(`${label("What the app learned")}
${review ? paragraph(`${review.title}.`) : ""}
${review ? small(clip(review.why)) : ""}
${rows ? `<div style="padding-top:10px;">${label("Rule and strategy changes this week")}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>` : small("No rule or strategy changes this week.")}
${harrisLine}`);
}

export function buildPicksEmail(input: {
  nfl: PicksReport | null;
  cfb: PicksReport | null;
  appUrl: string;
  generatedAt: string;
  /** Newest first. */
  learning?: JournalEntry[];
  /** The John Harris tracker line (tracked, never bet). */
  harris?: string;
}): PicksEmail {
  const { nfl, cfb, appUrl } = input;
  const pick = (r: PicksReport | null) => (r ? selectForEmail(r, LIMITS[r.league].plays, LIMITS[r.league].su) : null);
  // No stakes on the update: a Tuesday-night game released at 9am belongs to
  // that day's 9am email, so plays and totals are emptied here, before render.
  const noBets = (s: EmailSelection | null): EmailSelection | null => (s ? { ...s, plays: [], shownPlays: 0, totals: [], shownTotals: 0 } : null);
  const selections = { nfl: noBets(pick(nfl)), cfb: noBets(pick(cfb)) };
  const early = (x: EmailSelection | null) => x?.early.length ?? 0;
  const week = nfl?.week ?? cfb?.week;
  const subject = `Week ${week ?? ""} update: ${early(selections.nfl)} NFL and ${early(selections.cfb)} college early looks`;
  const asOf = (r: PicksReport | null) =>
    r?.reference.fetchedAt
      ? `${r.league === "nfl" ? "NFL" : "College"} lines: ${r.reference.source}, read ${new Date(r.reference.fetchedAt).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" })} ET.`
      : "";
  const body = [
    learningCard(input.learning ?? [], new Date(input.generatedAt), input.harris),
    nfl && selections.nfl ? leagueCard(nfl, selections.nfl, appUrl) : card(paragraph("The NFL board couldn't be read this morning.")),
    cfb && selections.cfb ? leagueCard(cfb, selections.cfb, appUrl) : card(paragraph("The college board couldn't be read this morning.")),
  ].join("");
  const html = emailPage({
    title: subject,
    kicker: `${new Date(input.generatedAt).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" })} · Week ${week ?? ""}`,
    heading: "This week's update",
    preheader: subject,
    body,
    cta: { href: `${appUrl}/picks`, text: "Open Picks" },
    footnote: `<div>No stakes in this email. Bets go out at 9am ET on each game day, at that morning's line and price, by email and push. ${sizingNote(nfl ?? cfb)} Units are risked: a 2u bet risks 2u. Each bet is graded at the price shown (DraftKings when sent); a better number elsewhere only helps. Win chances are estimates from each rule's record, not proven calibration. Limits: 5u per bet and per game, 30u per week across both sports (split however the edges fall), 30u open at once. No parlays until single-bet estimates prove calibrated. Every model is judged against one current line per game. ${escapeHtml([asOf(nfl), asOf(cfb)].filter(Boolean).join(" "))}</div>
<div style="padding-top:6px;">${generatedLine(input.generatedAt)}</div>`,
  });
  return { html, subject, selections };
}

// ------------------------------------------------------------ game-day update

/**
 * What changed since Tuesday, at the current line. Used on its own for the
 * Saturday college email and as a block inside the Sunday brief for the NFL.
 */
export function updateBlock(r: PicksReport, d: UpdateDiff): string {
  const name = (k: string) => r.names[k] ?? k;
  const at = (side: "home" | "away", homeLine: number) => (side === "home" ? homeLine : -homeLine);
  const row = (main: string, sub: string, right: string) => `<tr>
  <td style="padding:6px 0;border-top:1px solid ${PALETTE.hairline};font:600 14px/1.35 ${FONT};color:${PALETTE.ink};">${escapeHtml(main)}<div style="font:400 12px/1.4 ${FONT};color:${PALETTE.muted};">${escapeHtml(sub)}</div></td>
  <td align="right" style="padding:6px 0;border-top:1px solid ${PALETTE.hairline};font:400 12px/1.4 ${FONT};color:${PALETTE.muted};white-space:nowrap;">${escapeHtml(right)}</td>
</tr>`;
  const table = (rows: string) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;">${rows}</table>`;
  const team = (side: "home" | "away", g: { home: string; away: string }) => name(side === "home" ? g.home : g.away);
  const opp = (side: "home" | "away", g: { home: string; away: string }) => name(side === "home" ? g.away : g.home);
  const parts: string[] = [];
  if (d.added.length || d.addedTotals.length) {
    parts.push(`<div style="padding-top:12px;">${label("Bets at today's line, not sent before")}</div>${table(
      [
        ...d.added.map((g) =>
          row(
            `${team(g.side!, g)} ${line(at(g.side!, g.homeLine!))}`,
            `vs ${opp(g.side!, g)}${d.pageOnly.includes(`${d.week}:${g.away}@${g.home}`) ? " · was on the page Tuesday, not in the email" : ""}`,
            `${g.stake}u · ${price(g.price)}`,
          ),
        ),
        ...d.addedTotals.map((g) =>
          row(g.play!, `${name(g.away)} at ${name(g.home)}`, `${g.stake}u · ${price(g.price)}`),
        ),
      ].join(""),
    )}`);
  }
  if (d.off.length || d.totalsOff.length) {
    parts.push(`<div style="padding-top:12px;">${label("Off now for anyone who hasn't bet: skip at today's number")}</div>${table(
      [
        ...d.off.map((o) => row(`${team(o.sent.side, o.sent)} ${line(at(o.sent.side, o.sent.homeLine))} (as sent)`, o.reason, "")),
        ...d.totalsOff.map((o) => row(`${o.sent.play} (as sent)`, `${name(o.sent.away)} at ${name(o.sent.home)} · ${o.reason}`, "")),
      ].join(""),
    )}${small("Already bet it? Your bet stands as sent and is graded at the line and price it went out at.")}`);
  }
  if (d.stillOn.length) {
    parts.push(`<div style="padding-top:12px;">${label("Still on")}</div>${table(
      d.stillOn
        .map((x) =>
          row(
            `${team(x.sent.side, x.sent)} ${line(at(x.sent.side, x.nowLine))} now`,
            `sent at ${line(at(x.sent.side, x.sent.homeLine))} vs ${opp(x.sent.side, x.sent)}`,
            x.moved === 0 ? "same number" : x.moved > 0 ? `${x.moved} better now` : `${-x.moved} worse now`,
          ),
        )
        .join(""),
    )}`);
  }
  if (d.totalsStillOn.length) {
    parts.push(`<div style="padding-top:12px;">${label("Totals still on")}</div>${table(
      d.totalsStillOn
        .map((x) =>
          row(
            `${x.sent.side === "over" ? "Over" : "Under"} ${x.nowLine} now`,
            `sent at ${x.sent.line} · ${name(x.sent.away)} at ${name(x.sent.home)}`,
            x.moved === 0 ? "same number" : x.moved > 0 ? `${x.moved} better now` : `${-x.moved} worse now`,
          ),
        )
        .join(""),
    )}`);
  }
  if (!parts.length) parts.push(paragraph("Nothing has changed since Tuesday's card.", PALETTE.muted));
  const asOf = r.reference.fetchedAt
    ? `Lines: ${r.reference.source}, read ${new Date(r.reference.fetchedAt).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" })} ET.`
    : "";
  const tail = [
    asOf,
    d.kickedOff ? `${d.kickedOff} sent play${d.kickedOff === 1 ? " has" : "s have"} kicked off.` : "",
    d.noQuote ? `${d.noQuote} sent play${d.noQuote === 1 ? " has" : "s have"} no current quote, so ${d.noQuote === 1 ? "it" : "they"} can't be rechecked right now.` : "",
  ].filter(Boolean);
  return `${parts.join("")}${small(tail.join(" "))}`;
}

// ------------------------------------------------------------- today's bets

export interface TodayLeague {
  r: PicksReport;
  /** Already narrowed to today's games. */
  diff: UpdateDiff;
}

const betsOf = (ls: TodayLeague[]) => ls.reduce((n, l) => n + l.diff.added.length + l.diff.addedTotals.length, 0);
const unitsOf = (ls: TodayLeague[]) =>
  ls.reduce((u, l) => u + l.diff.added.reduce((s, g) => s + (g.stake ?? 0), 0) + l.diff.addedTotals.reduce((s, g) => s + (g.stake ?? 0), 0), 0);
const u = (x: number) => `${Math.round(x * 100) / 100}u`;
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

/** The 9am game-day email: today's bets at this morning's line, and any sent bet that is now off. */
export function buildTodayEmail(input: { date: string; leagues: TodayLeague[]; appUrl: string; generatedAt: string }): { html: string; subject: string } {
  const { leagues, appUrl } = input;
  const bets = betsOf(leagues);
  const off = leagues.reduce((n, l) => n + l.diff.off.length + l.diff.totalsOff.length, 0);
  const subject = bets
    ? `Today's bets: ${bets} (${u(unitsOf(leagues))}) · ${dayLabel(input.date)}`
    : `Today: ${off} sent bet${off === 1 ? " is" : "s are"} off · ${dayLabel(input.date)}`;
  const body = leagues
    .filter((l) => l.diff.added.length || l.diff.addedTotals.length || l.diff.off.length || l.diff.totalsOff.length)
    .map(({ r, diff }) => {
      const league = r.league === "nfl" ? "NFL" : "College";
      const name = (k: string) => r.names[k] ?? k;
      const totals = diff.addedTotals
        .map(
          (g) => `<tr>
  <td style="padding:7px 0;border-top:1px solid ${PALETTE.hairline};font:600 14px/1.35 ${FONT};color:${PALETTE.ink};">${escapeHtml(g.play!)} (${escapeHtml(price(g.price))})<div style="font:400 12px/1.4 ${FONT};color:${PALETTE.muted};">${escapeHtml(`${name(g.away)} at ${name(g.home)}`)}${g.ref?.kickoff ? ` · ${escapeHtml(when(g.ref.kickoff))}` : ""}</div></td>
  <td align="right" style="padding:7px 0;border-top:1px solid ${PALETTE.hairline};font:600 13px/1.4 ${FONT};color:${PALETTE.accent};white-space:nowrap;">${g.stake}u</td>
</tr>`,
        )
        .join("");
      const offOnly = { ...diff, added: [], addedTotals: [], stillOn: [], totalsStillOn: [], kickedOff: 0, noQuote: 0, gone: 0 };
      return card(`${label(`${league} · Week ${r.week}`)}
${diff.added.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;">${playRows(r, diff.added)}</table>` : ""}
${totals ? `<div style="padding-top:12px;">${label("Totals")}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${totals}</table>` : ""}
${diff.off.length || diff.totalsOff.length ? updateBlock(r, offOnly) : ""}
${small(feedsLine(r))}`);
    })
    .join("");
  const html = emailPage({
    title: subject,
    kicker: `${dayLabel(input.date)} · 9am ET`,
    heading: bets ? "Today's bets" : "Today: nothing new to bet",
    preheader: subject,
    body,
    cta: { href: `${appUrl}/picks`, text: "Open Picks" },
    footnote: `<div>Bets for today's games only, judged at this morning's DraftKings line and price. Each is graded at the line and price shown; a better number elsewhere only helps. ${sizingNote(input.leagues[0]?.r ?? null)} Units are risked. Limits: 5u per bet and per game, 30u per week across both sports, 30u open at once. Check the live number before betting; the page has a checker for moved lines.</div>
<div style="padding-top:6px;">${generatedLine(input.generatedAt)}</div>`,
  });
  return { html, subject };
}

/** The phone alert that rides with today's email. Pure. */
export function todayPush(input: { date: string; leagues: TodayLeague[]; appUrl: string }): Push {
  const { leagues } = input;
  const bets = betsOf(leagues);
  const lines: string[] = [];
  for (const { r, diff } of leagues) {
    const league = r.league === "nfl" ? "NFL" : "CFB";
    const name = (k: string) => r.names[k] ?? k;
    for (const g of diff.added.slice().sort((a, b) => (a.ref?.kickoff ?? "").localeCompare(b.ref?.kickoff ?? ""))) {
      const team = g.side === "home" ? g.home : g.away;
      lines.push(`${league} ${name(team)} ${line(g.side === "home" ? g.homeLine! : -g.homeLine!)} · ${g.stake}u (${price(g.price)})${g.ref?.kickoff ? ` · ${when(g.ref.kickoff).replace(/^\w+ /, "")}` : ""}`);
    }
    for (const g of diff.addedTotals) lines.push(`${league} ${g.play} · ${g.stake}u (${price(g.price)})`);
    for (const o of diff.off) lines.push(`OFF ${league} ${name(o.sent.side === "home" ? o.sent.home : o.sent.away)}: ${o.reason}`);
    for (const o of diff.totalsOff) lines.push(`OFF ${league} ${o.sent.play}: ${o.reason}`);
  }
  return {
    title: bets ? `Today's bets: ${bets} · ${u(unitsOf(leagues))}` : "Picks: a sent bet is off",
    message: lines.join("\n") || "Nothing today.",
    url: `${input.appUrl}/picks`,
    urlTitle: "Open Picks",
  };
}
