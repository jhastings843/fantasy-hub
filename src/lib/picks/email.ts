import { type BoardGame, type Record as Rec } from "./engine";
import { type EmailSelection, selectForEmail } from "./issued";
import type { PicksReport } from "./report";
import { PALETTE, card, emailPage, escapeHtml, generatedLine, label, paragraph, small } from "@/lib/email/shell";

// The Wednesday picks email. Both leagues in one, NFL first because that is
// the pick'em, each with the plays that fit the rule and the straight-up list.
// Everything here is read off the same report the page renders.

const rec = (r: Rec) => `${r.w}-${r.l}${r.p ? `-${r.p}` : ""}`;
const line = (x: number) => (x === 0 ? "PK" : `${x > 0 ? "+" : ""}${x}`);
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

function playRows(r: PicksReport, games: BoardGame[]): string {
  const name = (k: string) => r.names[k] ?? k;
  return games
    .map((g) => {
      const team = g.side === "home" ? g.home : g.away;
      const opp = g.side === "home" ? g.away : g.home;
      const lineFor = g.side === "home" ? g.homeLine! : -g.homeLine!;
      const chip =
        g.tier === "t1"
          ? `<span style="background:${PALETTE.accent};color:#fff;border-radius:4px;padding:2px 6px;font:600 10px/1.4 ${FONT};">TIER 1</span>`
          : `<span style="background:${PALETTE.goodBg};color:${PALETTE.accent};border:1px solid ${PALETTE.goodBorder};border-radius:4px;padding:1px 6px;font:600 10px/1.4 ${FONT};">TIER 2</span>`;
      return `<tr>
  <td style="padding:7px 0;border-top:1px solid ${PALETTE.hairline};width:64px;">${chip}</td>
  <td style="padding:7px 8px;border-top:1px solid ${PALETTE.hairline};font:600 14px/1.35 ${FONT};color:${PALETTE.ink};">${escapeHtml(`${name(team)} ${line(lineFor)}`)}<div style="font:400 12px/1.4 ${FONT};color:${PALETTE.muted};">vs ${escapeHtml(name(opp))}</div></td>
  <td align="right" style="padding:7px 0;border-top:1px solid ${PALETTE.hairline};font:400 12px/1.4 ${FONT};color:${PALETTE.muted};white-space:nowrap;">${g.pemPick ? "PEM's side" : `edge ${g.read!.avgEdge.toFixed(1)}`}</td>
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
  ].filter(Boolean);
  const su = r.su.best ? `Straight up follows ${r.su.best.label.toLowerCase()} (${r.su.best.w}-${r.su.best.l}).` : "";
  return card(`${label(`${league} · Week ${r.week ?? "?"}`)}
${paragraph(ruleLine)}
${
  shown.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;">${playRows(r, shown)}</table>${plays.length > shown.length ? small(`Plus ${plays.length - shown.length} more on the page.`) : ""}`
    : paragraph("Nothing fits this week.", PALETTE.muted)
}
${caveats.map((c) => small(c)).join("")}
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

const LIMITS = { nfl: { plays: 12, su: 16 }, cfb: { plays: 10, su: 15 } } as const;

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
    kicker: `Wednesday · Week ${week ?? ""}`,
    heading: "Where both models agree",
    preheader: subject,
    body,
    cta: { href: `${appUrl}/picks`, text: "Open Picks" },
    footnote: `<div>Every model is judged against one current line per game. ${escapeHtml([asOf(nfl), asOf(cfb)].filter(Boolean).join(" "))} Check the live number before betting; the page has a checker for moved lines.</div>
<div style="padding-top:6px;">${generatedLine(input.generatedAt)}</div>`,
  });
  return { html, subject, selections };
}
