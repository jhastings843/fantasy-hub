// /pickem pick log: write picks, grade them from ESPN, print record splits.
//
//   node --import ./scripts/ts-resolve.mjs scripts/pickem-log.mts log < picks.json
//   node --import ./scripts/ts-resolve.mjs scripts/pickem-log.mts log --file picks.json
//   node --import ./scripts/ts-resolve.mjs scripts/pickem-log.mts grade                 (every week with ungraded picks)
//   node --import ./scripts/ts-resolve.mjs scripts/pickem-log.mts grade --league cfb --season 2026 --week 11
//   node --import ./scripts/ts-resolve.mjs scripts/pickem-log.mts stats [--league cfb] [--json]
//
// Files: data/pickem/<league>-<season>-w<NN>.jsonl, one pick per line. See
// data/pickem/README.md. Grading reads ESPN's public scoreboard and game
// summary (no key, free), the same feed closing-store.ts uses for the Picks tab.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { teamKey } from "../src/lib/picks/parse";
import { parseScoreboard, parseSummary } from "../src/lib/picks/closing";
import { buildRecord, gradePick, problemsOf, splits, type FinishedGame, type PickInput, type PickRecord } from "../src/lib/pickem-log/log";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/football";
const SPORT = { nfl: "nfl", cfb: "college-football" } as const;

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

// --dir points it somewhere else (a scratch folder for testing).
const DIR = path.resolve(flag("dir") ?? path.join(import.meta.dirname, "../data/pickem"));

const fileOf = (league: string, season: number, week: number, seasontype = 2) =>
  path.join(DIR, `${league}-${season}-${seasontype === 3 ? "post" : "w"}${String(week).padStart(2, "0")}.jsonl`);

function readFile(f: string): PickRecord[] {
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as PickRecord);
}
const allFiles = () => (existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(DIR, f)) : []);

// ------------------------------------------------------------------ log

function log() {
  const raw = flag("file") ? readFileSync(flag("file")!, "utf8") : readFileSync(0, "utf8");
  const parsed = JSON.parse(raw) as PickInput | PickInput[];
  const inputs = Array.isArray(parsed) ? parsed : [parsed];
  const bad = inputs.map((p, i) => ({ i, p, problems: problemsOf(p) })).filter((x) => x.problems.length);
  if (bad.length) {
    for (const b of bad) console.error(`pick ${b.i + 1} (${b.p.away?.name} at ${b.p.home?.name}): ${b.problems.join("; ")}`);
    console.error("Nothing written.");
    process.exit(1);
  }
  const runId = flag("run") ?? randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  mkdirSync(DIR, { recursive: true });
  const byFile = new Map<string, PickRecord[]>();
  for (const p of inputs) {
    const r = buildRecord(p, runId, now);
    const f = fileOf(r.league, r.season, r.week, r.seasontype);
    byFile.set(f, [...(byFile.get(f) ?? []), r]);
  }
  for (const [f, rs] of byFile) {
    if (!has("dry")) appendFileSync(f, rs.map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.log(`${has("dry") ? "[dry] " : ""}${rs.length} pick(s) -> ${path.relative(process.cwd(), f)} (run ${runId})`);
  }
}

// ------------------------------------------------------------------ grade

interface RawScoreboard {
  events?: Array<{ id: string; competitions?: Array<{ competitors?: Array<{ homeAway: string; curatedRank?: { current?: number } }> }> }>;
}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`ESPN answered ${res.status} for ${url}`);
  return (await res.json()) as T;
}

async function gradeFile(f: string): Promise<void> {
  const rs = readFile(f);
  const todo = rs.filter((r) => !r.result || has("regrade"));
  if (!todo.length) return void console.log(`${path.basename(f)}: nothing to grade`);
  const { league, season, week, seasontype } = todo[0];
  const extra = league === "cfb" ? "&groups=80&limit=400" : "";
  const raw = await json<RawScoreboard & Parameters<typeof parseScoreboard>[1]>(
    `${BASE}/${SPORT[league]}/scoreboard?week=${week}&seasontype=${seasontype}&dates=${season}${extra}`,
  );
  const events = parseScoreboard(league, raw);
  const now = new Date().toISOString();
  const summaries = new Map<string, FinishedGame["close"]>();
  let graded = 0;
  const waiting: string[] = [];
  for (const r of todo) {
    const h = teamKey(league, r.home.name);
    const a = teamKey(league, r.away.name);
    const e = events.find((x) => (x.home === h && x.away === a) || (x.home === a && x.away === h));
    if (!e) {
      waiting.push(`${r.away.name} at ${r.home.name}: not on ESPN's week ${week} scoreboard (check names)`);
      continue;
    }
    if (!e.completed || !e.final) {
      waiting.push(`${r.away.name} at ${r.home.name}: not final yet`);
      continue;
    }
    // ESPN may list the teams the other way round (neutral sites); scores and lines follow the record's own home team.
    const flipped = e.home !== h;
    if (!summaries.has(e.id)) {
      try {
        const s = parseSummary(await json(`${BASE}/${SPORT[league]}/summary?event=${e.id}`));
        summaries.set(e.id, s ? { open: s.open, spread: s.close, total_open: s.totalOpen, total: s.totalClose } : null);
      } catch {
        summaries.set(e.id, null);
      }
    }
    const c = summaries.get(e.id) ?? null;
    const turn = (x: number | null) => (x === null || !flipped ? x : -x || 0);
    const cs = raw.events?.find((x) => x.id === e.id)?.competitions?.[0]?.competitors ?? [];
    const rank = (side: string) => {
      const n = cs.find((x) => x.homeAway === side)?.curatedRank?.current;
      return n && n <= 25 ? n : null;
    };
    const game: FinishedGame = {
      final: flipped ? { home: e.final.away, away: e.final.home } : e.final,
      close: c ? { open: turn(c.open), spread: turn(c.spread), total_open: c.total_open, total: c.total } : null,
      ranks: flipped ? { home: rank("away"), away: rank("home") } : { home: rank("home"), away: rank("away") },
    };
    r.result = gradePick(r, game, now, `ESPN event ${e.id}`);
    graded++;
  }
  writeFileSync(f, rs.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`${path.basename(f)}: graded ${graded}, waiting ${waiting.length}`);
  for (const w of waiting) console.log(`  ${w}`);
}

async function grade() {
  const league = flag("league");
  const season = flag("season");
  const week = flag("week");
  if (week) {
    const f = fileOf(league ?? "cfb", Number(season ?? new Date().getFullYear()), Number(week), Number(flag("seasontype") ?? 2));
    if (!existsSync(f)) return void console.log(`No log at ${path.relative(process.cwd(), f)}`);
    return gradeFile(f);
  }
  const files = allFiles().filter((f) => !league || path.basename(f).startsWith(`${league}-`));
  if (!files.length) return void console.log("No pick logs yet.");
  for (const f of files) await gradeFile(f);
}

// ------------------------------------------------------------------ stats

function stats() {
  const league = flag("league");
  const rs = allFiles().flatMap(readFile).filter((r) => !league || r.league === league);
  const rows = splits(rs);
  if (has("json")) return void console.log(JSON.stringify(rows, null, 2));
  if (!rows.length) return void console.log(`${rs.length} pick(s) logged, none graded yet.`);
  let last = "";
  for (const r of rows.sort((a, b) => a.split.localeCompare(b.split) || a.group.localeCompare(b.group))) {
    if (r.split !== last) console.log(`\n${r.split}`);
    last = r.split;
    const pct = r.pct === null ? "  -  " : `${(r.pct * 100).toFixed(1)}%`;
    const clv = r.clv === null ? "" : `  CLV ${r.clv > 0 ? "+" : ""}${r.clv}`;
    console.log(`  ${r.group.padEnd(22)} ${`${r.w}-${r.l}-${r.p}`.padEnd(10)} ${pct}${clv}`);
  }
}

const run = { log, grade, stats }[cmd as "log" | "grade" | "stats"];
if (!run) {
  console.error("Usage: pickem-log.mts log|grade|stats  (see data/pickem/README.md)");
  process.exit(2);
}
await run();
