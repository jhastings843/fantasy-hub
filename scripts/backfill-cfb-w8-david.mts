// One-off, 2026-10-26: David rebuilt his college page on Fri 2026-10-23
// (~11:40pm ET), and the old text reader found no games, so 41 of 44
// Saturday games of college Week 8 were stored without his line and the
// Saturday game-day send (10:30am ET, after waiting for his board) had no
// college bets. parseDavidBoard now reads the new page (RSC payload).
//
// This repairs what the break left behind, using what we already held:
// 1. Forecast snapshots of Week 8 missing David get his line back: the model
//    line from his page (identical to every copy stored before the break, all
//    56 games), the market number and total from the last copy stored before
//    the break. Marked `backfilled`. The originals are saved first.
// 2. The Saturday send is replayed: compose() at the send's own moment
//    (2026-10-24T14:30:02Z) on the frozen Week 8 rule, the quotes stored at
//    or before then, the exposure and NFL rivals its recorded decision saw,
//    and the active policy. Its plays become an issued record with
//    provenance "reconstructed" (never emailed), and its sizing a decision
//    marked `reconstructed`, so the sizing replay's coverage check holds.
//    Both checks are run on the result before anything is written.
//
//   npx tsx --tsconfig scripts/tsconfig.json --env-file=.env.local scripts/backfill-cfb-w8-david.mts          dry run
//   npx tsx --tsconfig scripts/tsconfig.json --env-file=.env.local scripts/backfill-cfb-w8-david.mts --write  writes

import { readFileSync, writeFileSync } from "node:fs";
import { redis } from "@/lib/redis/client";
import { parseDavidBoard } from "@/lib/picks/parse";
import { compose, type PicksCore } from "@/lib/picks/compose";
import { diffUpdate, onDate } from "@/lib/picks/update";
import { toIssuedUpdate, type IssuedRecord } from "@/lib/picks/issued";
import { loadActivePolicy } from "@/lib/picks/policy-store";
import { loadRuleFreeze } from "@/lib/picks/rule-freeze";
import { loadIssued, saveIssued } from "@/lib/picks/issued-store";
import { loadDecisions } from "@/lib/picks/decisions-store";
import { coverageGaps, reproductionGaps, toDecision } from "@/lib/picks/learning/replay";
import { etDate } from "@/lib/picks/hold";
import { grade, key, type RefLine } from "@/lib/picks/engine";
import type { ForecastSnapshot } from "@/lib/picks/forecasts";

const WRITE = process.argv.includes("--write");
const SEASON = 2026;
const WEEK = 8;
const SEND_AT = "2026-10-24T14:30:02.954Z";
const SEND_KEY = "picks-day:2026-10-24";
const WHY = "David's college board unread after his 2026-10-23 redesign";
const LIST = `picks:v2:cfb:${SEASON}:forecast:w${WEEK}`;
const now = new Date(SEND_AT);

// ------------------------------------------------------------- 1. snapshots
const page = parseDavidBoard("cfb", readFileSync("test/fixtures/picks/ds-cfb-board-wk8.html", "utf8"));
if (page.week !== WEEK || page.rows.length !== 56) throw new Error(`fixture is week ${page.week} with ${page.rows.length} games`);
const model = new Map(page.rows.map((r) => [`${r.away}@${r.home}`, r.line.model]));
const raw = await redis.lrange<ForecastSnapshot>(LIST, 0, -1);
writeFileSync(`${process.env.TMPDIR ?? "/tmp"}/forecast-cfb-w8-before-backfill.json`, JSON.stringify(raw));
const lastDavid = new Map<string, ForecastSnapshot>();
const fixes: { i: number; snap: ForecastSnapshot }[] = [];
raw.forEach((s, i) => {
  const g = `${s.away}@${s.home}`;
  if (s.david) {
    lastDavid.set(g, s);
    if (model.has(g) && model.get(g) !== s.david.model) throw new Error(`${g}: stored model ${s.david.model}, page ${model.get(g)}`);
    return;
  }
  const prev = lastDavid.get(g);
  if (!prev?.david || !model.has(g)) return;
  fixes.push({ i, snap: { ...s, david: { model: model.get(g)!, market: prev.david.market }, davidTotal: prev.davidTotal, backfilled: WHY } });
});
const snaps = raw.map((s, i) => fixes.find((f) => f.i === i)?.snap ?? s);
console.log(`snapshots: ${raw.length}, missing David and repaired: ${fixes.length} across ${new Set(fixes.map((f) => key(f.snap))).size} games`);

// ------------------------------------------------------------ 2. the send
const cached = (await redis.get<{ value: PicksCore }>("picks:v2:cfb:core")) ?? (await redis.get<{ value: PicksCore }>("picks:v2:cfb:core:lkg"));
if (!cached?.value || cached.value.week !== WEEK) throw new Error("no Week 8 college core cached");
const core: PicksCore = structuredClone(cached.value);
const freeze = await loadRuleFreeze("cfb", SEASON, WEEK);
if (!freeze) throw new Error("no Week 8 rule freeze");
Object.assign(core, { strategies: freeze.board, policyId: freeze.policyId, ruleSet: { at: freeze.reviewAt, throughWeek: freeze.throughWeek } });
const pregame = snaps.filter((s) => s.at <= SEND_AT);
const last = new Map<string, ForecastSnapshot>();
for (const s of pregame) last.set(`${s.away}@${s.home}`, s);
for (const r of core.rows) {
  const s = last.get(`${r.away}@${r.home}`);
  if (s?.david) Object.assign(r, { david: s.david, davidTotal: s.davidTotal });
}
const quotes = new Map<string, RefLine>();
for (const s of pregame) if (s.ref) quotes.set(key(s), s.ref);
const fetchedAt = [...quotes.values()].map((q) => q.fetchedAt).sort().pop() ?? null;
// Finals known at the send: only games that had kicked off 4+ hours before it.
core.finals = core.finals.filter(([k]) => {
  if (!k.startsWith(`${WEEK}:`)) return true;
  const ko = quotes.get(k)?.kickoff;
  return !!ko && Date.parse(ko) + 4 * 3600e3 < now.getTime();
});
const { decisions } = await loadDecisions(SEASON);
const dec = decisions.find((d) => d.sendKey === SEND_KEY && d.league === "cfb");
const nflDec = decisions.find((d) => d.sendKey === SEND_KEY && d.league === "nfl");
if (!dec || !nflDec) throw new Error("no recorded decision for the Saturday send");
const exposure = { weekly: dec.exposure.weekly, outstanding: dec.exposure.outstanding, reserved: dec.exposure.reserved, perGame: new Map(dec.exposure.perGame) };
const rivals = nflDec.candidates
  .filter((c) => !c.rival && c.held)
  .map((c) => ({ id: `rival:${c.kind}:nfl:${c.key.split(":")[1]}`, game: `nfl:${c.key}`, want: nflDec.live[c.id] ?? 0, priority: 0, info: c }));
const issuedCfb = await loadIssued("cfb", SEASON);
const issuedBefore = issuedCfb.filter((r) => r.issuedAt <= SEND_AT);
const policy = await loadActivePolicy();
if (policy.id !== dec.policyId) throw new Error(`active policy ${policy.id}, the send ran under ${dec.policyId}`);
const report = compose({ core, quotes: { fetchedAt, lines: [...quotes] }, issued: issuedBefore, exposure, policy, now, rivals, settled: dec.settled });
const diff = onDate(diffUpdate(report, issuedBefore, now), etDate(now));
const subject = "Saturday college bets, rebuilt (not emailed: David's board unread)";
const rec: IssuedRecord = { ...toIssuedUpdate(report, diff, "gsat", { issuedAt: SEND_AT, subject }), provenance: "reconstructed", status: "sent", idempotencyKey: SEND_KEY, unverified: [`Never emailed. Rebuilt 2026-10-26 from stored pregame data: ${WHY}.`] };
const decision = { ...toDecision(report, { at: new Date(now.getTime() + 1).toISOString(), sendKey: SEND_KEY, order: dec.order, onSendDate: (k) => !!k && etDate(new Date(k)) === etDate(now), finalsKnown: dec.finalsKnown })!, reconstructed: WHY };

const finals = new Map(cached.value.finals);
let units = 0;
for (const p of rec.plays) {
  const f = finals.get(key({ week: WEEK, home: p.home, away: p.away }));
  const res = f ? grade(f, p.homeLine, p.side) : "?";
  const u = res === "W" ? p.units! * (p.price! < 0 ? 100 / -p.price! : p.price! / 100) : res === "L" ? -p.units! : 0;
  units += u;
  console.log(`  ${p.tier} ${p.play} (${p.price}) ${p.units}u  final ${f ? `${f.away}-${f.home}` : "?"}  ${res}  ${u >= 0 ? "+" : ""}${u.toFixed(2)}u`);
}
console.log(`card: ${rec.plays.length} plays, ${(rec.totals ?? []).length} totals, net ${units.toFixed(2)}u`);

// ---------------------------------------------------------------- 3. checks
const all = [...decisions.filter((d) => !(d.sendKey === SEND_KEY && d.league === "cfb")), decision];
const issuedNfl = await loadIssued("nfl", SEASON);
const since = "2026-10-12T00:00:00Z";
const before = coverageGaps(decisions, [{ league: "nfl", records: issuedNfl }, { league: "cfb", records: issuedCfb }], since).length + reproductionGaps(decisions).length;
const gaps = [...coverageGaps(all, [{ league: "nfl", records: issuedNfl }, { league: "cfb", records: [...issuedCfb, rec] }], since), ...reproductionGaps(all)];
console.log(`sizing replay gaps: ${before} before, ${gaps.length} after${gaps.length ? `: ${gaps.map((g) => g.why).join("; ")}` : ""}`);
if (gaps.length > before) throw new Error("the rebuilt send would break the sizing replay; nothing written");

if (!WRITE) {
  console.log("dry run: nothing written (pass --write)");
} else {
  await redis.set(`${LIST}:before-backfill`, JSON.stringify(raw), { ex: 90 * 24 * 3600 });
  const pipe = redis.pipeline();
  for (const f of fixes) pipe.lset(LIST, f.i, JSON.stringify(f.snap));
  await pipe.exec();
  const ok = await saveIssued(rec);
  await redis.hset(`picks:v2:${SEASON}:decisions`, { [`${SEND_KEY}|cfb|${decision.at}`]: JSON.stringify(decision) });
  console.log(`written: ${fixes.length} snapshots, record ${ok ? "saved" : "ALREADY THERE, left as is"} (w${WEEK}:gsat), decision ${decision.at}`);
}
