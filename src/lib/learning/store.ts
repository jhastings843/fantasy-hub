import "server-only";
import { redis } from "@/lib/redis/client";
import { emptyState, review, reviewDue, type Candidate, type Gate, type JournalLine, type SectionState } from "./engine";

// Redis side of the shared learning engine. One state object and one
// append-only journal per section and season; nothing else is written. Keys
// are versioned (learn:v1) and separate from the old props:...:system hashes,
// which are left as they were.

const stateKey = (section: string, season: number) => `learn:v1:${section}:${season}:state`;
const journalKey = (section: string, season: number) => `learn:v1:${section}:${season}:journal`;

export async function loadSection(section: string, season: number): Promise<SectionState> {
  return (await redis.get<SectionState>(stateKey(section, season))) ?? emptyState(section);
}

export async function loadJournal(section: string, season: number, limit = 20): Promise<JournalLine[]> {
  const raw = await redis.lrange<string | JournalLine>(journalKey(section, season), -limit, -1);
  return raw.map((x) => (typeof x === "string" ? (JSON.parse(x) as JournalLine) : x)).reverse();
}

/** Run the section's review if it hasn't run this week. Returns what it journaled (empty when not due). */
export async function reviewIfDue(section: string, season: number, week: number, gate: Gate, cands: Candidate[], now: Date): Promise<JournalLine[]> {
  if (!week) return [];
  const prev = await loadSection(section, season);
  if (!reviewDue(prev, week)) return [];
  const { state, journal } = review(gate, prev, cands, now.toISOString(), week);
  await redis.set(stateKey(section, season), state);
  if (journal.length) await redis.rpush(journalKey(section, season), ...journal.map((j) => JSON.stringify(j)));
  return journal;
}
