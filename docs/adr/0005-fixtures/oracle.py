"""Independent oracle #1 (Python zoneinfo) for ADR 0005 common-free-time cases."""
import json, sys
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

def parse_local(s, tz):
    return datetime.fromisoformat(s).replace(tzinfo=ZoneInfo(tz))

def day_window(d, ws, we, gtz):
    z = ZoneInfo(gtz)
    start = datetime(d.year, d.month, d.day, tzinfo=z) + timedelta(minutes=0)
    # wall-clock minutes -> resolve via wall time, not elapsed (DST-safe)
    def wall(m):
        if m == 1440:
            n = d + timedelta(days=1)
            return datetime(n.year, n.month, n.day, tzinfo=z)
        return datetime(d.year, d.month, d.day, m // 60, m % 60, tzinfo=z)
    return wall(ws).astimezone(timezone.utc), wall(we).astimezone(timezone.utc)

def fmt(inst, d, gtz):
    loc = inst.astimezone(ZoneInfo(gtz))
    if loc.date() > d:
        return "24:00"
    return loc.strftime("%H:%M")

def run(case):
    gtz = case.get("gtz", "Asia/Bangkok")
    ws, we = case.get("window", [480, 1320])
    mn = case.get("min", 120)
    members = case["members"]
    d0, d1 = date.fromisoformat(case["from"]), date.fromisoformat(case["to"])
    out = []
    d = d0
    while d <= d1:
        W0, W1 = day_window(d, ws, we, gtz)
        per = {}
        allday = set()
        for b in case["busy"]:
            if b["u"] not in members:
                continue
            tz = b.get("tz", gtz)
            if b["k"] == "d":
                if date.fromisoformat(b["s"]) <= d <= date.fromisoformat(b["e"]):
                    allday.add(b["u"])
            else:
                s = parse_local(b["s"], tz).astimezone(timezone.utc)
                e = parse_local(b["e"], tz).astimezone(timezone.utc)
                s, e = max(s, W0), min(e, W1)
                if s < e:
                    per.setdefault(b["u"], []).append((s, e))
        def free_of(intervals):
            iv = sorted(intervals)
            merged = []
            for s, e in iv:
                if merged and s <= merged[-1][1]:
                    merged[-1] = (merged[-1][0], max(merged[-1][1], e))
                else:
                    merged.append((s, e))
            segs, cur = [], W0
            for s, e in merged:
                if s > cur: segs.append((cur, s))
                cur = max(cur, e)
            if cur < W1: segs.append((cur, W1))
            return [(s, e) for s, e in segs if (e - s) >= timedelta(minutes=mn)]
        free_members = [m for m in members if m not in allday and free_of(per.get(m, []))]
        if allday:
            common = []
        else:
            common = free_of([x for m in members for x in per.get(m, [])])
        out.append({
            "date": d.isoformat(),
            "free": f"{len(free_members)}/{len(members)}",
            "all_free": bool(common),
            "segments": [f"{fmt(s,d,gtz)}-{fmt(e,d,gtz)}({int((e-s).total_seconds()//60)})" for s, e in common],
        })
        d += timedelta(days=1)
    return out

cases = json.load(open(sys.argv[1]))
res = {c["id"]: run(c) for c in cases}
print(json.dumps(res, indent=1, ensure_ascii=False))
