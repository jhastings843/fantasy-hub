// King of the End Zone payouts, from DK Network's "Tracking the leader for
// DraftKings King of the End Zone" posts (one per promo game, linked from the
// King Of hub). After the game the post names the winner and what each of his
// bettors got: "All Pickens bettors will win $65 in bonus bets", "The 26,158
// DraftKings Sportsbook bettors who picked him have received $77 in bonus
// bets", "All Raymond bettors received a $477 bonus bet credit". The intro
// states the pool ("a share of the $2 million in bonus bets"). Some posts give
// the winner only (Kittle, Cook): then there is no payout yet. Pure.
//
//   trackingLinks(hubHtml) -> [{ url, date: "2026-10-26" }, ...]
//   parsePayout(articleHtml) -> { winner: "George Pickens", perBettor: 65, pool: 2000000 }
//   backers({ perBettor: 65, pool: 2000000 }) -> 30769

/** What a tracking post says once the game is over. Any field can be missing. */
export interface PayoutRead {
  winner?: string;
  /** Bonus bets each winning bettor got, dollars. */
  perBettor?: number;
  /** Bettors on the winner, when the post states it. */
  bettors?: number;
  /** The promo's pool, dollars, when stated. */
  pool?: number;
}

/** Saved on the KotezSaved record once a post gives the per-bettor amount. */
export interface KotezPayout {
  perBettor: number;
  pool?: number;
  /** Stated by DK when the post gives it; else pool / perBettor (see backers). */
  bettors?: number;
  /** The post read. */
  source: string;
  at: string;
  /** Our estimate for the winner beside the actual (to calibrate the price-squared crowd estimate later). */
  est?: { name: string; share: number; impliedEntrants?: number };
}

const ENTITIES: { [k: string]: string } = { amp: "&", quot: '"', apos: "'", nbsp: " ", lt: "<", gt: ">", rsquo: "’", lsquo: "‘", ndash: "–", mdash: "—" };

/** HTML to plain text: scripts and tags dropped, entities decoded, spaces folded. */
export function textOf(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

const NUM = (s: string) => Number(s.replace(/,/g, ""));

/** The hub's tracking posts for King of the End Zone, with the game date from the post's slug (m-d-yy). */
export function trackingLinks(hub: string): { url: string; date: string }[] {
  const out = new Map<string, string>();
  for (const m of hub.matchAll(/href="(https:\/\/dknetwork\.draftkings\.com\/\d{4}\/\d{2}\/\d{2}\/tracking-the-leader-for-draftkings-king-of-the-end-zone-[a-z]+-(\d{1,2})-(\d{1,2})-(\d{2})\/?)"/gi)) {
    const date = `20${m[4]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    out.set(m[1], date);
  }
  return [...out].map(([url, date]) => ({ url, date }));
}

/** The post's address built from the game date (ET), for when the hub no longer lists it. */
export function trackingUrl(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `https://dknetwork.draftkings.com/${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/tracking-the-leader-for-draftkings-king-of-the-end-zone-${day}-${m}-${d}-${String(y).slice(2)}/`;
}

const NAME = "([A-Z][\\w'’.-]+(?:\\s+[A-Z][\\w'’.-]+){0,2})";

/** Winner, per-bettor bonus, bettors and pool from a tracking post. */
export function parsePayout(html: string): PayoutRead {
  const t = textOf(html);
  const out: PayoutRead = {};
  const winner =
    t.match(/King of the End Zone Winner\s*[-–:]\s*([^(]+?)\s*\(/i)?.[1] ??
    t.match(new RegExp(`Congrat(?:s|ulations) to all ${NAME} bettors`))?.[1] ??
    t.match(new RegExp(`All ${NAME} bettors`))?.[1] ??
    // Two words at most here: the text before a name is often a heading ("Winnings Update Bijan Robinson was crowned").
    t.match(/([A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+)?) (?:was|is) (?:crowned |your |tonight’s |tonight's |night’s |night's |the )*King of the End Zone(?! leader| lead)/)?.[1];
  if (winner) out.winner = winner.trim();
  // "$65 in bonus bets", "$477 bonus bet credit". The pool ("$2 million in bonus bets") and "$5 on a player" don't match.
  const per = [...t.matchAll(/\$(\d{1,3}(?:,\d{3})*|\d+)(?:\.\d\d)?\s+(?:in\s+bonus\s+bets?|bonus\s+bets?\b)/gi)].map((m) => NUM(m[1])).filter((v) => v > 0 && v < 100_000);
  if (per.length) out.perBettor = per[per.length - 1];
  const bettors = [...t.matchAll(/\b(\d{1,3}(?:,\d{3})+|\d{3,})\s+(?:[A-Z][\w'’.-]*\s+){0,3}bettors\b/g)].map((m) => NUM(m[1]));
  if (bettors.length) out.bettors = bettors[bettors.length - 1];
  const pool = t.match(/\$(\d+(?:\.\d+)?)\s*(?:million|M)\s+in\s+bonus\s+bets/i);
  if (pool) out.pool = Math.round(Number(pool[1]) * 1_000_000);
  return out;
}

/** Bettors on the winner: stated, else pool / per-bettor (an estimate: DK rounds the payout). Null without either. */
export function backers(p: { perBettor: number; pool?: number; bettors?: number }): number | null {
  if (p.bettors) return p.bettors;
  return p.pool && p.perBettor ? Math.round(p.pool / p.perBettor) : null;
}

/** Same person? Last names match (DK and ESPN spell first names differently: Khalif / Kalif Raymond). Post winners are sometimes the last name only. */
export function sameWinner(post: string, espn: string): boolean {
  const last = (s: string) => s.toLowerCase().replace(/[^a-z\s-]/g, "").trim().split(/\s+/).filter((w) => !/^(jr|sr|ii|iii|iv)$/.test(w)).at(-1) ?? "";
  return !!last(post) && last(post) === last(espn);
}

/** "$65 each, about 30,800 backers" (the count rounded to the hundred when it is pool / payout). */
export function payoutLine(p: Pick<KotezPayout, "perBettor" | "pool" | "bettors">): string {
  const n = backers(p);
  const stated = !!p.bettors;
  const count = n === null ? "" : stated ? `, ${n.toLocaleString("en-US")} backers` : `, about ${(Math.round(n / 100) * 100).toLocaleString("en-US")} backers`;
  return `$${p.perBettor.toLocaleString("en-US")} each${count}`;
}
