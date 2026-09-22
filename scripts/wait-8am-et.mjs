#!/usr/bin/env node
// Exits once the America/New_York clock reads 08:06 or later.
function etMinutes() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
}

const target = 8 * 60 + 6;
while (etMinutes() < target) {
  await new Promise((r) => setTimeout(r, 30_000));
}
console.log(`ET clock is past 08:06 (${etMinutes()} minutes into the day)`);
