// Weekly UI check for the Picks tab (report only: it never changes the layout).
//
// Loads every sport/market/view at phone and desktop width and checks what a
// usable page needs: no horizontal page scroll, current picks near the top on
// a phone, the right tab marked current, no console errors, the market tabs
// reachable by keyboard with a visible focus ring, Back restoring the view.
// Betting wins or losses are not inputs. Posts the result to the learning
// journal when CRON_SECRET is set.
//
//   node scripts/picks-ui-check.mjs https://fantasy-hub-tan.vercel.app
import { chromium } from "playwright";

const host = process.argv[2] ?? "https://fantasy-hub-tan.vercel.app";
const paths = ["/picks", "/picks/cfb", "/picks?m=su", "/picks/cfb?m=ou", "/picks?v=results", "/picks?v=research", "/picks/cfb?m=su&v=research"];
const FIRST_PICK_MAX_MOBILE = 900;
const fails = [];
const rows = [];
const b = await chromium.launch();
for (const [w, h] of [[390, 844], [1280, 900]]) {
  for (const path of paths) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    await p.goto(host + path, { waitUntil: "networkidle", timeout: 120000 });
    const m = await p.evaluate(() => {
      const first = document.querySelector("[data-first-pick]") ?? document.querySelector("main section h2");
      return {
        height: document.documentElement.scrollHeight,
        firstTop: first ? Math.round(first.getBoundingClientRect().top + scrollY) : null,
        overflow: document.documentElement.scrollWidth > innerWidth,
        current: [...document.querySelectorAll('nav a[aria-current="page"]')].map((a) => a.textContent),
      };
    });
    const q = new URL(host + path).searchParams;
    const want = [q.get("m") === "su" ? "Straight up" : q.get("m") === "ou" ? "Totals" : "Spreads", q.get("v") === "results" ? "Results" : q.get("v") === "research" ? "Research" : "This week"];
    if (m.overflow) fails.push(`${w}px ${path}: horizontal page scroll`);
    if (w === 390 && !q.get("v") && (m.firstTop ?? 99999) > FIRST_PICK_MAX_MOBILE) fails.push(`${w}px ${path}: first pick at ${m.firstTop}px`);
    if (!want.every((x) => m.current.includes(x))) fails.push(`${w}px ${path}: current tabs ${m.current.join(",")}`);
    if (errs.length) fails.push(`${w}px ${path}: console error ${errs[0].slice(0, 120)}`);
    rows.push({ w, path, ...m });
    await p.close();
  }
}
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto(host + "/picks/cfb", { waitUntil: "networkidle" });
let reached = 0;
for (let i = 1; i <= 30; i++) {
  await p.keyboard.press("Tab");
  if ((await p.evaluate(() => document.activeElement?.textContent?.trim())) === "Totals") { reached = i; break; }
}
const ring = reached ? await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle) : "none";
if (!reached) fails.push("keyboard: market tabs not reachable");
if (ring === "none") fails.push("keyboard: no visible focus ring on tabs");
if (reached) {
  await p.keyboard.press("Enter");
  await p.waitForURL(/m=ou/, { timeout: 60000 });
  await p.goBack();
  await p.waitForURL((u) => !u.search.includes("m=ou"), { timeout: 60000 });
}
await b.close();
const pass = fails.length === 0;
const summary = pass ? `All ${rows.length} views pass (no page overflow, picks near the top on phones, tabs, keyboard, Back).` : fails.join("; ");
console.log(JSON.stringify({ pass, summary, rows }, null, 1));
if (process.env.CRON_SECRET) {
  await fetch(`${host}/api/picks/review`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, "content-type": "application/json" },
    body: JSON.stringify({ title: `UI check: ${pass ? "pass" : `${fails.length} problem(s)`}`, why: summary, evidence: { rows: rows.map((r) => ({ w: r.w, path: r.path, height: r.height, firstTop: r.firstTop })) } }),
  });
}
process.exit(pass ? 0 : 1);
