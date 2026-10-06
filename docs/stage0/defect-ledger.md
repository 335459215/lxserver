# 阶段 0 — 缺陷台账

> 规则（来自重构计划）：**移植过程中发现的缺陷只记录，不顺手改**。每个缺陷单独排期，
> 修复时先在这里登记，避免同一问题在新前端里复活。
> 状态：`待排期` / `修复中` / `已修复(附提交)` / `不修(附理由)`。

| 编号 | 位置 | 一句话 | 严重度 | 状态 |
|---|---|---|---|---|
| D-001 | `public/music/js/batch_pagination.js:523` | `goToPage is not defined`，加载即抛错并中断后续 export，分页控件全废 | 高 | 待排期 |
| D-002 | `public/music/js/dislike_manager.js:77` | 首屏 dislike 偶发 401，控制台报错（用户态未就绪就发请求） | 中 | 待排期 |
| D-003 | `src/server/customSourceHandlers.ts` + 用户 sources.json | 自定义源 `lx.send` 写成三参会**静默丢 sources**，自愈逻辑再把 `sources.json` 覆写成 `[]` | 高 | 待排期 |
| D-004 | `src/modules/utils/musicSdk/kw/musicSearch.js:100-108` + `server.ts:5758` | kw 空页/越界页 → 重试 3 次后抛 `try max num` → 搜索接口整体 500 | 中 | 待排期 |
| D-005 | `/api/music/url` 成功响应 | 成功路径不返回 `attempts`，换源过程不可观测 | 中 | 待排期 |
| D-006 | `/api/config` POST 错误分支 | 出错只回 `Server Error`，无任何细节 | 低 | 待排期 |
| D-007 | `serveStatic` 静态资源 | 每次请求重读文件 + 重压 gzip，无缓存 | 中 | 阶段 A 一并处理 |

---

## D-001 批量分页在加载时就已废掉

**现象**：任何一次播放器加载都会在控制台留下 `Uncaught ReferenceError: goToPage is not defined`
（冒烟套件 `classifyPageErrors` 里以 `KNOWN_DEFECTS` 形式记录，旧前端基线命中）。

**根因**：`batch_pagination.js` 结尾是一串 `window.xxx = xxx` 导出，其中
`window.goToPage = goToPage;`（第 523 行）引用的 `goToPage` **在该文件里从未定义**
（真正的定义在 `app.js:42`，加载时序更晚）。这一行抛错后，同块剩余的导出不会再执行。

**用户可见后果**：`nextPage` / `prevPage` / `jumpToPage` / `changeItemsPerPage` 从未挂到
`window` 上，而 `public/music/index.html` 第 524、540、542、550、1644 行直接以内联
`onclick="prevPage()"` 之类调用它们 —— 点「上一页 / 下一页 / 跳页 / 每页条数」全部报错。
（`window.goToPage` 那行本身反而是多余的：`app.js:42` 已经定义过同名函数。）

**修法方向**：删掉第 523 行（或改成 `if (typeof goToPage === 'function')` 守卫），
并给这四个函数补一条 UI 冒烟用例（当前套件没有覆盖批量分页控件）。

## D-002 首屏 dislike 偶发 401

**现象**：偶发 `console.error: [Dislike] load failed: Error: 请先登录本地账号`
（同一份 fixture，时有时无；冒烟 UI-Y04 曾稳定命中一次）。

**根因（待确认）**：`dislike_manager.js` 的 `request()` 会先 `await ensureUserAuthToken()`，
再取 `getUserAuthHeaders()`。`ensureUserAuthToken()` 在「有 username 无 password」时直接
`return false` **不清 token**，因此已种下的 `lx_user_token` 仍在；但请求偶尔仍以 401 返回。
怀疑是首次进入时用户态/公开空间上下文还没切完就发了请求（`isViewingPublicFavorites`
分支可能带上 `_open` 用户名与不属于它的 token，服务端 `verifyUserAuth` 判失败）。

**影响**：控制台噪音 + 那一轮的厌恶过滤没生效，需刷新才恢复。不影响播放主链路。

**修法方向**：首屏 dislike 加载改到用户态就绪之后（或在 401 时静默重试一次），
不要往控制台抛 error。

## D-003 自定义源三参 `lx.send` 静默吞掉 + 自愈毁数据

**现象**：按某些第三方教程写成
`globalThis.lx.send('inited', null, { status, openDevTools, sources })` 的源，
服务端日志显示"成功加载 … 支持平台:（空）"，且 `data/users/source/<user>/sources.json`
里的 `supportedSources` 被改写为 `[]` —— 用户什么都没做错，源却"坏掉"了，再上传也一样。

**根因**：本服务端的 `send` 是 **两参** 形式 `(eventName, data)`
（`src/server/customSourceHandlers.ts` 的报错文案也写的是两参），
三参写法拿不到 sources；随后自愈逻辑认为"源声明与实际不符"，把 sources.json 覆写掉。
**自愈是破坏性的，且没有任何提示。**

**影响**：高。自定义源是这个项目最重要的扩展机制，写错一个签名就静默失效还丢配置。

**修法方向**：① `send` 对第三参给出可见警告；② 自愈前先备份/只在确认能重新拿到声明时才覆写；
③ 文档与示例脚本统一两参写法（fixture 已按两参写，见 `scripts/smoke/fixtures/sources/mock-kw.js`）。

## D-004 kw 空页让整个搜索 500

**现象**：翻到最后一页之后再翻（或前端预取越界页）时，
`/api/music/search` 返回 `500 {"error":"try max num"}`，
前端控制台 `[Search] 搜索失败: Error: 搜索请求失败: 500 Internal Server Error`，用户看到搜索"坏了"。

**根因**：kw SDK 把「有总数但本页 0 条」当成需要重试的失败
（`musicSearch.js:103`：`if (!result || (result.TOTAL !== '0' && result.SHOW === '0')) return this.search(..., ++retryNum)`），
重试 3 次后 `throw new Error('try max num')`；`server.ts:5758` 的 catch 直接 500。
叠加前端预取没有停止条件（`[Prefetch] 触及本地末页，自动拉取后续 3 页`），末页之后必然撞上。

**证据**：冒烟调查期间稳定复现（45 首 fixture，第 4 页起 500）。
**注意**：kw 越界页的真实返回形态未知，mock 无法稳定复现，因此 mock 按
"越界页返回 `TOTAL='0', SHOW='0'`" 建模（`scripts/smoke/lib/mock.mjs` 有注释），
这样套件是绿的；这个缺陷靠上面的证据链记录，不靠套件看守。

**修法方向**：① 服务端对 `try max num`（以及"本页 0 条"）返回 200 + 空数组，让翻页自然结束；
② 前端预取在收到空页/短页后停止。

## D-005 解析成功时看不到换源过程

**现象**：`POST /api/music/url` 成功时返回
`{url, type, sourceId, sourceName, requestedSource, resolvedSource, resolvedSong}`，
没有 `attempts`；失败路径反而有。于是"这首歌换了平台、试过几个源"在成功时无据可查。

**影响**：排查"为什么这首歌变慢/为什么音质变了"只能看服务端日志。
换源可观测性是这个项目的核心卖点之一，缺了它等于没有仪表盘。

**修法方向**：成功响应里同样带回 `attempts`（失败项 + 胜出项 + 各源耗时），
前端在成功提示里可展开。接口字段新增是兼容的，不影响现有调用方。

## D-006 `/api/config` 出错只有一句 `Server Error`

**现象**：后台配置页保存失败时弹 `Server Error`，不知道是哪个键、哪种非法（路径冲突？类型错？越权？）。

**根因**：`/api/config` POST 的 catch 只回固定文案，不带 `err.message` 与出错的键名。

**修法方向**：回 `{ error: message, key }`（注意别把内部路径/堆栈透给前端）。

## D-007 静态资源每次请求都重读 + 重压

**现象**：同一 `app.js` 连续请求三轮，每次 20~26 ms、线上 164.2 KB，没有任何变快。

**根因**：`serveStatic` 无缓存，每次都 `readFile` + `gzipSync`。
707 KB 的文件每次重压，NAS 弱 CPU 上 30~80 ms 起，并发时直接吃掉 CPU 预算。

**处置**：不单独排期 —— 重构计划阶段 A 的"构建期预压缩"就是治这个的，
届时用 `PERF-04` 用例的数字做前后对照。

---

## 非缺陷（记下来免得反复讨论）

- 搜索结果行的「歌手」列点击是**按歌手重新搜索**（`app.js` 行内
  `onclick="event.stopPropagation(); …doSearch()"`），整行中心点落在该列上。
  这是设计，不是 bug；但自动化测试点整行不会触发播放，必须点行内播放按钮
  （`scripts/smoke/cases/ui.cases.mjs` 的 `playFirstResult` 已注明）。
- 播放地址最终走 `/api/music/download?url=…` 代理而非裸外链，是既有设计（SSRF/防盗链），
  冒烟 UI-P04 对它做了断言，不算缺陷。
