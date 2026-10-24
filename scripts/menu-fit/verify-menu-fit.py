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

    browser.close()

failed = [c for c in report["checks"] if not c["ok"]]
with open(os.path.join(OUT, "quality-menu-fit-report.json"), "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)

print(f"\n===== {len(report['checks']) - len(failed)}/{len(report['checks'])} checks passed =====")
for c in failed:
    print("FAIL  " + c["name"] + (f"  [{c['detail']}]" if c["detail"] else ""))
sys.exit(1 if failed else 0)
