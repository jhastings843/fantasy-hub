import json, glob, re, difflib, math, sys
SP = sys.argv[1]
finals = json.load(open(f"{SP}/finals.json"))
graded = json.load(open(f"{SP}/graded.json"))
WEEKDATES = {1: ("20260903", "20260907"), 3: ("20260917", "20260920"), 4: ("20260924", "20260927"), 5: ("20261001", "20261004")}
AL = {"s.": "south ", "n.": "north ", "w.": "west ", "e.": "east ", "ga.": "georgia ", "wash.": "washington ", "st.": "state", "st": "state",
      "bgsu": "bowling green", "cmu": "central michigan", "wmu": "western michigan", "emu": "eastern michigan", "niu": "northern illinois",
      "ucf": "ucf", "pitt": "pittsburgh", "usf": "south florida", "smu": "smu", "tcu": "tcu", "byu": "byu", "unlv": "unlv", "utep": "utep",
      "utsa": "utsa", "uab": "uab", "ecu": "east carolina", "fiu": "florida international", "fau": "florida atlantic", "lsu": "lsu",
      "ole": "ole", "miss": "mississippi", "sdsu": "san diego state", "so": "southern", "uconn": "uconn", "umass": "massachusetts",
      "jmu": "james madison", "app": "appalachian", "nc": "nc", "ul": "louisiana", "caro.": "carolina", "mich.": "michigan", "ill.": "illinois", "sjsu": "san jose state", "nmsu": "new mexico state", "odu": "old dominion", "va.": "virginia", "app.": "appalachian", "miss.": "mississippi"}
def norm(s):
    s = s.lower().replace("&", "and").replace("'", "").replace("é", "e")
    toks = []
    for t in s.split():
        toks.append(AL.get(t, t))
    s = " ".join(toks)
    s = re.sub(r"\s+", " ", s).strip()
    s = s.replace("mississippi state", "mississippi state").replace("ole mississippi", "ole miss")
    s = s.replace("texas aandm", "texas a and m").replace("texas a and m", "texas a and m")
    return s
def best(name, pool):
    n = norm(name)
    if n in pool: return n
    m = difflib.get_close_matches(n, pool, n=1, cutoff=0.8)
    return m[0] if m else None
def cover(margin_home, home_line):
    v = margin_home + home_line
    return 0 if abs(v) < 1e-9 else (1 if v > 0 else -1)
def wilson(w, n, z=1.645):
    if n == 0: return (0, 0)
    p = w / n; d = 1 + z*z/n; c = p + z*z/(2*n); r = z*math.sqrt(p*(1-p)/n + z*z/(4*n*n))
    return ((c - r)/d, (c + r)/d)
rows = []
for wk, (a, b) in WEEKDATES.items():
    try: sheet = json.load(open(f"{SP}/w{wk}.json"))
    except FileNotFoundError: print("missing week", wk); continue
    fw = [f for f in finals if a <= f["date"] <= b]
    pool = {}
    for f in fw:
        for k in ("home", "homeShort"):
            if f.get(k): pool[norm(f[k])] = f
    unmatched = []
    for g in sheet:
        if g.get("average") is None or g.get("spread") is None: continue
        hk = best(g["home"], list(pool))
        f = pool.get(hk) if hk else None
        if not f: unmatched.append(g["home"]); continue
        jline = -g["average"]  # home-side
        line = g["spread"]
        side = "home" if jline < line else "away" if jline > line else None
        res = cover(f["hs"] - f["as"], line)
        win = None if side is None or res == 0 else ((res > 0) == (side == "home"))
        print("   match", wk, g["away"], "@", g["home"], "->", f["away"], "@", f["home"]) if norm(g["home"]) != norm(f["home"]) else None
        rows.append({"week": wk, "home": f["home"], "away": f["away"], "line": line, "john": jline, "side": side, "edge": abs(jline - line), "win": win, "margin": f["hs"] - f["as"]})
    print(f"week {wk}: sheet {len(sheet)}, matched {len([r for r in rows if r['week']==wk])}, unmatched {unmatched}")
def rec(rs):
    w = sum(1 for r in rs if r["win"] is True); l = sum(1 for r in rs if r["win"] is False)
    lo, hi = wilson(w, w + l)
    return f"{w}-{l} ({w/(w+l)*100:.1f}%, 90% range {lo*100:.0f}-{hi*100:.0f}%)" if w + l else "0-0"
print("\nHARRIS ALONE vs his sheet line (all matched games):", rec(rows))
for t in (2, 3, 4):
    print(f"  edge >= {t}:", rec([r for r in rows if r["edge"] >= t]))
# agreement with Sam & David (weeks 4-5, our graded rows)
gi = {}
for g in graded: gi[(g["week"], g["home"])] = g
def gkey(r):
    for (wk, h), g in gi.items():
        if wk == r["week"] and difflib.SequenceMatcher(None, norm(h), norm(r["home"])).ratio() > 0.85: return g
    return None
both = []
for r in rows:
    if r["week"] not in (4, 5): continue
    g = gkey(r)
    if not g or not g.get("read"): continue
    rd = g["read"]
    mkt = g["sam"]["market"]  # home-side, Sam's source line
    jside = "home" if r["john"] < mkt else "away" if r["john"] > mkt else None
    sres = g.get("samResult")  # W/L/P of Sam's side at his line
    agree = rd.get("agree"); sdside = rd.get("samSide") if agree else None
    # grade the Sam+David side at the market line using the final
    res = cover(r["margin"], mkt)
    sdwin = None if not sdside or res == 0 else ((res > 0) == (sdside == "home"))
    both.append({"agree": agree, "sdside": sdside, "jside": jside, "sdwin": sdwin})
ag = [b for b in both if b["agree"] and b["sdwin"] is not None]
def rr(bs):
    w = sum(b["sdwin"] for b in bs); n = len(bs); lo, hi = wilson(w, n)
    return f"{w}-{n-w} ({w/n*100:.1f}%, 90% range {lo*100:.0f}-{hi*100:.0f}%)" if n else "0-0"
print(f"\nWEEKS 4-5 joined with Sam/David: {len(both)} games; Sam+David agree and decided: {len(ag)}")
print("  Sam+David agree, all:", rr(ag))
print("  ...and Harris agrees:", rr([b for b in ag if b["jside"] == b["sdside"]]))
print("  ...and Harris disagrees:", rr([b for b in ag if b["jside"] and b["jside"] != b["sdside"]]))
json.dump(rows, open(f"{SP}/harris-rows.json", "w"))
