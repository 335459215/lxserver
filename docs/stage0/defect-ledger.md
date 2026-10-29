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
| D-010 | `bindIP` 配置项 | 只在 `/config.json` 回显，`index.ts` 硬编码传 `'0.0.0.0'`，**从未生效** | 中 | **已修复**（v2.27.10 + v2.27.11，见下） |
| D-011 | `Dockerfile` 的 `ENV BIND_IP` | 环境变量优先级高于配置文件，硬编码 `'0.0.0.0'` 让用户的 `bindIP` **永远无效** | 中 | **已修复**（v2.27.11，见下） |
| D-012 | `web/src/components/player/QualityMenu.tsx` | 降级判定用「不等」而非「更低」，实得**更高**时也标成降级并谎报「该曲不可得」 | 中 | **已修复**（v2.28.0，见下） |
| D-013 | 同上 · `MenuContent` | 菜单长到 7 项双行后，手机上前者顶部被裁 73px，「自动最高档」开关点不到 | 中 | **已修复**（v2.28.0，见下） |

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

---

## 2026-10-17 修复批次四（v2.27.10）

### D-010 已修复：bindIP 从"死配置"变成真正生效

**发现**：`startServer(port, ip)` 一直支持绑定地址，但 `index.ts` 硬编码传
`'0.0.0.0'`。于是 `config.js` 里的 `bindIP` **只在 `/config.json` 里被回显，
从未被消费**。用户把它改成 `127.0.0.1`（前面挂反向代理时的常见做法）会发现毫无变化 ——
服务仍然监听所有网卡。

这不只是"配置没反应"，而是**安全语义错误**：用户以为已经限制了访问面，实际没有。

顺带发现 `BIND_IP` 环境变量也一直是死代码（只在被注释掉的旧行里出现过）。

**修法**：
- `index.ts` 真正读取 `config.bindIP`；空值/缺失回落 `'0.0.0.0'`，
  避免把服务绑死在不存在的地址上起不来
- `BIND_IP` 环境变量接通（与 `PORT` 一致，环境变量可覆盖配置文件）
- `POST /api/config` 白名单补上 `bindIP` 与 `port`（此前两者都改不了；
  两者都只在 `startServer()` 消费，改完需重启 —— 设置页「重启服务」区块已写明）

**验证**（`.playwright/_verify-bindip.py`，真起三次服务）：

| 场景 | 结果 |
|---|---|
| `bindIP=127.0.0.1` | 日志 `Listening on 127.0.0.1`；局域网 `192.168.1.42:9611` **不可达** |
| `bindIP=0.0.0.0` | 日志 `Listening on 0.0.0.0`（默认行为未被改坏） |
| `bindIP` 为空 | 回落 `0.0.0.0`，服务正常启动（不会起不来） |

`test/bindIP.test.ts` 3 项（含"绑 127.0.0.1 后局域网不可达"这条安全断言）。
变异测试 2 项：退回硬编码 → 3 条断言失败；去掉空值回落 → 启动失败被捕获。

**踩坑（写下来免得再犯）**：变异脚本判定"未命中"了好几次，实际变异**已被捕获**
（`FAIL=3`）。根因是 Windows 中文环境下 `execSync` 按 cp936/GBK 解码子进程输出，
中文全变乱码，`out.includes('日志显示监听')` 永远为 false。
必须设 `PYTHONIOENCODING=utf-8` 并显式按 utf8 解码。

### 顺带排查：fpcalc 不是缺陷（虚惊一场）

上一轮注意到镜像里 `public/music/bin/` 只有 `README.md`，怀疑音频指纹功能失效。
查清后**功能完好**：

- `Dockerfile` 里 `apk add chromaprint`，容器内 `/usr/bin/fpcalc` 存在，
  `fpcalc -version` → `1.6.0`
- `identify.ts` 的 `getFpcalcPath()` **优先查 PATH**，只有系统没有时才回落到
  `public/music/bin/` 下的打包二进制。所以该目录为空是**有意设计**，不是漏打包。

---

## 2026-10-17 修复批次五（v2.27.11）

### D-011 已修复：Dockerfile 的 `ENV BIND_IP` 让 bindIP 永远失效

**这是 D-010 的第二层，部署后才暴露。** v2.27.10 修好了 `index.ts` 硬编码问题，
本地单测、变异测试、端到端全部通过 —— 但**线上仍然监听 `0.0.0.0`**。

**根因**：`Dockerfile` 第 36 行 `ENV BIND_IP='0.0.0.0'`。环境变量优先级**高于**
`config.js`（`index.ts` 里 `envParams.BIND_IP` 会覆盖配置文件）。于是：
- 用户改 `config.js` 的 `bindIP` → 被镜像默认值压住，永远无效
- `/config.json`、`/api/config`、启动日志**全都显示 `0.0.0.0`**
- 从任何界面都看不出"是镜像的默认值在作祟"

**为什么本地测试拦不住**：单测与变异测试跑的是**本机进程**，没有镜像的 ENV。
这类"部署环境与开发环境不一致"的缺陷，只有真正在容器里跑才会暴露。

**修法**：
- 注释掉 `Dockerfile` 的 `ENV BIND_IP`，并写明原因（需要固定地址时由使用者在
  `compose.yaml` 的 `environment` 里显式给 —— 那是用户的明确意图，镜像不替他决定）
- `/api/config` 的 **GET 白名单补上 `bindIP` 与 `port`**（此前读回来永远是
  `undefined`，一度让我误判成"写入成功但值丢了"，实际是读取侧没返回）
- 新增 `test/dockerfileEnv.test.ts` 3 项守住部署契约，其中一条是
  **"测试的测试"**：验证 ENV 解析器能区分注释行与生效行，
  否则"不得有 BIND_IP"这条断言在已注释掉时也会失败（说明解析有 bug）
- `test/bindIP.test.ts` 增加"启动流程真的把 config.bindIP 传给 listen"的
  **接线验证**（前面的用例只验证 `http.listen` 本身的行为）
- 变异测试 1 项：把 `ENV BIND_IP` 加回去 → 2 条断言失败，已进 CI（累计 20 项）

**线上验证（决定性证据）**：
```
BIND_IP=(未设置) ✓
config.js: "bindIP": "127.0.0.1"
netstat:   tcp 0 0 127.0.0.1:9527 LISTEN     ← 真的生效了
```

### ⚠️ 顺带查清：`bindIP` 在 Docker 下管不到外部访问

实测把 `bindIP` 设成 `127.0.0.1` 后，容器内确实只监听回环，但**局域网仍能访问**
`192.168.1.28:9528`。原因：

```
宿主机: docker-proxy 监听 0.0.0.0:9528  →  转发进容器 127.0.0.1:9527
```

compose 的 `ports: "9528:9527"` 由 `docker-proxy` 在宿主机上监听，与容器内
绑什么地址无关。**所以想不对外暴露，正确做法是改 compose 端口映射**
（如 `"127.0.0.1:9528:9527"`），而不是改 `bindIP`。

`bindIP` 真正有用的场景：裸机/非容器部署（直接 `node index.js`），
或容器内限制只让同网络 sidecar 访问。此结论已写进 `config-keys.md`。

**测试无法覆盖这一条**（需要真实 docker + 宿主网络），所以在
`bindIP.test.ts` 顶部以注释形式记录，并在 `config-keys.md` 用实测表格说明。

---

## 2026-10-20 修复批次六（v2.28.0）

本轮主线是功能（每曲可用音质档位 + 按曲目自动选最高档），但**过程中实测到两个真缺陷**，
按「发现即登记」的规则补在这里。

### D-012 已修复：降级判定用「不等」而非「更低」，升级被误标成降级

**位置**：`web/src/components/player/QualityMenu.tsx`（原 `degraded` 表达式）

**现象**：用户首选 `flac`、实得 `flac24bit`（更高）时，界面显示红点 +
「首选 FLAC 该曲不可得，已自动降级到 24bit」。既谎报降级，又给了相反的结论。

**根因**：`degraded = resolvedQuality !== preferredQuality` —— 「不等」不等于「更低」。
`flac` 与 `flac24bit` 确实不相等，但只有后者高于前者。

**为什么以前没暴露**：解析器只会**向下**回退，实得永远 ≤ 首选，两者在这个前提下等价。
v2.28.0 加了「按曲目自动选最高档」后，实得**高于**首选变成正常情况，缺陷立刻显形。

**修法**：`isDegraded()` 按档位序号比较（`web/src/lib/qualityOptions.ts`）；
任一侧是未知档位（自定义音源）时无法比大小，才退回「不等即降级」的保守判断。

**测试**：`test/qualityOptions.test.ts` 的「升级与同档都不算降级」；
变异测试把实现改回 `return true` → 该用例变红（已捕获）。

### D-013 已修复：音质菜单在手机上顶部被裁掉 73px（功能项点不到）

**位置**：`web/src/components/player/QualityMenu.tsx` 的 `MenuContent`

**现象**：菜单从「6 行单行」变成「7 项双行」（约 512px）后，390×844 与 360×640 下
Radix 翻转朝上仍放不下，菜单矩形 `y = -73` —— 标题「播放音质」与
「按曲目自动选最高档」开关**整个在视口外，点不到**。

**为什么断言抓不到**：被裁掉的元素**仍在 DOM 里**，`is_visible()` 返回 true，
`count()` 也正常。只有把 `bounding_box()` 与视口高做比较才看得见。

**修法**：`max-h-[var(--radix-dropdown-menu-content-available-height)]` + `overflow-auto`。
用 Radix 自己算出的「当前展开方向剩余空间」，而不是猜一个 `80dvh`
（同一个 80dvh 在 844 高下是 675px、在 640 高下是 512px，两种都不可靠）。
另注意 `MenuContent` 基类是 `overflow-hidden`，覆盖必须用同组的 `overflow-auto`；
写 `overflow-y-auto` 属另一组，两者并存时谁生效取决于 CSS 生成顺序。

**测试**：`.playwright/_verify-quality-menu-fit.py` —— 5 种视口 × 3 断言
（菜单项数 / 完整落在视口内 / 最后一个档位可点）。修复前 9/15，修复后 **15/15**。

### 顺带：三个验证脚本自身过期（不是产品缺陷，但会掩盖回归）

`verify-quality` / `verify-music-ui` / `verify-shell` 共 18 条断言在**本次改动前就已红**，
原因是对着 v2.26.0 之前的 UI 写死了文案与结构（详见 `PLAYER-HANDOFF.md` §十）。
已全部按当前信息架构重写，并用**旧版线上（NAS v2.27.12）做 A/B** 确认与本次改动无关。
重写后全量回归 **173/173**。

### D-014 已修复：歌单播放「显示 A、播出来是 B」（高音质 + 自动选最高档必现）

**报告（2026-10-29）**：歌单播放时实际出声的歌曲与界面显示的**不是同一首**；
把音质选到最高、再打开「按曲目自动选最高档」后立刻出现。手动点「下一首」/「上一首」
偶尔恢复同步，但多数时候仍错位。**直接搜索歌手/歌曲播放不复现**。

**根因（两层，都只在歌单 + 高音质路径上显形）**

1. **切歌时 `<audio>` 还在播上一首**（`web/src/lib/player.tsx` 的 `loadAndPlay`）。
   切歌只改了 React state（`current` 立刻变新歌、界面同步刷新），但 `<audio>`
   仍挂着上一首的 src 继续出声，直到新链接**解析完成**才换声。
   - 320k/128k 大多命中粘滞缓存或播放缓存，解析接近瞬时 → 窗口小到听不出；
   - flac/hires 首次解析要 1~5 秒，叠加「自动选最高档」把起手档位抬到无损 →
     窗口被放大到**清晰可闻**。这就是「只有高音质 + 歌单才出现」的原因。
   - 点下一首/上一首「偶尔恢复」= 解析快的那几首窗口恰好很短。

2. **跨平台替身按歌名「包含」匹配，同名的 Live/伴奏版被当成同一首**
   （`src/server/musicMatch.ts` 的 `getSongMatchScore`）。
   高音质档原平台常拿不到链接 → 服务端在其它平台按「歌名+歌手」搜替身 →
   旧规则只要求 `候选名.includes(目标名)`，且**任一侧时长缺失就跳过时长校验** →
   `晴天 (Live)` / `晴天 (伴奏)` 被当作 `晴天` 顶上去（另一个录音）。
   低音质档原平台大多直接命中，替身几乎不参与 —— 与「只有高音质才复现」吻合。

3. **错曲被播放缓存永久固化**（`web/src/lib/audioCache.ts` + `player.tsx`）。
   替身字节被写进**原歌**的缓存键。此后每次播放都直接命中缓存、连解析器都不经过，
   用户在 UI 上点「换源重试」也救不回来 —— 表现为「错位一直好不了」。

**修法**

- `loadAndPlay`：**换曲时立刻** `pause()` + 清 `src` + `load()`（`audioSongKeyRef`
  判断是否真的换了曲目；同一首重新解析 — 切音质/开自动档/换源重试 — **保持出声**，
  否则切个音质就断流）。
- `getSongMatchScore`：新增**版本词护栏**（live/伴奏/remix/cover/不插电/纯音乐…，
  两侧集合不一致直接否决；全角字母与全角括号都归一化）+ **时长必填护栏**
  （目标有时长、候选没有 → 不再放行）。
- 播放缓存：写入时记录 `resolvedKey`（实际命中的曲目）；**替身不写缓存**；
  命中缓存时若 `resolvedKey !== 请求 key` 则判为脏数据、删除并重新解析。
- `advance`/`playAt`/`playSong`/`playQueue`：同步更新 `stateRef`。`setState` 是异步的，
  连点「下一首」时第二次会从旧下标重算，导致高亮与音频错开一位。
- `prev`：只在 `<audio>` 里**确实是当前曲目**时才认 `currentTime > 3s`
  （切歌解析期间音频已清空，旧的判断会误走「回到开头」）。

**测试**
- `test/substituteMatch.test.ts`（16 项）：Live/伴奏/缺时长/全角字母等边界。
- `test/searchSession.test.ts` 见 D-015。
- `scripts/mutation-check-substitute.cjs`（6 个变异全部被捕获，已注册进 `test:mutation`）。

---

### D-015 已修复：搜索结果点歌播放后返回，搜索页整页空白

**报告（2026-10-29）**：搜索歌手或歌曲 → 点结果播放 → 点「返回」→
**搜索页全空白**，必须重新搜一遍。用户明确希望回到**原来的搜索结果页**。

**根因**：`SearchPage` 把 `keyword`/`source`/`kind`/`results`/`phase` 全部放在
**组件本地 state**。React Router 切走路由时组件卸载，state 归零；返回时重新挂载
= 全新实例 = 空态。结果数组要重新打 5 个上游平台（数秒），体感就是「白屏 + 重搜」。

**修法**（`web/src/lib/searchSession.ts` + `SearchPage.tsx`）
- 模块级单例保存**最近一次 done 态**的搜索快照（关键词/来源/类型/结果/是否还有更多）。
- 重新挂载时，**仅当 URL 的 `?q=` 与快照完全一致**才恢复 ——
  从侧栏点「搜索发现」（无 `?q`）仍是干净的新搜索页，不会被旧结果"粘住"。
- `createSearchPager` 新增 `hydrate()`：恢复时把结果**连同页码**接管进控制器，
  否则恢复后「加载更多」会因 `loadedPage=0` 被守卫挡掉（按钮点了没反应）。
- 滚动位置：卸载时记 `window.scrollY`，恢复时等两帧再 `scrollTo`
  （列表刚挂载时高度没铺开，立刻滚会被夹到 0）。
- `phase=loading/error` **不覆盖**上一次成功快照（半截状态没有恢复价值）；
  退出登录时 `clearSearchSnapshot()`（与 `player.clear()` 同一语义）。

**测试**：`test/searchSession.test.ts`（13 项：恢复边界、滚动位置、不恢复 loading 等）。
