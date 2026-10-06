# scripts/smoke — 冒烟测试框架

阶段 0 的能力对照测试：**同一套用例分别跑旧前端（`--surface old`）和新前端（`--surface new`），
逐项比对通过与否**。"没丢功能"靠客观证据，不靠人眼。

```
node scripts/smoke/run.mjs --surface old          # 旧前端全量（api + ui + perf）
node scripts/smoke/run.mjs --surface old --only api
node scripts/smoke/run.mjs --surface old --only ui
node scripts/smoke/run.mjs --surface old --only perf
node scripts/smoke/run.mjs --surface both         # 跑完两边并产出新旧比对
node scripts/smoke/run.mjs --surface old --filter UI-P04 --headed   # 单条调试，看浏览器
```

结果写到 `scripts/smoke/baseline/`：`<surface>-<时间戳>.md/.json`，并始终刷新 `-latest`；
`--surface both` 额外产出 `baseline/compare.md/.json`（逐项标注 一致 / 回归 / 改善 /
新前端缺少 / 新前端新增）。

## 环境怎么搭的（ hermetic ）

- **数据隔离**：每次运行在系统临时目录建一份全新 fixture data（`lib/fixture.mjs`），
  跑完整体删除。**线上 `data/` 永不被触碰**；`--keep` 可留下现场复查。
- **不碰真实音乐平台**：`lib/mock.mjs` 起一个本地服务，同时扮演两件事 ——
  ① 服务端出网代理（内置音乐 SDK 的 search/hotword/lyric 全部打到它）；
  ② mock 音频文件服务器（自定义源返回的播放地址指向它）。
  对 https 一律 502：不做 TLS 中间人，也保证测试流量不出网。
- **服务端**：用 `tsx` 直接跑 `src/index.ts`（编译产物 `server/` 是旧的，别用）。
- **浏览器**：Playwright + `--autoplay-policy=no-user-gesture-required --mute-audio`，
  后台用例用管理员密码预置 `localStorage.lx_auth`。

## 两个必须知道的坑（写新用例会反复撞上）

1. **播放器没有原生 select 可点**。`CustomSelectManager` 把所有 `<select>` 换成了
   portal 下拉，原 select 被 `display:none`。要用 `#cs-w-<selectId> .cs-trigger` 打开、
   再点 `.cs-dropdown .cs-option`（见 `selectSearchSource()`）。
2. **`#search-input` 带 `readonly` + `onfocus` 移除**。必须 `page.click()` 之后再 `fill()`。
3. **结果行不能点整行**：行的水平中心在「歌手」列上，那一列是"按歌手搜索"，
   会 `stopPropagation`。播放要点行内 `button[title="播放"]`（见 `playFirstResult()`）。
4. **首次访问有「项目使用声明」遮罩**（`common_ui.checkProjectAgreement`）会拦截所有点击。
   功能性用例预置 `lx_agreement_accepted=true`；遮罩本身由 `UI-Y04` 专门验证。

## 目录

| 文件 | 作用 |
|---|---|
| `run.mjs` | CLI 入口 + 环境编排（fixture / mock / server / browser / 预登录） |
| `cases/api.cases.mjs` | 34 条接口契约用例（登录、歌单、厌恶库、设置、token、解析、搜索、后台、缓存、本地音乐、下载） |
| `cases/ui.cases.mjs` | 14 条界面用例（首屏、搜索、端到端播放、主题、设置页、响应式、后台各页、PWA、声明遮罩） |
| `cases/perf.cases.mjs` | 5 条性能用例（包体积、首屏时间、请求数、重复压缩行为、内存），带预算，按 surface 切换 |
| `lib/fixture.mjs` | 隔离 data 目录 + 自定义源（mock-kw / mock-dead） |
| `lib/mock.mjs` | mock 音乐平台：kw 搜索（45 首，可翻 3 页）、热搜、歌词（按 kw 的 yeelion+deflate 协议编码）、1 秒 WAV 音频 |
| `lib/server.mjs` / `lib/browser.mjs` / `lib/http.mjs` / `lib/report.mjs` | 服务端启动、浏览器上下文、HTTP 客户端、报告与比对 |

## 加一条用例

在 `cases/*.cases.mjs` 的数组里加一个 `{ id, group, async run(ctx) }`，返回一个对象作为详情
（会进 JSON 报告）。`ctx` 上有 `baseUrl`、`playerUrl`、`adminUrl`、`token`、`browser`、
`http`、`surface`。抛错即失败，错误信息会写进报告。

页面错误由 `collectPageErrors` 收集；命中 `KNOWN_DEFECTS` 的算"已知缺陷"，
其余一律算失败 —— 新增的静默报错不会悄悄溜过去。已知缺陷清单与
`docs/stage0/defect-ledger.md` 保持同步。

## 新前端（阶段 A 起）

`--surface new` 指向 `/app` 与 `/app/admin/`（`run.mjs` 的 `SURFACES` 里改）。
在它上线之前这个 surface 必然全红，属预期；每完成一个阶段就跑一次 `--surface both`，
用 `compare.md` 看哪些用例从"新前端缺少"变成"一致"。性能预算在 `new` surface 上更紧
（传输量 ≤400KB、首屏请求 ≤35），见 `perf.cases.mjs` 的 `PERF_BUDGETS_NEW`。
