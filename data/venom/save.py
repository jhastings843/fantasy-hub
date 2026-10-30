import json, sys
# Anytime TD (default): python3 save.py WEEK      rows team|name|pos|score|pct
# Prop boards:          python3 save.py WEEK STAT rows team|name|pos|rank|score
#   STAT is pass_yds, rush_yds or rec (Venom's Pass Yards, Rush Yards, Receptions boards)
week = int(sys.argv[1]); stat = sys.argv[2] if len(sys.argv) > 2 else "attd"; rows = sys.stdin.read()
today = __import__("datetime").date.today().isoformat()
if stat == "attd":
    out = [dict(zip(["team","name","pos","score","p"], r.split("|"))) for r in rows.strip().splitlines()]
    for o in out: o["score"] = float(o["score"]); o["p"] = int(o["p"]) / 100
    source = "Venom Analytics app, Game Vault NFL Anytime TD, top 5 per game, read " + today
else:
    assert stat in ("pass_yds", "rush_yds", "rec"), stat
    out = [dict(zip(["team","name","pos","rank","score"], r.split("|"))) for r in rows.strip().splitlines()]
    for o in out: o["rank"] = int(o["rank"]); o["score"] = float(o["score"])
    source = f"Venom Analytics app, Game Vault NFL {stat} board, top 5 per game (rank, 0-100 score), read " + today
json.dump({"season": 2026, "week": week, "stat": stat, "source": source, "rows": out}, open(f"nfl-{stat}-2026-w{week:02d}.json", "w"), indent=1)
print(week, stat, len(out))
