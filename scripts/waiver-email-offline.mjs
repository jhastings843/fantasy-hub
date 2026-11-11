// Build the week N waiver/FAAB email from the STORED research, with no send,
// no app, no Gmail. Read-only: Sleeper public API for rosters, plus a sources
// JSON written by scripts/read-waiver-sources.mjs.
//
//   node --env-file=.env.local scripts/waiver-email-offline.mjs sources.json previews/out
//
// Writes <out>.md and <out>.html. Dynasty leagues read only the dynasty pass,
// redraft leagues only the redraft pass (docs/faab-strategy.md, Standing rule).
import { readFileSync, writeFileSync } from "node:fs";

const [srcPath, outBase = "previews/waiver-email"] = process.argv.slice(2);
const src = JSON.parse(readFileSync(srcPath, "utf8"));
const S = "https://api.sleeper.app/v1";
const j = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };

const state = await j(`${S}/state/nfl`);
const season = String(state.league_season ?? state.season);
const week = Math.max(Number(state.week) || 0, Number(state.display_week) || 0);
const user = await j(`${S}/user/${process.env.SLEEPER_USERNAME}`);
const leagues = (await j(`${S}/user/${user.user_id}/leagues/nfl/${season}`));
const players = await j(`${S}/players/nfl`);
const trending = await j(`${S}/players/nfl/trending/add?lookback_hours=48&limit=100`);

const ALIAS = { chigoziemokonkwo: "chigokonkwo" };
const norm = (s) => {
  const k = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "").replace(/(jr|sr|ii|iii|iv)$/, "");
  return ALIAS[k] ?? k;
};
const byName = new Map();
for (const [id, p] of Object.entries(players)) {
  if (!p.full_name) continue;
  const k = norm(p.full_name);
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push({ id, ...p });
}
const resolve = (t) => {
  if (t.position === "DEF" && players[t.team]) return { id: t.team, ...players[t.team] };
  const c = byName.get(norm(t.name)) ?? [];
  return c.find((p) => p.team === t.team && p.position === t.position)
    ?? c.find((p) => p.position === t.position) ?? c[0] ?? null;
};

const out = [];
for (const lg of leagues) {
  const type = lg.settings?.type === 2 ? "dynasty" : "redraft";
  if (/guillotine|chopped/i.test(lg.name)) { out.push({ name: lg.name, skip: "guillotine" }); continue; }
  const research = src[`waivers:v1:research:${season}:w${week}:${type}`];
  const rosters = await j(`${S}/league/${lg.league_id}/rosters`);
  const owned = new Set(rosters.flatMap((r) => [...(r.players ?? []), ...(r.taxi ?? []), ...(r.reserve ?? [])]));
  const mine = rosters.find((r) => r.owner_id === user.user_id || (r.co_owners ?? []).includes(user.user_id));
  const budget = Number(lg.settings?.waiver_budget ?? 100);
  const used = Number(mine?.settings?.waiver_budget_used ?? 0);
  const slots = new Set(lg.roster_positions ?? []);
  const canStart = (pos) => slots.has(pos) || (pos === "QB" && slots.has("SUPER_FLEX"))
    || (["RB", "WR", "TE"].includes(pos) && (slots.has("FLEX") || slots.has("SUPER_FLEX")))
    || (pos === "DEF" && slots.has("DEF")) || (pos === "K" && slots.has("K"));
  const rows = [];
  for (const t of research?.targets ?? []) {
    if (!canStart(t.position)) continue;
    const p = resolve(t);
    if (p && owned.has(p.id)) continue;
    const bid = Math.round((t.faabPercent / 100) * budget);
    rows.push({ ...t, bid: Math.min(bid, budget - used), matched: !!p });
  }
  const inResearch = new Set(rows.map((r) => r.name));
  const trendingFree = trending
    .filter((t) => !owned.has(t.player_id) && players[t.player_id])
    .map((t) => { const p = players[t.player_id]; return { ...p, full_name: p.full_name ?? `${p.first_name} ${p.last_name}`, adds: t.count }; })
    .filter((p) => canStart(p.position) && p.team && !inResearch.has(p.full_name)
      && !(research?.targets ?? []).some((r) => norm(r.name) === norm(p.full_name)))
    .slice(0, 5)
    .map((p) => ({ name: p.full_name, position: p.position, team: p.team, adds: p.adds }));
  out.push({
    trendingFree,
    name: lg.name, type, budget, left: budget - used, teams: lg.total_rosters,
    researchedAt: research?.generatedAt ?? null, total: research?.targets?.length ?? 0, rows,
    scoring: lg.scoring_settings?.rec === 1 ? "full PPR" : lg.scoring_settings?.rec === 0.5 ? "half PPR" : "standard",
  });
}

const fmtDate = (s) => new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
writeFileSync(`${outBase}.json`, JSON.stringify({ season, week, generatedAt: new Date().toISOString(), leagues: out }, null, 2));
console.log(JSON.stringify({ season, week, leagues: out.map((l) => ({ name: l.name, type: l.type, skip: l.skip, left: l.left, budget: l.budget, rows: l.rows?.length, total: l.total, at: l.researchedAt && fmtDate(l.researchedAt) })) }, null, 1));
