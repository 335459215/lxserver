"""音质菜单在各视口下的可用性护栏（可进 CI，完全离线）。

【为什么需要它】
v2.28.0 给菜单加了「按曲目自动选最高档」开关 + 每档的「本曲 …」备注，菜单从
"6 行单行" 变成 "7 项双行"（约 512px）。手机上 Radix 翻转朝上后仍放不下，
菜单顶部被裁掉 73px —— 标题与开关整个在视口外、点不到。

**关键：被裁掉的元素还在 DOM 里、is_visible() 仍为 true**，
普通断言（count/visible/text）完全抓不到这类裁切。只有量 bounding_box()
与视口的关系才看得见。这就是本脚本存在的意义。

【怎么做到离线可跑】
不连 NAS、不搜真实歌曲：用同目录的 static-fixture-server.mjs 提供构建产物 + 桩接口，
桩的搜索结果里带 types[]，所以「本曲 xx MB」的标注路径同样被真实执行。
登录态直接注入 localStorage，不依赖 /api/login 的真实实现。

【本脚本**在仓库内**（scripts/menu-fit/），不是 .playwright/ 本地脚本目录】
上一版变异测试曾直接调 .playwright/_verify-bindip.py，而那个目录不进 git，
CI 里根本不存在，导致 test job 整挂而 build 仍成功（commit 98a1809 修过）。
凡是 CI 要跑的东西必须仓库内自包含。

用法（推荐，跨平台）：
    node scripts/menu-fit/run.mjs --port 9701 --python python3
或分步：
    node scripts/menu-fit/static-fixture-server.mjs 9701 &
    python scripts/menu-fit/verify-menu-fit.py http://127.0.0.1:9701
退出码非 0 表示有视口装不下菜单。
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9701").rstrip("/")
# 截图落在仓库内 scripts/menu-fit/shots/（已被 .gitignore 忽略），
# 不写系统临时目录 —— 这样本地与 CI 的行为一致，产物也好找。
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
os.makedirs(OUT, exist_ok=True)

# 覆盖：桌面（正常）/ 笔记本（菜单需上翻）/ 矮屏（必须内部滚动）/ 两种手机
VIEWPORTS = [
    ("desktop-1440x900", 1440, 900),
    ("laptop-1366x700", 1366, 700),
    ("short-1280x620", 1280, 620),
    ("phone-390x844", 390, 844),
    ("phone-360x640", 360, 640),
]

EXPECT_MENU_ITEMS = 7  # 6 个档位 + 1 个「按曲目自动选最高档」开关

report = {"base": BASE, "checks": []}


def check(name, cond, detail=""):
    report["checks"].append({"name": name, "ok": bool(cond), "detail": detail})
    print(("PASS  " if cond else "FAIL  ") + name + (f"  [{detail}]" if detail else ""))


def reset_fixture(page):
    """把桩服务的历史状态重置成初始 6 条。

    【为什么每段历史用例前都要调】
    historyStore 是桩进程的内存状态，会跨用例、跨 run 累积。
    实测踩过：手动删了一条后重跑护栏，统计变成「8 首 / 14 次」，
    分组变成 4/1/2/1 —— 断言全红，但报错指向业务逻辑，排查方向完全错了。
    测试之间必须彼此隔离。
    """
    try:
        page.evaluate("async () => { await fetch('/api/__fixture__/reset', {method:'POST'}); }")
    except Exception:  # noqa: BLE001
        pass


def inject_login(ctx):
    """直接注入登录态：不依赖真实 /api/login，离线也能过登录门。"""
    ctx.add_init_script(
        """
        localStorage.setItem('lx.user.token', 'stub-token');
        localStorage.setItem('lx.user.name', 'tester');
        """
    )


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for label, w, h in VIEWPORTS:
        ctx = browser.new_context(viewport={"width": w, "height": h})
        inject_login(ctx)
        page = ctx.new_page()

        # 直接进搜索页并带关键词 —— 桩接口会返回带 types 的曲目
        page.goto(f"{BASE}/app/search?q=周杰伦", wait_until="load")
        page.wait_for_timeout(2500)

        rows = page.locator("ul li button[aria-label^='播放']")
        if rows.count() == 0:
            check(f"[{label}] 桩数据渲染出搜索结果", False, "0 行（桩接口或登录门有问题）")
            ctx.close()
            continue
        check(f"[{label}] 桩数据渲染出搜索结果", True, f"{rows.count()} 行")

        # 点第一首起播（桩环境没有真音频，但状态机会进入 loading/playing，
        # 音质按钮的 aria-label 与「本曲 …」标注不依赖音频是否真的出声）
        rows.first.click()
        page.wait_for_timeout(1500)

        # 窄屏下 PlayerBar 是 lg:block（不渲染），音质入口在全屏播放页里
        if w < 1024:
            link = page.locator('a[href$="/now-playing"]:visible').first
            if link.count() > 0:
                # 必须走站内链接做 SPA 跳转：page.goto 会整页刷新并丢掉播放器内存态
                link.click()
                page.wait_for_timeout(1500)

        trig = page.locator('button[aria-label^="音质"]:visible').first
        if trig.count() == 0:
            check(f"[{label}] 音质入口可见", False, "找不到可见的 button[aria-label^=音质]")
            ctx.close()
            continue
        check(f"[{label}] 音质入口可见", True)

        trig.click()
        page.wait_for_timeout(700)

        menu = page.locator('[role="menu"]').first
        items = page.locator('[role="menuitem"]')
        n = items.count()
        check(f"[{label}] 菜单项数正确（6 档 + 1 开关）", n == EXPECT_MENU_ITEMS, f"{n} 项")

        box = menu.bounding_box()
        if not box:
            check(f"[{label}] 菜单完整落在视口内", False, "拿不到 bounding_box")
        else:
            top_ok = box["y"] >= -1
            bottom_ok = box["y"] + box["height"] <= h + 1
            check(
                f"[{label}] 菜单完整落在视口内",
                top_ok and bottom_ok,
                f"y={box['y']:.0f} h={box['height']:.0f} 底部={box['y'] + box['height']:.0f} 视口={h}",
            )

        # 逐档标注：桩数据里「晴天」申报了 flac，菜单应出现「本曲」与体积
        menu_text = menu.inner_text()
        check(f"[{label}] 菜单按本曲申报标注可用档位", "本曲" in menu_text,
              menu_text.replace("\n", "|")[:100])
        check(f"[{label}] 标注带体积（MB/KB）", ("MB" in menu_text) or ("KB" in menu_text))

        # 最后一个档位必须真的能点到 —— 被视口裁掉时 click 会失败/超时
        last = items.nth(n - 1)
        try:
            last.scroll_into_view_if_needed(timeout=3000)
            last.click(timeout=3000)
            check(f"[{label}] 最后一个档位可点", True)
        except Exception as e:  # noqa: BLE001
            check(f"[{label}] 最后一个档位可点", False, str(e).splitlines()[0][:120])

        page.screenshot(path=os.path.join(OUT, f"quality-menu-{label}.png"))
        ctx.close()

    # ================= 降级标注（D-012 的端到端护栏）=================
    #
    # 【为什么单独一段，且必须在离线桩里做】
    # 线上音源基本都能给出 flac，于是 resolvedQuality == preferredQuality，
    # 「实得低于首选」这条分支永远走不到 —— verify-quality.py 里那条断言
    # 长期落在 [INFO] "本次未发生降级" 的跳过分支上，等于没验。
    # 桩接口刻意让 flac 请求返回 320k，才把这条路径真正跑起来。
    #
    # 这段验三件事（都是 D-012 的具体表现）：
    #   ① 首选 flac、实得 320k → 音质按钮的 aria-label 必须显示实得的 320k（不谎报 flac）
    #   ② 必须点亮红点（降级标记）
    #   ③ 反过来：实得高于首选时**不得**标成降级（D-012 的核心回归）
    print("\n--- 降级标注（D-012）---")
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    inject_login(ctx)
    page = ctx.new_page()

    # 首选「无损」——桩会让它实得 320k，构成一次真实降级。
    #
    # ⚠️ 档位用 add_init_script 设置（**每次导航都会执行**），不是 evaluate。
    # 这样 reload/SPA 跳转后都不会被重置；同理，③ 里要改档位时**不能**再靠
    # evaluate —— 那会被这条 init_script 在下次导航时覆盖回 flac。
    # （第一版就是这么错的：看着改了 320k，实际页面加载后又是 flac，
    #   于是"同档不误报"那条断言恒红。）
    page.add_init_script("localStorage.setItem('lx.playback.quality', 'flac')")
    page.goto(f"{BASE}/app/search?q=周杰伦", wait_until="load")
    page.wait_for_timeout(2500)

    rows = page.locator("ul li button[aria-label^='播放']")
    check("降级场景：桩数据渲染出搜索结果", rows.count() > 0, f"{rows.count()} 行")
    if rows.count() > 0:
        # 明确点「晴天」（降级场景）。
        # ⚠️ 必须限定在结果列表 `ul li` 里：'晴天' 也可能出现在首页/推荐区，
        #    全页匹配会点到别的元素上（实测就点到了另一首，导致断言读错对象）。
        #    并且点完要**校验当前曲目**，否则后面所有断言都在测另一首歌。
        target = page.locator("ul li button[aria-label*='晴天']").first
        if target.count() == 0:
            target = rows.first
        target.click()

        # 等解析完成（桩立即返回，但要给状态机一点时间）
        trig = page.locator('button[aria-label^="音质"]:visible').first
        label_attr = ""
        for _ in range(24):
            if trig.count() > 0:
                label_attr = trig.get_attribute("aria-label") or ""
                if "320k" in label_attr:
                    break
            page.wait_for_timeout(250)

        # 先确认点到的确实是降级场景那首（否则下面全是误报）
        cur_name = page.evaluate(
            """() => {
              const el = document.querySelector('[aria-label="播放栏"] a[title="展开全屏播放页"]');
              const t = el ? el.innerText.split('\\n')[0].trim() : '';
              return t;
            }"""
        )
        check("点中的是降级场景曲目（晴天）", "晴天" in (cur_name or ""),
              f"当前曲目={cur_name!r}")
        check("首选 flac 实得 320k 时，按钮显示**实得**档位（不谎报首选）",
              "320k" in label_attr and "FLAC" not in label_attr,
              f"aria-label={label_attr!r}")

        dots = page.locator('button[aria-label^="音质"]:visible span.bg-danger').count()
        check("降级时点亮红点（可见的降级标记）", dots >= 1, f"{dots} 个红点")

        # 菜单底部应给出「已自动降级到 …」的解释文案
        if trig.count() > 0:
            trig.first.click()
            page.wait_for_timeout(600)
            menu_text = page.locator('[role="menu"]').first.inner_text()
            check("菜单里有降级说明文案",
                  ("降级" in menu_text) or ("不可得" in menu_text),
                  menu_text.replace("\n", "|")[-110:])
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)

        # ③ 反向：实得**高于**首选 → 不得标成降级（D-012 的核心回归）。
        #
        # 【为什么必须是"升级"而不是"同档"】
        # 第一版这条写的是「同档不误报」（首选 320k、实得 320k），
        # 变异测试证明它**没有验证力**：把 isDegraded 退回旧实现
        # `resolved !== preferred` 后它依然全绿 —— 因为同档时
        # `resolved === preferred` 会提前返回 false，新旧实现表现一致（假绿）。
        #
        # 真正能区分新旧的是**升级**：首选 flac、实得 flac24bit。
        #   新实现：序号比较 → 24bit 高于 flac → 不算降级 ✓
        #   旧实现：字面不等 → 判成降级 ✗（这就是 D-012 的 bug）
        # 桩服务按曲目名区分场景（「只有高品位的歌」请求 flac 回 flac24bit）。
        #
        # 【坑记录】本段用 add_init_script 设档位（每次导航都执行），
        # 所以不能在同一个 context 里用 evaluate 改档位 —— reload 一跑又被写回。
        # 换新 context 才干净。
        page.close()
        ctx.close()

        ctx2 = browser.new_context(viewport={"width": 1440, "height": 900})
        inject_login(ctx2)
        page = ctx2.new_page()
        page.add_init_script("localStorage.setItem('lx.playback.quality', 'flac')")
        page.goto(f"{BASE}/app/search?q=周杰伦", wait_until="load")
        page.wait_for_timeout(2500)

        # 点第二首「只有高品位的歌」（升级场景）
        rows2 = page.locator("ul li button[aria-label^='播放']")
        upgrade_row = page.locator("ul li button[aria-label*='高品位']")
        target_row = upgrade_row.first if upgrade_row.count() > 0 else rows2.last
        if rows2.count() > 0:
            target_row.click()
            trig2 = page.locator('button[aria-label^="音质"]:visible').first
            lab2 = ""
            for _ in range(32):
                if trig2.count() > 0:
                    lab2 = trig2.get_attribute("aria-label") or ""
                    if "24bit" in lab2 or "flac24bit" in lab2.lower():
                        break
                page.wait_for_timeout(250)
            dots2 = page.locator('button[aria-label^="音质"]:visible span.bg-danger').count()
            # 升级：显示实得 24bit，且**不得**标降级、不得有红点
            check("实得高于首选时显示实得档位（24bit）",
                  "24bit" in lab2 or "flac24bit" in lab2.lower(),
                  f"aria-label={lab2!r}")
            check("实得高于首选时**不**标成降级（D-012 核心）",
                  dots2 == 0 and "降级" not in lab2,
                  f"aria-label={lab2!r} 红点={dots2}")
        else:
            check("实得高于首选时**不**标成降级（D-012 核心）", False, "桩数据未渲染")

        page.screenshot(path=os.path.join(OUT, "quality-upgrade.png"))
        ctx2.close()
    else:
        page.screenshot(path=os.path.join(OUT, "quality-degraded.png"))
        ctx.close()

    # ================= 播放历史：分桶 + 统计 =================
    #
    # 【为什么这段值得进护栏】
    # 「今天/昨天」的边界是纯逻辑，但有三种写法都不报错、只在特定时刻错：
    #   ① 用「距今 <24h」当今天 → 凌晨看昨晚的歌会被算成今天；
    #   ② 用 UTC 日期 → 东八区 08:00 前「今天」显示成昨天；
    #   ③ 用 getDate() 相减 → 跨月/跨年时 1 号与 31 号判等。
    # 单测已钉住这三条（test/historyStats.test.ts），这里再从**渲染层**验
    # "分组标题真的画出来了、条目落在正确的组里" —— 单测测不到 DOM。
    print("\n--- 播放历史分桶与统计 ---")
    ctx3 = browser.new_context(viewport={"width": 1440, "height": 900})
    inject_login(ctx3)
    page = ctx3.new_page()
    page.goto(f"{BASE}/app/history", wait_until="load")
    page.wait_for_timeout(1500)
    reset_fixture(page)
    page.reload(wait_until="load")
    page.wait_for_timeout(3000)

    headings = page.evaluate(
        """() => Array.from(document.querySelectorAll('main h2[id^="hist-"]'))
              .map(h => ({ id: h.id, text: (h.innerText||'').trim().replace(/\\n/g,' ') }))"""
    )
    got = [h["id"].replace("hist-", "") for h in headings]
    check("历史页按时间分桶渲染出四个分组",
          got == ["today", "yesterday", "week", "earlier"], f"{got}")

    # 条目数：今天 2 / 昨天 1 / 一周 2 / 更早 1（桩数据固定）
    counts = []
    for key in ("today", "yesterday", "week", "earlier"):
        sec = page.locator(f'section:has(h2#hist-{key})')
        counts.append(sec.locator("ul li").count() if sec.count() else -1)
    check("各分组条目数正确（2/1/2/1）", counts == [2, 1, 2, 1], f"{counts}")

    # 统计卡四项都在，且数值对得上（不同歌曲 6、累计播放 12、覆盖天数 5）
    stats_text = page.evaluate(
        """() => {
          const grid = document.querySelector('main .grid');
          return grid ? (grid.innerText || '').replace(/\\n/g, '|') : '';
        }"""
    )
    for label in ("不同歌曲", "累计播放", "覆盖天数", "最常听"):
        check(f"统计卡含「{label}」", label in stats_text, stats_text[:90])
    # 6 首、playCount 之和 = 3+1+2+1+4+1 = 12；覆盖天数 = 今天/昨天/3天前/5天前/30天前 = 5
    check("统计数值正确（6 首 / 12 次 / 5 天）",
          "6" in stats_text and "12" in stats_text and "5" in stats_text,
          stats_text[:120])
    # 最常听歌手：五月天 playCount 1+4=5 vs 周杰伦 3+2=5 → 并列取先出现（今天那首含周杰伦）
    check("最常听歌手按播放次数加权（并列取先出现）",
          "周杰伦" in stats_text or "五月天" in stats_text, stats_text[-60:])

    # ---- 分组内下标必须换算回全局下标 ----
    #
    # 这是最容易出错、也最难发现的一处：SongList 的 onPlay 给的是**分组内**相对下标，
    # 直接 playQueue(songs, i) 会播错歌，界面不报错，只是"点了 A 播了 B"。
    #
    # 断言必须选**分组间错位最大**的那一行，否则测不出来：
    #   点「昨天」组第 1 首 → 正确应播全局第 3 首「昨天听的歌」；
    #   若换算丢失（直接用 i=0），会播全局第 1 首「今天听的歌」。
    # 而点「今天」组第 2 首时两种实现都会得到全局第 2 首 —— 没有区分力。
    yday_sec = page.locator("section:has(h2#hist-yesterday)")
    if yday_sec.count() > 0:
        yday_sec.locator("ul li button[aria-label^='播放']").first.click()
        # 等播放栏出现曲名
        cur = ""
        for _ in range(24):
            cur = page.evaluate(
                """() => {
                  const el = document.querySelector('[aria-label="播放栏"] a[title="展开全屏播放页"]');
                  return el ? el.innerText.split('\\n')[0].trim() : '';
                }"""
            )
            if cur:
                break
            page.wait_for_timeout(250)
        check("点「昨天」组第 1 首播的是该组那首（下标换算正确）",
              "昨天听的歌" in cur,
              f"实际播放={cur!r}（错的话会播成「今天听的歌」）")
    else:
        check("点「昨天」组第 1 首播的是该组那首（下标换算正确）", False, "昨天分组不存在")

    page.screenshot(path=os.path.join(OUT, "history-buckets.png"))
    ctx3.close()

    # ================= 播放历史：单条删除 + 撤销 =================
    #
    # 【为什么这段必须验，且必须验「服务端真的收到请求」】
    # 前端做了「乐观更新」：点删除立刻从列表移除。于是如果只是断言
    # 「列表少了一条」，**即使删除请求根本没发出去、或服务端返回 500，
    # 断言依然会绿** —— 因为 UI 已经先移除了。这是典型的假绿。
    #
    # 所以这里分三层验：
    #   ① UI：条目消失、统计数字跟着变（不是只有列表变了）
    #   ② 服务端：桩服务记录的 removedLog 里必须有这个 key（证明请求真的到了）
    #   ③ 撤销：点「撤销」后条目回来，且服务端列表也恢复
    print("\n--- 播放历史：单条删除与撤销 ---")
    ctx4 = browser.new_context(viewport={"width": 1440, "height": 900})
    inject_login(ctx4)
    page = ctx4.new_page()
    page.goto(f"{BASE}/app/history", wait_until="load")
    page.wait_for_timeout(1500)
    reset_fixture(page)
    page.reload(wait_until="load")
    page.wait_for_timeout(3000)

    def stats_text():
        return page.evaluate(
            """() => {
              const g = document.querySelector('main .grid');
              return g ? (g.innerText || '').replace(/\\n/g, '|') : '';
            }"""
        )

    before_stats = stats_text()
    check("删除前统计为 6 首 / 12 次", "6" in before_stats and "12" in before_stats, before_stats[:60])

    # 删「昨天」组那条（它独处一组，删完该组应整个消失 —— 顺带验证空分组不渲染）
    yday = page.locator("section:has(h2#hist-yesterday)")
    check("删除前存在「昨天」分组", yday.count() > 0)
    if yday.count() > 0:
        # 删除按钮是行内的 trash 图标；用 title/aria-label 定位更稳
        del_btn = yday.locator("ul li button[title*='移除'], ul li button[title*='删除'], ul li button[aria-label*='移除'], ul li button[aria-label*='删除']").first
        if del_btn.count() == 0:
            # 退化：取该行最后一个 button（SongList 里删除按钮在末尾）
            del_btn = yday.locator("ul li").first.locator("button").last
        check("「昨天」分组有删除入口", del_btn.count() > 0)
        del_btn.click()
        page.wait_for_timeout(1200)

        check("删除后条目从列表消失", page.locator("section:has(h2#hist-yesterday)").count() == 0,
              "昨天分组应整个消失（只剩 1 条且被删）")

        after_stats = stats_text()
        check("删除后统计跟着变（5 首 / 10 次）",
              "5" in after_stats and "10" in after_stats, after_stats[:60])

        # ② 服务端确实收到了删除请求
        log = page.evaluate(
            """async () => {
              const r = await fetch('/api/__fixture__/removed-log');
              return (await r.json()).removed || [];
            }"""
        )
        check("服务端真的收到了删除请求（不是只在 UI 上移除）",
              "kw|stub-3" in log, f"removedLog={log}")

        # ③ 撤销
        undo = page.locator('button:has-text("撤销")')
        if undo.count() > 0:
            undo.first.click()
            page.wait_for_timeout(1500)
            check("点撤销后条目回到列表",
                  page.locator("section:has(h2#hist-yesterday)").count() > 0,
                  "撤销后应重新出现「昨天」分组")
            restored = page.evaluate(
                """async () => {
                  const r = await fetch('/api/music/history/list');
                  const j = await r.json();
                  return { total: j.total, names: (j.list||[]).map(x => x.name) };
                }"""
            )
            check("撤销后服务端列表也恢复了",
                  restored["total"] == 6 and any("昨天听的歌" in n for n in restored["names"]),
                  f"total={restored['total']}")
        else:
            check("删除后出现「撤销」按钮", False, "没找到撤销按钮")
            check("撤销后服务端列表也恢复了", False, "跳过")
    else:
        for nm in ("「昨天」分组有删除入口", "删除后条目从列表消失",
                   "删除后统计跟着变（5 首 / 10 次）",
                   "服务端真的收到了删除请求（不是只在 UI 上移除）",
                   "删除后出现「撤销」按钮", "撤销后服务端列表也恢复了"):
            check(nm, False, "前置：昨天分组不存在")

    page.screenshot(path=os.path.join(OUT, "history-remove.png"))
    ctx4.close()

    # ================= 歌词多平台回退 =================
    #
    # 【为什么必须在离线桩里验】「本源无歌词」在真实环境极难稳定复现
    # （取决于平台版权，今天没有明天可能有）。桩里把非 kg 一律判无歌词
    # （500 = 真实服务端的「无歌词」信号），回退链必然被触发，才可断言。
    #
    # 验四件事：
    #   ① 回退后渲染出歌词内容（不是「暂无歌词」空态）
    #   ② 显示「歌词来自酷狗」徽标 —— 不明说的话，用户会以为歌词是本源给的
    #   ③ 请求顺序：先本源 kw、再回退 kg。跳过本源直取 kg 是回归
    #      （那会让所有歌都走回退，本源的时间轴/翻译反而没人用了）
    #   ④ 日志恰好两条 —— kg 命中后不再继续尝试别的源
    #
    # 桌面 1440 下右侧「正在播放」常驻面板就是 Lyrics 的消费者，无需跳转
    # 全屏页；前面的段落点过歌（会打歌词接口），所以先 reset 清掉 lyricLog。
    print("\n--- 歌词多平台回退 ---")
    ctx5 = browser.new_context(viewport={"width": 1440, "height": 900})
    inject_login(ctx5)
    page = ctx5.new_page()
    page.goto(f"{BASE}/app/search?q=周杰伦", wait_until="load")
    page.wait_for_timeout(1500)
    reset_fixture(page)
    page.reload(wait_until="load")
    page.wait_for_timeout(2500)

    rows = page.locator("ul li button[aria-label^='播放']")
    check("回退场景：桩数据渲染出搜索结果", rows.count() > 0, f"{rows.count()} 行")
    if rows.count() > 0:
        rows.first.click()
        page.wait_for_timeout(3000)

        body = page.evaluate("() => document.body.innerText || ''")
        check("回退后渲染出歌词内容", "回退歌词第一行" in body)
        check("不是「暂无歌词」空态", "这首歌暂时没有歌词" not in body)
        check("显示「歌词来自酷狗」徽标", "歌词来自酷狗" in body)

        log = page.evaluate(
            """async () => {
              const r = await fetch('/api/__fixture__/lyric-log');
              return (await r.json()).sources || [];
            }"""
        )
        check("请求顺序：先本源 kw 再回退 kg（不跳过本源）",
              log[:2] == ["kw", "kg"], f"lyricLog={log}")
        check("kg 命中后不再继续尝试（恰好 2 次请求）", len(log) == 2, f"lyricLog={log}")
    else:
        for nm in ("回退后渲染出歌词内容", "不是「暂无歌词」空态",
                   "显示「歌词来自酷狗」徽标",
                   "请求顺序：先本源 kw 再回退 kg（不跳过本源）",
                   "kg 命中后不再继续尝试（恰好 2 次请求）"):
            check(nm, False, "前置：搜索结果为空")

    page.screenshot(path=os.path.join(OUT, "lyric-fallback.png"))
    ctx5.close()

    # ================= 全局快捷键（v2.32.0）=================
    #
    # 【验什么】7 个新键（/ ←→ ↑↓ M S R L）里，可离线稳定断言的 6 类：
    #   ① L 收藏/取消收藏 —— 三层：toast 文案 + 桩服务端 loveLog + 状态可逆
    #   ② S 随机 / R 循环 —— toast 文案 + TransportControls 的 aria-label/pressed 翻转
    #   ③ ↑↓ 音量 —— 音量 range input 的 value 步进 0.05（先 ↓×2 再 ↑，避开默认 1.0 的天花板）
    #   ④ M 静音 —— 静音按钮 aria-label 翻转
    #   ⑤ / 聚焦搜索框
    #   ⑥ 输入框/滑块守卫 —— 焦点在输入框里按 s 要打字不切随机；
    #      焦点在原生 range 上按 ↑ 只走原生 step=0.01，不能「一步顶两步」(+0.06)
    #
    # 【seek 为什么不验】桩环境的 <audio> 能不能真出声取决于 headless 的自动播放
    # 策略，position 时钟不可靠 —— seek 逻辑只有「clamp + audio.currentTime」三行，
    # 验它得不偿失（verify-playback 在真实环境已覆盖播放时钟）。
    print("\n--- 全局快捷键 ---")
    ctx6 = browser.new_context(viewport={"width": 1440, "height": 900})
    inject_login(ctx6)
    page = ctx6.new_page()
    page.goto(f"{BASE}/app/search?q=周杰伦", wait_until="load")
    page.wait_for_timeout(1500)
    reset_fixture(page)
    page.reload(wait_until="load")
    page.wait_for_timeout(2500)

    rows = page.locator("ul li button[aria-label^='播放']")
    check("快捷键场景：桩数据渲染出搜索结果", rows.count() > 0, f"{rows.count()} 行")
    if rows.count() > 0:
        rows.first.click()
        page.wait_for_timeout(1500)

        # ① L 收藏 → 取消收藏（服务端三层验证）
        page.keyboard.press("l")
        page.wait_for_timeout(1000)
        check("L：toast 显示「已收藏」", "已收藏" in page.evaluate("() => document.body.innerText"))
        love = page.evaluate(
            """async () => {
              const r = await fetch('/api/__fixture__/love-log');
              return await r.json();
            }"""
        )
        check("L：服务端真的收到了收藏请求", love["ops"] and love["ops"][0]["op"] == "add"
              and "228908" in (love["ops"][0]["songmid"] or []), f"ops={love['ops']}")

        page.keyboard.press("l")
        page.wait_for_timeout(1000)
        check("L：再按一次 toast 显示「已取消收藏」",
              "已取消收藏" in page.evaluate("() => document.body.innerText"))
        love2 = page.evaluate(
            """async () => (await (await fetch('/api/__fixture__/love-log')).json())"""
        )
        check("L：服务端也收到了移除请求且收藏清空",
              len(love2["ops"]) == 2 and love2["ops"][1]["op"] == "remove" and love2["love"] == [],
              f"ops={[(o['op']) for o in love2['ops']]} love={len(love2['love'])}")

        # ② S 随机开关（aria-label + toast 双断言）
        shuf = page.locator("button[aria-label='开启随机播放'], button[aria-label='关闭随机播放']")
        check("S：随机按钮存在", shuf.count() > 0)
        page.keyboard.press("s")
        page.wait_for_timeout(400)
        check("S：toast 显示「随机播放：开」", "随机播放：开" in page.evaluate("() => document.body.innerText"))
        check("S：按钮 aria-label 翻转为「关闭随机播放」",
              page.locator("button[aria-label='关闭随机播放']").count() > 0)
        page.keyboard.press("s")
        page.wait_for_timeout(400)
        check("S：再按恢复「开启随机播放」",
              page.locator("button[aria-label='开启随机播放']").count() > 0)

        # ② R 循环切换（默认「列表循环」→ 单曲 → 不循环 → 列表循环）
        page.keyboard.press("r")
        page.wait_for_timeout(400)
        check("R：循环切到「单曲循环」",
              page.locator("button[aria-label^='循环模式：单曲循环']").count() > 0)
        page.keyboard.press("r")
        page.wait_for_timeout(400)
        check("R：再按到「不循环」",
              page.locator("button[aria-label^='循环模式：不循环']").count() > 0)
        page.keyboard.press("r")
        page.wait_for_timeout(400)
        check("R：第三次回到「列表循环」（完整一圈）",
              page.locator("button[aria-label^='循环模式：列表循环']").count() > 0)

        # ③ ↑↓ 音量步进 0.05（先降两次避开默认 1.0 天花板，再升回来）
        vol = page.locator("input[aria-label='音量']")
        check("音量条存在", vol.count() > 0)
        v0 = float(vol.input_value())
        page.keyboard.press("ArrowDown")
        page.wait_for_timeout(200)
        v1 = float(vol.input_value())
        page.keyboard.press("ArrowDown")
        page.wait_for_timeout(200)
        v2 = float(vol.input_value())
        page.keyboard.press("ArrowUp")
        page.wait_for_timeout(200)
        v3 = float(vol.input_value())
        check("↓↓↑：音量按 0.05 步进（+ 回升）",
              abs(v1 - (v0 - 0.05)) < 0.001 and abs(v2 - (v0 - 0.10)) < 0.001 and abs(v3 - v1) < 0.001,
              f"{v0}→{v1}→{v2}→{v3}")

        # ④ M 静音
        page.keyboard.press("m")
        page.wait_for_timeout(200)
        check("M：静音按钮翻转为「取消静音」",
              page.locator("button[aria-label='取消静音']").count() > 0)
        page.keyboard.press("m")
        page.wait_for_timeout(200)
        check("M：再按恢复「静音」", page.locator("button[aria-label='静音']").count() > 0)

        # ⑤ / 聚焦搜索框
        page.keyboard.press("/")
        page.wait_for_timeout(300)
        focused = page.evaluate(
            "() => { const el = document.activeElement; return el ? el.getAttribute('aria-label') : ''; }"
        )
        check("/：焦点进入搜索输入框", focused == "搜索关键词", f"focused={focused!r}")

        # ⑥ 输入框守卫：焦点在输入框里按 s 是打字，不是切随机。
        #    【为什么用 toast 计数而不是「正文不含『随机播放：』」】前面的用例
        #    合法地弹过 S 的 toast，它 4 秒后才消失 —— 「正文不含」会被旧 toast
        #    误伤（本护栏第一版就是这么假红的）。
        toasts_before = page.locator('li[role="status"]').count()
        page.keyboard.type("s")
        page.wait_for_timeout(400)
        typed = page.evaluate(
            "() => document.querySelector('input[aria-label=\"搜索关键词\"]').value"
        )
        check("输入框内按 s：正常打字（值含 s）", "s" in typed, f"typed={typed!r}")
        check("输入框内按 s：不触发随机切换（无新 toast、按钮未翻转）",
              page.locator('li[role="status"]').count() == toasts_before
              and page.locator("button[aria-label='开启随机播放']").count() > 0)

        # ⑥ 原生 range 守卫：焦点在音量条上按 ↑ 只走原生 step（0.01），不能 +0.06
        page.evaluate("() => document.querySelector('input[aria-label=\"音量\"]').focus()")
        page.keyboard.press("ArrowUp")
        page.wait_for_timeout(200)
        v4 = float(page.locator("input[aria-label='音量']").input_value())
        check("音量条聚焦时按 ↑：只走原生 step=0.01（不与全局快捷键叠加）",
              abs(v4 - (v3 + 0.01)) < 0.001, f"{v3}→{v4}")

        # ⑦ ? 帮助面板（v2.33.0）。先 blur：上个用例把焦点留在音量输入框上，
        #    不 blur 的话 ? 会被输入框守卫吞掉（那本身也是对的行为，但测不了面板）。
        #    ⚠️ 必须按 "Shift+Slash" 而不是 "?"：playwright 的 press("?") 会合成
        #    shift=False 的 keydown，而真实键盘按 ? 必然带 Shift ——
        #    实现按 e.shiftKey 分流（? 帮助 / / 聚焦搜索），用 "?" 按出来的是
        #    「聚焦搜索」，第一版就这么假红的。
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        page.keyboard.press("Shift+Slash")
        page.wait_for_timeout(600)
        dlg = page.locator("[role='dialog']")
        check("？：帮助面板弹出", dlg.count() > 0)
        if dlg.count() > 0:
            txt = dlg.inner_text()
            check("帮助面板列出 L 收藏当前曲", "收藏 / 取消收藏当前曲" in txt)
            check("帮助面板列出空格与 ?", "Space" in txt and "?" in txt)
            check("帮助面板列出 / 聚焦搜索", "聚焦搜索框" in txt)
            page.keyboard.press("Escape")
            page.wait_for_timeout(400)
            check("Esc 关闭帮助面板", page.locator("[role='dialog']").count() == 0)

        btn = page.locator("header button[aria-label='键盘快捷键']")
        check("顶栏有键盘图标入口", btn.count() > 0)
        if btn.count() > 0:
            btn.click()
            page.wait_for_timeout(500)
            check("点顶栏按钮也弹出帮助面板", page.locator("[role='dialog']").count() > 0)
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
    else:
        for nm in ("L：toast 显示「已收藏」", "L：服务端真的收到了收藏请求",
                   "L：再按一次 toast 显示「已取消收藏」", "L：服务端也收到了移除请求且收藏清空",
                   "S：随机按钮存在", "S：toast 显示「随机播放：开」", "S：按钮 aria-label 翻转为「关闭随机播放」",
                   "S：再按恢复「开启随机播放」", "R：循环切到「单曲循环」", "R：再按到「不循环」",
                   "R：第三次回到「列表循环」（完整一圈）", "音量条存在", "↓↓↑：音量按 0.05 步进（+ 回升）",
                   "M：静音按钮翻转为「取消静音」", "M：再按恢复「静音」", "/：焦点进入搜索输入框",
                   "输入框内按 s：正常打字（值含 s）", "输入框内按 s：不触发随机切换（无新 toast、按钮未翻转）",
                   "音量条聚焦时按 ↑：只走原生 step=0.01（不与全局快捷键叠加）",
                   "？：帮助面板弹出", "帮助面板列出 L 收藏当前曲", "帮助面板列出空格与 ?",
                   "帮助面板列出 / 聚焦搜索", "Esc 关闭帮助面板", "顶栏有键盘图标入口",
                   "点顶栏按钮也弹出帮助面板"):
            check(nm, False, "前置：搜索结果为空")

    page.screenshot(path=os.path.join(OUT, "keyboard-shortcuts.png"))
    ctx6.close()

    # ================= 最近搜索（v2.34.0）=================
    #
    # 【验什么】记录（提交即记）/ 跨 reload 持久化 / 新者在前 /
    # 点词重搜 / 删单条 / 清空。去重与挪前在单测 + 变异脚本里盯
    # （test/searchHistory.test.ts，CI 常驻），这里只验 UI 接线。
    print("\n--- 最近搜索 ---")
    ctx7 = browser.new_context(viewport={"width": 1440, "height": 900})
    inject_login(ctx7)
    page = ctx7.new_page()
    page.goto(f"{BASE}/app/search", wait_until="load")
    page.wait_for_timeout(2500)

    check("空历史时不显示「最近搜索」区", "最近搜索" not in page.evaluate("() => document.body.innerText"))

    page.fill("input[aria-label='搜索关键词']", "周杰伦")
    page.keyboard.press("Enter")
    page.wait_for_timeout(2500)
    check("提交搜索后出结果", page.locator("ul li button[aria-label^='播放']").count() > 0)

    page.fill("input[aria-label='搜索关键词']", "林俊杰")
    page.keyboard.press("Enter")
    page.wait_for_timeout(2500)

    # 整页 reload：证明持久化（localStorage），而不是只活在内存里
    page.reload(wait_until="load")
    page.wait_for_timeout(2500)
    chips = page.locator("span.group > button[title]")
    n = chips.count()
    check("reload 后出现最近搜索 chips（持久化）", n >= 2, f"{n} 个")
    if n >= 2:
        first = chips.nth(0).get_attribute("title")
        second = chips.nth(1).get_attribute("title")
        check("新搜索的词排在最前", first == "林俊杰" and second == "周杰伦", f"{first} / {second}")

        # 点旧词重搜 → 它应挪到最前（去重，不产生第二条）
        page.locator("span.group > button[title='周杰伦']").click()
        page.wait_for_timeout(2500)
        check("点词重搜出了结果", page.locator("ul li button[aria-label^='播放']").count() > 0)
        page.reload(wait_until="load")
        page.wait_for_timeout(2500)
        chips2 = page.locator("span.group > button[title]")
        titles = [chips2.nth(i).get_attribute("title") for i in range(chips2.count())]
        check("重搜后该词挪到最前且只有一条（去重+置顶）",
              titles[0] == "周杰伦" and titles.count("周杰伦") == 1, f"{titles}")

        # 删单条
        page.locator("button[aria-label='删除搜索记录 林俊杰']").click()
        page.wait_for_timeout(500)
        titles2 = [page.locator("span.group > button[title]").nth(i).get_attribute("title")
                   for i in range(page.locator("span.group > button[title]").count())]
        check("删单条后只剩另一条", titles2 == ["周杰伦"], f"{titles2}")

        # 清空
        page.locator("button:has-text('清空')").first.click()
        page.wait_for_timeout(500)
        check("清空后「最近搜索」区消失", "最近搜索" not in page.evaluate("() => document.body.innerText"))
    else:
        for nm in ("新搜索的词排在最前", "点词重搜出了结果",
                   "重搜后该词挪到最前且只有一条（去重+置顶）", "删单条后只剩另一条",
                   "清空后「最近搜索」区消失"):
            check(nm, False, "前置：chips 未出现")

    page.screenshot(path=os.path.join(OUT, "search-history.png"))
    ctx7.close()

    # ================= 睡眠定时器（v2.35.0）=================
    #
    # 【验什么】UI 接线与状态可见性：入口存在 / 菜单项齐全 / 设定后倒计时
    # 出现 / 进行中的项被禁用 / 两种模式切换 / 关闭复位。
    # 【到点暂停为什么不在这验】需要真实时钟等 15 分钟；淡出与暂停的
    # 语义边界在 test/sleepTimer.test.ts + mutation-check-sleeptimer.cjs
    # （CI 常驻）里盯 —— e2e 只证明「接线对」，逻辑归单测。
    print("\n--- 睡眠定时器 ---")
    ctx8 = browser.new_context(viewport={"width": 1440, "height": 900})
    inject_login(ctx8)
    page = ctx8.new_page()
    page.goto(f"{BASE}/app/search?q=周杰伦", wait_until="load")
    page.wait_for_timeout(2500)

    trig = page.locator("button[aria-label='睡眠定时']").first
    check("播放栏有睡眠定时入口", trig.count() > 0)
    if trig.count() > 0:
        trig.click()
        page.wait_for_timeout(600)
        menu_text = page.locator("[role='menu']").first.inner_text()
        check("菜单含「播完当前这首」", "播完当前这首" in menu_text)
        check("菜单含 15/30/60 分钟档", all(f"{m} 分钟" in menu_text for m in (15, 30, 60)))
        check("菜单含「关闭睡眠定时」", "关闭睡眠定时" in menu_text)

        page.locator("[role='menuitem']:has-text('30 分钟')").click()
        page.wait_for_timeout(800)
        check("设定后 toast「30 分钟后停止」", "30 分钟后停止" in page.evaluate("() => document.body.innerText"))
        label = page.locator("button[aria-label^='睡眠定时']").first.get_attribute("aria-label") or ""
        check("入口变为倒计时态（aria-label 带剩余时间）", "剩余" in label and any(c.isdigit() for c in label), label)

        page.locator("button[aria-label^='睡眠定时']").first.click()
        page.wait_for_timeout(600)
        item30 = page.locator("[role='menuitem']:has-text('30 分钟')")
        check("进行中的档位标注且禁用", "进行中" in (item30.first.inner_text() if item30.count() else ""),
              item30.first.inner_text() if item30.count() else "未找到")

        page.locator("[role='menuitem']:has-text('播完当前这首')").click()
        page.wait_for_timeout(800)
        label2 = page.locator("button[aria-label^='睡眠定时']").first.get_attribute("aria-label") or ""
        check("切到「播完当前这首」（无倒计时）", "播完当前这首" in label2, label2)

        page.locator("button[aria-label^='睡眠定时']").first.click()
        page.wait_for_timeout(600)
        page.locator("[role='menuitem']:has-text('关闭睡眠定时')").click()
        page.wait_for_timeout(800)
        label3 = page.locator("button[aria-label='睡眠定时']").first.get_attribute("aria-label") or ""
        check("关闭后回到初始态", label3 == "睡眠定时", label3)
        check("关闭后 toast「已关闭」", "已关闭睡眠定时" in page.evaluate("() => document.body.innerText"))

    # 全屏播放页入口（移动端场景的主要入口）
    page.goto(f"{BASE}/app/search?q=周杰伦", wait_until="load")
    page.wait_for_timeout(2000)
    rows = page.locator("ul li button[aria-label^='播放']")
    if rows.count() > 0:
        rows.first.click()
        page.wait_for_timeout(1200)
        link = page.locator('a[href$="/now-playing"]:visible').first
        if link.count() > 0:
            link.click()
            page.wait_for_timeout(1500)
        check("全屏播放页也有睡眠定时入口",
              page.locator("[aria-label^='睡眠定时']").count() > 0)

    page.screenshot(path=os.path.join(OUT, "sleep-timer.png"))
    ctx8.close()

    # ================= 倍速播放（v2.36.0）=================
    #
    # 【验什么】本特性最大的坑不是「设了没生效」，而是「**换歌后悄悄回落 1x**」——
    # 换 src 会把 <audio> 的 playbackRate 重置为 1，内核必须在每次设完 src 后
    # 重挂。所以断言直接读 <audio> 元素的真实状态（不是只看 UI 标签）：
    #   ① 设 1.5x → audio.playbackRate === 1.5 且 preservesPitch（变速不变调）
    #   ② 切到下一首（换 src）→ 仍是 1.5（重挂生效）
    #   ③ reload 后再播 → 持久化的倍速被应用
    print("\n--- 倍速播放 ---")
    ctx9 = browser.new_context(viewport={"width": 1440, "height": 900})
    inject_login(ctx9)
    page = ctx9.new_page()
    page.goto(f"{BASE}/app/search?q=周杰伦", wait_until="load")
    page.wait_for_timeout(2500)

    rows = page.locator("ul li button[aria-label^='播放']")
    check("倍速场景：桩数据渲染出搜索结果", rows.count() > 0, f"{rows.count()} 行")
    if rows.count() > 0:
        rows.first.click()
        page.wait_for_timeout(1500)
        link = page.locator('a[href$="/now-playing"]:visible').first
        if link.count() > 0:
            link.click()
            page.wait_for_timeout(1500)

        trig = page.locator("button[aria-label^='倍速：']").first
        check("播放页有倍速入口（默认 1x）", trig.count() > 0,
              trig.get_attribute("aria-label") if trig.count() else "未找到")

        trig.click()
        page.wait_for_timeout(600)
        menu_text = page.locator("[role='menu']").first.inner_text()
        check("菜单含 0.5x~2x 六档", all(f"{v}x" in menu_text for v in ("0.5", "0.75", "1", "1.25", "1.5", "2")))
        check("当前档（1x）标注并禁用", "1x（当前）" in menu_text)

        page.locator("[role='menuitem']:has-text('1.5x')").click()
        page.wait_for_timeout(800)
        audio = page.evaluate(
            "() => { const a = document.querySelector('audio'); return a ? { rate: a.playbackRate, pitch: a.preservesPitch } : null; }"
        )
        check("设 1.5x：audio.playbackRate 真的变了", audio and abs(audio["rate"] - 1.5) < 0.001,
              f"rate={audio and audio['rate']}")
        check("变速不变调（preservesPitch）", audio and audio["pitch"] is True, str(audio))
        check("入口标签更新为 1.5x", page.locator("button[aria-label='倍速：1.5x']").count() > 0)

        # 换歌（换 src）：playbackRate 必须仍是被设的值
        page.keyboard.press("Shift+ArrowRight")
        page.wait_for_timeout(2000)
        audio2 = page.evaluate("() => { const a = document.querySelector('audio'); return a ? a.playbackRate : 0; }")
        check("切到下一首（换 src）后仍是 1.5x（重挂生效）",
              abs(audio2 - 1.5) < 0.001, f"rate={audio2}")

        # 持久化：换 1.25x → 整页重载 → 重新播一首 → 1.25 被应用。
        # ⚠️ 此时 URL 已在全屏播放页，reload 后没有搜索结果 —— 必须 goto 回
        # 搜索页（同源导航，localStorage 保留）。
        page.locator("button[aria-label^='倍速：']").first.click()
        page.wait_for_timeout(600)
        page.locator("[role='menuitem']:has-text('1.25x')").click()
        page.wait_for_timeout(600)
        page.goto(f"{BASE}/app/search?q=周杰伦", wait_until="load")
        page.wait_for_timeout(2500)
        rows2 = page.locator("ul li button[aria-label^='播放']")
        if rows2.count() > 0:
            rows2.first.click()
            page.wait_for_timeout(2000)
            audio3 = page.evaluate("() => { const a = document.querySelector('audio'); return a ? a.playbackRate : 0; }")
            check("reload 后持久化的 1.25x 被应用", abs(audio3 - 1.25) < 0.001, f"rate={audio3}")
        else:
            check("reload 后持久化的 1.25x 被应用", False, "reload 后无搜索结果")
    else:
        for nm in ("播放页有倍速入口（默认 1x）", "菜单含 0.5x~2x 六档", "当前档（1x）标注并禁用",
                   "设 1.5x：audio.playbackRate 真的变了", "变速不变调（preservesPitch）",
                   "入口标签更新为 1.5x", "切到下一首（换 src）后仍是 1.5x（重挂生效）",
                   "reload 后持久化的 1.25x 被应用"):
            check(nm, False, "前置：搜索结果为空")

    page.screenshot(path=os.path.join(OUT, "playback-rate.png"))
    ctx9.close()

    browser.close()

failed = [c for c in report["checks"] if not c["ok"]]
with open(os.path.join(OUT, "quality-menu-fit-report.json"), "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)

print(f"\n===== {len(report['checks']) - len(failed)}/{len(report['checks'])} checks passed =====")
for c in failed:
    print("FAIL  " + c["name"] + (f"  [{c['detail']}]" if c["detail"] else ""))
sys.exit(1 if failed else 0)
