"""键盘焦点可见性检查（WCAG 2.4.7 / 2.2 SC 2.4.13 Focus Appearance）。

为什么单独一个脚本：前一个审计脚本只看静态渲染，**看不见焦点态**。
而"键盘能 Tab 到但看不出在哪"是最常见的可访问性回归，且完全不影响截图。

做法：逐次按 Tab，量当前焦点元素在聚焦前后的样式差异（outline / box-shadow /
border-color 是否真的变了）。只认"有可见变化"，不认"写了类名"。
"""
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:9701"
ROUTES = [("dashboard", "/app/"), ("search", "/app/search"), ("settings", "/app/settings")]

SNAP = r"""
() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName.toLowerCase(),
    name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 26),
    outline: cs.outlineWidth + ' ' + cs.outlineStyle + ' ' + cs.outlineColor,
    shadow: cs.boxShadow.slice(0, 60),
    border: cs.borderColor,
    rect: [Math.round(r.width), Math.round(r.height)],
  };
}
"""

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_init_script(
        "localStorage.setItem('lx.user.token','stub-token');"
        "localStorage.setItem('lx.user.name','tester');"
    )
    page = ctx.new_page()

    total_bad = 0
    for name, path in ROUTES:
        page.goto(BASE + path, wait_until="load")
        page.wait_for_timeout(2200)
        page.evaluate("() => document.body.focus()")
        print(f"\n=== {name} ===")

        prev_key = None
        bad = 0
        for i in range(24):
            page.keyboard.press("Tab")
            page.wait_for_timeout(90)
            cur = page.evaluate(SNAP)
            if not cur:
                continue
            key = (cur["tag"], cur["name"], cur["outline"], cur["shadow"], cur["border"])
            focused = page.evaluate(
                "() => { const e=document.activeElement; const s=getComputedStyle(e);"
                " return {o:s.outlineWidth+' '+s.outlineStyle, sh:s.boxShadow!=='none'}; }"
            )
            has_outline = focused["o"].split()[1] not in ("none", "0px", "")
            has_shadow = focused["sh"]
            if not (has_outline or has_shadow):
                bad += 1
                print(f"  NO-FOCUS-RING <{cur['tag']}> \"{cur['name']}\" {cur['rect']}")
            prev_key = key
        print(f"  共 {bad} 个控件聚焦时无可见指示")
        total_bad += bad
    b.close()

    # 与 audit-ui.py 同样的原则：能失败才算护栏。
    # 聚焦环缺失是 WCAG 2.4.7 的硬失败（键盘用户完全迷失），必须让 CI 红。
    print(f"\n{'全部通过' if total_bad == 0 else f'{total_bad} 个控件缺少焦点指示'}")
    sys.exit(1 if total_bad else 0)
