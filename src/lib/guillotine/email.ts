import { TIER_LABEL } from "./market";
import type { Posture } from "./chop-line";
import type { WeeklyFaabReport } from "./types";

// The Tuesday email.
//
// Same report object as the page, rendered for an inbox on a phone. Email is a
// worse medium than the app in every way except the one that matters here: it
// arrives. So this is not the page squeezed into a table, it is the same
// argument told in the order a phone can carry, and it stops early. The verdict
// and the claims are the email; the field table and the market are a link.
//
// Written with table layout and inline styles because that is what mail clients
// render. Gmail strips <style> blocks in some contexts and Outlook ignores most
// of flexbox, so nothing here depends on either.

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

const PALETTE = {
  ink: "#18181b",
  body: "#52525b",
  muted: "#a1a1aa",
  hairline: "#e4e4e7",
  surface: "#ffffff",
  page: "#fafaf9",
  amber: "#f59e0b",
  amberInk: "#b45309",
};

const POSTURE_COLOR: Record<Posture, { bg: string; ink: string; border: string; label: string }> = {
  red: { bg: "#fff1f2", ink: "#be123c", border: "#fecdd3", label: "Spend" },
  yellow: { bg: "#fffbeb", ink: "#b45309", border: "#fde68a", label: "Selective" },
  green: { bg: "#ecfdf5", ink: "#047857", border: "#a7f3d0", label: "Hold" },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Subject line. Leads with the decision, because that is all the list shows. */
export function emailSubject(report: WeeklyFaabReport): string {
  if (report.state !== "ok") {
    const who = report.league.name || "Guillotine";
    return `${who}: no FAAB advice yet`;
  }
  const verdict = POSTURE_COLOR[report.posture.posture].label;
  const risk = report.risk.myChopProbability;
  const riskText = risk == null ? "" : ` (${(risk * 100).toFixed(0)}% chop risk)`;

  if (report.card.sitOut) {
    return `Week ${report.week}: hold your FAAB${riskText}`;
  }
  const top = report.card.chains[0]?.targets[0];
  return top
    ? `Week ${report.week}: ${verdict}, ${top.player.name} at ${money(top.bid)}${riskText}`
    : `Week ${report.week}: ${verdict}${riskText}`;
}

function statCell(label: string, value: string, hint: string): string {
  return `
    <td style="padding:0 8px 0 0;vertical-align:top;width:25%;">
      <div style="font:600 10px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};">${escapeHtml(label)}</div>
      <div style="font:600 18px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${PALETTE.ink};padding-top:2px;">${escapeHtml(value)}</div>
      <div style="font:400 11px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${PALETTE.muted};padding-top:2px;">${escapeHtml(hint)}</div>
    </td>`;
}

function chainBlock(
  chain: WeeklyFaabReport["card"]["chains"][number],
  index: number,
): string {
  const claims = chain.targets
    .map((target, i) => {
      const flags = [
        target.player.fromChoppedRoster ? "Chopped" : null,
        target.player.injuryStatus,
        target.player.byeWeek != null ? `Bye ${target.player.byeWeek}` : null,
      ]
        .filter(Boolean)
        .map(
          (flag) =>
            `<span style="display:inline-block;background:#f4f4f5;color:${PALETTE.body};font:600 10px/1.4 -apple-system,sans-serif;padding:2px 6px;border-radius:999px;margin-left:6px;">${escapeHtml(String(flag))}</span>`,
        )
        .join("");

      const fallback =
        i > 0
          ? `<div style="font:400 11px/1.4 -apple-system,sans-serif;color:${PALETTE.muted};padding-bottom:4px;">Only if the one above loses</div>`
          : "";

      return `
      <tr>
        <td style="padding:10px 14px;border-top:1px solid ${PALETTE.hairline};">
          ${fallback}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="vertical-align:top;">
                <div style="font:600 15px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${PALETTE.ink};">
                  ${escapeHtml(target.player.name)}
                  <span style="font-weight:400;color:${PALETTE.muted};font-size:12px;">${escapeHtml(target.player.position)}${target.player.team ? " " + escapeHtml(target.player.team) : ""}</span>${flags}
                </div>
                <div style="font:400 12px/1.5 -apple-system,sans-serif;color:${PALETTE.body};padding-top:3px;">
                  ${escapeHtml(TIER_LABEL[target.tier])}${target.weekGain > 0 ? `. Adds ${target.weekGain.toFixed(1)} to your lineup` : ""}${target.displaces ? ` over ${escapeHtml(target.displaces.name)}` : ""}.
                </div>
              </td>
              <td style="vertical-align:top;text-align:right;white-space:nowrap;padding-left:12px;">
                <div style="font:600 18px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${PALETTE.amberInk};">${money(target.bid)}</div>
                <div style="font:400 11px/1.4 -apple-system,sans-serif;color:${PALETTE.muted};">stop at ${money(target.walkAway)}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
    })
    .join("");

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${PALETTE.hairline};border-radius:12px;margin-bottom:12px;background:${PALETTE.surface};">
    <tr>
      <td style="padding:10px 14px;background:#fafafa;border-radius:12px 12px 0 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font:600 13px/1.4 -apple-system,sans-serif;color:${PALETTE.ink};">
              <span style="color:${PALETTE.muted};font-weight:400;">${String(index + 1).padStart(2, "0")}</span>
              &nbsp;${escapeHtml(chain.need)}
            </td>
            <td style="text-align:right;font:400 11px/1.4 -apple-system,sans-serif;color:${PALETTE.body};">
              ${chain.drop ? `all drop ${escapeHtml(chain.drop.name)}` : "no free roster spot"}
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${claims}
  </table>`;
}

export function renderEmail(report: WeeklyFaabReport, appUrl: string): string {
  const link = `${appUrl.replace(/\/$/, "")}/l/${report.league.id}/faab`;

  if (report.state !== "ok") {
    return wrap(
      `<p style="font:400 15px/1.6 -apple-system,sans-serif;color:${PALETTE.body};margin:0 0 16px;">${escapeHtml(report.message ?? "No advice this week.")}</p>`,
      report,
      link,
    );
  }

  const tone = POSTURE_COLOR[report.posture.posture];
  const risk = report.risk.myChopProbability;

  const headline = report.card.sitOut
    ? "Bid nothing meaningful this week."
    : `Commit up to ${money(report.card.maxPossibleSpend)} this week.`;

  const verdict = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${tone.bg};border:1px solid ${tone.border};border-radius:14px;margin-bottom:20px;">
    <tr>
      <td style="padding:18px;">
        <span style="display:inline-block;background:${tone.ink};color:#ffffff;font:600 12px/1 -apple-system,sans-serif;padding:6px 12px;border-radius:999px;">${tone.label}</span>
        <div style="font:600 24px/1.25 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${PALETTE.ink};padding-top:14px;letter-spacing:-.01em;">
          ${escapeHtml(headline)}
        </div>
        <div style="font:400 14px/1.6 -apple-system,sans-serif;color:${PALETTE.body};padding-top:8px;">
          ${escapeHtml(report.posture.detail)}
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;border-top:1px solid ${tone.border};">
          <tr>
            <td style="padding-top:14px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  ${statCell("Chop risk", risk == null ? "n/a" : `${(risk * 100).toFixed(1)}%`, `avg ${(report.risk.baselineRisk * 100).toFixed(1)}%`)}
                  ${statCell("FAAB left", money(report.me.faabRemaining), `of ${money(report.league.budget)}`)}
                  ${statCell("Week ceiling", money(report.budget.weeklyCap), "all claims")}
                  ${statCell("Max one player", money(report.budget.maxSingleBid), "hard stop")}
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;

  const [lineLow, lineHigh] = report.risk.chopLineRange;
  const myFloor = report.field.find((t) => t.isMine)?.floor ?? null;
  const atRisk = myFloor != null && myFloor <= lineHigh;

  const chopLine = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${PALETTE.hairline};border-radius:12px;background:${PALETTE.surface};margin-bottom:20px;">
    <tr>
      <td style="padding:16px 18px;">
        <div style="font:600 10px/1.3 -apple-system,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};">The chop line</div>
        <div style="font:400 14px/1.6 -apple-system,sans-serif;color:${PALETTE.body};padding-top:8px;">
          You project <strong style="color:${PALETTE.ink};">${report.me.projected.toFixed(1)}</strong>${
            myFloor == null
              ? ""
              : ` with a bad week around <strong style="color:${PALETTE.amberInk};">${myFloor.toFixed(1)}</strong>`
          }.
          The low score usually lands between <strong style="color:${POSTURE_COLOR.red.ink};">${lineLow.toFixed(0)}</strong>
          and <strong style="color:${POSTURE_COLOR.red.ink};">${lineHigh.toFixed(0)}</strong> with ${report.league.teamsAlive} teams alive.
          ${
            atRisk
              ? "Your floor reaches into that range, which is why the risk is real even though the projection looks comfortable."
              : "Your floor clears it, so only an unusual week puts you in danger."
          }
        </div>
      </td>
    </tr>
  </table>`;

  const claims = report.card.chains.length
    ? `
  <div style="font:600 10px/1.3 -apple-system,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};padding-bottom:10px;">Claims to submit</div>
  ${report.card.chains.map(chainBlock).join("")}
  <p style="font:400 12px/1.6 -apple-system,sans-serif;color:${PALETTE.body};margin:4px 0 20px;">
    Every claim in a group drops the same player, so winning one cancels the rest. Submit them in the order shown. Groups are independent and can all win, which is why the ceiling counts one per group.
  </p>`
    : `<p style="font:400 15px/1.6 -apple-system,sans-serif;color:${PALETTE.body};margin:0 0 20px;">${escapeHtml(report.card.summary)}</p>`;

  const pacing = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${PALETTE.hairline};border-radius:12px;background:${PALETTE.surface};margin-bottom:20px;">
    <tr>
      <td style="padding:16px 18px;">
        <div style="font:600 10px/1.3 -apple-system,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};">Pacing</div>
        <div style="font:400 13px/1.6 -apple-system,sans-serif;color:${PALETTE.body};padding-top:8px;">${escapeHtml(report.budget.phaseNote)}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;">
          <tr>
            ${statCell("Chops left", String(report.budget.eliminationsRemaining), "including this one")}
            ${statCell("Per chop", money(report.budget.neutralAllowance), "neutral allowance")}
            ${statCell("Your FAAB share", `${(report.budget.purchasingPowerShare * 100).toFixed(1)}%`, `even is ${((1 / Math.max(1, report.league.teamsAlive)) * 100).toFixed(1)}%`)}
            ${statCell("Richest rival", money(report.budget.maxRivalBid), "their max bid")}
          </tr>
        </table>
      </td>
    </tr>
  </table>`;

  // The season, not just the week.
  //
  // The pacing numbers above are correct and unreadable as a plan: "week
  // ceiling $20" says nothing about whether $20 is tight because it is
  // September or tight because the money is gone. This is the same curve,
  // drawn forward, plus the names of the teams who can outbid you.
  const s = report.season;
  const paceLine = s.onPace
    ? `Spent ${money(s.spent)} of ${money(report.league.budget)}. The curve says hold ${money(s.holdFloor)} at this point, so you are ${money(Math.abs(s.aheadBy))} ahead of it.`
    : `Spent ${money(s.spent)} of ${money(report.league.budget)}. The curve says hold ${money(s.holdFloor)} at this point, so you are ${money(Math.abs(s.aheadBy))} behind it. Bid like the money is scarcer than the ceiling suggests.`;

  const trajectory = s.next.length
    ? s.next
        .map(
          (w) =>
            `<span style="white-space:nowrap;">W${w.week}: ${money(w.weeklyCap)} ceiling, hold ${money(w.holdFloor)}</span>`,
        )
        .join(' <span style="color:' + PALETTE.muted + '">&middot;</span> ')
    : "";

  const wallets = report.wallets
    .slice(0, 6)
    .map((w) => {
      const share = report.league.budget > 0 ? w.remaining / report.league.budget : 0;
      const bar = Math.max(2, Math.round(share * 100));
      return `<tr>
      <td style="padding:3px 8px 3px 0;font:${w.isMine ? "600" : "400"} 12px/1.5 -apple-system,sans-serif;color:${w.isMine ? PALETTE.ink : PALETTE.body};white-space:nowrap;">${escapeHtml(w.name)}${w.isMine ? " (you)" : ""}</td>
      <td width="55%" style="padding:3px 8px 3px 0;">
        <div style="background:${PALETTE.hairline};border-radius:3px;height:6px;">
          <div style="background:${w.isMine ? POSTURE_COLOR.green.ink : PALETTE.muted};width:${bar}%;height:6px;border-radius:3px;"></div>
        </div>
      </td>
      <td style="padding:3px 0;font:${w.isMine ? "600" : "400"} 12px/1.5 -apple-system,sans-serif;color:${PALETTE.ink};text-align:right;white-space:nowrap;">${money(w.remaining)}</td>
    </tr>`;
    })
    .join("");

  const seasonBlock = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${PALETTE.hairline};border-radius:12px;background:${PALETTE.surface};margin-bottom:20px;">
    <tr>
      <td style="padding:16px 18px;">
        <div style="font:600 10px/1.3 -apple-system,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};">The season plan</div>
        <div style="font:400 13px/1.6 -apple-system,sans-serif;color:${PALETTE.body};padding-top:8px;">${escapeHtml(paceLine)}</div>
        ${
          trajectory
            ? `<div style="font:400 12px/1.7 -apple-system,sans-serif;color:${PALETTE.body};padding-top:10px;">${trajectory}</div>
        <div style="font:400 11px/1.5 -apple-system,sans-serif;color:${PALETTE.muted};padding-top:4px;">Assuming one chop a week and no week where you are in danger, which lifts the ceiling on its own.</div>`
            : ""
        }
        <div style="font:400 12px/1.6 -apple-system,sans-serif;color:${PALETTE.body};padding-top:10px;">${
          s.inversionWeek
            ? `Six teams left projects to <strong style="color:${PALETTE.ink};">week ${s.inversionWeek}</strong>, where the format inverts and ceiling starts beating floor.`
            : "The field is already small enough that the format has inverted: outscore the survivors rather than avoid last."
        }${
          s.pacingOffWeek
            ? ` Pacing itself does not stop until four teams, projected <strong style="color:${PALETTE.ink};">week ${s.pacingOffWeek}</strong>, and money unspent after that is worth nothing.`
            : " Pacing is already off, so unspent money is a wasted asset."
        }</div>
        ${
          wallets
            ? `<div style="font:600 10px/1.3 -apple-system,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};padding:14px 0 6px;">Who can outbid you</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${wallets}</table>`
            : ""
        }
      </td>
    </tr>
  </table>`;

  const notes = [...report.league.scoringNotes, ...report.caveats];
  const notesBlock = notes.length
    ? `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${PALETTE.hairline};border-radius:12px;background:#fafafa;margin-bottom:20px;">
    <tr>
      <td style="padding:16px 18px;">
        <div style="font:600 10px/1.3 -apple-system,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};">Worth knowing</div>
        ${notes
          .map(
            (note) =>
              `<div style="font:400 12px/1.6 -apple-system,sans-serif;color:${PALETTE.body};padding-top:8px;">${escapeHtml(note)}</div>`,
          )
          .join("")}
      </td>
    </tr>
  </table>`
    : "";

  return wrap(verdict + chopLine + claims + pacing + seasonBlock + notesBlock, report, link);
}

function wrap(inner: string, report: WeeklyFaabReport, link: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(emailSubject(report))}</title>
</head>
<body style="margin:0;padding:0;background:${PALETTE.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(report.card.summary)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.page};padding:20px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr>
          <td style="padding-bottom:16px;">
            <div style="font:600 10px/1.3 -apple-system,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${PALETTE.muted};">
              ${escapeHtml(report.league.name)} &middot; Week ${report.week}
            </div>
            <div style="font:600 20px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${PALETTE.ink};padding-top:4px;letter-spacing:-.01em;">
              Where the money goes
            </div>
          </td>
        </tr>
        <tr><td>${inner}</td></tr>
        <tr>
          <td style="padding-top:4px;">
            <a href="${escapeHtml(link)}" style="display:inline-block;background:${PALETTE.amber};color:#ffffff;font:600 14px/1 -apple-system,sans-serif;padding:12px 18px;border-radius:10px;text-decoration:none;">Open the full report</a>
          </td>
        </tr>
        <tr>
          <td style="padding-top:18px;">
            <div style="font:400 11px/1.5 -apple-system,sans-serif;color:${PALETTE.muted};">
              Built from Sleeper projections scored under this league's settings. Generated ${escapeHtml(new Date(report.generatedAt).toLocaleString("en-US", { timeZone: "America/New_York" }))} ET.
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
