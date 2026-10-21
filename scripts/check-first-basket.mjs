#!/usr/bin/env node
// Daily check for Sam's NBA First Basket page. On 2026-10-20 and 10-21 every
// game showed <span class="bdbtn ps lk" aria-disabled="true">FIRST BASKET — LOCKED</span>
// with no href, and the guessed paths all 404'd. This reads the page and the
// guessed paths, logs the state, and posts a Mac notification the first time
// any of them opens. After that it writes a flag file and stays quiet, so the
// build happens once, in a Claude session, not here.
//
//   node scripts/check-first-basket.mjs
//
// Runs at 8:30am from ~/Library/LaunchAgents/com.jackh.first-basket-check.plist.

import { existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = "https://samthemodelman.smmodel.workers.dev/nba/";
const PATHS = ["firstbasket/", "fb/", "first/", "first-basket/"];
const FLAG = join(homedir(), "Library/Logs/first-basket-open.flag");

const stamp = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  dateStyle: "medium",
  timeStyle: "short",
}).format(new Date());

if (existsSync(FLAG)) {
  console.log(`${stamp} ET: already found open earlier, see ${FLAG}. Unload the job.`);
  process.exit(0);
}

const res = await fetch(BASE, { headers: { "user-agent": "Mozilla/5.0" } });
const html = await res.text();

// Every element whose text mentions FIRST BASKET, locked or not.
const buttons = [...html.matchAll(/<(a|span|button)\b([^>]*)>([^<]*FIRST BASKET[^<]*)/gi)];
const locked = buttons.filter(([, , attrs]) => /aria-disabled="true"/.test(attrs) || !/href=/.test(attrs));
const open = buttons.filter((b) => !locked.includes(b));

const pathHits = [];
for (const p of PATHS) {
  const r = await fetch(BASE + p, { headers: { "user-agent": "Mozilla/5.0" } });
  if (r.status !== 404) pathHits.push(`${p} ${r.status}`);
}

if (res.status !== 200) {
  console.log(`${stamp} ET: /nba/ returned ${res.status}, could not check.`);
  process.exit(1);
}

if (open.length === 0 && pathHits.length === 0) {
  console.log(`${stamp} ET: still locked, ${locked.length} of ${buttons.length} buttons locked, guessed paths all 404.`);
  process.exit(0);
}

const detail = [
  ...open.map(([, tag, attrs, text]) => `<${tag}${attrs}>${text.trim()}`),
  ...pathHits.map((h) => `path ${h}`),
].join("\n");
writeFileSync(FLAG, `${stamp} ET\n${detail}\n`);
console.log(`${stamp} ET: OPEN.\n${detail}`);

const msg = "Sam's First Basket page looks open. Tell Claude to build the First Basket section.";
execFileSync("osascript", ["-e", `display notification "${msg}" with title "First Basket is open" sound name "Glass"`]);
