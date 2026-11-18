// Short site names for the "Pulled from" line at the top of the midweek email
// (Jack, 2026-11-17: "Pulled from Flock Fantasy, Yahoo Fantasy, RotoWire").
//
// Research sources arrive as whatever the model wrote: a bare URL, "FantasyPros
// (https://...)", or just a name. A URL wins when there is one; known hosts get
// their brand name, unknown hosts their domain without www or TLD.
//   "https://www.fantasypros.com/2026/11/waiver-wire-week-11/" -> "FantasyPros"
//   "RotoBaller FAAB column (https://www.rotoballer.com/...)"  -> "RotoBaller"
//   "https://sports.yahoo.com/fantasy/article/..."             -> "Yahoo Fantasy"
//   "https://www.footballguys.com/article/..."                 -> "Footballguys"
//   "Dynasty Daddy"                                            -> "Dynasty Daddy"

const HOSTS: Record<string, string> = {
  "fantasypros.com": "FantasyPros",
  "rotoballer.com": "RotoBaller",
  "rotowire.com": "RotoWire",
  "sports.yahoo.com": "Yahoo Fantasy",
  "yahoo.com": "Yahoo Fantasy",
  "espn.com": "ESPN",
  "cbssports.com": "CBS Sports",
  "nbcsports.com": "NBC Sports",
  "theathletic.com": "The Athletic",
  "nytimes.com": "The Athletic",
  "pff.com": "PFF",
  "fantasylife.com": "Fantasy Life",
  "thefantasyfootballers.com": "Fantasy Footballers",
  "footballguys.com": "Footballguys",
  "4for4.com": "4for4",
  "establishtherun.com": "Establish The Run",
  "numberfire.com": "numberFire",
  "fanduel.com": "FanDuel Research",
  "draftsharks.com": "Draft Sharks",
  "razzball.com": "Razzball",
  "si.com": "Sports Illustrated",
  "usatoday.com": "USA Today",
  "sleeper.com": "Sleeper",
  "reddit.com": "Reddit",
  "dynastynerds.com": "Dynasty Nerds",
  "dynasty-daddy.com": "Dynasty Daddy",
  "dynastydaddy.com": "Dynasty Daddy",
  "keeptradecut.com": "KeepTradeCut",
  "flockfantasy.com": "Flock Fantasy",
  "beehiiv.com": "Flock Fantasy",
  "youtube.com": "YouTube",
  "bleacherreport.com": "Bleacher Report",
  "fftoday.com": "FFToday",
  "fansided.com": "FanSided",
  "nfl.com": "NFL.com",
  "optimusfantasy.com": "Optimus Fantasy",
  "sportsline.com": "SportsLine",
  "rotoworld.com": "Rotoworld",
  "fantasyalarm.com": "Fantasy Alarm",
  "dynastyleaguefootball.com": "Dynasty League Football",
};

/** The featured sources lead the line and Sleeper's most-added closes it; research sits between. */
const LEAD = ["Jingles", "Flock Fantasy", "Dynasty Nerds"];
const LAST = ["Sleeper"];

export function sourceName(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // A URL with or without its scheme ("bleacherreport.com/articles/1" came back in week 11).
  const url =
    s.match(/https?:\/\/[^\s)\]]+/)?.[0] ??
    s.match(/\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|co|us|tv|news|app)\b(?:\/[^\s)\]]*)?/i)?.[0];
  if (url) {
    try {
      const host = new URL(/^https?:/i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
      for (const [h, name] of Object.entries(HOSTS)) if (host === h || host.endsWith(`.${h}`)) return name;
      const parts = host.split(".");
      // A Substack writer is named by the subdomain, not "Substack".
      const base = parts.length > 2 && parts[parts.length - 2] === "substack" ? parts[0] : parts.length > 1 ? parts[parts.length - 2] : parts[0];
      return base.charAt(0).toUpperCase() + base.slice(1);
    } catch {
      /* fall through to the name */
    }
  }
  const name = s.split(/\s[(\-–:|]/)[0].trim();
  return name && name.length <= 40 ? name : null;
}

/** Names with no repeats (case-insensitive): featured sources first, Sleeper last, the rest in first-seen order. */
export function uniqueSources(names: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    if (!n) continue;
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  const rank = (n: string) => (LEAD.includes(n) ? LEAD.indexOf(n) - LEAD.length : LAST.includes(n) ? 1 : 0);
  return out.map((n, i) => ({ n, i })).sort((a, b) => rank(a.n) - rank(b.n) || a.i - b.i).map(({ n }) => n);
}
