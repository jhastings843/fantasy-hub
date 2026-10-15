// Sam's first touchdown pages (samthemodelman.smmodel.workers.dev/nfl/firsttd/).
//
// One page per game, current week only: last week's pages are gone once the
// board turns over (404), and no archive has them. So the tracker keeps its
// own copy, taken before kickoff, and everything here reads that copy.
//
// What a page gives: the model's pick, each team's chance to score first, a
// chance for every player who has touched the ball (THIN players get none,
// OUT players are removed), an "any other" remainder per team, a "no
// offensive first TD" remainder, and a small table of how each defense has
// been scored on. The three blocks add to 100%. The page's script also
// carries, per player, two per-game rates: s1 "touchdowns he has scored" and
// s2 "opportunity he has been given". Those two are the closest thing to the
// model's reasoning that the page publishes, so they are kept.

export interface FtdPlayer {
  key: string; // "SEA_J_Smith-Njigba"
  name: string; // "J.Smith-Njigba"
  team: string;
  touches: number;
  tds: number;
  /** The model's chance to score the game's first TD. Null when THIN or OUT. */
  p: number | null;
  thin: boolean;
  out: boolean;
  games?: number;
  s1?: number;
  s2?: number;
}

export interface FtdTeam {
  team: string;
  pFirst: number;
  players: FtdPlayer[];
  /** "Any other <team>": everyone below the page's threshold. */
  rest: number;
  /**
   * What the page holds for its THIN players without printing it: the side's
   * chance minus every printed number. Sam gives them a share, he just won't
   * say whose (6.8% of Denver's 41.5% on the first page read).
   */
  thin: number;
}

export interface FtdDefenseRow {
  label: string;
  away: string;
  home: string;
  league: string;
}

export interface FtdGame {
  season: number;
  week: number;
  slug: string; // "2026_06_SEA_DEN"
  away: string;
  home: string;
  /** The page's own kickoff line, "Thursday, October 15 · 8:15 PM ET". */
  when: string;
  pick: { name: string; team: string; p: number } | null;
  teams: FtdTeam[]; // away first, as the page lists them... or as found
  none: number;
  defense: FtdDefenseRow[];
}

const pct = (s: string): number | null => {
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*%/);
  return m ? Math.round(Number(m[1]) * 10) / 1000 : null;
};
const text = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&mdash;/g, "—")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** "2026_06_SEA_DEN" to its parts. Sam writes away first. */
export function parseSlug(slug: string): { season: number; week: number; away: string; home: string } | null {
  const m = slug.match(/^(\d{4})_(\d{2})_([A-Z]{2,3})_([A-Z]{2,3})$/);
  return m ? { season: Number(m[1]), week: Number(m[2]), away: m[3], home: m[4] } : null;
}

/** The first TD links on Sam's NFL board, in board order. */
export function parseBoardLinks(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href="firsttd\/(\d{4}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3})(?:\.html)?"/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** The page's embedded per-player data (D.players), or an empty map. */
function embedded(html: string): Map<string, { games?: number; s1?: number; s2?: number }> {
  const out = new Map<string, { games?: number; s1?: number; s2?: number }>();
  const i = html.indexOf("var D=");
  if (i < 0) return out;
  try {
    // The object literal is JSON; read it with a brace counter so the code after it is ignored.
    const start = i + 6;
    let depth = 0;
    let inStr = false;
    let end = -1;
    for (let j = start; j < html.length; j++) {
      const c = html[j];
      if (inStr) {
        if (c === "\\") j++;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        end = j + 1;
        break;
      }
    }
    if (end < 0) return out;
    const d = JSON.parse(html.slice(start, end)) as { players?: Record<string, { games?: number; s1?: number; s2?: number }> };
    for (const [k, v] of Object.entries(d.players ?? {})) out.set(k, { games: v.games, s1: v.s1, s2: v.s2 });
  } catch {
    // Missing reasoning data is not worth failing the page over.
  }
  return out;
}

/** One game page. Null when it is not a first TD page we can read. */
export function parseFirstTdPage(slug: string, html: string): FtdGame | null {
  const id = parseSlug(slug);
  if (!id) return null;
  const extra = embedded(html);

  const stamp = html.match(/<div class="stamp">([\s\S]*?)<\/div>/);
  const when = stamp ? text(stamp[1]).replace(/^FIRST TOUCHDOWN\s*·\s*/i, "").replace(/\s*·\s*[^·]*$/, "") : "";

  const pickM = html.match(/<div class="ftd-pick">([\s\S]*?)<\/div>/);
  let pick: FtdGame["pick"] = null;
  if (pickM) {
    const n = pickM[1].match(/class="n">([^<]+)</);
    const t = pickM[1].match(/class="t">([A-Z]{2,3})/);
    const p = pickM[1].match(/class="p">([^<]+)</);
    const pp = p ? pct(p[1]) : null;
    if (n && t && pp !== null) pick = { name: n[1].trim(), team: t[1], p: pp };
  }

  // Split on the team headers; each chunk runs to the next header.
  const teams: FtdTeam[] = [];
  const heads = [...html.matchAll(/<div class="ftd-team"><b>([A-Z]{2,3})<\/b><i>([^<]*)<\/i><\/div>/g)];
  for (let h = 0; h < heads.length; h++) {
    const team = heads[h][1];
    const pFirst = pct(heads[h][2]);
    const from = heads[h].index! + heads[h][0].length;
    const nextHead = h + 1 < heads.length ? heads[h + 1].index! : html.indexOf("ftd-team ftd-none", from);
    const chunk = html.slice(from, nextHead > 0 ? nextHead : undefined);
    const players: FtdPlayer[] = [];
    for (const r of chunk.matchAll(/<div class="ftd-row( gone)?" data-k="([^"]+)">([\s\S]*?)<span class="ftd-p">([^<]*)<\/span><\/div>/g)) {
      const body = r[3];
      const name = (body.match(/class="ftd-nm">([^<]+)</) ?? [])[1]?.trim() ?? r[2];
      const sub = (body.match(/class="ftd-sub">([^<]+)</) ?? [])[1] ?? "";
      const touches = Number((sub.match(/(\d+)\s*tch/) ?? [])[1] ?? 0);
      const tds = Number((sub.match(/(\d+)\s*TD/) ?? [])[1] ?? 0);
      const thin = /ftd-thin/.test(body);
      const out = !!r[1] || />OUT</.test(body);
      const e = extra.get(r[2]);
      players.push({
        key: r[2], name, team, touches, tds, p: pct(r[4]), thin, out,
        ...(e?.games !== undefined ? { games: e.games } : {}),
        ...(e?.s1 !== undefined ? { s1: e.s1 } : {}),
        ...(e?.s2 !== undefined ? { s2: e.s2 } : {}),
      });
    }
    const restM = chunk.match(/ftd-row ftd-rest">[\s\S]*?<span class="ftd-p">([^<]*)<\/span>/);
    if (pFirst === null) continue;
    const rest = restM ? (pct(restM[1]) ?? 0) : 0;
    const printed = players.reduce((a, p) => a + (p.out ? 0 : (p.p ?? 0)), 0) + rest;
    const thin = players.some((p) => p.thin && !p.out) ? Math.max(0, Math.round((pFirst - printed) * 1000) / 1000) : 0;
    teams.push({ team, pFirst, players, rest, thin });
  }

  const noneM = html.match(/ftd-team ftd-none"><b>[^<]*<\/b><i>([^<]+)<\/i>/);
  const none = noneM ? (pct(noneM[1]) ?? 0) : 0;

  // The defense table: columns are the page's two teams in its order, then League.
  const defense: FtdDefenseRow[] = [];
  const defM = html.match(/<div class="ftd-def[^"]*">([\s\S]*?)<\/table>/);
  if (defM) {
    const cols = [...defM[1].matchAll(/<th>([A-Z]{2,3})<\/th>/g)].map((m) => m[1]);
    for (const row of defM[1].matchAll(/<tr><td>([^<]+)<\/td><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><\/tr>/g)) {
      const v: { [team: string]: string } = { [cols[0]]: text(row[2]), [cols[1]]: text(row[3]) };
      defense.push({ label: text(row[1]), away: v[id.away] ?? "", home: v[id.home] ?? "", league: text(row[4]) });
    }
  }

  if (!teams.length) return null;
  return { ...id, slug, when, pick, teams, none, defense };
}

/** Every priced player in the game, most likely first. */
export function pricedPlayers(g: FtdGame): (FtdPlayer & { p: number })[] {
  return g.teams
    .flatMap((t) => t.players)
    .filter((p): p is FtdPlayer & { p: number } => p.p !== null && !p.out)
    .sort((a, b) => b.p - a.p);
}

/** The fair American price for a chance, so a book's number can be judged against it. */
export function fairAmerican(p: number): string {
  if (p <= 0 || p >= 1) return "n/a";
  const v = p >= 0.5 ? -Math.round((p / (1 - p)) * 100) : Math.round(((1 - p) / p) * 100);
  return v > 0 ? `+${v}` : `${v}`;
}
