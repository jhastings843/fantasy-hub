// The one check every spread reader runs (Jack, 2026-11-02, after a flipped
// Purdue-Gonzaga line and UConn football the week before: "fix it so it
// doesn't happen again"). A home spread must agree with the book on who is
// favored: the shorter moneyline, or the side the feed flags as favorite.
// When it doesn't, the line was read from the wrong side and is turned around.
// Lines inside a point are left alone; a pick'em can lean either way. Pure.

export interface FavoriteHint {
  mlHome?: number | null;
  mlAway?: number | null;
  /** The feed's own favorite flags, when it gives them. */
  homeFav?: boolean | null;
  awayFav?: boolean | null;
}

/** True: home is favored; false: away; null: no way to tell. Moneylines first, then the flags. */
export function homeFavored(h: FavoriteHint): boolean | null {
  const { mlHome, mlAway } = h;
  if (typeof mlHome === "number" && typeof mlAway === "number" && mlHome !== mlAway) return mlHome < mlAway;
  if (h.homeFav === true && h.awayFav !== true) return true;
  if (h.awayFav === true && h.homeFav !== true) return false;
  return null;
}

/** True when the home spread puts the favorite on the wrong side. */
export function spreadFlipped(homeSpread: number | null | undefined, h: FavoriteHint): boolean {
  if (typeof homeSpread !== "number" || Math.abs(homeSpread) < 1) return false;
  const fav = homeFavored(h);
  return fav === null ? false : fav ? homeSpread > 0 : homeSpread < 0;
}

/** An American price string or number ("-245", "+200", "EVEN") to a number, or undefined. */
export function americanOf(x: unknown): number | undefined {
  if (typeof x === "number") return Number.isFinite(x) ? x : undefined;
  if (typeof x !== "string") return undefined;
  const t = x.trim().toUpperCase();
  if (t === "EVEN" || t === "EV") return 100;
  const v = Number(t.replace("+", ""));
  return Number.isFinite(v) && Math.abs(v) >= 100 ? v : undefined;
}
