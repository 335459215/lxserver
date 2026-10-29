"""搜索页返回后不再空白 + 切歌不再「显示 A 播 B」的端到端护栏（可进 CI，完全离线）。

【为什么需要它（2026-10-29 用户报告的两个缺陷）】

① 搜索结果 → 点歌播放 → 进全屏播放页 → 点「返回」→ **搜索页整页空白**，
   必须重新搜一遍。根因：结果全在 SearchPage 的组件本地 state，路由切走即销毁。
   护栏做法：返回后必须仍能看到原来的结果行与关键词。

② 歌单播放时「实际播放的歌曲和显示的歌曲完全不是同一首」，把音质调到最高 +
   打开「自动选最高档」后必然出现。根因有两层：
   - 切歌时 <audio> 仍在播上一首，直到新链接解析完成才换声
   - 跨平台替身匹配太松（同名 Live/伴奏版被当成同一首，单测覆盖）
   护栏做法：切歌后极短时间内断言 <audio> 已卸掉上一首的 src 且已暂停
   （「界面已切到新歌，耳朵不该还在听旧歌」）。

【怎么离线跑】用同目录 static-fixture-server.mjs 的桩接口 + 注入登录态，
不连 NAS、不连任何外网。

用法：
    node scripts/menu-fit/static-fixture-server.mjs 9702 &
    python scripts/menu-fit/verify-search-restore.py http://127.0.0.1:9702
"""
import sys

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover - 环境没装 playwright
    print("SKIP  未安装 playwright（pip install playwright && playwright install chromium）")
    sys.exit(0)

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9702").rstrip("/")

checks = []


def check(name, cond, detail=""):
    checks.append({"name": name, "ok": bool(cond), "detail": detail})
    print(("PASS  " if cond else "FAIL  ") + name + (f"  [{detail}]" if detail else ""))


def inject_login(ctx):
    """直接注入登录态：不依赖真实 /api/login，离线也能过登录门。"""
    ctx.add_init_script(
        """
        localStorage.setItem('lx.user.token', 'stub-token');
        localStorage.setItem('lx.user.name', 'tester');
        """
    )


def rows(page):
    return page.locator("ul li button[aria-label^='播放']")


def goto_search(page, q="周杰伦"):
    page.goto(f"{BASE}/app/search?q={q}", wait_until="load")
    page.wait_for_timeout(2500)


with sync_playwright() as p:
    try:
        browser = p.chromium.launch(headless=True)
    except Exception as e:  # noqa: BLE001 - 浏览器没装好
        print(f"SKIP  无法启动 chromium（未安装？）: {str(e).splitlines()[0][:120]}")
        sys.exit(0)
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    inject_login(ctx)
    page = ctx.new_page()

    # ===================== 缺陷 ① =====================
    goto_search(page)

    n0 = rows(page).count()
    check("初次进入：搜索出结果", n0 > 0, f"{n0} 行")
    if n0 == 0:
        print("\n桩接口没返回结果（登录门或桩服务有问题），无法继续")
        ctx.close()
        browser.close()
        sys.exit(1)

    first_label = rows(page).first.get_attribute("aria-label") or ""

    # 点第一首起播（桩音频 30s）
    rows(page).first.click()
    page.wait_for_timeout(1500)

    # 进全屏播放页（必须走站内 SPA 跳转，page.goto 会整页刷新丢内存态）
    link = page.locator('a[href$="/now-playing"]:visible').first
    if link.count() == 0:
        check("能进入全屏播放页", False, "找不到 /now-playing 入口")
    else:
        link.click()
        page.wait_for_timeout(1500)
        check("能进入全屏播放页", "/now-playing" in page.url, page.url)

        back = page.locator("button[aria-label='返回上一页']").first
        if back.count() == 0:
            check("播放页有返回按钮", False)
        else:
            back.click()
            page.wait_for_timeout(1800)

            check("返回后回到搜索页", "/search" in page.url, page.url)

            n1 = rows(page).count()
            check(
                "【缺陷①】返回后搜索结果仍在（不再是空白）",
                n1 == n0,
                f"返回后 {n1} 行 / 原来 {n0} 行",
            )

            kw = page.locator("input[aria-label='搜索关键词']").input_value()
            check("【缺陷①】返回后关键词仍在输入框", kw == "周杰伦", f"value={kw!r}")

            back_first = ""
            if n1 > 0:
                # 【为什么取 aria-label 而不是 inner_text】列表行里歌名所在的
                # 视觉层带 `pointer-events-none`，Playwright 的 inner_text 在
                # 某些渲染状态下会拿到空串（实测如此），而 aria-label 始终带
                # 「播放 <歌名> - <歌手>」，是稳定可比的。
                back_first = rows(page).first.get_attribute("aria-label") or ""
            check(
                "【缺陷①】返回后第一行仍是同一首",
                back_first == first_label,
                f"{back_first!r} vs {first_label!r}",
            )

    # 【缺陷①的决定性断言：返回后不得重新发起搜索】
    #
    # 为什么不能只看「返回后有没有结果行」：旧实现在挂载时会重新跑一遍搜索，
    # 桩接口是本地即时响应，几十毫秒就补回结果 —— DOM 断言看不出差别。
    # 真实环境里那 5 个上游平台要几百毫秒到几秒，用户看到的就是
    # 「空白 + 重新搜索」。所以真正能区分新旧实现的是**因果**：
    # 返回时若又打了 /api/music/search，就说明它是「重搜」而不是「恢复」。
    page.goto(f"{BASE}/app/search?q=周杰伦", wait_until="load")
    page.wait_for_timeout(2200)
    search_requests = []
    page.on(
        "request",
        lambda r: search_requests.append(r.url) if "/api/music/search" in r.url else None,
    )
    rows(page).first.click()
    page.wait_for_timeout(1000)
    page.locator('a[href$="/now-playing"]:visible').first.click()
    page.wait_for_timeout(1000)
    search_requests.clear()
    page.locator("button[aria-label='返回上一页']").first.click()
    page.wait_for_timeout(2000)
    check(
        "【缺陷①】返回搜索页时不再重新发起搜索（走恢复，不是重搜）",
        len(search_requests) == 0,
        f"返回后新增搜索请求 {len(search_requests)} 个",
    )

    # ===================== 缺陷 ② =====================
    if "/search" not in page.url:
        goto_search(page)
    else:
        # 已在搜索页：刷新到干净状态，避免上一步的播放残留干扰
        goto_search(page)

    r = rows(page)
    if r.count() >= 2:
        r.first.click()
        page.wait_for_timeout(1800)

        before = page.evaluate(
            "() => ({ src: document.querySelector('audio')?.getAttribute('src') || '',"
            " paused: document.querySelector('audio')?.paused })"
        )
        check("起播后 <audio> 已挂上音频", bool(before["src"]), before["src"][:60])

        # 监听 src 的每一次变化：切歌的正确序列必须是
        #   ① 旧 src 先被卸掉（null）+ 已暂停   ← 这一条就是本次修复
        #   ② 之后才挂上新链接
        # 【为什么不能只在一个时间点采样】桩环境的解析是瞬时的，新链接 16ms
        # 就挂上了（实测序列：0ms src=null paused=true → 16ms 新链接 playing）。
        # 任何「等 N 毫秒再看 src 是否为空」的断言都会漏掉这段窗口。
        page.evaluate(
            """() => {
              window.__srcLog = [];
              const a = document.querySelector('audio');
              window.__srcObserver = new MutationObserver(() => {
                window.__srcLog.push({
                  src: a.getAttribute('src'),
                  paused: a.paused,
                });
              });
              window.__srcObserver.observe(a, { attributes: true, attributeFilter: ['src'] });
            }"""
        )

        r.nth(1).click()
        page.wait_for_timeout(1800)

        log = page.evaluate("() => window.__srcLog || []")
        check("切歌触发了 src 变更", len(log) > 0, f"{len(log)} 次")

        # 第一次变化必须是「卸掉旧 src」（null/空）且处于暂停态
        first = log[0] if log else {}
        check(
            "【缺陷②】切歌时先卸掉上一首的音频源（不会继续出声）",
            (first.get("src") in (None, "")) and first.get("paused") is True,
            f"第一次变更: src={first.get('src')!r} paused={first.get('paused')}",
        )

        # 之后才挂上新链接（顺序断言：卸下 → 挂上）
        adopted = any(e.get("src") for e in log)
        check("【缺陷②】随后挂上新曲目的音频源", adopted, f"最终 src={log[-1].get('src') if log else ''!r}")

        page.evaluate("() => window.__srcObserver?.disconnect()")
    else:
        check("桩数据至少两首（切歌断言需要）", False, f"只有 {r.count()} 行")

    ok = all(c["ok"] for c in checks)
    print(f"\n汇总：{sum(c['ok'] for c in checks)}/{len(checks)} 通过")
    ctx.close()
    browser.close()
    sys.exit(0 if ok else 1)
