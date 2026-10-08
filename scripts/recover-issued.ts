// One-off, 2026-10-08: rebuild issued records for the first picks email
// (Week 5, sent 2026-10-07 19:00 UTC, Resend id 01a117bc-...) from the
// delivered message itself, before issued records existed.
//
// The frozen board snapshots from that send are kept untouched, but they are
// not what was sent: the college one holds 12 Tier 2 games the email left to
// the page, and both store the models' average winner where the college email
// listed the Vegas favorite. This reads the email's HTML back from Resend,
// matches each printed play to a snapshot row (side and line must agree), and
// writes a record marked provenance "recovered" with everything it cannot
// vouch for listed in `unverified`. Writes with NX: never overwrites.
//
//   npx tsx scripts/recover-issued.ts          dry run, prints the records
//   npx tsx scripts/recover-issued.ts --write  writes them

import { readFileSync } from "node:fs";
import { Redis } from "@upstash/redis";
import { tally, type Result } from "../src/lib/picks/engine";
import { RULE_VERSION, type IssuedRecord } from "../src/lib/picks/issued";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => /^(UPSTASH_REDIS_REST_URL|UPSTASH_REDIS_REST_TOKEN|RESEND_API_KEY)=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]),
);
const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
const WRITE = process.argv.includes("--write");

const decode = (s: string) =>
  s.replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&middot;/g, "·").trim();
const text = (html: string) => decode(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));

/** "14-2" or "18-4-1" as a Record. */
function record(s: string) {
  const [w, l, p = 0] = s.split("-").map(Number);
  return tally([...Array(w).fill("W"), ...Array(l).fill("L"), ...Array(p).fill("P")] as Result[]);
}

const RULE_TESTS: { [label: string]: { id: string; test: object } } = {
  "agree on underdog": { id: "dog", test: { side: "dog" } },
  "agree, line 14+ either side": { id: "any-14", test: { minAbsLine: 14 } },
  "both agree, any edge": { id: "agree", test: {} },
  "agree + model lines within 3 of each other": { id: "gap3", test: { maxModelGap: 3 } },
};

interface SnapPlay { home: string; away: string; tier: string; side?: "home" | "away"; homeLine?: number; play: string }

async function main() {
  const sent = await redis.get<{ sentAt: string; subject: string; messageId: string }>("email:v1:sent:picks:2026:w5");
  if (!sent) throw new Error("no sent record for 2026 w5");
  const res = await fetch(`https://api.resend.com/emails/${sent.messageId}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
  const html = ((await res.json()) as { html: string }).html;
  // Display name -> team key, from the live college report.
  const cfb = (await (await fetch("https://fantasy-hub-tan.vercel.app/api/picks?league=cfb")).json()) as { report?: { names: { [k: string]: string } }; names?: { [k: string]: string } };
  const names = cfb.report?.names ?? cfb.names ?? {};
  const keyOf = (league: "nfl" | "cfb", display: string) =>
    league === "nfl" ? display : Object.entries(names).find(([, v]) => v === display)?.[0] ?? display.toLowerCase();

  // The two league cards, in order: NFL then College.
  const cards = html.split(/(?=NFL · Week|College · Week)/).slice(1);
  const out: IssuedRecord[] = [];
  for (const [league, week, chunk] of [
    ["nfl", 5, cards.find((c) => c.startsWith("NFL"))!],
    ["cfb", 6, cards.find((c) => c.startsWith("College"))!],
  ] as const) {
    const snap = await redis.get<{ plays: SnapPlay[]; rule: string }>(`picks:v1:${league}:snap:2026:w${week}`);
    if (!snap) throw new Error(`${league} snapshot missing`);
    const unverified: string[] = [
      "Lines are each site's own number as the email printed them (the worse of the two); no common reference line or quote time was recorded.",
      "Rule and Tier 2 definitions are matched by label to the code at commit c5ed6fe; their records are as printed.",
      "Tier 2's printed record was the runner-up cut's full record, not the games it added outside Tier 1.",
    ];
    const t = text(chunk);
    const ruleM = t.match(/Rule: (.+?), (\d+-\d+(?:-\d+)?) so far\. Tier 2: (.+?), (\d+-\d+(?:-\d+)?)\./);
    if (!ruleM) throw new Error(`${league}: rule line not found`);
    const cut = (label: string, rec: string) => ({ ...RULE_TESTS[label], label, evidence: record(rec) });

    // Plays: TIER n | Team +x | vs Opp | edge
    const plays = [...chunk.matchAll(/TIER (\d)<\/span><\/td>\s*<td[^>]*>([^<]+)<div[^>]*>vs ([^<]+)<\/div>/g)].map((m) => {
      const [, tier, playText, opp] = m;
      const pm = decode(playText).match(/^(.*) (PK|[+-][\d.]+)$/)!;
      const team = keyOf(league, pm[1]);
      const other = keyOf(league, decode(opp));
      const line = pm[2] === "PK" ? 0 : Number(pm[2]);
      const row = snap.plays.find((p) => (p.home === team && p.away === other) || (p.away === team && p.home === other));
      if (!row?.side || row.homeLine === undefined) throw new Error(`${league}: no snapshot row for ${pm[1]}`);
      const side: "home" | "away" = row.home === team ? "home" : "away";
      const homeLine = side === "home" ? line : -line;
      if (side !== row.side || homeLine !== row.homeLine) throw new Error(`${league}: ${pm[1]} differs from the snapshot`);
      return { home: row.home, away: row.away, tier: `t${tier}` as "t1" | "t2", side, homeLine, play: decode(playText), basis: "source" as const, shownInEmail: true };
    });
    const tiered = snap.plays.filter((p) => p.tier === "t1" || p.tier === "t2");
    const notSent = tiered.filter((p) => !plays.some((x) => x.home === p.home && x.away === p.away));
    if (notSent.length) {
      unverified.push(`${notSent.length} Tier 1/2 game${notSent.length === 1 ? "" : "s"} the email left to the page ("Plus ${notSent.length} more") are not part of this record; the old frozen snapshot counted them.`);
    }

    // Straight up: rank | Pick over Opp | Band · margin
    const su = [...chunk.matchAll(/width:28px;">\d+<\/td>\s*<td[^>]*>([^<]+)<span[^>]*>over ([^<]+)<\/span><\/td>\s*<td[^>]*>([^<]+)<\/td>/g)].map((m) => {
      const team = keyOf(league, decode(m[1]));
      const opp = keyOf(league, decode(m[2]));
      const [band, margin] = decode(m[3]).split(" · ");
      const row = snap.plays.find((p) => (p.home === team && p.away === opp) || (p.away === team && p.home === opp));
      if (!row) throw new Error(`${league}: no snapshot row for SU ${m[1]}`);
      return { home: row.home, away: row.away, side: (row.home === team ? "home" : "away") as "home" | "away", margin: Number(margin), band: `${band} (as printed)`, shownInEmail: true };
    });
    const method = t.match(/Straight up follows (.+?) \(/)![1];
    unverified.push(`Straight up: the ${su.length} picks the email listed, labelled as printed ("Lock"/"Solid"/"Toss-up" were margin bands, not probabilities).`);

    out.push({
      league,
      season: 2026,
      week,
      issuedAt: sent.sentAt,
      provenance: "recovered",
      emailId: sent.messageId,
      subject: sent.subject,
      ruleVersion: `pre-issued-records (recovered under ${RULE_VERSION})`,
      rule: cut(ruleM[1], ruleM[2]),
      second: cut(ruleM[3], ruleM[4]),
      suMethod: { id: method === "vegas favorite" ? "vegas" : "avg", label: method },
      plays,
      su,
      unverified,
    });
  }

  for (const rec of out) {
    console.log(`\n${rec.league} week ${rec.week}: ${rec.plays.length} plays (${rec.plays.filter((p) => p.tier === "t1").length} T1), ${rec.su.length} SU, method ${rec.suMethod.id}`);
    console.log(` rule ${rec.rule?.id} ${rec.rule?.evidence?.w}-${rec.rule?.evidence?.l}; tier 2 ${rec.second?.id}`);
    rec.plays.forEach((p) => console.log(`  ${p.tier} ${p.play} (${p.side} ${p.homeLine})`));
    rec.unverified.forEach((u) => console.log(`  ! ${u}`));
    if (WRITE) {
      const ok = await redis.set(`picks:v1:${rec.league}:issued:2026:w${rec.week}`, rec, { nx: true });
      await redis.sadd(`picks:v1:${rec.league}:issued:2026`, rec.week);
      console.log(ok === "OK" ? "  written" : "  already on file, left alone");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
