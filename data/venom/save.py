import json, sys
week = int(sys.argv[1]); rows = sys.stdin.read()
out = [dict(zip(["team","name","pos","score","p"], r.split("|"))) for r in rows.strip().splitlines()]
for o in out: o["score"] = float(o["score"]); o["p"] = int(o["p"]) / 100
json.dump({"season": 2026, "week": week, "source": "Venom Analytics app, Game Vault NFL Anytime TD, top 5 per game, read " + __import__("datetime").date.today().isoformat() + "", "rows": out}, open(f"nfl-attd-2026-w{week:02d}.json", "w"), indent=1)
print(week, len(out))
