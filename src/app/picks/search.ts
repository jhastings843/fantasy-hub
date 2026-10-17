// The week's verdicts, flattened for the search box: one entry per game with
// its spread, straight-up and total call, worded the way the cards word them.
import { marginBand, marginLabel, suPick } from "@/lib/picks/engine";
import type { PicksReport } from "@/lib/picks/report";
import { NFL_TEAMS } from "@/lib/picks/teams";
import { STATUS_TEXT, pickText, statusOf } from "./ats";
import { kickoffEt, line, price } from "./ui";
import type { SearchEntry, SearchRow } from "./WeekSearch";

const FULL_NFL: Record<string, string> = Object.fromEntries(Object.entries(NFL_TEAMS).map(([full, abbr]) => [abbr, full]));

export function picksSearchIndex(r: PicksReport): SearchEntry[] {
  const name = (k: string) => r.names[k] ?? k;
  const method = r.su.best?.id ?? "avg";
  const totals = new Map(r.totals.board.map((t) => [`${t.away}@${t.home}`, t]));
  return r.board.map((g) => {
    const key = `${g.away}@${g.home}`;
    const f = g.final;
    const rows: SearchRow[] = [];

    // Spread
    const st = statusOf(g);
    const pick = pickText(g, name);
    if (f) {
      // Graded at the line it went out at, else the line the board picked it at.
      const side = g.issued?.side ?? g.side;
      const at = g.issued?.homeLine ?? g.homeLine;
      const covered = side && at !== undefined ? f.home - f.away + at : null;
      const res = covered === null ? null : covered === 0 ? "P" : (covered > 0) === (side === "home") ? "W" : "L";
      const bet = g.issued ? `${g.issued.units}u bet` : "no bet";
      rows.push({ market: "Spread", text: g.side ? `${pick} · ${bet}` : "Pass", tone: res && g.issued ? res : "pass", result: res ?? undefined });
    } else if (st === "bet" || st === "sent") {
      const u = st === "sent" ? g.issued!.units : g.stake;
      rows.push({ market: "Spread", text: `Bet ${pick} · ${u}u at ${price(st === "sent" ? g.issued!.price : g.price)}`, tone: "bet" });
    } else if (st === "early") {
      rows.push({ market: "Spread", text: `Early look ${pick} · about ${g.stake}u, a bet at 9am on game day`, tone: "lean" });
    } else if (st === "pass") {
      rows.push({ market: "Spread", text: g.read?.samSide && g.read.davidSide && g.read.samSide !== g.read.davidSide ? `Pass · models split (${pick})` : "Pass", tone: "pass" });
    } else {
      rows.push({ market: "Spread", text: `${STATUS_TEXT[st]} · ${pick}`, tone: st === "started" ? "pass" : "lean" });
    }

    // Straight up
    const su = suPick(method, g.sam, g.david, g.ref?.line);
    if (su) {
      const who = name(su.side === "home" ? g.home : g.away);
      const res = f ? (f.home === f.away ? "P" : (f.home > f.away) === (su.side === "home") ? "W" : "L") : undefined;
      rows.push({ market: "To win", text: `${who} · ${marginLabel(r.league, marginBand(r.league, su.margin)).toLowerCase()} (${su.margin.toFixed(1)})`, tone: res ?? "lean", result: res });
    }

    // Total
    const t = totals.get(key);
    if (t) {
      const call = t.side ? `${t.side === "over" ? "Over" : "Under"} ${t.ref?.total ?? ""}`.trim() : "";
      let text: string;
      let tone: SearchRow["tone"] = "pass";
      if (t.stake) {
        text = `Bet ${call} · ${t.stake}u at ${price(t.price)}`;
        tone = "bet";
      } else if (t.tier === "t1") {
        text = `Priced out · ${call}`;
        tone = "lean";
      } else if (t.tier === "lean") {
        text = `Tracking only · ${call}`;
        tone = "lean";
      } else text = t.tier === "split" ? "Models split" : t.tier === "one" ? "One model only" : "No line";
      let result: SearchRow["result"];
      if (f && t.side && t.ref?.total !== undefined) {
        const pts = f.home + f.away;
        result = pts === t.ref.total ? "P" : (pts > t.ref.total) === (t.side === "over") ? "W" : "L";
        text += ` · ${pts} scored`;
        if (t.stake) tone = result;
      }
      rows.push({ market: "Total", text, tone, result });
    }

    const teams = [g.away, g.home];
    const terms = teams.flatMap((k) => [k, name(k), r.league === "nfl" ? (FULL_NFL[k] ?? "") : ""]).join(" ");
    return {
      key,
      title: `${name(g.away)} at ${name(g.home)}`,
      meta: f ? `Final ${name(g.away)} ${f.away}, ${name(g.home)} ${f.home}` : `${kickoffEt(g.ref?.kickoff)}${g.ref ? ` · ${name(g.home)} ${line(g.ref.line)}` : ""}`,
      terms: terms.toLowerCase(),
      rank: rows.some((x) => x.tone === "bet") ? 0 : f ? 2 : 1,
      rows,
    };
  });
}
