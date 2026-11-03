import json
import sys
sys.stdout.reconfigure(encoding="utf-8")

d = json.load(open("scripts/ui-audit/shots/report.json", encoding="utf-8"))

print("--- 超出视口 明细 ---")
for e in d["routes"]:
    it = e.get("outOfView") or []
    if it:
        print(f"[{e['vp']}] {e['route']}  ({len(it)})")
        for x in it[:10]:
            print("   ", x["tag"], repr(x["text"][:20]), "left=", x["left"], "right=", x["right"],
                  "overR=", x["overRight"], "overL=", x["overLeft"])

print()
print("--- 触摸目标 warn(24-44) 抽样 ---")
for e in d["routes"]:
    it = [x for x in (e.get("touch") or []) if x["level"] == "warn"]
    if it:
        print(f"[{e['vp']}] {e['route']}: {len(it)} 处")
        for x in it[:6]:
            print(f"    {x['w']}x{x['h']}  {x['text'][:28]}  {x['sel']}")

print()
print("--- 其他 ---")
for e in d["routes"]:
    nn = e.get("noAccessibleName") or []
    ct = e.get("clippedText") or []
    ia = e.get("imgNoAlt") or []
    if nn or ct or ia:
        print(f"[{e['vp']}] {e['route']}: noName={len(nn)} clipped={len(ct)} imgNoAlt={len(ia)}")
        for x in nn[:4]:
            print("    noName:", x["sel"], "|", x["html"][:70])
        for x in ct[:4]:
            print("    clipped:", repr(x["text"][:30]), x["scrollW"], x["clientW"])

print()
print("console errors:", len(d["consoleErrors"]), "failed reqs:", len(d["failedRequests"]))
for x in d["consoleErrors"][:8]:
    print("   ", x["vp"], x["text"][:150])
for x in d["failedRequests"][:8]:
    print("   REQ", x["url"][:100], x["err"])
