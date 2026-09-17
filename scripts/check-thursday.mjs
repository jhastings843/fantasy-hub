#!/usr/bin/env node
// Reads /api/health and /api/thursday-email?check=1 from production and prints
// both, with the Eastern time of the read. No secret needed for either.
//
//   node scripts/check-thursday.mjs

const APP_URL = (process.env.APP_URL || "https://fantasy-hub-tan.vercel.app").replace(/\/$/, "");

const et = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  dateStyle: "medium",
  timeStyle: "medium",
}).format(new Date());

async function read(path) {
  const res = await fetch(`${APP_URL}${path}`, { headers: { accept: "application/json" } });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const [health, check] = await Promise.all([
  read("/api/health"),
  read("/api/thursday-email?check=1"),
]);

console.log(`Read at ${et} ET`);
console.log("\n== /api/health");
console.log(JSON.stringify(health, null, 2));
console.log("\n== /api/thursday-email?check=1");
console.log(JSON.stringify(check, null, 2));
