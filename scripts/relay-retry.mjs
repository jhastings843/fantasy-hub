// What the PEM relay does with the app's answer to a post. Pure, no I/O, so
// src/lib/picks/relay-retry.test.ts can check it.
//
// The app can answer ok and still have read nothing usable: a Harris sheet
// with games 0, or a PEM card that failed its own check (verified false).
// That post is tried again on later relay runs, up to MAX_TRIES in all, and
// Jack is pushed once on the first such answer and once when the relay gives
// up. A post the app read and verified, or deliberately skipped, is done.

export const MAX_TRIES = 3;

/** An ok answer with nothing usable in it. */
export const unusable = (json) => Boolean(json?.ok && !json.skipped && (json.verified === false || json.games === 0));

/**
 * Is this post finished? Entries written before tries were counted (no
 * `tries`) are left as done, so old weeks are not re-read on every run.
 */
export function isDone(entry) {
  if (!entry) return false;
  if (entry.tries === undefined) return true;
  return !unusable(entry.result) || entry.tries >= MAX_TRIES;
}

/**
 * The state entry to store after an answer, and the alert to push (or null).
 * Returns { entry: null } for a failed answer: nothing stored, retried next run
 * as before.
 */
export function afterAnswer(prev, json, label, note = "", now = new Date()) {
  if (!json?.ok) return { entry: null, alert: null };
  if (!unusable(json)) return { entry: { at: now.toISOString(), result: json }, alert: null };
  const tries = (prev?.tries ?? 0) + 1;
  const entry = { at: now.toISOString(), result: json, tries };
  const what = `${label}${json.week ? ` week ${json.week}` : ""}: the app read ${json.games ?? 0} games${json.verified === false ? ", not verified" : ""}${note ? ` (${note})` : ""}`;
  if (tries === 1) return { entry, alert: { title: `${label}: post read but not usable`, message: `${what}. Trying again on the next relay runs (up to ${MAX_TRIES} tries).` } };
  if (tries >= MAX_TRIES) return { entry, alert: { title: `${label}: gave up after ${MAX_TRIES} tries`, message: `${what}. This week stays out of the picks review until someone looks.` } };
  return { entry, alert: null };
}
