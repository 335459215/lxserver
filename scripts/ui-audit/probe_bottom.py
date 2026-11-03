"""定位底部橙色条带：谁在画它、画的是什么。

截图里"底部有一条橙色"可能是 toast、可能是渐变、可能是背景图。
这里同时取 DOM 命中和真实像素，两边对齐后才下结论。
"""
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:9701"
W, H = 390, 844

JS = r"""
() => {
  const H = window.innerHeight;
  const out = { toasts: [], olChildren: 0, docBg: getComputedStyle(document.body).backgroundColor };
  const ol = document.querySelector('ol[class*="z-\\[100\\]"]') || document.querySelector('ol');
  if (ol) {
    out.olChildren = ol.children.length;
    out.olHTML = ol.innerHTML.slice(0, 600);
  }
  // 底部 40px 内所有可见元素
  const hits = [];
  document.querySelectorAll('body *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.height === 0 || r.width === 0) return;
    if (r.bottom < H - 40 || r.top > H) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    if (cs.backgroundImage !== 'none' || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent')) {
      hits.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 70),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        bg: cs.backgroundColor,
        bgImg: cs.backgroundImage.slice(0, 140),
      });
    }
  });
  out.bottomHits = hits.slice(0, 25);
  return out;
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
    page.wait_for_timeout(3000)

    import json
    print(json.dumps(page.evaluate(JS), ensure_ascii=False, indent=1)[:4000])

    # 直接量像素：截底部 60px
    page.screenshot(path="scripts/ui-audit/shots/_bottom.png", clip={"x": 0, "y": H - 60, "width": W, "height": 60})
    print("\n底部条带截图: scripts/ui-audit/shots/_bottom.png")
    b.close()
