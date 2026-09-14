// The house style, in one place.
//
// There are five emails now (Tuesday FAAB, Wednesday midweek, Thursday before
// kickoff, Sunday morning, and the Sunday lock alarm) and they all land on the
// same phone within a few days of each other. Four copies of a palette is four
// chances for one of them to drift into looking like a different product, and
// the drift always happens on the one you edited last.
//
// Everything here is a string builder. No dependency, no templating language,
// and no client: an email is HTML that has to survive Gmail, which means
// tables, inline styles, and nothing clever.

export const PALETTE = {
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
  bad: "#b91c1c",
  badBg: "#fef2f2",
  badBorder: "#fecaca",
};

export type Tint = { bg: string; border: string };

export const GOOD: Tint = { bg: PALETTE.goodBg, border: PALETTE.goodBorder };
export const WARN: Tint = { bg: PALETTE.warnBg, border: PALETTE.warnBorder };
export const BAD: Tint = { bg: PALETTE.badBg, border: PALETTE.badBorder };

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export const money = (n: number) => `$${Math.round(n)}`;

export function card(inner: string, tint?: Tint): string {
  const bg = tint?.bg ?? PALETTE.surface;
  const border = tint?.border ?? PALETTE.hairline;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bg};border:1px solid ${border};border-radius:12px;margin-bottom:12px;">
  <tr><td style="padding:16px 18px;">${inner}</td></tr>
</table>`;
}

export function label(text: string): string {
  return `<div style="font:600 10px/1.3 -apple-system,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${PALETTE.muted};padding-bottom:6px;">${escapeHtml(text)}</div>`;
}

export function statCell(name: string, value: string): string {
  return `<td width="25%" style="padding-right:8px;">
  <div style="font:600 16px/1.2 -apple-system,sans-serif;color:${PALETTE.ink};">${escapeHtml(value)}</div>
  <div style="font:400 10px/1.3 -apple-system,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};padding-top:2px;">${escapeHtml(name)}</div>
</td>`;
}

/** Up to four numbers across, which is what 560px holds on a phone. */
export function statRow(stats: { name: string; value: string }[]): string {
  if (stats.length === 0) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
  <tr>${stats.slice(0, 4).map((s) => statCell(s.name, s.value)).join("")}</tr>
</table>`;
}

export function headline(text: string): string {
  return `<div style="font:700 22px/1.25 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${PALETTE.ink};letter-spacing:-.01em;">${escapeHtml(text)}</div>`;
}

export function paragraph(text: string, color = PALETTE.body): string {
  return `<div style="font:400 14px/1.55 -apple-system,sans-serif;color:${color};padding-top:6px;">${escapeHtml(text)}</div>`;
}

export function small(text: string, color = PALETTE.muted): string {
  return `<div style="font:400 12px/1.5 -apple-system,sans-serif;color:${color};padding-top:4px;">${escapeHtml(text)}</div>`;
}

export function button(href: string, text: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${PALETTE.accent};color:#ffffff;font:600 14px/1 -apple-system,sans-serif;padding:12px 18px;border-radius:10px;text-decoration:none;">${escapeHtml(text)}</a>`;
}

export interface PageInput {
  /** Browser and client title. Usually the subject. */
  title: string;
  /** The small uppercase line above the heading: "Sunday, Week 3". */
  kicker: string;
  /** The one line that says what this email is for. */
  heading: string;
  /** The inbox preview line, which is the only text seen without opening. */
  preheader: string;
  /** Already-rendered cards. */
  body: string;
  cta?: { href: string; text: string };
  /** Provenance, generation time, anything in fine print. */
  footnote?: string;
}

/**
 * The 560px column every one of these emails lives in.
 *
 * 560 rather than 600: a phone in portrait renders 600 with a horizontal
 * nudge in Gmail's iOS client, and every one of these is read on a phone.
 */
export function emailPage(input: PageInput): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(input.title)}</title>
</head>
<body style="margin:0;padding:0;background:${PALETTE.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.page};padding:20px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr>
          <td style="padding-bottom:16px;">
            <div style="font:600 10px/1.3 -apple-system,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${PALETTE.muted};">${escapeHtml(input.kicker)}</div>
            <div style="font:600 20px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${PALETTE.ink};padding-top:4px;letter-spacing:-.01em;">${escapeHtml(input.heading)}</div>
          </td>
        </tr>
        <tr><td>${input.body}</td></tr>
        ${
          input.cta
            ? `<tr><td style="padding-top:4px;">${button(input.cta.href, input.cta.text)}</td></tr>`
            : ""
        }
        ${
          input.footnote
            ? `<tr><td style="padding-top:18px;"><div style="font:400 11px/1.55 -apple-system,sans-serif;color:${PALETTE.muted};">${input.footnote}</div></td></tr>`
            : ""
        }
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** "Generated 8:02 AM ET", for the bottom of any of these. */
export function generatedLine(generatedAt: string): string {
  return `Generated ${escapeHtml(
    new Date(generatedAt).toLocaleString("en-US", { timeZone: "America/New_York" }),
  )} ET.`;
}
