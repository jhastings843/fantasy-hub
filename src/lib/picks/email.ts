import { type BoardGame, type Record as Rec } from "./engine";
import { type EmailSelection, selectForEmail } from "./issued";
import type { UpdateDiff } from "./update";
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

// The Tuesday picks card. Both leagues in one, NFL first because that is
// the pick'em, each with the plays that fit the rule and the straight-up list.
// Everything here is read off the same report the page renders.

const rec = (r: Rec) => `${r.w}-${r.l}${r.p ? `-${r.p}` : ""}`;
const line = (x: number) => (x === 0 ? "PK" : `${x > 0 ? "+" : ""}${x}`);
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

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

/** The season's unit total for this sport, from bets that went out with a stake. */
function unitsLine(r: PicksReport): string {
  const u = r.units?.total;
  if (!u || !u.bets) return small("Bets carry stakes from this card on (0.25u to 5u, sized to each rule's record and the price).", PALETTE.body);
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
  const plays = sel.plays;
  const shown = plays.slice(0, sel.shownPlays);
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
      ? `Priced out (fits the rule, but the quoted price leaves under a quarter unit, or there is no quoted price): ${sel.pricedOut
          .map((g) => `${r.names[g.side === "home" ? g.home : g.away] ?? (g.side === "home" ? g.home : g.away)} ${g.price !== undefined ? price(g.price) : "(no price)"}`)
          .join(", ")}.`
      : "",
    sel.overBudget.length
      ? `Left out by the weekly limit (worth a bet, but this week's ${r.allocation.room}u budget is used): ${sel.overBudget
          .map((g) => r.names[g.side === "home" ? g.home : g.away] ?? (g.side === "home" ? g.home : g.away))
          .join(", ")}.`
      : "",
  ].filter(Boolean);
  const su = r.su.best ? `Straight up follows ${r.su.best.label.toLowerCase()} (${r.su.best.w}-${r.su.best.l}).` : "";
  return card(`${label(`${league} · Week ${r.week ?? "?"}`)}
${unitsLine(r)}
${lastWeekLine(r)}
${paragraph(ruleLine)}
${
  shown.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;">${playRows(r, shown)}</table>${plays.length > shown.length ? small(`Plus ${plays.length - shown.length} more on the page.`) : ""}`
    : paragraph("Nothing fits this week.", PALETTE.muted)
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

export function buildPicksEmail(input: {
  nfl: PicksReport | null;
  cfb: PicksReport | null;
  appUrl: string;
  generatedAt: string;
}): PicksEmail {
  const { nfl, cfb, appUrl } = input;
  const pick = (r: PicksReport | null) => (r ? selectForEmail(r, LIMITS[r.league].plays, LIMITS[r.league].su) : null);
  const selections = { nfl: pick(nfl), cfb: pick(cfb) };
  const t1 = (x: EmailSelection | null) => x?.plays.filter((g) => g.tier === "t1").length ?? 0;
  const week = nfl?.week ?? cfb?.week;
  const subject = `Week ${week ?? ""} picks: ${t1(selections.nfl)} NFL, ${t1(selections.cfb)} college Tier 1`;
  const asOf = (r: PicksReport | null) =>
    r?.reference.fetchedAt
      ? `${r.league === "nfl" ? "NFL" : "College"} lines: ${r.reference.source}, read ${new Date(r.reference.fetchedAt).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" })} ET.`
      : "";
  const body = [
    nfl && selections.nfl ? leagueCard(nfl, selections.nfl, appUrl) : card(paragraph("The NFL board couldn't be read this morning.")),
    cfb && selections.cfb ? leagueCard(cfb, selections.cfb, appUrl) : card(paragraph("The college board couldn't be read this morning.")),
  ].join("");
  const html = emailPage({
    title: subject,
    kicker: `${new Date(input.generatedAt).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" })} · Week ${week ?? ""}`,
    heading: "Where both models agree",
    preheader: subject,
    body,
    cta: { href: `${appUrl}/picks`, text: "Open Picks" },
    footnote: `<div>Stakes run 0.25u to 5u, with 1u = 1% of bankroll: a quarter-Kelly bet on each rule's record pulled toward 50% (as if it had already gone 50-50 over 100 games), at the price shown. Units are risked: a 2u bet risks 2u. Each bet is graded at the price shown (DraftKings when sent); a better number elsewhere only helps. Win chances are estimates from each rule's record, not proven calibration. Limits: 5u per bet and per game, 15u per sport per week (card plus game-day additions), 30u open across both sports. No parlays until single-bet estimates prove calibrated. Every model is judged against one current line per game. ${escapeHtml([asOf(nfl), asOf(cfb)].filter(Boolean).join(" "))} Check the live number before betting; the page has a checker for moved lines.</div>
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
    parts.push(`<div style="padding-top:12px;">${label("New in an email: qualifies at the current line")}</div>${table(
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

export function buildPicksUpdate(input: { r: PicksReport; diff: UpdateDiff; appUrl: string; generatedAt: string }): { html: string; subject: string } {
  const { r, diff, appUrl } = input;
  const league = r.league === "nfl" ? "NFL" : "College";
  const bits = [
    diff.added.length + diff.addedTotals.length ? `${diff.added.length + diff.addedTotals.length} new` : "",
    diff.off.length ? `${diff.off.length} off` : "",
  ].filter(Boolean);
  const subject = `${league} Week ${r.week} game-day update: ${bits.join(", ") || "no changes"}`;
  const html = emailPage({
    title: subject,
    kicker: `${r.league === "cfb" ? "Saturday" : "Sunday"} · Week ${r.week}`,
    heading: "What changed since Tuesday",
    preheader: subject,
    body: card(`${label(`${league} · Week ${r.week}`)}${updateBlock(r, diff)}`),
    cta: { href: `${appUrl}/picks${r.league === "cfb" ? "/cfb" : ""}`, text: "Open Picks" },
    footnote: `<div>Every model judged again at today's line. A game counts once in the record, at the line it was first sent.</div>
<div style="padding-top:6px;">${generatedLine(input.generatedAt)}</div>`,
  });
  return { html, subject };
}
