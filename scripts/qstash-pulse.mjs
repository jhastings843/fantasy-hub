#!/usr/bin/env node
// The QStash schedule that fires the heartbeat.
//
//   node scripts/qstash-pulse.mjs list
//   node scripts/qstash-pulse.mjs create
//   node scripts/qstash-pulse.mjs delete
//
// WHY THIS EXISTS. .github/workflows/pulse.yml asks GitHub for a run every
// fifteen minutes, and GitHub's scheduler delivered about seven a day
// (measured 2026-09-14 to 09-17: 18 runs in 57 hours, median gap 197 minutes,
// longest 330). Every run was green, so nothing flagged it. The hourly refresh
// was really a three-hourly one and the Sunday 11:45 alarm window could go a
// whole afternoon without a pulse. QStash fires on the minute. The GitHub
// workflow stays as a backstop; the app's tier leases make a doubled call
// harmless.
//
// Needs, in the environment or in files passed with --env <path> (repeatable):
//   QSTASH_URL, QSTASH_TOKEN   the QStash account (signal-bot's .env has them)
//   CRON_SECRET                the app's bearer, as set in Vercel
//   APP_URL                    optional, defaults to the production deployment
//
// Nothing here prints a header or a token. Printing a schedule raw is how a
// token leaked once in signal-bot, so `list` prints id, cron, destination and
// state, and nothing else.

import fs from 'node:fs';

const args = process.argv.slice(2);
const envFiles = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--env') envFiles.push(args[++i]);
}
const command = args.find((a) => !a.startsWith('--') && !envFiles.includes(a)) || 'list';

for (const file of envFiles) {
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trimStart().startsWith('#')) continue;
    const v = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const BASE = (process.env.QSTASH_URL || 'https://qstash.upstash.io').replace(/\/$/, '');
const TOKEN = process.env.QSTASH_TOKEN || '';
const SECRET = process.env.CRON_SECRET || '';
const APP_URL = (process.env.APP_URL || 'https://fantasy-hub-tan.vercel.app').replace(/\/$/, '');
const DESTINATION = `${APP_URL}/api/pulse`;
const CRON = '*/15 * * * *';

if (!TOKEN) {
  console.error('QSTASH_TOKEN is not set. Pass --env <file> or export it.');
  process.exit(1);
}

async function api(method, p, headers = {}) {
  const r = await fetch(BASE + p, { method, headers: { Authorization: `Bearer ${TOKEN}`, ...headers } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : {};
}

const describe = (s) =>
  `${s.scheduleId}  ${String(s.cron).padEnd(14)} ${s.isPaused ? 'paused' : 'active'}  ${s.destination}`;

async function mine() {
  const all = await api('GET', '/v2/schedules');
  return all.filter((s) => s.destination === DESTINATION);
}

async function list() {
  const ours = await mine();
  if (ours.length === 0) {
    console.log(`No schedule for ${DESTINATION}.`);
    return;
  }
  for (const s of ours) console.log(describe(s));
}

async function create() {
  if (!SECRET) {
    console.error('CRON_SECRET is not set; the schedule would call the app unauthenticated.');
    process.exit(1);
  }
  const existing = await mine();
  if (existing.length > 0) {
    console.log('Already scheduled:');
    for (const s of existing) console.log(describe(s));
    return;
  }
  const res = await api('POST', `/v2/schedules/${encodeURIComponent(DESTINATION)}`, {
    'Upstash-Cron': CRON,
    'Upstash-Method': 'GET',
    // One retry, a minute later. The app answers 200 even when a job inside
    // it failed, so a retry only ever covers a request that never arrived.
    'Upstash-Retries': '1',
    'Upstash-Forward-Authorization': `Bearer ${SECRET}`,
  });
  console.log(`Created ${res.scheduleId}  ${CRON}  ${DESTINATION}`);
}

async function remove() {
  const ours = await mine();
  for (const s of ours) {
    await api('DELETE', `/v2/schedules/${s.scheduleId}`);
    console.log(`Deleted ${s.scheduleId}`);
  }
  if (ours.length === 0) console.log('Nothing to delete.');
}

const run = { list, create, delete: remove }[command];
if (!run) {
  console.error(`Unknown command "${command}". Use list, create or delete.`);
  process.exit(1);
}
run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
