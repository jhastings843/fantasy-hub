// Log Jack's own bets on the Money page.
//
//   node scripts/money-bet.mjs card.json            log every bet in the file
//   node scripts/money-bet.mjs --grade <id> W "why"  grade one by hand (W, L, P, void)
//   node scripts/money-bet.mjs --remove <id>
//
// card.json is an array of bets (fields in src/lib/money/bets.ts, MoneyBet).
// Example:
//   [{ "id": "2026-w6-sea-den-jsn", "source": "Jingles", "sport": "nfl", "date": "2026-10-15",
//      "away": "SEA", "home": "DEN", "market": "prop", "player": "Jaxon Smith-Njigba",
//      "stat": "rec_yds", "side": "over", "line": 92.5, "price": -110, "units": 4,
//      "label": "JSN over 92.5 receiving yards" }]
// Posts to HUB_URL (default the live site) with MONEY_INGEST_SECRET from .env.local.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]),
);
const secret = process.env.MONEY_INGEST_SECRET ?? env.MONEY_INGEST_SECRET;
const hub = (process.env.HUB_URL ?? "https://fantasy-hub-tan.vercel.app").replace(/\/$/, "");
if (!secret) throw new Error("MONEY_INGEST_SECRET missing from .env.local");

const [a, b, c, d] = process.argv.slice(2);
const body =
  a === "--grade" ? { grade: { id: b, outcome: c, actual: d } } : a === "--remove" ? { remove: b } : { bets: JSON.parse(readFileSync(a, "utf8")) };
const res = await fetch(`${hub}/api/money/bets`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
  body: JSON.stringify(body),
});
console.log(res.status, await res.text());
