# 阶段 0 — 性能基线与可度量验收标准

> 测量对象：`public/music/` 播放器（挂在 `/`）+ `public/` 后台（挂在 `/admin/`）。
> 测量方式：`node scripts/smoke/run.mjs --surface old --only perf`（用例见 `scripts/smoke/cases/perf.cases.mjs`）。
> 采集时间：2026-10-05，Node v25.6.0，无头 Chromium，本机回环（非 NAS）；数字用于纵向对比，绝对值随机器浮动。

## 一、实测数据（旧前端，阶段 0 基线）

| 指标 | 实测 | 说明 |
|---|---|---|
| `app.js` 原始体积 | **706.5 KB** | 播放器主脚本，单文件 |
| `app.js` gzip 体积 | **163 KB** | 线上传输量 |
| `index.html` 原始体积 | **455 KB** | 大量内联 onclick/内联样式 |
| `public/music/js/*.js` | **29 个文件 / 828 KB** | 首屏只加载其中一部分（见请求数） |
| 首屏 JS+CSS 传输量 | **562 KB** | gzip 后实际落线 |
| 首屏请求数 | **62 个**（另有 9 个后台轮询） | 36 个 JS + 3 个 CSS + 31 个接口/其他 |
| FCP | **216 ms** | `first-contentful-paint` |
| `domContentLoaded` | **2034 ms** | |
| `loadEventEnd` | **2050 ms** | |
| app 就绪（`switchTab`/`doSearch` 可用） | **2228 ms** | 比 load 晚约 200 ms，defer 脚本收尾 |
| JS 堆（首屏后） | **12 MB** | Chrome `performance.memory` 近似值 |
| JS 堆（播放中） | **12 MB** | 播放 1 秒 mock 音频期间；仅说明无泄漏量级 |
| 同一资源重复请求 `app.js` | 三轮均 **164.2 KB / 20~26 ms** | 见下 |

### 静态资源的压缩行为（PERF-04）

三轮相同请求 `Accept-Encoding: gzip`：`content-length` 都是 164.2 KB，耗时 20~26 ms 且没有明显变快。
说明 `serveStatic` **每次请求都重读文件并重新 gzip**，没有任何缓存 —— 这正是计划里"构建期预压缩"要治理的对象。
到 NAS（弱 CPU）上，1~2 MB bundle 每次请求重压 30~80 ms，多用户并发时会直接吃满 CPU。
**阶段 A 动作**：构建期产出 `.br`/`.gz`，运行时按 `Accept-Encoding` 直接吐预压缩文件 + `ETag`/`Last-Modified`。

## 二、可度量验收标准（预算）

预算写在用例里（`perf.cases.mjs` 的 `PERF_BUDGETS_OLD` / `PERF_BUDGETS_NEW`），按 `--surface` 取用：

| 指标 | 旧前端预算（记录现状，留余量） | 新前端目标（阶段 A 起） |
|---|---|---|
| `app.js` 原始体积 | ≤ 900 KB | ≤ 900 KB |
| `app.js` gzip 体积 | ≤ 200 KB | ≤ 200 KB |
| 首屏 JS+CSS 传输量 | ≤ 900 KB | **≤ 400 KB** |
| 首屏请求数 | ≤ 80 | **≤ 35** |
| `domContentLoaded` | ≤ 6000 ms | ≤ 3000 ms |
| app 就绪 | ≤ 12000 ms | ≤ 8000 ms |
| FCP | ≤ 8000 ms | ≤ 4000 ms |
| JS 堆（首屏/播放中） | ≤ 260 / 420 MB | ≤ 200 / 300 MB |

新前端目标比旧基线紧的只有三项（传输量、请求数、时间）：一个打包入口替掉 29 个零散 JS 与重复接口调用，是阶段 A 应该直接拿到的收益。
`perf.cases.mjs` 的 `budgetsFor(surface)` 会自动切换，`--surface new` 跑不过就是没达标，不靠人眼判断。

## 三、暂未纳入的指标（以及原因）

- **长列表滚动帧率**：fixture 的歌单/搜索结果每页只有 20 行，测不出帧率。阶段 D1 实现虚拟滚动、有了真实长列表（多平台聚合 60+ 行、下载队列、本地音乐库）之后再补这一项，测量方法：`requestAnimationFrame` 采样滚动 3 秒取 P50/P95 帧间隔。
- **内存绝对值**：`performance.memory` 是 Chrome 的非标准近似值，且不开 `--enable-precise-memory-info` 时粒度很粗。这里只用来看"有没有数量级变化"，不当绝对值验收。
- **NAS 真实环境数字**：本机回环没有 NAS 的 CPU/磁盘瓶颈，上述绝对时间会偏乐观。真正影响体感的是 NAS 上的首屏与切源延迟，阶段 A 上线后用同一套用例在 NAS 上跑一次，回填本节。

## 四、与其它指标的对照

- **解析延迟**：另有基线数据（平均 723 ms、8/8 可播），来自解析器 e2e，不在本文件重复；阶段 A/C 之后用同一批 `race-e2e-test.js` 与 `P04-*` 用例回归。
- **功能是否丢失**：不看性能，看 `docs/stage0/` 清单 + 冒烟比对（`baseline/compare*.md`）。
