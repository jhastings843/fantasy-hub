#!/usr/bin/env node
// Finds Jay's (@FansOfCFB) weekly PEM picks card on X and hands it to the app.
// Also finds John Harris's (@jhnhrris) weekly "CONTEST PICKS" post, which the
// app tracks but never bets on (POST /api/picks/harris).
//
//   node scripts/pem-relay.mjs          check the latest posts, send any new card
//   node scripts/pem-relay.mjs --dry    say what it would send
//
// X has no free API, so this runs on Jack's Mac and reads X through his
// logged-in Chrome with OpenCLI (a background tab it closes itself). It only
// finds the post; the app downloads the public image and reads it. Run by
// ~/Library/LaunchAgents/com.jackh.pem-relay.plist every two hours.
//
// Needs PEM_RELAY_SECRET in this repo's .env.local. That secret can only post
// PEM cards; it is not the app's cron secret.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const APP_URL = process.env.APP_URL ?? "https://fantasy-hub-tan.vercel.app";
const STATE = path.join(ROOT, ".pem-relay", "sent.json");
const dry = process.argv.includes("--dry");

function secret() {
  const env = path.join(ROOT, ".env.local");
  if (!existsSync(env)) return null;
  const line = readFileSync(env, "utf8").split("\n").find((l) => l.startsWith("PEM_RELAY_SECRET="));
  return line ? line.slice("PEM_RELAY_SECRET=".length).trim() : null;
}

function log(msg) {
  console.log(`${new Date().toISOString()} ${msg}`);
}

const isPicksCard = (text) => /week \d+ PEM picks|PEM week \d+ picks/i.test(text);

function latestPosts(user = "FansOfCFB") {
  const out = execFileSync(
    "opencli",
    ["twitter", "tweets", user, "--limit", "40", "--window", "background", "--keep-tab", "false", "-f", "json"],
    { encoding: "utf8", timeout: 180_000, env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` } },
  );
  return JSON.parse(out);
}

async function main() {
  const key = secret();
  if (!key && !dry) throw new Error("PEM_RELAY_SECRET is missing from .env.local");
  const sent = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};

  let posts;
  try {
    posts = latestPosts();
  } catch (e) {
    // Most often: Chrome is closed or X logged out. Next run tries again.
    const err = String(e.stderr ?? e.message);
    const msg = err.match(/message:\s*>?-?\s*([\s\S]*?)(?:\n\s*exitCode|$)/)?.[1]?.replace(/\s+/g, " ").trim();
    log(`couldn't read X: ${msg || err.split("\n")[0]}`);
    return;
  }

  const cards = posts.filter((p) => !p.is_retweet && isPicksCard(p.text) && p.media_urls?.length && !sent[p.id]);
  if (!cards.length) return log("no new picks card");

  for (const p of cards.reverse()) {
    const body = { tweetId: p.id, text: p.text, imageUrl: p.media_urls[0] };
    if (dry) {
      log(`would send ${p.id}: ${p.text.split("\n")[0]}`);
      continue;
    }
    const res = await fetch(`${APP_URL}/api/picks/pem`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const json = await res.json().catch(() => ({}));
    log(`sent ${p.id} (${p.text.split("\n")[0]}): ${res.status} ${JSON.stringify(json)}`);
    // A card the app read, or deliberately skipped, is done. A failure is retried next run.
    if (res.ok && json.ok) {
      sent[p.id] = { at: new Date().toISOString(), result: json };
      mkdirSync(path.dirname(STATE), { recursive: true });
      writeFileSync(STATE, JSON.stringify(sent, null, 2));
    }
  }
}

// John Harris: the contest post's text (his picks) and every sheet image.
const isHarrisPost = (text) => /contest picks/i.test(text) && !/early look/i.test(text) && !text.trim().startsWith("@");

async function harris(key, sent) {
  let posts;
  try {
    posts = latestPosts("jhnhrris");
  } catch (e) {
    log(`couldn't read X for Harris: ${String(e.stderr ?? e.message).split("\n")[0]}`);
    return;
  }
  const found = posts.filter((p) => !p.is_retweet && isHarrisPost(p.text) && !sent[`harris:${p.id}`]);
  if (!found.length) return log("no new Harris post");
  for (const p of found.reverse()) {
    const body = { tweetId: p.id, text: p.text, postedAt: new Date(p.created_at).toISOString(), imageUrls: p.media_urls ?? [] };
    if (dry) {
      log(`would send Harris ${p.id}: ${p.text.split("\n")[0]} (${body.imageUrls.length} images)`);
      continue;
    }
    const res = await fetch(`${APP_URL}/api/picks/harris`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    });
    const json = await res.json().catch(() => ({}));
    log(`sent Harris ${p.id}: ${res.status} ${JSON.stringify(json)}`);
    if (res.ok && json.ok) {
      sent[`harris:${p.id}`] = { at: new Date().toISOString(), result: json };
      mkdirSync(path.dirname(STATE), { recursive: true });
      writeFileSync(STATE, JSON.stringify(sent, null, 2));
    }
  }
}

main()
  .then(async () => {
    const sent = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
    await harris(secret(), sent);
  })
  .catch((e) => {
  log(`failed: ${e.message}`);
  process.exit(1);
});
