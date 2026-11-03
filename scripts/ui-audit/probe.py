"""定点探针：把截图里"看着不对"的地方落到具体元素上。

截图只能说明"这一块是橙色的"，说明不了"这是哪个元素、为什么在这"。
这个脚本用 elementFromPoint 把坐标反查成 DOM，再用 getBoundingClientRect
与计算样式解释成因 —— 避免凭截图猜一个不存在的 bug。

用法：
    python scripts/ui-audit/probe.py            # 默认手机 390x844
    python scripts/ui-audit/probe.py 390 844
"""
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:9701"
W = int(sys.argv[1]) if len(sys.argv) > 1 else 390
H = int(sys.argv[2]) if len(sys.argv) > 2 else 844

PROBE_JS = r"""
({ x, y }) => {
  const el = document.elementFromPoint(x, y);
  if (!el) return { x, y, el: null };
  const chain = [];
  let n = el;
  for (let i = 0; i < 5 && n; i++) {
    const cs = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    chain.push({
      tag: n.tagName.toLowerCase(),
      cls: (typeof n.className === 'string' ? n.className : '').slice(0, 90),
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      bg: cs.backgroundColor,
      bgImg: (cs.backgroundImage || 'none').slice(0, 110),
      position: cs.position,
      z: cs.zIndex,
      overflow: cs.overflow,
    });
    n = n.parentElement;
  }
  return { x, y, chain };
}
"""

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": W, "height": H})
    ctx.add_init_script(
        "localStorage.setItem('lx.user.token','stub-token');"
        "localStorage.setItem('lx.user.name','tester');"
    )
    page = ctx.new_page()
    page.goto(BASE + "/app/", wait_until="load")
    page.wait_for_timeout(2500)

    print(f"viewport {W}x{H}")
    # 底部 10px、中部、tabbar 区域各探一次
    for y in [H - 6, H - 30, H - 60, H - 100]:
        r = page.evaluate(PROBE_JS, {"x": W // 2, "y": y})
        print(f"\n=== point ({r['x']}, {y}) ===")
        for i, c in enumerate(r["chain"] or []):
            print(f"  {'↑' if i else '·'} <{c['tag']}> rect={c['rect']} pos={c['position']} z={c['z']}")
            print(f"      bg={c['bg']}  bgImg={c['bgImg']}")
            print(f"      cls={c['cls']}")

    # 全页最高的 z-index 固定元素
    fixed = page.evaluate(
        """() => [...document.querySelectorAll('body *')].filter(el => {
            const cs = getComputedStyle(el);
            return (cs.position === 'fixed' || cs.position === 'sticky') && cs.display !== 'none';
        }).map(el => {
            const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
            return { tag: el.tagName.toLowerCase(),
                     cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
                     rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
                     pos: cs.position, z: cs.zIndex, bg: cs.backgroundColor };
        })"""
    )
    print("\n=== fixed/sticky 元素 ===")
    for f in fixed:
        print(f"  <{f['tag']}> rect={f['rect']} pos={f['pos']} z={f['z']} bg={f['bg']}")
        print(f"      {f['cls']}")

    b.close()
