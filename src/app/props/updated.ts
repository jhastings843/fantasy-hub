import { whenEt } from "../picks/ui";

/** "Updated Wed, Oct 21, 3:05 PM." from the newest of the given times, or "Not updated yet." */
export function updated(times: (string | null | undefined)[], verb = "Updated"): string {
  const t = times.filter((x): x is string => !!x).sort().at(-1);
  return t ? `${verb} ${whenEt(t)}.` : "Not updated yet.";
}
