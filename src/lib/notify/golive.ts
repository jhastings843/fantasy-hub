import "server-only";
import { redis } from "@/lib/redis/client";
import { push, type Push } from "./pushover";
import type { Candidate, JournalLine, SectionState } from "@/lib/learning/engine";

// Go-live alerts (Jack, 2026-11-02): one Pushover alert when a learner slice
// goes live, is paused by its weekly loss cap, or is rolled back, or when a
// section's staking scheme switches (lib/props/staking.ts), in every
// section that runs on the shared engine (lib/learning/store.ts reviewIfDue
// calls this after it writes the journal). NBA picks' go-live gate flipping
// on or off gets one too (notifyNbaGate). Each alert is remembered in Redis,
// so the 15-minute reruns never repeat one.
//
//   alertFor("nba-props-ours", { kind: "activated", label: "Unders 2+ pts" ... }, { w: 34, l: 21, units: 9.4 })
//     -> { title: "Now live: NBA props", message: "NBA props: Unders 2+ pts is now live (34-21, +9.4u)" }

/** What each section is called in an alert. Unknown ids fall back to the id. */
export const SECTION_NAME: { [id: string]: string } = {
  "nfl-props": "NFL props (Sam and David)",
  "nba-props": "NBA props (Sam)",
  "nfl-firsttd": "NFL First TD (Sam)",
  "nfl-props-ours": "NFL props",
  "nba-props-ours": "NBA props",
  "nfl-firsttd-ours": "NFL First TD",
  "nba-firstbasket-ours": "NBA First Basket",
  "nfl-attd-ours": "NFL Anytime TD",
  "nba-lotto-ours": "NBA lottos",
  "nba-kotc-ours": "King of the Court",
  "cbb-model-ours": "CBB model",
  "cfb-model-ours": "CFB model",
};

export const sectionName = (id: string) => SECTION_NAME[id] ?? id;

export type AlertKind = "live" | "paused" | "rolled back" | "stake";

/** The alert a journal line asks for, or null (registrations and reviews never push). */
export function alertKind(j: JournalLine): AlertKind | null {
  if (!j.id) return null;
  if (j.kind === "activated") return "live";
  if (j.kind === "staking") return "stake";
  if (j.kind === "rolled back") return j.text.startsWith("Paused") ? "paused" : "rolled back";
  return null;
}

const signed = (x: number) => `${x >= 0 ? "+" : "-"}${Math.abs(Math.round(x * 10) / 10)}u`;

/** Won-lost and units on a slice's bets from `since` on, for the alert. Pure. */
export function recordSince(c: Candidate | undefined, since: string | undefined): { w: number; l: number; units: number } {
  const bets = (c?.bets ?? []).filter((b) => !since || b.at >= since);
  return { w: bets.filter((b) => b.net > 0).length, l: bets.filter((b) => b.net < 0).length, units: Math.round(bets.reduce((a, b) => a + b.net, 0) * 100) / 100 };
}

/** The push for one journal line. Pure. */
export function alertFor(section: string, j: JournalLine, rec?: { w: number; l: number; units: number }, label?: string): Push | null {
  const kind = alertKind(j);
  if (!kind) return null;
  const name = sectionName(section);
  const what = label ?? j.id!;
  if (kind === "live")
    return { title: `Now live: ${name}`, message: `${name}: ${what} is now live${rec ? ` (${rec.w}-${rec.l}, ${signed(rec.units)})` : ""}. Its bets carry 1u from now on.` };
  if (kind === "stake") return { title: `Stake change: ${name}`, message: `${name}: ${j.text}` };
  if (kind === "paused") return { title: `Paused: ${name}`, message: `${name}: ${j.text}` };
  return { title: `Dropped: ${name}`, message: `${name}: ${j.text} No more stakes on it.` };
}

/** Redis key that remembers one alert. */
export const alertKey = (section: string, season: number, j: JournalLine) => `notify:v1:golive:${section}:${season}:${j.id}:${alertKind(j)}:${j.at}`;

const KEEP = 120 * 24 * 3600;

/**
 * One push per new activated, paused or rolled-back journal line. Never
 * throws: a failed alert must not fail the review that wrote it.
 */
export async function notifyJournal(section: string, season: number, journal: JournalLine[], state: SectionState, cands: Candidate[]): Promise<number> {
  let sent = 0;
  for (const j of journal) {
    try {
      if (!alertKind(j)) continue;
      // Claim first: a rerun (or a second caller in the same minute) finds the key and stays quiet.
      if ((await redis.set(alertKey(section, season, j), new Date().toISOString(), { nx: true, ex: KEEP })) !== "OK") continue;
      const e = state.entries[j.id!];
      const c = cands.find((x) => x.id === j.id);
      const p = alertFor(section, j, alertKind(j) === "live" ? recordSince(c, e?.registeredAt) : undefined, e?.label);
      if (p && (await push({ ...p, url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://fantasy-hub-tan.vercel.app"}/props`, urlTitle: "Open Props" })).pushed) sent++;
    } catch {
      /* the next line still gets its chance */
    }
  }
  return sent;
}

// ---------------------------------------------------------- NBA picks gate

/** The push when NBA picks' go-live gate flips. Pure. */
export function nbaGatePush(live: boolean, tier1?: { label: string; w: number; l: number; units: number } | null): Push {
  return live
    ? {
        title: "Now live: NBA picks",
        message: `NBA picks are now live: tier bets carry stakes under NBA's own limits${tier1 ? ` (tier 1: ${tier1.label}, ${tier1.w}-${tier1.l}, ${signed(tier1.units)})` : ""}.`,
      }
    : { title: "Off: NBA picks", message: "NBA picks are off: the go-live gate no longer holds, so bets are tracked with no stake." };
}

/**
 * Remembers the gate's last state per season and pushes once when it
 * changes. The first read only pushes when it is already live.
 */
export async function notifyNbaGate(season: number, live: boolean, tier1?: { label: string; w: number; l: number; units: number } | null): Promise<boolean> {
  try {
    const prev = await redis.getset<string>(`notify:v1:nba-gate:${season}`, live ? "on" : "off");
    const was = prev === null || prev === undefined ? "off" : String(prev);
    if (was === (live ? "on" : "off")) return false;
    const r = await push({ ...nbaGatePush(live, tier1), url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://fantasy-hub-tan.vercel.app"}/picks?l=nba`, urlTitle: "Open NBA picks" });
    return r.pushed;
  } catch {
    return false;
  }
}
