// Our own model's reads on the picks board (tracked only): the latest one per
// game from the forecast archive, and its straight-up record. Pure.

import { type SuRecord, key } from "./engine";
import type { ForecastSnapshot } from "./forecasts";
import type { OurLine } from "@/lib/models/nfl/spread-live";

/** The last snapshot before kickoff that carries our model's read, per game key. */
export function latestOurs(snaps: ForecastSnapshot[]): Map<string, OurLine> {
  const out = new Map<string, OurLine>();
  for (const s of [...snaps].sort((a, b) => a.at.localeCompare(b.at))) if (s.ours && (!s.ref?.kickoff || s.at < s.ref.kickoff)) out.set(key(s), s.ours);
  return out;
}

/** Our model's straight-up record: its projected winner at the last read before kickoff, ties left out. */
export function oursSuRecord(ours: Map<string, OurLine>, finals: Map<string, { home: number; away: number }>): SuRecord {
  let w = 0;
  let l = 0;
  for (const [k, o] of ours) {
    const f = finals.get(k);
    if (!f || f.home === f.away || o.model === 0) continue;
    if ((o.model < 0) === f.home > f.away) w++;
    else l++;
  }
  return { id: "ours", label: "Our model's projected winner", w, l, pct: w + l ? w / (w + l) : 0 };
}

