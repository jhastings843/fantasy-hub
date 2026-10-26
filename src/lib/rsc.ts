// Next.js pages ship their server data as an RSC payload: a run of
// rsc.push("...") calls whose string arguments, joined, hold plain JSON
// objects. Reading that is steadier than scraping markup that gets restyled.

/** The page's RSC payload, decoded into one string ("" when there is none). */
export function rscText(html: string): string {
  let rsc = "";
  for (const m of html.matchAll(/\.rsc\.push\(("(?:[^"\\]|\\.)*")\)/g)) {
    try {
      rsc += JSON.parse(m[1]) as string;
    } catch {
      /* not a string chunk */
    }
  }
  return rsc;
}

/** The JSON object starting at `from` (a "{"), by brace matching outside strings. */
export function objectAt(s: string, from: number): string | null {
  let depth = 0;
  let inStr = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return s.slice(from, i + 1);
  }
  return null;
}
