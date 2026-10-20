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

    browser.close()

failed = [c for c in report["checks"] if not c["ok"]]
with open(os.path.join(OUT, "quality-menu-fit-report.json"), "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)

print(f"\n===== {len(report['checks']) - len(failed)}/{len(report['checks'])} checks passed =====")
for c in failed:
    print("FAIL  " + c["name"] + (f"  [{c['detail']}]" if c["detail"] else ""))
sys.exit(1 if failed else 0)
