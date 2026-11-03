"""确认两个待修点的真实形态，避免"按想象改代码"。

1. 音量 range：80x4 是否真的可点？滑块 thumb 到底有没有被渲染？
2. PlayerBar 里 "未在播放" 为什么 scrollWidth=64 而 clientWidth=1？
"""
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:9701"

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_init_script(
        "localStorage.setItem('lx.user.token','stub-token');"
        "localStorage.setItem('lx.user.name','tester');"
    )
    page = ctx.new_page()
    page.goto(BASE + "/app/", wait_until="load")
    page.wait_for_timeout(2500)

    info = page.evaluate(
        """() => {
        const r = document.querySelector('input[type=range][aria-label="音量"]');
        if (!r) return { found: false };
        const cs = getComputedStyle(r);
        const rect = r.getBoundingClientRect();
        return {
          found: true,
          rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
          appearance: cs.appearance + '/' + cs.webkitAppearance,
          bg: cs.background.slice(0, 120),
          cursor: cs.cursor,
          // thumb 伪元素无法直接取尺寸，这里量"在轨道上不同 x 处的可点元素"
        };
      }"""
    )
    print("音量 range:", info)

    # 量：滑块两端各点一下，看命中的是不是 range 自己（说明轨道区域可点）
    if info.get("found"):
        x, y, w, h = info["rect"]
        for dx in (2, w // 2, w - 2):
            hit = page.evaluate(
                "([x,y]) => { const e = document.elementFromPoint(x,y); return e ? e.tagName.toLowerCase() + '/' + (e.getAttribute('type')||'') : null; }",
                [x + dx, y + h // 2],
            )
            print(f"  点 (x+{dx}, 中心y) -> {hit}")

    # 裁切文本
    clip = page.evaluate(
        """() => {
        const els = [...document.querySelectorAll('body *')].filter(el => {
          const cs = getComputedStyle(el);
          return cs.overflowX === 'hidden' && el.clientWidth > 0 &&
                 el.scrollWidth > el.clientWidth + 4 && (el.textContent||'').trim();
        }).map(el => {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return { cls: (typeof el.className==='string'?el.className:'').slice(0,90),
                   text: el.textContent.trim().slice(0,30),
                   scrollW: el.scrollWidth, clientW: el.clientWidth,
                   rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
                   textOverflow: cs.textOverflow, whiteSpace: cs.whiteSpace };
        });
        return els.slice(0, 6);
      }"""
    )
    print("\n裁切元素:")
    for c in clip:
        print("  ", c)

    page.screenshot(path="scripts/ui-audit/shots/_playerbar.png",
                    clip={"x": 0, "y": 830, "width": 1440, "height": 70})
    b.close()
