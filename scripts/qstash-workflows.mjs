#!/usr/bin/env node
// QStash schedules that start the game-time GitHub workflows on the minute.
//
//   node scripts/qstash-workflows.mjs check                  (no tokens: validates SLOTS)
//   node scripts/qstash-workflows.mjs list   --env <file>...
//   node scripts/qstash-workflows.mjs create --env <file>...  (idempotent: upserts by id, removes stale ids)
//   node scripts/qstash-workflows.mjs delete --env <file>...
//
// WHY. GitHub ran these scheduled workflows 3 to 6 hours late (odds-morning's
// 8am slot ran at 1:27pm, 2:21pm and 2:44pm ET on Oct 29 to 31; on Sun Nov 1
// neither it nor first-td's morning slot had run by 9:12am, so the ATTD parlay
// and the day's prices weren't built). The same workflows started by hand
// begin within seconds, so QStash calls GitHub's workflow_dispatch API at the
// Eastern times below. Times are Eastern (CRON_TZ), so DST needs no edits.
// The workflows' own crons stay as a backstop; a doubled run is harmless
// (each game's price read happens once, the parlay is set-if-absent, saves
// skip started games).
//
// Needs (environment or --env files):
//   QSTASH_URL, QSTASH_TOKEN  the QStash account (one per account; signal-bot's .env has it)
//   GH_DISPATCH_TOKEN         fine-grained GitHub token, this repo only, Actions: read and write
//
// Never prints a header or token: list shows id, cron, state and workflow only.

import fs from 'node:fs';
import path from 'node:path';

const REPO = 'jhastings843/fantasy-hub';
const TZ = 'CRON_TZ=America/New_York ';

// Eastern times. Kickoffs: Sun 1pm / 4:05-4:25pm / 8:20pm, Thu and Mon 8:15pm.
export const SLOTS = [
  // DraftKings read; the app only reads a game from 8am ET on its date.
  ['odds-morning', '0 8 * * 0,1,4,5,6'],
  // Sunday captures (8:30am and noon also build the ATTD parlay), plus 6:30pm daily.
  ['first-td', '30 8 * * 0'],
  ['first-td', '0 12 * * 0'],
  ['first-td', '30 15 * * 0'],
  ['first-td', '30 18 * * *'],
  // Overnight grading of Thursday, Sunday and Monday night games.
  ['first-td', '30 1 * * 1,2,5'],
  // About 45 min before each kickoff window.
  ['props-prekick', '30 19 * * 1,4'],
  ['props-prekick', '45 8 * * 0'],
  ['props-prekick', '15 12 * * 0'],
  ['props-prekick', '20 15 * * 0'],
  ['props-prekick', '35 19 * * 0'],
  // NBA: grade overnight, afternoon tips, then ahead of 7pm, 8pm and late tips.
  ['nba-props', '30 2 * * *'],
  ['nba-props', '0 12 * * *'],
  ['nba-props', '30 17 * * *'],
  ['nba-props', '45 18 * * *'],
  ['nba-props', '45 19 * * *'],
  ['nba-props', '0 21 * * *'],
];

const PREFIX = 'fh-wf-';
const idOf = (wf, cron) => `${PREFIX}${wf}-${cron.replace(/[^0-9]+/g, '_').replace(/^_|_$/g, '')}`;
const dest = (wf) => `https://api.github.com/repos/${REPO}/actions/workflows/${wf}.yml/dispatches`;

function check() {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.github', 'workflows');
  const ids = new Set();
  for (const [wf, cron] of SLOTS) {
    const yml = fs.readFileSync(path.join(dir, `${wf}.yml`), 'utf8');
    if (!/workflow_dispatch/.test(yml)) throw new Error(`${wf}.yml has no workflow_dispatch`);
    if (cron.trim().split(/\s+/).length !== 5) throw new Error(`bad cron "${cron}"`);
    const id = idOf(wf, cron);
    if (ids.has(id)) throw new Error(`duplicate slot ${id}`);
    ids.add(id);
  }
  console.log(`${SLOTS.length} slots OK`);
}

const args = process.argv.slice(2);
const envFiles = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--env') envFiles.push(args[++i]);
const command = args.find((a) => !a.startsWith('--') && !envFiles.includes(a)) || 'list';
for (const file of envFiles) {
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trimStart().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

const BASE = (process.env.QSTASH_URL || 'https://qstash.upstash.io').replace(/\/$/, '');

async function api(method, p, headers = {}, body) {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('QSTASH_TOKEN is not set. Pass --env <file> or export it.');
  const r = await fetch(BASE + p, { method, headers: { Authorization: `Bearer ${token}`, ...headers }, body });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${p.split('/https')[0]} -> ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : {};
}

const mine = async () => (await api('GET', '/v2/schedules')).filter((s) => String(s.scheduleId).startsWith(PREFIX));
const describe = (s) => `${s.scheduleId.padEnd(34)} ${String(s.cron).replace(TZ, '').padEnd(18)} ${s.isPaused ? 'paused' : 'active'}`;

async function list() {
  const ours = await mine();
  if (!ours.length) return console.log('No workflow schedules.');
  for (const s of ours.sort((a, b) => a.scheduleId.localeCompare(b.scheduleId))) console.log(describe(s));
}

async function create() {
  check();
  const gh = process.env.GH_DISPATCH_TOKEN;
  if (!gh) throw new Error('GH_DISPATCH_TOKEN is not set.');
  const want = new Set();
  for (const [wf, cron] of SLOTS) {
    const id = idOf(wf, cron);
    want.add(id);
    // Destination goes in the path unencoded (QStash rejects an encoded scheme).
    await api('POST', `/v2/schedules/${dest(wf)}`, {
      'Upstash-Schedule-Id': id,
      'Upstash-Cron': TZ + cron,
      'Upstash-Method': 'POST',
      'Upstash-Retries': '2',
      'Content-Type': 'application/json',
      'Upstash-Forward-Authorization': `Bearer ${gh}`,
      'Upstash-Forward-Accept': 'application/vnd.github+json',
      'Upstash-Forward-X-GitHub-Api-Version': '2022-11-28',
      'Upstash-Forward-User-Agent': 'fantasy-hub-qstash',
    }, JSON.stringify({ ref: 'main' }));
    console.log(`Set ${id}`);
  }
  for (const s of await mine()) {
    if (!want.has(s.scheduleId)) {
      await api('DELETE', `/v2/schedules/${s.scheduleId}`);
      console.log(`Removed stale ${s.scheduleId}`);
    }
  }
}

async function remove() {
  const ours = await mine();
  for (const s of ours) {
    await api('DELETE', `/v2/schedules/${s.scheduleId}`);
    console.log(`Deleted ${s.scheduleId}`);
  }
  if (!ours.length) console.log('Nothing to delete.');
}

const run = { check: async () => check(), list, create, delete: remove }[command];
if (!run) {
  console.error(`Unknown command "${command}". Use check, list, create or delete.`);
  process.exit(1);
}
run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
