# v2.50.2 交接：底部导航栏「没固定、跟着内容走」的根因与修法

> 用户反馈（v2.50.1 线上，iPhone 截图）：底部 Tab 栏没有固定在屏幕底部，
> 而是浮在**页面中部**，上下滚动时跟着内容一起走；同一张截图里**顶部导航栏也不见了**。
>
> 本轮结论：**两个叠加的缺陷**，一个在 CSS 结构、一个在 JS。都已修，且都有可复跑的实测脚本。

---

## 一、先看用户截图说明了什么

截图里同时出现三件事，这三件事一起出现基本就指明了病根：

1. **顶部 sticky 顶栏不见了** —— 页面已经滚下去了
2. **底部 fixed Tab 栏出现在页面中部**，下方还有两排歌单卡片 —— 它没有贴视口
3. 两条栏**都**偏离了自己的位置

单独看「底栏没固定」很容易以为是 `position: fixed` 写错了。但它没写错
（`fixed inset-x-0 bottom-0 z-40`，部署产物里也一致）。**顶栏也一起丢了**才是关键：
顶栏是 `sticky`、底栏是 `fixed`，两种不同的定位机制同时失效，说明问题不在单个元素，
而在**「页面根节点在滚动」这个结构本身**。

已知的触发条件（[StackOverflow 79753701](https://stackoverflow.com/questions/79753701/ios-26-safari-web-layouts-are-breaking-due-to-fixed-sticky-position-elements-getting-shifted-vertically)、
[Apple 社区 256170519](https://discussions.apple.com/thread/256170519)）：
iOS 26 Safari 在**折叠/展开地址栏**时会整体位移视口，`position: fixed` 与 `sticky`
元素跟着一起位移。页面是否是根滚动、内容有多长、滚到哪个位置，都会影响是否复现。

---

## 二、第二个缺陷：那行「滚动时把栏推回视口底」的 hack

`MobileTabBar.tsx` 旧代码：

```ts
useEffect(() => {
  const sync = () => document.getElementById('mobile-tabbar')
    ?.scrollIntoView({ block: 'end' })
  sync()
  window.addEventListener('scroll', sync, { passive: true })
  window.addEventListener('resize', sync)
  return () => { ... }
}, [])
```

注释里的前提是「浏览器不会对 fixed 元素滚动，`scrollIntoView` 对它是空操作」。
**这个前提是错的**，而且错得很危险：

- 只要 fixed 元素的**包含块**不再是视口（祖先带 `transform` / `filter` /
  `backdrop-filter` / `contain` / `will-change` / `perspective` 任意一条），
  `scrollIntoView` 就会**真的滚动页面**把这个元素送进视野；
- 它挂在 `scroll` 事件上，于是形成「用户滚一下 → 页面自己再滚一下」的拉扯。

实测（`.playwright/_probe-scrollhack.py`，祖先加 `contain: paint`）：

```
正常祖先            hack=False  scrollY=[300, 600, 900, 1200, 900, 600]   ← 跟手
正常祖先            hack=True   scrollY=[300, 600, 900, 1200, 900, 600]   ← 空操作（注释只对了一半）
祖先 contain:paint  hack=False  scrollY=[300, 600, 900, 1200, 900, 600]   ← 正常
祖先 contain:paint  hack=True   scrollY=[2335, 2335, 2335, 2335, 2335, 2335]  ← 一次滚 300 直接被拽到页底
```

也就是说：**这个 hack 平时看起来无害，一旦 fixed 的包含块被改变（iOS 上很常见），
它会把页面拽走** —— 用户看到的就是「导航栏跟着内容一起走了」。

### 结论

这条栏靠 CSS 贴底就够了，**不要再用 JS 去「纠正」它的位置**。
`scrollIntoView` 已经删掉，`useEffect` / `addEventListener('scroll')` 一并移除。

---

## 三、修法：把滚动从「文档」搬到「内层容器」

改前结构（根节点滚）：

```
html / body（滚动容器）
└─ div.min-h-[calc(100dvh - header)]     ← Shell 根
   ├─ header.sticky top-0                 ← 随根滚动
   ├─ div（内容区，mx-auto max-w-6xl）
   └─ PlayerBar.fixed / MobileTabBar.fixed ← 相对视口
```

改后结构（只有 main 滚）：

```
html / body / #root   { height: 100% }    ← index.css 新增，且 body overscroll-behavior-y: none
└─ div.h-[100dvh].overflow-hidden         ← Shell 根：不滚
   ├─ header.shrink-0                      ← 普通 flex 行，不参与滚动（sticky 已无意义）
   ├─ div.flex.flex-1.overflow-hidden      ← 一条不滚的行
   │  └─ div.mx-auto.max-w-6xl.overflow-hidden
   │     ├─ aside（桌面侧栏，固定一列，自己可滚）
   │     ├─ main#app-scroll.overflow-y-auto.overscroll-contain   ← 唯一的滚动容器
   │     └─ aside（右侧正在播放面板，≥1280px）
   ├─ PlayerBar.fixed                      ← 相对视口，滚动区之外
   └─ MobileTabBar.fixed                   ← 相对视口，滚动区之外
```

关键点：

1. **根节点不再是滚动容器** → 浏览器没有「折叠地址栏把整页推走」的机会，
   两条栏相对一个静止盒子定位。
2. **侧栏/右面板不能放进滚动容器**：第一版偷懒把它们塞进 `#app-scroll`，
   桌面回归立刻发现「侧栏跟着内容一起滚走了」（`.playwright/verify-tabbar-fixed.py`
   里现在有这条断言）。只有 `main` 滚才是原本手感。
3. **`overscroll-contain`**：滚到边界不把滚动传给外层（iOS 上这会把地址栏弹出来、
   连带位移视口，正是漂移的触发条件之一）。
4. **移动抽屉挪到滚动区之外**：`fixed` 在滚动容器内部时，部分 WebKit 版本会把
   包含块认成那个容器，`inset-0` 只盖住内容区，遮罩漏出顶栏和底栏。

### 高度为什么用 `100%` 而不是 `100vh` / `100dvh`

- `100vh`：移动浏览器里是「地址栏收起后」的高度，会多出一截 → 底栏被压出屏幕；
- `100dvh`：随地址栏收放**实时变化**，滚动中高度跳变，等于每滚一下重排一次；
- `100%`：沿 `html → body → #root` 传递，三者是同一个布局视口高度，最稳。

⚠️ **不要把 `overflow: hidden` 加到 `html/body` 上**替代这一条（有项目踩过）：
那会让 Safari 地址栏不再收起，且返回上一页时丢失滚动位置。
本项目的 `overflow-hidden` 只加在外壳 div 上，浏览器地址栏行为不变。

### 附带必改：换路由时要把内层滚动归零

把滚动容器从 `document` 换成 `main` 之后，**浏览器原本免费提供的「换页回到顶部」没了**。
旧版没人写过这行代码 —— 是 `document` 滚动时浏览器自己重置的。
实测：首页滚到 553px 再点「排行榜」，新页面直接从中间开始（`scrollTop=122`）。

所以 `App.tsx` 里补了一个 `useEffect(..., [pathname])`：

```ts
const el = document.getElementById('app-scroll')
if (el) el.scrollTop = 0
if (window.scrollY !== 0) window.scrollTo(0, 0)
```

依赖只写 `pathname`：同一页内的 query 变化（换搜索词）不该清位置，
否则「搜到一半接着往下翻」会被打断。

> 这是**切换滚动容器的必然代价**，不是可选优化。凡是改「谁在滚」的重构，
> 都要把「换页回到顶部 / 滚动位置恢复」这两件事重新接一遍。

---

## 四、验证（都可复跑，不需要起后端）

三个脚本都自带静态服务 + mock API，直接 `python <脚本>` 即可：

| 脚本 | 守什么 | 结果 |
|---|---|---|
| `.playwright/verify-tabbar-fixed.py` | 滚动全过程 Tab 栏贴底、顶栏恒可见、document 不可滚、内容不被遮挡、桌面侧栏不跟着滚 | **15/15** |
| `.playwright/verify-multi-pages.py` | 9 个页面 × 2 断点：文档不滚 / 顶栏贴顶 / 底栏贴底 / 无横向溢出 | **18/18** |
| `.playwright/run-mobile-nav.py` | 项目自带 `verify-mobile-nav.py`（32 条既有契约） | **32/32** |
| `.playwright/verify-live-v2502.py` | **真实后端 + 真实登录**（127.0.0.1:9600，不 mock 任何 API）：滚动行为、产物 hash、版本号、路由重置 | **17/17** |

移动端核心数据（390×844）：

```
scroll    0 -> inner=0 doc=0 barGap=0 barPos=fixed headerTop=0
scroll  200 -> inner=200 doc=0 barGap=0 barPos=fixed headerTop=0
scroll  500 -> inner=500 doc=0 barGap=0 barPos=fixed headerTop=0
scroll  900 -> inner=553 doc=0 barGap=0 barPos=fixed headerTop=0   ← 已到底，底栏不动
```

`barTop` 六次采样全部是 `730`（= 视口 844 − 栏高 114），即**栏顶边在整个滚动过程中不变**。

另外：`npm run test:unit` **405/405** 通过；`tsc --noEmit` 无错。
eslint 的 5 个 error 全是既有问题（`SourcesGroup.tsx` 等本轮未触碰的文件），未新增。

### 真实后端复验（不是 mock）
本地起 `node index.js`（bindIP 127.0.0.1、端口 9600），真实登录后跑
`verify-live-v2502.py`：**17/17**。关键数据：

```
scroll    0 -> inner=0   doc=0 barTop=730 barGap=0 headerTop=0
scroll  500 -> inner=500 doc=0 barTop=730 barGap=0 headerTop=0
scroll 1400 -> inner=553 doc=0 barTop=730 barGap=0 headerTop=0   ← 到底后仍不动
```

产物核对：`scrollIntoView(mobile-tabbar)` 已消失、`#app-scroll` 与 `overscroll-contain` 均存在；
`/app/config.json` 的 `version` = `v2.50.2`。

（UI **不显示**版本号 —— `groups.ts` 里「关于」组被用户要求删掉了，
`/api/status` 也不返回版本，只有 uptime/内存。所以版本断言只能查 `/app/config.json`。）

### 顺带修了两个**测试自身**的过时断言（不是产品缺陷）

1. `verify-mobile-nav.py` 里「内容区与 Tab 栏不重叠」量的是 `main.getBoundingClientRect().bottom`。
   `main` 现在是滚动容器，盒子恒等于「顶到视口底」→ 断言恒红。
   改成量**最后一个内容元素**（实测 `lastBottom=575 < barTop=730`，内容没有被压住）。
2. 多页面探针第一版用 `offsetParent !== null` 判断栏可见 —— 但**`position: fixed`
   元素没有 `offsetParent`**（规范如此），会把两条栏都判成不可见（假阴性）。
   改成 `display` + 盒子面积判断。

> 这两条记在这里，是因为「测试红了」很容易被当成「改坏了」，进而去改产品代码迁就断言。

---

## 五、教训（下轮别再踩）

- **`scrollIntoView` 不是「对 fixed 元素安全的空操作」**。它的行为取决于包含块，
  而包含块会被 `transform/filter/backdrop-filter/contain/will-change/perspective` 改掉。
  拿它当「贴底补丁」等于埋一颗只在高版本 WebKit 上引爆的雷。
- **`position: fixed` 不是绝对的**。任何祖先加上上面那串属性，它就退化成相对祖先定位。
  这一类改动（给容器加 `backdrop-blur`、`animate-`、`will-change`）必须回归导航栏。
- **两种不同的定位机制同时失效时，先怀疑结构性原因**（谁在滚、视口有没有位移），
  而不是逐个元素找 typo。
- **iOS 的地址栏折叠是视口位移的来源**。让「只有一个内层容器滚」，
  比在根滚动上打各种 `dvh` 补丁可靠得多。

---

## 六、改动文件

```
web/src/App.tsx                            Shell 结构重排：外壳不滚 + main 滚；抽屉移出滚动区
web/src/components/player/MobileTabBar.tsx 删掉 scroll 里的 scrollIntoView hack 及其 effect
web/src/components/player/NowPlayingPanel.tsx  sticky → h-full（与新的 flex 行对齐）
web/src/index.css                          html/body/#root 高度链 + body overscroll
```

配套脚本：

```
.playwright/verify-tabbar-fixed.py       新增，15 条断言
.playwright/verify-multi-pages.py        新增，多页面高度链回归
.playwright/verify_tabbar_helpers.py     新增，静态服务 + mock API（含 /sw.js 兜底）
.playwright/run-mobile-nav.py            新增，用 mock 环境跑既有 verify-mobile-nav.py
.playwright/_probe-scrollhack.py         诊断：scrollIntoView hack 的对照实验
.playwright/_probe-containing-block.py   诊断：哪些祖先属性会让 fixed 失效
.playwright/verify-mobile-nav.py         修正一条过时断言（main 变滚动容器）
```

> 尚未完成：真机 iOS 复验。本轮所有结论来自 Chromium 的机制级复现
> （包含块对照表、scrollIntoView 拉扯实验），iOS 上的最终确认需要在
> 那台 iPhone 上再截一次同位置的图。
