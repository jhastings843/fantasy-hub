#!/usr/bin/env node
// Reads Venom Analytics' newest NFL boards (Anytime TD, Pass Yards, Rush Yards,
// Receptions) and uploads them for the Anytime TD and NFL props learners, so the
// weekly /venom read runs by itself (Jack, 2026-10-30).
//
//   node --env-file=.env.local scripts/venom-reader.mjs          read the newest week, save, upload
//   node --env-file=.env.local scripts/venom-reader.mjs --dry    read and print counts only
//   node --env-file=.env.local scripts/venom-reader.mjs --week 8 read a past week (saves, uploads)
//   add --games-only to read just the Game Cheat Code board (backfill without re-reading past prop boards)
// Since 2026-11-08 it also reads the GAME CHEAT CODE tab: each game's market and Venom
// spread and total (nfl-games-SEASON-wNN.json), a tracked outside source for the NFL picks.
//
// Same rules as the /venom skill: it reads the app as shown on screen in Jack's own
// logged-in Chrome (OpenCLI, a background tab it closes), never the app's data
// endpoints, and his Whop login never leaves Chrome. The boards are members-only:
// files go to data/venom (git-ignored) and the app's private Redis only.
// Run by ~/Library/LaunchAgents/com.jackh.venom-reader.plist, Tuesday and Wednesday.
// Pushes a phone alert when a new week is in, or when it can't read (Chrome
// closed, Whop logged out, the page changed).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const APP = "https://whop.com/venom-analytics-23d5/exp_pkDwTMXc5FPhsD/app/";
const SESSION = "venom-reader";
const TABS = [
  ["ANY TD", "attd"],
  ["PASS YARDS", "pass_yds"],
  ["RUSH YARDS", "rush_yds"],
  ["RECEPTIONS", "rec"],
];
// A board this many days old for the same week is not re-read: Venom hasn't posted
// the next week yet, and that week's games may have started.
const STALE_DAYS = 4;
const dry = process.argv.includes("--dry");
const gamesOnly = process.argv.includes("--games-only");
// Every player on the Anytime TD board (not just his top 5), saved as nfl-attd_full-*.json for a research
// grade only (Jack, 2026-11-08): never uploaded, so the learner's "Venom picks" slice keeps its top-5 meaning.
const attdFull = process.argv.includes("--attd-full");
const weekArg = process.argv.includes("--week") ? Number(process.argv[process.argv.indexOf("--week") + 1]) : null;

const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` };

function opencli(args, timeout = 60_000) {
  const out = execFileSync("opencli", ["browser", SESSION, ...args], { encoding: "utf8", timeout, env, stdio: ["ignore", "pipe", "pipe"] });
  return out.replace(/\n?\s*Update available[\s\S]*$/, "").trim();
}

let frame = null;
/** Runs JS inside the app's frame and returns the result as text. */
const inApp = (js) => opencli(["eval", "--frame", String(frame), js]);

const click = (label) =>
  inApp(`(() => { const el = [...document.querySelectorAll("*")].filter((e) => e.textContent.trim().toUpperCase() === ${JSON.stringify(label)}).pop(); el?.click(); return !!el })()`) === "true";

async function push(title, message) {
  const { PUSHOVER_APP_TOKEN: token, PUSHOVER_USER_KEY: user } = process.env;
  if (!token || !user || dry) return log(`(no push) ${title}: ${message}`);
  await fetch("https://api.pushover.net/1/messages.json", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, user, title, message }) }).catch(() => {});
}

/** One board's top-5 rows from the page text. Each player reads: rank, name, POS, "DAL VS ARI", tags..., score, ["55% TD"], ▼. */
export function parseBoard(text, stat) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const rows = [];
  for (let i = 3; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Z]{2,3}) VS ([A-Z]{2,3})$/i);
    if (!m || !/^(QB|RB|WR|TE|FB)$/.test(lines[i - 1]) || !/^\d+$/.test(lines[i - 3])) continue;
    let score = null;
    let pct = null;
    for (let j = i + 1; j < lines.length && lines[j] !== "▼"; j++) {
      if (score === null && /^\d{1,3}\.\d$/.test(lines[j])) score = Number(lines[j]);
      const p = lines[j].match(/^(\d+)% TD$/);
      if (p) pct = Number(p[1]) / 100;
    }
    if (score === null) continue;
    const base = { team: m[1].toUpperCase(), name: lines[i - 2], pos: lines[i - 1] };
    if (stat === "attd") {
      if (pct !== null) rows.push({ ...base, score, p: pct });
    } else if (stat === "attd_full") {
      if (pct !== null) rows.push({ ...base, rank: Number(lines[i - 3]), score, p: pct });
    } else rows.push({ ...base, rank: Number(lines[i - 3]), score });
  }
  return rows;
}

/**
 * The Game Cheat Code board: per game, "AWAY @ HOME", the kickoff, then SPREAD / TOTAL
 * under MARKET and VENOM ("JAX -10" or "PK", then the total), then any "VENOM EDGE X"
 * flags (a team, OVER or UNDER) before "LINE MOVEMENT". Lines come back home-side,
 * betting style (-3 = the home team gives 3), as the picks engine uses.
 *   parseGames("JAX\n@\nBAL\nTHU, NOV 5 · 20:15 ET\nSPREAD\nTOTAL\nMARKET\nJAX -10\n39.5\nVENOM\nJAX -5\n44\nVENOM EDGE BAL\nLINE MOVEMENT")
 *     -> [{ away: "JAX", home: "BAL", kickoff: "THU, NOV 5 · 20:15 ET", market: 10, total: 39.5, model: 5, modelTotal: 44, edgeSide: "home", edgeTotal: null }]
 */
export function parseGames(text) {
  const L = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const out = [];
  const home = (s, away, h) => {
    if (/^PK$/i.test(s)) return 0;
    const m = s.match(/^([A-Z]{2,3})\s*([+-]?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    const v = Number(m[2]);
    return m[1] === h ? v : m[1] === away ? -v : null;
  };
  for (let i = 1; i + 1 < L.length; i++) {
    if (L[i] !== "@" || !/^[A-Z]{2,3}$/.test(L[i - 1]) || !/^[A-Z]{2,3}$/.test(L[i + 1])) continue;
    const away = L[i - 1], h = L[i + 1];
    const mk = L.indexOf("MARKET", i), vn = L.indexOf("VENOM", i);
    if (mk < 0 || vn < 0 || mk > i + 8 || vn > mk + 4) continue;
    const market = home(L[mk + 1], away, h), total = Number(L[mk + 2]);
    const model = home(L[vn + 1], away, h), modelTotal = Number(L[vn + 2]);
    if (market === null || model === null || !Number.isFinite(total) || !Number.isFinite(modelTotal)) continue;
    let edgeSide = null, edgeTotal = null;
    for (let j = vn + 3; j < L.length && !/^LINE MOVEMENT/.test(L[j]) && L[j] !== "@"; j++) {
      const e = L[j].match(/^VENOM EDGE (.+)$/);
      if (!e) continue;
      if (/^OVER$/i.test(e[1])) edgeTotal = "over";
      else if (/^UNDER$/i.test(e[1])) edgeTotal = "under";
      else if (e[1] === h) edgeSide = "home";
      else if (e[1] === away) edgeSide = "away";
    }
    out.push({ away, home: h, kickoff: L[i + 2], market, total, model, modelTotal, edgeSide, edgeTotal });
  }
  return out;
}

/** Reads the Game Cheat Code tab of the week already chosen. */
async function readGames() {
  if (!click("GAME CHEAT CODE")) throw new Error("no GAME CHEAT CODE tab");
  await sleep(4000);
  const text = inApp("document.body.innerText");
  const cap = text.match(/(\d{4}) · WEEK (\d+) · SORTED/);
  if (!cap) throw new Error(`GAME CHEAT CODE: no "WEEK N" caption`);
  const rows = parseGames(text);
  const shown = (text.match(/^@$/gm) ?? []).length;
  if (shown < 8 || rows.length < shown - 1) throw new Error(`GAME CHEAT CODE: read ${rows.length} of ${shown} games`);
  return { season: Number(cap[1]), week: Number(cap[2]), rows };
}

const file = (stat, season, week) => path.join(ROOT, "data/venom", `nfl-${stat}-${season}-w${String(week).padStart(2, "0")}.json`);

async function main() {
  try {
    opencli(["--window", "background", "open", APP], 90_000);
  } catch (e) {
    const msg = String(e.stderr ?? e.message).split("\n").find((l) => l.trim()) ?? "unknown";
    log(`couldn't open the app: ${msg}`);
    return push("Venom reader couldn't run", "Chrome or the OpenCLI bridge isn't up. It tries again at the next run; or run /venom.");
  }
  try {
    // The app loads in a cross-origin frame on apps.whop.com; wait for it.
    for (let t = 0; t < 10 && frame === null; t++) {
      await sleep(3000);
      const frames = JSON.parse(opencli(["frames"]) || "[]");
      frame = frames.find((f) => /apps\.whop\.com/.test(f.url))?.index ?? null;
    }
    if (frame === null) throw new Error("no Venom app frame (logged out of Whop?)");
    if (!click("NFL")) throw new Error("no NFL tab");
    await sleep(3000);

    // Week buttons read "'26" over the number; the newest is last.
    const weeks = JSON.parse(inApp(`JSON.stringify([...document.querySelectorAll("button")].map((b) => b.textContent.replace(/\\s+/g, "")).filter((t) => /^'\\d{2}\\d{1,2}$/.test(t)))`) || "[]");
    const pick = weekArg ? weeks.find((w) => w.slice(3) === String(weekArg) && w.startsWith("'26")) : weeks.at(-1);
    if (!pick) throw new Error(`no week button${weekArg ? ` for week ${weekArg}` : ""} (saw ${weeks.join(" ")})`);
    const clicked = inApp(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.replace(/\\s+/g, "") === ${JSON.stringify("PICK")}); b?.click(); return !!b })()`.replace("PICK", pick));
    if (clicked !== "true") throw new Error(`couldn't click week ${pick}`);
    await sleep(3000);

    const boards = {};
    let season = null;
    let week = null;
    const saveGames = (g) => {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      writeFileSync(file("games", g.season, g.week), JSON.stringify({ season: g.season, week: g.week, stat: "games", source: `Venom Analytics app, Game Vault NFL Game Cheat Code (market and Venom spread and total), read ${today}`, rows: g.rows }, null, 1));
    };
    if (attdFull) {
      if (!click("ANY TD")) throw new Error("no ANY TD tab");
      await sleep(3500);
      inApp(`[...document.querySelectorAll("*")].filter((e) => e.children.length === 0 && /^show all \\d+ players$/i.test(e.textContent.trim())).forEach((e) => e.click())`);
      await sleep(3000);
      const text = inApp("document.body.innerText");
      const cap = text.match(/(\d{4}) · WEEK (\d+) · SORTED/);
      if (!cap) throw new Error(`ANY TD: no "WEEK N" caption`);
      const games = (text.match(/FULL MATCHUP/g) ?? []).length;
      const rows = parseBoard(text, "attd_full");
      if (dry) return log(`week ${cap[2]} (dry): attd_full ${rows.length} from ${games} games`);
      if (rows.length < games * 8) throw new Error(`ANY TD full: read ${rows.length} rows from ${games} games`);
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      writeFileSync(file("attd_full", Number(cap[1]), Number(cap[2])), JSON.stringify({ season: Number(cap[1]), week: Number(cap[2]), stat: "attd_full", source: `Venom Analytics app, Game Vault NFL Anytime TD, every player, read ${today}`, rows }, null, 1));
      return log(`week ${cap[2]}: attd_full ${rows.length} from ${games} games (saved, not uploaded)`);
    }
    if (gamesOnly) {
      const g = await readGames();
      if (dry) return log(`week ${g.week} (dry): games ${g.rows.length}`);
      saveGames(g);
      const up = execFileSync(process.execPath, ["--env-file=.env.local", "scripts/venom-upload.mjs", String(g.week), "games"], { cwd: ROOT, encoding: "utf8", env });
      return log(`week ${g.week}: games ${g.rows.length}\n${up.trim()}`);
    }
    for (const [label, stat] of TABS) {
      if (!click(label)) throw new Error(`no ${label} tab`);
      await sleep(3500);
      // Prop boards: every player, so each has a real score (since 2026-10-30). Anytime TD
      // stays at the top 5 per game, his headline list, which is what its slice means.
      if (stat !== "attd") {
        inApp(`[...document.querySelectorAll("*")].filter((e) => e.children.length === 0 && /^show all \\d+ players$/i.test(e.textContent.trim())).forEach((e) => e.click())`);
        await sleep(2500);
      }
      const text = inApp("document.body.innerText");
      const cap = text.match(/(\d{4}) · WEEK (\d+) · SORTED/);
      if (!cap) throw new Error(`${label}: no "WEEK N" caption`);
      [season, week] = [Number(cap[1]), Number(cap[2])];
      const games = (text.match(/FULL MATCHUP/g) ?? []).length;
      const rows = parseBoard(text, stat);
      // Anytime TD shows 5 a game; full prop boards list every player (pass yards: the 2 QBs). Far fewer means the page changed.
      const floor = stat === "attd" ? games * 5 - 2 : stat === "pass_yds" ? games * 2 - 2 : stat === "rush_yds" ? games * 4 : games * 8;
      if (games < 8 || rows.length < floor) throw new Error(`${label}: read ${rows.length} rows from ${games} games, expected at least ${floor}`);
      boards[stat] = { rows, games };
    }

    // The Game Cheat Code board last: a failure there never costs the four boards above.
    let games = null;
    try {
      games = await readGames();
      if (games.week !== week) throw new Error(`GAME CHEAT CODE shows week ${games.week}, boards week ${week}`);
    } catch (e) {
      log(`games board skipped: ${e.message}`);
      games = null;
    }
    const summary = TABS.map(([, s]) => `${s} ${boards[s].rows.length}`).join(", ") + `, games ${games ? games.rows.length : "not read"}`;
    if (dry) return log(`week ${week} (dry): ${summary}`);

    const existing = file("attd", season, week);
    if (!weekArg && existsSync(existing)) {
      const read = JSON.parse(readFileSync(existing, "utf8")).source?.match(/read (\d{4}-\d{2}-\d{2})/)?.[1];
      if (read && (Date.now() - Date.parse(read)) / 86_400_000 > STALE_DAYS) return log(`week ${week} was read ${read}; no newer week posted yet, left as is`);
    }

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    for (const [, stat] of TABS) {
      const source = stat === "attd" ? `Venom Analytics app, Game Vault NFL Anytime TD, top 5 per game, read ${today}` : `Venom Analytics app, Game Vault NFL ${stat} board, every player (rank, 0-100 score), read ${today}`;
      writeFileSync(file(stat, season, week), JSON.stringify({ season, week, stat, source, rows: boards[stat].rows }, null, 1));
    }
    if (games) saveGames(games);
    const up = execFileSync(process.execPath, ["--env-file=.env.local", "scripts/venom-upload.mjs", String(week)], { cwd: ROOT, encoding: "utf8", env });
    log(`week ${week}: ${summary}\n${up.trim()}`);
    if (!weekArg) await push(`Venom Week ${week} read`, `${boards.attd.games} games. Anytime TD ${boards.attd.rows.length}, pass yards ${boards.pass_yds.rows.length}, rush yards ${boards.rush_yds.rows.length}, receptions ${boards.rec.rows.length}. Uploaded for the learners.`);
  } catch (e) {
    log(`failed: ${e.message}`);
    // A hand-run backfill reports in the terminal; only the scheduled read alerts the phone.
    if (!gamesOnly && !attdFull && !weekArg) await push("Venom reader couldn't read the boards", `${e.message}. If Whop logged you out, log in in Chrome; or run /venom.`);
  } finally {
    try {
      opencli(["close"]);
    } catch {}
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) await main();
