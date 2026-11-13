import "server-only";
import { redis } from "@/lib/redis/client";
import { emptyState, expand, register, review, reviewDue, type Bet, type Candidate, type Gate, type JournalLine, type SectionState } from "./engine";
import { notifyJournal } from "@/lib/notify/golive";

// Redis side of the shared learning engine. One state object and one
// append-only journal per section and season; nothing else is written. Keys
// are versioned (learn:v1) and separate from the old props:...:system hashes,
// which are left as they were.

const stateKey = (section: string, season: number) => `learn:v1:${section}:${season}:state`;
const journalKey = (section: string, season: number) => `learn:v1:${section}:${season}:journal`;

// Carry-over (Jack, 2026-11-12): a slice keeps its record across seasons.
// Each review saves every slice's bets since it registered (betsKey, one hash
// field per slice). A season with no state yet starts from the last season's
// entries (same registeredAt, status and combinations), and every load attaches
// the last season's saved bets as `carried`. Carried weeks shift down 100 per
// season so weeks never collide; carried bets are evidence only (liveBets skips them).
const betsKey = (section: string, season: number) => `learn:v1:${section}:${season}:bets`;
const WEEK_SHIFT = 100;

/** Compact row: [game, week, at, net, toward, key]. */
type Row = [string, number, string, number, number, string];
const toRow = (b: Bet): Row => [b.game, b.week, b.at, b.net, b.toward ?? 0, b.key ?? ""];
const fromRow = ([game, week, at, net, toward, key]: Row): Bet => ({ game, week: week - WEEK_SHIFT, at, net, ...(toward ? { toward } : {}), ...(key ? { key } : {}), carried: true });

async function carriedFrom(section: string, season: number): Promise<{ [id: string]: Bet[] } | undefined> {
  const raw = await redis.hgetall<{ [id: string]: Row[] | string }>(betsKey(section, season - 1));
  if (!raw || !Object.keys(raw).length) return undefined;
  const out: { [id: string]: Bet[] } = {};
  for (const [id, v] of Object.entries(raw)) out[id] = (typeof v === "string" ? (JSON.parse(v) as Row[]) : v).map(fromRow);
  return out;
}

export async function loadSection(section: string, season: number): Promise<SectionState> {
  const [own, carried] = await Promise.all([redis.get<SectionState>(stateKey(section, season)), carriedFrom(section, season)]);
  let state = own;
  if (!state) {
    const prev = await redis.get<SectionState>(stateKey(section, season - 1));
    state = prev ? { v: 1, section, entries: prev.entries, ...(prev.generated ? { generated: prev.generated } : {}), ...(prev.stake ? { stake: prev.stake } : {}) } : emptyState(section);
  }
  return carried ? { ...state, carried } : state;
}

/** The state as saved: never the carried bets. */
const saved = (s: SectionState): SectionState => {
  const rest = { ...s };
  delete rest.carried;
  return rest;
};

/** Every slice's bets since it registered (carried ones included, so the record chains season to season). */
async function saveBets(section: string, season: number, state: SectionState, cands: Candidate[]): Promise<void> {
  const fields: { [id: string]: string } = {};
  for (const c of expand(state, cands)) {
    const e = state.entries[c.id];
    if (!e) continue;
    const rows = c.bets.filter((b) => b.at >= e.registeredAt).map((b) => (b.carried ? toRow({ ...b, week: b.week + WEEK_SHIFT }) : toRow(b)));
    if (rows.length) fields[c.id] = JSON.stringify(rows);
  }
  // Small batches keep each request well under Upstash's request size cap.
  const ids = Object.keys(fields);
  let batch: { [id: string]: string } = {};
  let size = 0;
  for (const id of ids) {
    batch[id] = fields[id];
    size += fields[id].length;
    if (size > 400_000) {
      await redis.hset(betsKey(section, season), batch);
      batch = {};
      size = 0;
    }
  }
  if (Object.keys(batch).length) await redis.hset(betsKey(section, season), batch);
}

export async function loadJournal(section: string, season: number, limit = 20): Promise<JournalLine[]> {
  const raw = await redis.lrange<string | JournalLine>(journalKey(section, season), -limit, -1);
  return raw.map((x) => (typeof x === "string" ? (JSON.parse(x) as JournalLine) : x)).reverse();
}

/** The slate a run belongs to: its ET date. */
const slateOf = (now: Date) => now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** Run the section's review if it hasn't run this slate. Returns what it journaled (empty when not due). */
export async function reviewIfDue(section: string, season: number, week: number, gate: Gate, cands: Candidate[], now: Date): Promise<JournalLine[]> {
  if (!week) return [];
  const slate = slateOf(now);
  const before = await loadSection(section, season);
  if (!reviewDue(before, week, slate)) {
    // Not due, but new slices start their clock now.
    const { state, journal } = register(before, expand(before, cands), now.toISOString(), week);
    if (journal.length) {
      await redis.set(stateKey(section, season), saved(state));
      await redis.rpush(journalKey(section, season), ...journal.map((j) => JSON.stringify(j)));
    }
    return journal;
  }
  const prev = before;
  const { state, journal } = review(gate, prev, cands, now.toISOString(), week, slate);
  await redis.set(stateKey(section, season), saved(state));
  // Never costs the review: a failed save only means next season starts from the last good copy.
  await saveBets(section, season, { ...state, carried: prev.carried }, cands).catch((e) => console.error(`learn ${section} ${season}: saving bets for carry-over failed`, e));
  if (journal.length) await redis.rpush(journalKey(section, season), ...journal.map((j) => JSON.stringify(j)));
  // One push per slice that went live, paused or was rolled back (deduped in Redis; never throws).
  if (journal.length) await notifyJournal(section, season, journal, state, expand(state, cands));
  return journal;
}
