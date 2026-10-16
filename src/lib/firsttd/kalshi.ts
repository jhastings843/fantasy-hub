// Kalshi's first touchdown markets (series KXNFLFIRSTTD, public API, no key):
// a real-money price per player, readable as a probability. Saved with each
// pregame copy of Sam's page, so his number can be set against a price you
// could actually take. Kalshi writes JAC and LAR; Sam writes JAX and LA.

const API = "https://api.elections.kalshi.com/trade-api/v2";
const SAM: { [code: string]: string } = { JAC: "JAX", LAR: "LA", WSH: "WAS" };

export interface KalshiPlayer {
  name: string; // "Emanuel Wilson"
  bid: number | null;
  ask: number | null;
  last: number | null;
}
export interface KalshiGame {
  event: string;
  at: string;
  players: KalshiPlayer[];
}

interface Market {
  event_ticker?: string;
  yes_sub_title?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  last_price_dollars?: string;
}
interface Event {
  event_ticker?: string;
  sub_title?: string;
}

const price = (s: string | undefined) => {
  const v = Number(s);
  return Number.isFinite(v) && v > 0 && v < 1 ? v : null;
};

/** Kalshi's taker fee per contract at a price (0.07 x P x (1-P), rounded up to the cent). */
export const kalshiFee = (p: number) => Math.ceil(0.07 * p * (1 - p) * 100 - 1e-9) / 100;

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`Kalshi answered ${res.status}`);
  return (await res.json()) as T;
}

/** Open first TD markets, keyed "AWAY@HOME" in Sam's codes. */
export async function kalshiFirstTd(now = new Date()): Promise<Map<string, KalshiGame>> {
  const ev = await json<{ events?: Event[] }>(`${API}/events?series_ticker=KXNFLFIRSTTD&status=open&limit=100`);
  const games = new Map<string, string>(); // event ticker -> AWAY@HOME
  for (const e of ev.events ?? []) {
    const m = e.sub_title?.match(/^([A-Z]{2,3}) vs ([A-Z]{2,3})/);
    if (m && e.event_ticker) games.set(e.event_ticker, `${SAM[m[1]] ?? m[1]}@${SAM[m[2]] ?? m[2]}`);
  }
  const out = new Map<string, KalshiGame>();
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    const r = await json<{ markets?: Market[]; cursor?: string }>(
      `${API}/markets?series_ticker=KXNFLFIRSTTD&status=open&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    for (const m of r.markets ?? []) {
      const key = m.event_ticker ? games.get(m.event_ticker) : undefined;
      if (!key || !m.yes_sub_title) continue;
      const g = out.get(key) ?? { event: m.event_ticker!, at: now.toISOString(), players: [] };
      g.players.push({ name: m.yes_sub_title.trim(), bid: price(m.yes_bid_dollars), ask: price(m.yes_ask_dollars), last: price(m.last_price_dollars) });
      out.set(key, g);
    }
    if (!r.cursor || !r.markets?.length) break;
    cursor = r.cursor;
  }
  return out;
}
