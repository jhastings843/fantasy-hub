"""CFB ATS: are top-25 matchups harder to beat than the rest?

Reads only the local history cache (.cache/cfb: CFBD schedules with pregame
Elo, and multi-book spreads with openers). No network, no Redis.

"Top-25 matchup" is a PROXY: both teams inside the week's top 25 FBS teams by
pregame Elo. The cache has no AP poll, so this is not the real ranking.

Run from the repo root:  python3 -I research/pickem-cfb-ats.py
"""
import csv
import gzip
import math
import statistics as st
import sys
from collections import defaultdict

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
SEASONS = range(2019, 2026)
HFA_ELO = 55  # Elo points for home field; 25 Elo ~ 1 point of spread (538 convention)

games = {}
for s in SEASONS:
    with open(f"{ROOT}/.cache/cfb/sched-{s}.csv") as f:
        for r in csv.DictReader(f):
            if r["season_type"] != "regular" or r["completed"] != "TRUE":
                continue
            if r["home_division"] != "fbs" or r["away_division"] != "fbs":
                continue
            try:
                g = dict(
                    season=s, week=int(r["week"]), home=r["home_team"], away=r["away_team"],
                    hp=int(r["home_points"]), ap=int(r["away_points"]),
                    he=float(r["home_pregame_elo"]), ae=float(r["away_pregame_elo"]),
                    neutral=r["neutral_site"] == "TRUE",
                )
            except ValueError:
                continue
            games[r["game_id"]] = g

# Weekly Elo rank across FBS teams playing that week.
byweek = defaultdict(dict)
for g in games.values():
    byweek[(g["season"], g["week"])][g["home"]] = g["he"]
    byweek[(g["season"], g["week"])][g["away"]] = g["ae"]
rank = {}
for k, teams in byweek.items():
    for i, (t, _) in enumerate(sorted(teams.items(), key=lambda x: -x[1])):
        rank[(k, t)] = i + 1

close = defaultdict(list)
opener = defaultdict(list)
with gzip.open(f"{ROOT}/.cache/cfb/lines.csv.gz", "rt") as f:
    for r in csv.DictReader(f):
        if r["market_type"] != "spread" or r["game_id"] not in games:
            continue
        g = games[r["game_id"]]
        if r["abbr"] != g["home"]:
            continue
        if r["lines"]:
            close[r["game_id"]].append(float(r["lines"]))
        if r["opening_lines"]:
            opener[r["game_id"]].append(float(r["opening_lines"]))


def ats(margin_plus_line, side):
    v = margin_plus_line if side == "home" else -margin_plus_line
    return "W" if v > 0 else "L" if v < 0 else "P"


rows = []
for gid, g in games.items():
    if not close.get(gid):
        continue
    c = st.median(close[gid])
    o = st.median(opener[gid]) if opener.get(gid) else None
    elo_spread = -((g["he"] + (0 if g["neutral"] else HFA_ELO)) - g["ae"]) / 25  # home-side line
    wk = (g["season"], g["week"])
    both25 = rank[(wk, g["home"])] <= 25 and rank[(wk, g["away"])] <= 25
    one25 = (rank[(wk, g["home"])] <= 25) != (rank[(wk, g["away"])] <= 25)
    rows.append(dict(g, close=c, open=o, elo=elo_spread, group="both top-25" if both25 else "one top-25" if one25 else "neither"))


def tally(res):
    w = res.count("W"); l = res.count("L"); n = w + l
    if not n:
        return "0-0"
    p = w / n
    z = (w - n / 2) / math.sqrt(n / 4)
    return f"{w}-{l} {100*p:.1f}% (z vs 50% {z:+.2f}, n {n})"


print("Seasons 2019-2025, regular season, FBS v FBS, median close across books\n")
for grp in ["both top-25", "one top-25", "neither"]:
    rs = [r for r in rows if r["group"] == grp]
    print(f"== {grp}: {len(rs)} games")
    fav = [ats(r["hp"] - r["ap"] + r["close"], "home" if r["close"] < 0 else "away") for r in rs if r["close"] != 0]
    home = [ats(r["hp"] - r["ap"] + r["close"], "home") for r in rs if not r["neutral"]]
    print("  favorite ATS:      ", tally(fav))
    print("  home team ATS:     ", tally(home))
    # Simple rating model (pregame Elo) vs the close, every game and 3+ pts off.
    for edge in (0, 3, 7):
        res = [ats(r["hp"] - r["ap"] + r["close"], "home" if r["elo"] < r["close"] else "away")
               for r in rs if abs(r["elo"] - r["close"]) >= max(edge, 0.01)]
        print(f"  Elo model edge {edge}+:", tally(res))
    # Stale number: side the line later moved toward, taken at the opener, graded at the opener.
    mv = [r for r in rs if r["open"] is not None and r["close"] != r["open"]]
    stale = [ats(r["hp"] - r["ap"] + r["open"], "home" if r["close"] < r["open"] else "away") for r in mv]
    atclose = [ats(r["hp"] - r["ap"] + r["close"], "home" if r["close"] < r["open"] else "away") for r in mv]
    print("  line-move side at OPEN: ", tally(stale))
    print("  same side at CLOSE:     ", tally(atclose))
    if mv:
        print(f"  avg |open-close| move: {st.mean(abs(r['close'] - r['open']) for r in mv):.2f} pts on {len(mv)} moved games")
    resid = [r["hp"] - r["ap"] + r["close"] for r in rs]
    print(f"  close miss (SD of margin+line): {st.pstdev(resid):.2f} pts\n")
