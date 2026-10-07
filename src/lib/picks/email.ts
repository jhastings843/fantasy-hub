import { suPick, SU_BANDS, type BoardGame, type Record as Rec } from "./engine";
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
      const team = g.read?.side === "home" ? g.home : g.away;
      const opp = g.read?.side === "home" ? g.away : g.home;
      const chip =
        g.tier === "t1"
          ? `<span style="background:${PALETTE.accent};color:#fff;border-radius:4px;padding:2px 6px;font:600 10px/1.4 ${FONT};">TIER 1</span>`
          : `<span style="background:${PALETTE.goodBg};color:${PALETTE.accent};border:1px solid ${PALETTE.goodBorder};border-radius:4px;padding:1px 6px;font:600 10px/1.4 ${FONT};">TIER 2</span>`;
      return `<tr>
  <td style="padding:7px 0;border-top:1px solid ${PALETTE.hairline};width:64px;">${chip}</td>
  <td style="padding:7px 8px;border-top:1px solid ${PALETTE.hairline};font:600 14px/1.35 ${FONT};color:${PALETTE.ink};">${escapeHtml(`${name(team)} ${line(g.read!.line!)}`)}<div style="font:400 12px/1.4 ${FONT};color:${PALETTE.muted};">vs ${escapeHtml(name(opp))}</div></td>
  <td align="right" style="padding:7px 0;border-top:1px solid ${PALETTE.hairline};font:400 12px/1.4 ${FONT};color:${PALETTE.muted};white-space:nowrap;">edge ${g.read!.avgEdge.toFixed(1)}</td>
</tr>`;
    })
    .join("");
}

function suRows(r: PicksReport, limit: number): string {
  const name = (k: string) => r.names[k] ?? k;
  const method = r.su.best?.id ?? "avg";
  const b = SU_BANDS[r.league];
  const list = r.board
    .flatMap((g) => {
      const p = suPick(method, g.sam, g.david);
      return p ? [{ g, ...p }] : [];
    })
    .sort((x, y) => y.margin - x.margin);
  const total = list.length;
  return list
    .slice(0, limit)
    .map(({ g, side, margin }, i) => {
      const pick = side === "home" ? g.home : g.away;
      const opp = side === "home" ? g.away : g.home;
      const conf = margin >= b.lock ? "Lock" : margin >= b.solid ? "Solid" : "Toss-up";
      return `<tr>
  <td style="padding:5px 0;border-top:1px solid ${PALETTE.hairline};font:600 12px/1.4 ${FONT};color:${PALETTE.muted};width:28px;">${total - i}</td>
  <td style="padding:5px 6px;border-top:1px solid ${PALETTE.hairline};font:600 14px/1.35 ${FONT};color:${PALETTE.ink};">${escapeHtml(name(pick))} <span style="font-weight:400;color:${PALETTE.muted};font-size:12px;">over ${escapeHtml(name(opp))}</span></td>
  <td align="right" style="padding:5px 0;border-top:1px solid ${PALETTE.hairline};font:400 12px/1.4 ${FONT};color:${PALETTE.muted};white-space:nowrap;">${conf} · ${margin.toFixed(1)}</td>
</tr>`;
    })
    .join("");
}

function leagueCard(r: PicksReport, appUrl: string, suLimit: number, playLimit: number): string {
  const st = r.strategies;
  const plays = r.board
    .filter((g) => g.tier === "t1" || g.tier === "t2")
    .sort((a, b) => (a.tier === b.tier ? (b.read?.avgEdge ?? 0) - (a.read?.avgEdge ?? 0) : a.tier === "t1" ? -1 : 1));
  const shown = plays.slice(0, playLimit);
  const league = r.league === "nfl" ? "NFL" : "College";
  const ruleLine = st.rule
    ? `Rule: ${st.rule.label.toLowerCase()}, ${rec(st.rule.record)} so far.${st.second ? ` Tier 2: ${st.second.label.toLowerCase()}, ${rec(st.second.record)}.` : ""}`
    : "No cut has a big enough winning sample yet, so nothing is a bet.";
  const su = r.su.best ? `Straight up follows ${r.su.best.label.toLowerCase()} (${r.su.best.w}-${r.su.best.l}).` : "";
  return card(`${label(`${league} · Week ${r.week ?? "?"}`)}
${paragraph(ruleLine)}
${
  shown.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;">${playRows(r, shown)}</table>${plays.length > shown.length ? small(`Plus ${plays.length - shown.length} more on the page.`) : ""}`
    : paragraph("Nothing fits this week.", PALETTE.muted)
}
<div style="padding-top:16px;">${label("Straight up, most confident first")}</div>
${small(su)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;">${suRows(r, suLimit)}</table>
<div style="padding-top:10px;font:400 13px/1.4 ${FONT};"><a href="${escapeHtml(`${appUrl}/picks${r.league === "cfb" ? "/cfb" : ""}`)}" style="color:${PALETTE.accent};">Full ${league} board and backtest</a></div>`);
}

export function picksSubject(nfl: PicksReport | null, cfb: PicksReport | null): string {
  const count = (r: PicksReport | null) => r?.board.filter((g) => g.tier === "t1").length ?? 0;
  const week = nfl?.week ?? cfb?.week;
  return `Week ${week ?? ""} picks: ${count(nfl)} NFL, ${count(cfb)} college Tier 1`;
}

export function renderPicksEmail(input: {
  nfl: PicksReport | null;
  cfb: PicksReport | null;
  appUrl: string;
  generatedAt: string;
}): string {
  const { nfl, cfb, appUrl } = input;
  const body = [
    nfl ? leagueCard(nfl, appUrl, 16, 12) : card(paragraph("The NFL board couldn't be read this morning.")),
    cfb ? leagueCard(cfb, appUrl, 15, 10) : card(paragraph("The college board couldn't be read this morning.")),
  ].join("");
  return emailPage({
    title: picksSubject(nfl, cfb),
    kicker: `Wednesday · Week ${nfl?.week ?? cfb?.week ?? ""}`,
    heading: "Where both models agree",
    preheader: picksSubject(nfl, cfb),
    body,
    cta: { href: `${appUrl}/picks`, text: "Open Picks" },
    footnote: `<div>Plays use the worse of the two sites' lines as of this morning. Check the live number before betting; the page has a checker for moved lines.</div>
<div style="padding-top:6px;">${generatedLine(input.generatedAt)}</div>`,
  });
}
