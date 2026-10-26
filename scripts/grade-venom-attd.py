# Grade Venom's anytime TD picks (data/venom/nfl-attd-*.json) against nflverse
# (.cache/nfl/stats_player_week_2026.csv) and next to our walk-forward model on
# the same player-games (.cache/attd-ours-2026.json from fit-anytime-td.mts).
#   python3 scripts/grade-venom-attd.py
import json, csv, re, math, glob, statistics
def key(s): return re.sub(r'[^a-z]', '', re.sub(r'\s+(jr|sr|ii|iii|iv|v)\.?$', '', s.strip(), flags=re.I).lower())
td = {}
for r in csv.DictReader(open('.cache/nfl/stats_player_week_2026.csv')):
    td[(int(r['week']), key(r['player_display_name']))] = sum(float(r.get(c) or 0) for c in ('rushing_tds', 'receiving_tds', 'special_teams_tds'))
ours = {}
for k, v in json.load(open('.cache/attd-ours-2026.json')).items():
    w, n = k.split('|', 1); ours[(int(w), key(n))] = v['p']
rows, miss = [], []
for f in sorted(glob.glob('data/venom/nfl-attd-2026-w*.json')):
    d = json.load(open(f))
    for o in d['rows']:
        k = (d['week'], key(o['name']))
        if k not in td: miss.append(f"w{d['week']} {o['name']}"); continue
        rows.append({'w': d['week'], 'name': o['name'], 'v': o['p'], 'o': ours.get(k), 'y': 1 if td[k] > 0 else 0})
ll = lambda xs, f: -sum(math.log(max(1e-6, f(x) if x['y'] else 1 - f(x))) for x in xs) / len(xs)
n = len(rows); hits = sum(x['y'] for x in rows)
print(f"Venom picks graded {n} (not in box score: {len(miss)}), scored {hits} ({hits/n:.1%}), Venom said {sum(x['v'] for x in rows)/n:.1%}")
flat = hits / n
print(f"  log loss Venom {ll(rows, lambda x: x['v']):.4f} vs flat {ll(rows, lambda x: flat):.4f}")
for lo, hi in [(0, .3), (.3, .4), (.4, .5), (.5, 1)]:
    b = [x for x in rows if lo <= x['v'] < hi]
    if b: print(f"  Venom {lo:.0%}-{hi:.0%}: n {len(b)}, said {sum(x['v'] for x in b)/len(b):.1%}, scored {sum(x['y'] for x in b)/len(b):.1%}")
both = [x for x in rows if x['o'] is not None]
print(f"\nSame player-games as ours: {len(both)}")
print(f"  log loss Venom {ll(both, lambda x: x['v']):.4f}, ours {ll(both, lambda x: x['o']):.4f}, average {ll(both, lambda x: (x['v']+x['o'])/2):.4f}")
print(f"  corr {statistics.correlation([x['v'] for x in both], [x['o'] for x in both]):.2f}")
for wk in sorted(set(x['w'] for x in both)):
    b = [x for x in both if x['w'] == wk]
    print(f"  wk{wk}: n {len(b)}, Venom {ll(b, lambda x: x['v']):.3f}, ours {ll(b, lambda x: x['o']):.3f}")
# Paired check: per-pick log-loss difference, mean and its standard error.
dif = [(-math.log(max(1e-6, x['v'] if x['y'] else 1-x['v']))) - (-math.log(max(1e-6, x['o'] if x['y'] else 1-x['o']))) for x in both]
m, se = statistics.mean(dif), statistics.stdev(dif) / math.sqrt(len(dif))
print(f"  Venom minus ours per pick: {m:+.4f} (se {se:.4f}, t {m/se:+.2f}); negative = Venom better")
