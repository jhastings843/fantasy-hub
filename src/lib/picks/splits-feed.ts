import "server-only";
import { AN_LEAGUE, type SplitGame, type SplitsLeague, parseScoreboard } from "./splits";

// One read of Action Network's scoreboard per league per data run. A failure
// is "no splits this run", never an error: splits are evidence, not inputs.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

export async function fetchSplits(league: SplitsLeague): Promise<SplitGame[]> {
  try {
    const url = `https://api.actionnetwork.com/web/v2/scoreboard/${AN_LEAGUE[league]}?bookIds=30,68&periods=event`;
    const res = await fetch(url, { cache: "no-store", headers: { "user-agent": UA }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    return parseScoreboard(await res.json(), new Date().toISOString());
  } catch {
    return [];
  }
}
