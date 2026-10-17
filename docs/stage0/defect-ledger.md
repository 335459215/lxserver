# 阶段 0 — 缺陷台账

> 规则（来自重构计划）：**移植过程中发现的缺陷只记录，不顺手改**。每个缺陷单独排期，
> 修复时先在这里登记，避免同一问题在新前端里复活。
> 状态：`待排期` / `修复中` / `已修复(附提交)` / `不修(附理由)` / `随实现消失`。
>
> **2026-10-16 更新（v2.27.6）**：旧版前端（`public/music/**`、`public/index.html`、
> `public/app.js`）与 `src/server/subsonic.ts` 均已删除，新前端为 `web/`（React）。
> 因此凡引用这些路径的缺陷，**要么随实现消失，要么需重新定位**——见下表状态列。

| 编号 | 位置 | 一句话 | 严重度 | 状态 |
|---|---|---|---|---|
| D-001 | `public/music/js/batch_pagination.js:523` | `goToPage is not defined`，加载即抛错并中断后续 export，分页控件全废 | 高 | 随实现消失（旧前端已删） |
| D-002 | `public/music/js/dislike_manager.js:77` | 首屏 dislike 偶发 401，控制台报错（用户态未就绪就发请求） | 中 | 随实现消失（旧前端已删） |
| D-003 | `src/server/customSourceHandlers.ts` + 用户 sources.json | 自定义源 `lx.send` 写成三参会**静默丢 sources**，自愈逻辑再把 `sources.json` 覆写成 `[]` | 高 | **已修复**（v2.27.7，见下） |
| D-004 | `src/modules/utils/musicSdk/kw/musicSearch.js:100-108` + `server.ts:5758` | kw 空页/越界页 → 重试 3 次后抛 `try max num` → 搜索接口整体 500 | 中 | **已修复**（v2.27.7，见下） |
| D-005 | `/api/music/url` 成功响应 | 成功路径不返回 `attempts`，换源过程不可观测 | 中 | 已修复（musicResolver 现返回 `attempts`） |
| D-006 | `/api/config` POST 错误分支 | 出错只回 `Server Error`，无任何细节 | 低 | **已修复**（v2.27.7，见下） |
| D-007 | `serveStatic` 静态资源 | 每次请求重读文件 + 重压 gzip，无缓存 | 中 | **已修复**（v2.27.9，见下） |
| D-008 | `src/server/subsonic.ts:539,718-722` | Subsonic 单例可变字段跨请求共享（原文档记作 D-05） | 中 | 随实现消失（`subsonic.ts` 已删） |
| D-009 | 后台「需重启」提示与入口 | 改了只在启动时读取的键却没有提示，也没有重启入口 | 低 | **已修复**（v2.27.8，见下） |

> **说明**：原文档正文里出现过 `D-05` 这样的短编号引用，与表里的 `D-005` 不是同一项 ——
> 前者指 Subsonic 的单例可变字段（现已随实现消失，在此登记为 D-008 以消除歧义）。
>
> **D-009 补充**：原描述是「后台 UI 已只提示 `subsonic.*` 两项，漏了另外 3 个」。
> `subsonic.*` 随功能删除后，那两条提示也一并消失；新前端（`web/`）里**没有任何
> 重启提示**（已全量搜索确认）。也就是说这个缺陷从「提示不全」变成了「完全没有提示」，
> 仍需实现：设置页对这几个键标注「需重启生效」。

---

## 2026-10-16 修复批次（v2.27.7）

三项都配了回归测试与**变异测试**（把修复退回旧实现，断言测试确实失败）。

### D-003 已修复：自愈不再清空 supportedSources

**根因确认**：`loadUserApi` 里 `lx.send('inited', …)` 只要收到事件就 resolve，
`sources` 缺失时 `registeredSources` 保持空对象，但加载仍被判 `success`、
`info.sources` 为空。上层自愈拿这个「空」当权威结果，把已存的
`supportedSources` 覆写成 `[]`。

**修法**：
- `loadUserApi` 新增 `sourcesDeclared` 标记（脚本是否**真的**声明过 sources），
  并随返回值与 `apiInstance` 一起暴露。
- 自愈逻辑只在 `sourcesDeclared === true` 时才比对/更新，否则保留原列表并打日志。
- `lx.send` 收到多余参数（三参写法）时给出**可见警告**；`inited` 缺 sources 也告警。

**测试**：`test/d003SelfHeal.test.ts`（前提与标记）+ `test/d003SelfHeal2.test.ts`
（端到端：真实跑 `initUserApis`，断言磁盘上的 `sources.json` 未被清空）。
**顺带**：`initUserApis` 会启动 `fs.watch`，导致测试进程**永不退出**（表现为挂起而非失败）——
新增 `stopSourceWatcher()` 供测试关闭。

### D-004 已修复：kw 越界页返回空列表而非 500

**根因确认**：`musicSearch.js:103` 把「有总数但本页 0 条」当成需重试的失败，
重试 3 次后 `throw new Error('try max num')`，`server.ts` catch 直接 500。

**修法**：越界页不是错误，是「没有更多了」——`TOTAL === '0'` 或 `SHOW === '0'`
都返回空列表（保留 `total` 供前端判断到底）；`handleResult` 解析失败仍可重试，
但超过上限返回空列表而不是抛错。

**测试**：`test/d004KwEmptyPage.test.ts`（5 项：越界页、TOTAL=0、空响应、
正常页未被改坏、重试有上限）。

### D-006 已修复：配置保存失败回真实原因

**修法**：catch 改回 `{success:false, error: message}` JSON（**不回堆栈**，
堆栈只进服务端日志）。前端 `useConfig.ts` 同步解析该字段 ——
否则用户会看到一串裸露的 JSON。

**未修**：D-009（新前端完全没有「需重启生效」提示）。

---

## 2026-10-16 修复批次二（v2.27.8）

### D-009 已修复：补上重启入口，并更正原记录的键清单

**核实推翻了原记录**。原文写「后台 UI 已只提示 `subsonic.*` 两项，漏了另外 3 个」，
暗示那 3 个键本可以在 UI 上改、只是没提示。逐项核实后**并非如此**：

| 键 | 原记录 | 实际核实结果 |
|---|---|---|
| `port` | 改了要重启 | 不在 `/api/config` POST 白名单里 → **界面上根本改不了**；确需重启 |
| `bindIP` | 改了要重启 | 不在白名单；且**全代码库只被回显，从未被消费**（`startServer(port, '0.0.0.0')` 硬编码）→ 改它没有任何效果，不存在"需重启"问题 |
| `cache.namingPattern` | 改了要重启 | 不在白名单；且运行时有 `fileCache.setNamingPattern`，是**即时生效**的 |
| `serverCacheLocation` | 改了要重启 | 不在白名单；且它其实是**用户设置键**（存 `settings.json`），不是全局配置项 |

同时确认：新前端暴露的 **25 个可编辑键全部在运行时被 `config['…']` 读取**，
即**改了即时生效、都不需要重启**。

**所以真问题不是「提示缺失」，而是**：
1. 确实需要重启的 `port` / `serverCacheLocation` **不在白名单、界面改不了**，
   用户只能手改服务器上的 `config.js`；
2. 改完之后**没有任何入口让它生效** —— 后端 `/api/restart` 一直存在，
   但新前端从未调用过，这个能力等于被丢掉了。

**修法**：在「设置 → 日志」新增「重启服务」区块：
- 明确列出哪两个键需要重启、其余即时生效（避免用户以为所有设置都要重启）
- 二次确认对话框（提示会中断播放/下载/同步）
- 发出重启指令后**轮询等待服务真的回来**再刷新页面 —— 否则用户看到连接错误，
  会以为把服务弄坏了
- 轮询用**无需鉴权**的 `/config.json` 判活（重启期间会话可能未就绪，
  用鉴权接口会把"已恢复但未登录"误判成"还没起来"），并加 `cache: 'no-store'`
  防止浏览器返回缓存把"没起来"判成"已恢复"

**测试**：`.playwright/_verify-restart-ui.py`（10 项，含"确认框打开/取消可关"，
且**刻意不点确认**以免重启线上服务）。

---

## 2026-10-17 修复批次三（v2.27.9）

### D-007 已修复：静态资源内容缓存

**背景**：构建期预压缩（`.br`/`.gz` 兄弟文件）已经做了，但 `serveStatic` 仍每请求
`stat` + `readFile`，且在没有预压缩兄弟文件时**每次现压 gzip**（NAS 弱 CPU 上 30~80ms）。

**修法**：新增 `src/server/staticCache.ts`（LRU + 字节上限），接进 `serveStatic` 的
三条路径：预压缩变体、原文、现压 gzip 结果。

**这类缓存翻车几乎都在三处，所以按三点设计并各配测试**：
1. **必须有界** —— 缓存键是绝对路径而路径来自 HTTP 请求，攻击者可构造大量不存在的
   路径撑爆内存。用 LRU + 总字节上限 + **单条目上限**（`fpcalc.exe` 4MB 不缓存，
   否则会把真正热点的 bundle 挤掉），且只缓存 `stat` 成功的文件。
2. **必须能被发版失效** —— 指纹用 `{mtimeMs, size}` 而非仅 key。镜像更新后同名文件
   （如不带哈希的 `app.js`）内容变了而路径没变，只按 key 命中会**永远发旧内容**。
3. **必须区分压缩表示** —— 缓存键带 `::br` / `::gzip` / `::dyn-gzip` 变体。
   混用会把压缩字节当原文发出去，表现为白屏/乱码，且只在特定 `Accept-Encoding` 下复现。

另外做了 **in-flight 去重**：并发冷读同一文件只读一次盘。

**实测收益**（本机，`/app/assets/index-*.js` 673KB）：
| 场景 | 耗时 |
|---|---|
| 首次（冷，含读盘） | 18.81 ms |
| 稳定后（热，走缓存） | 7.89 ms（**2.4x**） |
| br 预压缩命中 | 1.24 ms |
| `fpcalc.exe` 4MB（超上限，不缓存） | 20.06 ms（符合预期） |

**测试**：
- `test/staticCache.test.ts` 12 项（失效 / LRU / 字节上限 / 并发去重 / 失败不缓存…）
- `.playwright/_verify-static-cache.py` 20 项端到端（真实 `serveStatic` 接线、
  压缩协商、304、**改文件后立刻失效**、404、路径穿透）
- `.playwright/_verify-static-cache-perf.py` 性能 A/B（防"加了复杂度却没收益"）

**踩坑记录（写给后来的人）**：第一版端到端测试用浏览器 `fetch` 设置
`Accept-Encoding`，10 条断言全红却**全是假阳性** —— 浏览器把该头列为
forbidden header name 会静默忽略，且 `arrayBuffer()` 自动解压。测压缩协商
必须用 `http.client` 之类的原始客户端。

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
