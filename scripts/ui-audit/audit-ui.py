"""前端 UI 审查台：离线、可复现、有断言（不是"看一眼截图"）。

【为什么需要它】
仓库已有 scripts/menu-fit/verify-menu-fit.py 证明了这条路可行：
static-fixture-server.mjs 提供构建产物 + 桩接口，Playwright 注入登录态，
于是**完全离线**也能把页面真实跑起来。本脚本沿用同一套骨架，
但把检查面从"音质菜单"扩到全站：

  1. 横向溢出（手机上一个不受控的宽元素会整页横滑）
  2. 元素超出视口（被裁掉但 is_visible() 仍为 true —— 截图看不出来的那类）
  3. 对比度（WCAG AA：正文 4.5:1、大字 3:1）
  4. 触摸目标（WCAG 2.2 AA 2.5.8 最小 24x24；44x44 为 iOS HIG 建议值）
  5. 无障碍名称（纯图标按钮必须有 aria-label / title）
  6. 图片缺 alt、文本被硬裁
  7. 控制台错误与失败请求

【设计取舍】
- 对比度用**计算样式**而不是截图取色：截图受抗锯齿/次像素影响，且渐变背景
  无法可靠采样。代价是 background-image 上的文字无法判定 —— 这类一律标
  UNKNOWN 并跳过，**宁可漏报也不误报**（误报会让人不再信任报告）。
- 尺寸断言量 bounding_box()，不信 CSS 类名。

用法：
    python scripts/ui-audit/audit-ui.py [baseUrl] [--out DIR]
    # 需先起桩服务：node scripts/menu-fit/static-fixture-server.mjs 9701
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:9701"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
# 路由前缀：离线桩与线上都用 /app/，但保留成参数，便于审计其它部署路径。
APP = os.environ.get("AUDIT_APP_PREFIX", "/app")

# 【为什么手写解析而不是 `elif not a.startswith("--")`】
# 第一版就是那个写法，于是 `--out G:\...\audit-live` 里的值被当成 BASE，
# 变成 BASE="G:\projects\..."①之后 playwright 报
# `Protocol "g:" not supported`，24 条路由全部渲染失败；②汇总里只有
# 「渲染报错 24」，对比度/触摸目标都是 0 —— 一份**看起来全绿但毫无意义**的
# 报告。选项值必须整体消费掉，不能漏给位置参数。
_i = 1
while _i < len(sys.argv):
    a = sys.argv[_i]
    if a == "--out" and _i + 1 < len(sys.argv):
        OUT = sys.argv[_i + 1]
        _i += 2
        continue
    if a == "--app" and _i + 1 < len(sys.argv):
        APP = sys.argv[_i + 1]
        _i += 2
        continue
    if not a.startswith("--"):
        BASE = a
    _i += 1

BASE = BASE.rstrip("/")
APP = APP.rstrip("/")
if not BASE.startswith("http"):
    raise SystemExit(f"[ui-audit] BASE 不合法: {BASE!r}（应为 http(s)://host:port）")
os.makedirs(OUT, exist_ok=True)

# 桌面 / 平板 / 手机三档。768 是仓库 tailwind 的 md 断点，1024 是 lg，
# 断点前后各取一个值，才能抓到"刚好跨断点"的布局塌陷。
VIEWPORTS = [
    ("desktop", 1440, 900),
    ("tablet", 834, 1112),
    ("phone", 390, 844),
]

ROUTES = [
    ("dashboard", f"{APP}/"),
    ("search", f"{APP}/search?q=%E5%91%A8%E6%9D%B0%E4%BC%A6"),
    ("playlist", f"{APP}/playlist"),
    ("leaderboard", f"{APP}/leaderboard"),
    ("history", f"{APP}/history"),
    ("local", f"{APP}/local"),
    ("settings", f"{APP}/settings"),
    ("nowplaying", f"{APP}/now-playing"),
]

# ===== 页面内执行的审计脚本 =====
AUDIT_JS = r"""
() => {
  const out = {};

  // ---------- 工具 ----------
  const parseColor = (s) => {
    if (!s) return null;
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (p.length < 3) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({          // fg 叠在 bg 上（alpha 合成）
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  const cssPath = (el) => {
    const parts = [];
    let n = el;
    let depth = 0;
    while (n && n.nodeType === 1 && depth < 6) {
      let s = n.tagName.toLowerCase();
      if (n.id) { parts.unshift(s + '#' + n.id); break; }
      const cls = (n.className && typeof n.className === 'string')
        ? n.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      if (cls) s += '.' + cls;
      parts.unshift(s);
      n = n.parentElement;
      depth++;
    }
    return parts.join(' > ');
  };

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    // sr-only：1×1 的读屏专用文本，本来就不该显示，也不是"被裁切"
    if (el.classList && el.classList.contains('sr-only')) return false;
    return true;
  };

  // 祖先里是否有一个「可横向滚动」的容器：这类元素的超出是设计的一部分
  // （心情电台那一排 chip 就是 overflow-x-auto 横向滑），不该报溢出。
  const inScroller = (el) => {
    let n = el.parentElement;
    while (n && n !== document.body) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
      n = n.parentElement;
    }
    return false;
  };

  // 向上找到"真实可见"的背景色；遇到 background-image 返回 null（不可判定）
  const effectiveBg = (el) => {
    let acc = { r: 255, g: 255, b: 255, a: 1 };  // 画布默认白
    const stack = [];
    let n = el;
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = parseColor(cs.backgroundColor);
      if (c && c.a > 0) {
        stack.push(c);
        if (c.a >= 0.999) break;
      }
      n = n.parentElement;
    }
    for (let i = stack.length - 1; i >= 0; i--) acc = over(stack[i], acc);
    return acc;
  };

  // ---------- 1. 横向溢出 ----------
  const de = document.documentElement;
  out.horizontalOverflow = {
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    overflow: de.scrollWidth - de.clientWidth,
  };

  // ---------- 2. 超出视口的元素（被裁，但 visible 仍为 true）----------
  const vw = de.clientWidth, vh = window.innerHeight;
  const outOfView = [];
  document.querySelectorAll('body *').forEach((el) => {
    if (outOfView.length > 40) return;
    if (!visible(el)) return;
    if (inScroller(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const overRight = r.right - vw;
    const overLeft = -r.left;
    if (overRight > 2 || overLeft > 2) {
      outOfView.push({
        sel: cssPath(el),
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 30),
        left: Math.round(r.left), right: Math.round(r.right),
        overRight: Math.round(overRight), overLeft: Math.round(overLeft),
      });
    }
  });
  out.outOfView = outOfView;

  // ---------- 3. 对比度 ----------
  const contrast = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = (node.nodeValue || '').trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el || !visible(el)) continue;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;

    const cs = getComputedStyle(el);
    // 文字被裁切/透明的直接跳过
    if (parseFloat(cs.fontSize) === 0) continue;

    const fgRaw = parseColor(cs.color);
    if (!fgRaw) continue;
    const bg = effectiveBg(el);
    if (!bg) continue;                       // 渐变/图片背景：不可判定
    const fg = fgRaw.a >= 0.999 ? fgRaw : over(fgRaw, bg);
    const r = ratio(fg, bg);

    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = isLarge ? 3.0 : 4.5;

    if (r < need) {
      const key = cssPath(el) + '|' + text.slice(0, 20);
      if (seen.has(key)) continue;
      seen.add(key);
      contrast.push({
        sel: cssPath(el),
        text: text.slice(0, 40),
        color: cs.color,
        bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
        fontSize: size,
        weight,
        ratio: Math.round(r * 100) / 100,
        need,
      });
    }
  }
  out.contrast = contrast;

  // ---------- 4. 触摸目标 ----------
  const interactiveSel = 'a[href], button, input:not([type=hidden]), select, textarea, [role="button"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"], summary';
  const small = [];
  document.querySelectorAll(interactiveSel).forEach((el) => {
    if (!visible(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    // 行内文字链接按 WCAG 2.5.8 有例外，跳过
    const cs = getComputedStyle(el);
    if (cs.display === 'inline') return;
    const w = Math.round(r.width), h = Math.round(r.height);
    if (w < 24 || h < 24) {
      small.push({ sel: cssPath(el), w, h, text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30), level: 'fail' });
    } else if (w < 44 || h < 44) {
      small.push({ sel: cssPath(el), w, h, text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30), level: 'warn' });
    }
  });
  out.touch = small;

  // ---------- 5. 无障碍名称 ----------
  // 【为什么要自己做名称计算】
  // 第一版只读 aria-label / title / textContent，于是 `aria-labelledby` 指向
  // 兄弟标签的控件（本项目 Radio/Switch 全是这种写法）被误报成"无名称"。
  // 误报比漏报更糟：报告一旦不可信，后面所有结论都会被当成噪音。
  // 这里按 accname 的简化顺序实现：aria-labelledby → aria-label → 原生
  // <label> → 内容 → title，并对 aria-labelledby 解析引用元素文字。
  const accName = (el) => {
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const txt = by
        .split(/\s+/)
        .map((id) => {
          const t = document.getElementById(id);
          return t ? (t.textContent || '').trim() : '';
        })
        .filter(Boolean)
        .join(' ')
        .trim();
      if (txt) return txt;
    }
    const al = el.getAttribute('aria-label');
    if (al && al.trim()) return al.trim();
    if (el.labels && el.labels.length) {
      const t = [...el.labels].map((l) => (l.textContent || '').trim()).join(' ').trim();
      if (t) return t;
    }
    const inner = (el.textContent || '').trim();
    if (inner) return inner;
    const ti = el.getAttribute('title');
    return ti ? ti.trim() : '';
  };

  const noName = [];
  document.querySelectorAll('button, [role="button"], a[href], [role="switch"]').forEach((el) => {
    if (!visible(el)) return;
    const name = accName(el);
    if (!name) noName.push({ sel: cssPath(el), tag: el.tagName.toLowerCase(), html: el.outerHTML.slice(0, 100) });
  });
  out.noAccessibleName = noName.slice(0, 20);

  // ---------- 6. 图片 alt / 文本硬裁 ----------
  out.imgNoAlt = [...document.querySelectorAll('img:not([alt])')]
    .slice(0, 10).map((i) => ({ src: (i.getAttribute('src') || '').slice(0, 60), sel: cssPath(i) }));

  const clipped = [];
  document.querySelectorAll('body *').forEach((el) => {
    if (clipped.length > 20) return;
    if (!visible(el)) return;
    const cs = getComputedStyle(el);
    if (cs.overflowX !== 'hidden' && cs.overflowX !== 'clip') return;
    if (cs.textOverflow === 'ellipsis') return;   // 有省略号是主动设计
    if (el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 0) {
      const txt = (el.textContent || '').trim();
      if (!txt) return;
      clipped.push({ sel: cssPath(el), scrollW: el.scrollWidth, clientW: el.clientWidth, text: txt.slice(0, 40) });
    }
  });
  out.clippedText = clipped;

  return out;
}
"""

report = {"base": BASE, "routes": [], "consoleErrors": [], "failedRequests": []}


def inject_login(ctx):
    """注入登录态。

    【两种模式】
    - 离线桩（默认）：桩服务不校验 token，直接塞一个假的即可。
    - 线上（AUDIT_USER / AUDIT_PASS 环境变量）：必须走真实 /api/login 换真
      token —— 线上 401 会把页面弹回登录门，量到的全是登录页，报告看着
      "全绿"其实毫无意义。真 token 还让「设置」等管理员页面真的渲染出来。
    """
    user = os.environ.get("AUDIT_USER")
    pwd = os.environ.get("AUDIT_PASS")
    token = "stub-token"
    if user and pwd:
        origin = "/".join(BASE.split("/")[:3])
        try:
            r = ctx.request.post(f"{origin}/api/login",
                                 data={"username": user, "password": pwd}, timeout=20000)
            j = r.json() if r.ok else {}
            if j.get("token"):
                token = j["token"]
                print(f"[login] ok user={user} admin={j.get('isAdmin')}")
            else:
                print(f"[login] FAILED status={r.status} — 后续结果不可信")
        except Exception as e:  # noqa: BLE001
            print(f"[login] ERROR {e} — 后续结果不可信")
    ctx.add_init_script(
        "localStorage.setItem('lx.user.token', %s);"
        "localStorage.setItem('lx.user.name', %s);"
        % (json.dumps(token), json.dumps(user or "tester"))
    )


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for vp_name, w, h in VIEWPORTS:
            ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
            inject_login(ctx)
            page = ctx.new_page()

            page.on("console", lambda m: report["consoleErrors"].append(
                {"vp": vp_name, "type": m.type, "text": m.text[:200]}) if m.type == "error" else None)
            page.on("requestfailed", lambda r: report["failedRequests"].append(
                {"vp": vp_name, "url": r.url[:160], "err": (r.failure or "")}))

            for route_name, path in ROUTES:
                entry = {"route": route_name, "vp": vp_name, "path": path}
                try:
                    page.goto(BASE + path, wait_until="load", timeout=30000)
                    page.wait_for_timeout(2200)
                    try:
                        page.evaluate("() => document.fonts.ready")
                    except Exception:
                        pass
                    page.wait_for_timeout(400)

                    entry.update(page.evaluate(AUDIT_JS))

                    shot = os.path.join(OUT, f"{vp_name}-{route_name}.png")
                    page.screenshot(path=shot, full_page=False)
                    entry["shot"] = shot
                except Exception as e:
                    entry["error"] = str(e)[:300]
                report["routes"].append(entry)
            ctx.close()
        browser.close()

    # ---- 汇总 ----
    print("\n" + "=" * 74)
    print("横向溢出")
    print("=" * 74)
    for e in report["routes"]:
        o = e.get("horizontalOverflow")
        if not o:
            continue
        flag = "FAIL" if o["overflow"] > 0 else "ok  "
        print(f"{flag} {e['vp']:<8} {e['route']:<12} scrollW={o['scrollWidth']} clientW={o['clientWidth']} 溢出={o['overflow']}px")

    print("\n" + "=" * 74)
    print("对比度不达标（WCAG AA）")
    print("=" * 74)
    total = 0
    for e in report["routes"]:
        items = e.get("contrast") or []
        if not items:
            continue
        total += len(items)
        print(f"\n[{e['vp']}] {e['route']}  ({len(items)} 处)")
        for it in items[:12]:
            print(f"   {it['ratio']:>5}:1 (需 {it['need']})  {it['fontSize']:.0f}px  \"{it['text'][:26]}\"  fg={it['color']} bg={it['bg']}")
            print(f"          {it['sel']}")
    print(f"\n合计 {total} 处")

    print("\n" + "=" * 74)
    print("触摸目标 < 24px（WCAG 2.2 AA 失败）")
    print("=" * 74)
    for e in report["routes"]:
        items = [x for x in (e.get("touch") or []) if x["level"] == "fail"]
        if not items:
            continue
        print(f"\n[{e['vp']}] {e['route']}")
        for it in items[:10]:
            print(f"   {it['w']}x{it['h']}  \"{it['text'][:30]}\"  {it['sel']}")

    print("\n" + "=" * 74)
    print("超出视口（被裁切）")
    print("=" * 74)
    for e in report["routes"]:
        items = e.get("outOfView") or []
        if not items:
            continue
        print(f"\n[{e['vp']}] {e['route']}  ({len(items)} 处)")
        for it in items[:8]:
            print(f"   overRight={it['overRight']} overLeft={it['overLeft']}  <{it['tag']}> \"{it['text'][:24]}\"")

    print("\n" + "=" * 74)
    print("其他")
    print("=" * 74)
    for e in report["routes"]:
        nn = e.get("noAccessibleName") or []
        ct = e.get("clippedText") or []
        ia = e.get("imgNoAlt") or []
        if nn or ct or ia:
            print(f"[{e['vp']}] {e['route']}: 无名称={len(nn)} 文本硬裁={len(ct)} 图缺alt={len(ia)}")
            for x in ct[:3]:
                print(f"      硬裁: {x['text'][:30]} (scrollW={x['scrollW']} clientW={x['clientW']})")

    errs = [x for x in report["consoleErrors"]]
    print(f"\n控制台错误 {len(errs)} 条，失败请求 {len(report['failedRequests'])} 条")
    for x in errs[:10]:
        print(f"   [{x['vp']}] {x['text'][:140]}")

    with open(os.path.join(OUT, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n报告: {os.path.join(OUT, 'report.json')}")

    # ---- 退出码 ----
    # 【为什么必须有】一个"只打印、永远 exit 0"的护栏接进 CI 等于没接。
    # 这里把「会让人真的受影响」的项算作失败：横向溢出、对比度不达标、
    # 触摸目标小于 24px、控件无无障碍名称。sr-only/装饰性项已在探针里排除。
    fails = {
        "横向溢出": sum(1 for e in report["routes"]
                        if (e.get("horizontalOverflow") or {}).get("overflow", 0) > 0),
        "对比度": sum(len(e.get("contrast") or []) for e in report["routes"]),
        "触摸目标<24": sum(1 for e in report["routes"]
                          for x in (e.get("touch") or []) if x["level"] == "fail"),
        "控件无名称": sum(len(e.get("noAccessibleName") or []) for e in report["routes"]),
        "渲染报错": sum(1 for e in report["routes"] if e.get("error")),
    }
    print("\n" + "-" * 40)
    for k, v in fails.items():
        print(f"{'FAIL' if v else 'ok  '}  {k}: {v}")
    total = sum(fails.values())
    print("-" * 40)
    print(f"{'全部通过' if total == 0 else f'共 {total} 项需处理'}")
    sys.exit(1 if total else 0)


main()
