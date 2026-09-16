import type { WaiverContext } from "@/lib/waivers/build";
import { usageText } from "@/lib/waivers/freshness";
import {
  card,
  emailPage,
  escapeHtml,
  generatedLine,
  label,
  money,
  paragraph,
  PALETTE,
  small,
  GOOD,
  WARN,
} from "@/lib/email/shell";

// Wednesday morning: what is on the wire, and what his list changed.
//
// This is the quietest of the five on purpose. Tuesday already covered the
// guillotine bids and Thursday covers lineups, so the only thing Wednesday
// owns is the waiver run in the other three leagues and whichever rankings
// post landed since. Most weeks that is one claim or none, and the email says
// so in a line rather than padding itself out to look busy.

export interface MidweekInput {
  leagues: WaiverContext[];
  /** The guillotine league, named so the email can point at its own guide. */
  guillotine: { leagueId: string; name: string } | null;
  week: number | null;
  generatedAt: string;
  appUrl: string;
}

/** Two of each kind. More than four names in one league is a shopping list. */
const PER_KIND = 2;

/**
 * Claims the email actually lists, not claims that exist.
 *
 * Each league shows two of each kind, so counting the full lists would put a
 * number in the subject line that the body never reaches. A subject that
 * promises thirteen and shows eight is a subject you stop trusting.
 */
export function claimCount(input: MidweekInput): number {
  return input.leagues.reduce(
    (n, l) =>
      n +
      Math.min(PER_KIND, l.report.startable.length) +
      Math.min(PER_KIND, l.report.seasonUpgrades.length),
    0,
  );
}

export function midweekSubject(input: MidweekInput): string {
  const n = claimCount(input);
  const head = `Week ${input.week ?? ""} midweek`;
  if (n === 0) return `${head}: nothing worth claiming`;
  return `${head}: ${n} claim${n === 1 ? "" : "s"} worth making`;
}

function usageNote(p: {
  lastWeek?: { week: number; points: number; snaps: number; targets: number; carries: number } | null;
  research?: { faabPercent: number | null; note: string } | null;
}): string {
  const usage = p.lastWeek ? ` ${usageText(p.lastWeek)}.` : "";
  const research = p.research
    ? ` Consensus${p.research.faabPercent != null ? ` ${p.research.faabPercent}% of budget` : " pick"}: ${p.research.note}`
    : "";
  return `${usage}${research}`;
}

function bidText(
  price: { bid: number; walkAway: number; longShot: boolean; marketExpected: number } | undefined,
): string {
  if (!price) return "";
  const stop = price.walkAway > price.bid ? `, stop at ${money(price.walkAway)}` : "";
  const lose = price.longShot
    ? ` Likely loses; the room should pay about ${money(price.marketExpected)}.`
    : "";
  return ` Bid ${money(price.bid)}${stop}.${lose}`;
}

function playerLine(
  name: string,
  detail: string,
  tint: "start" | "season",
): string {
  const chip = tint === "start" ? "STARTS" : "SEASON";
  const chipColour = tint === "start" ? PALETTE.warn : PALETTE.accent;
  return `<div style="padding:8px 0;border-top:1px solid ${PALETTE.hairline};">
  <div style="font:600 13px/1.4 -apple-system,sans-serif;color:${PALETTE.ink};">
    <span style="display:inline-block;border:1px solid ${chipColour};color:${chipColour};border-radius:5px;padding:1px 6px;font:600 10px/1.5 -apple-system,sans-serif;letter-spacing:.04em;margin-right:6px;">${chip}</span>
    ${escapeHtml(name)}
  </div>
  <div style="font:400 12px/1.5 -apple-system,sans-serif;color:${PALETTE.body};padding-top:3px;">${escapeHtml(detail)}</div>
</div>`;
}

function leagueCard(league: WaiverContext): string {
  const head = `<div style="font:600 14px/1.3 -apple-system,sans-serif;color:${PALETTE.ink};">${escapeHtml(league.leagueName)}</div>`;

  if (league.blocked) {
    return card(`${head}${small(league.blocked, PALETTE.warn)}`, WARN);
  }

  const budget =
    league.budgetLeft != null && league.budgetTotal
      ? small(
          `${money(league.budgetLeft)} of ${money(league.budgetTotal)} FAAB left.${
            league.pacing ? ` ${league.pacing.note}` : ""
          }`,
        )
      : "";
  const stale = league.source.note ? small(league.source.note) : "";

  const starts = league.report.startable
    .slice(0, PER_KIND)
    .map((t) =>
      playerLine(
        t.player.name,
        `Would start at ${t.slot}${t.displaces ? `, ahead of ${t.displaces.name}` : ""}. ${
          t.player.positionalRank != null
            ? `He has him ${t.player.position}${t.player.positionalRank} this week.`
            : "Unranked this week, so this is the season list talking."
        }${usageNote(t.player)}${bidText(t.price)}`,
        "start",
      ),
    )
    .join("");

  const season = league.report.seasonUpgrades
    .slice(0, PER_KIND)
    .map((t) =>
      playerLine(
        t.player.name,
        `${t.player.seasonPositionRank ?? "Ranked"} on the season list${
          t.placesBetter != null ? `, ${t.placesBetter} places better` : ""
        }${t.dropFor ? `. Drop ${t.dropFor.name}` : ". There is a free spot"}.${usageNote(t.player)}${bidText(t.price)}`,
        "season",
      ),
    )
    .join("");

  if (!starts && !season) {
    return card(
      `${head}<div style="font:600 13px/1.5 -apple-system,sans-serif;color:${PALETTE.good};padding-top:6px;">Nothing on the wire beats what you have.</div>${budget}`,
      GOOD,
    );
  }

  return card(`${head}${stale}${budget}<div style="padding-top:4px;">${starts}${season}</div>`);
}

export function renderMidweekEmail(input: MidweekInput): string {
  const n = claimCount(input);

  const body = input.leagues.length
    ? input.leagues.map(leagueCard).join("")
    : card(`${label("Waivers")}${paragraph("No league could be read this morning.")}`, WARN);

  const guillotine = input.guillotine
    ? card(
        `${label("Guillotine")}
<div style="font:400 13px/1.5 -apple-system,sans-serif;color:${PALETTE.body};">Bids in ${escapeHtml(input.guillotine.name)} process today. Tuesday's guide has the pacing; the page has the live numbers.</div>
<div style="padding-top:8px;"><a href="${escapeHtml(input.appUrl)}/l/${escapeHtml(input.guillotine.leagueId)}/faab" style="font:600 13px/1.4 -apple-system,sans-serif;color:${PALETTE.accent};text-decoration:none;">Open the FAAB guide &rarr;</a></div>`,
      )
    : "";

  // One provenance line for the whole email rather than per league: it is the
  // same list feeding all of them, and saying it four times reads as noise.
  const list = input.leagues.find((l) => l.listTitle);

  return emailPage({
    title: midweekSubject(input),
    kicker: `Wednesday · Week ${input.week ?? ""}`,
    heading: n === 0 ? "Nothing to claim" : "Worth a claim today",
    preheader:
      n === 0
        ? "No league has anything on the wire worth taking."
        : `${n} claim${n === 1 ? "" : "s"} across your leagues.`,
    body: `${body}${guillotine}`,
    cta: { href: `${input.appUrl}`, text: "Open fantasy hub" },
    footnote: `${
      list
        ? `<div>Rankings from ${escapeHtml(list.listTitle ?? "")}${
            list.listUpdatedLabel ? `, updated ${escapeHtml(list.listUpdatedLabel)}` : ""
          }.</div>`
        : ""
    }<div style="padding-top:6px;">${generatedLine(input.generatedAt)}</div>`,
  });
}
