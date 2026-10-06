# 配置键全景（全局 105 键 + 用户 60 键 + 音效 9 键 + 外观若干）

> 两套命名空间**在合并的"设置中心"里必须分开呈现**，否则用户会把"服务器配置"
> 当成"我的偏好"改，或反之。
> - 全局 = `src/defaultConfig.ts` ↔ `data/config.js`，服务端语义，**一台服务器一份**
> - 用户 = `public/music/app.js:82-145` 的 `DEFAULT_SETTINGS` ↔ `data/users/<dir>/settings.json`，**每人一份**
>
> 勘查时间 2026-10-05，commit `191edb0`。

## 1. 全局配置键（A 表）

| 键名 | 默认值 | 作用 | UI 分组 | 需重启 |
|---|---|---|---|---|
| `serverName` | `'lxserver'` | 同步服务名，注入前端 | 基础服务 | 否 |
| `bindIP` | `'0.0.0.0'` | 声明绑定 IP（实际主监听硬编码 0.0.0.0，本键仅参与序列化） | 基础服务 | 是 |
| `port` | `9527` | 主 HTTP/WS 端口 | 基础服务 | 是 |
| `debug.enabled` | `false` | 调试日志总开关 | 基础服务 | 否 |
| `disableTelemetry` | `false` | 关闭匿名数据上报 | 基础服务 | 否 |
| `system.allowUnsafeVM` | `false` | 允许自定义源以原生 VM 运行 | 安全 | 否 |
| `proxy.enabled` | `false` | 是否走反向代理转发（判 `x-real-ip`） | 访问与鉴权 | 否 |
| `proxy.header` | `'x-real-ip'` | 取原始 IP 的请求头 | 访问与鉴权 | 否 |
| `frontend.password` | `'123456'` | 管理后台登录密码（**78 处引用**） | 访问与鉴权 | 否 |
| `player.enableAuth` | `false` | Web 播放器访问密码开关 | 访问与鉴权 | 否 |
| `player.password` | `'123456'` | Web 播放器访问密码 | 访问与鉴权 | 否 |
| `admin.path` | `'/admin'` | 后台路由前缀（每请求解析） | 访问与鉴权 | 否 |
| `player.path` | `'/'` | 播放器路由前缀 | 访问与鉴权 | 否 |
| `users` | `[]`（config.js 为 `[{admin,password}]`） | 用户列表 | 用户管理 | 否 |
| `user.enablePath` | `true` | 连接 URL 带 `/用户名` | 用户与权限 | 否 |
| `user.enableRoot` | `false` | 连接 URL 用根路径，要求密码唯一 | 用户与权限 | 否 |
| `user.enablePublicRestriction` | `true` | 公开用户敏感操作限制总门控（16 处） | 用户与权限 | 否 |
| `user.enablePublicNonAdminLocalMusic` | `false` | 公开账号可访问本地音乐 | 用户与权限 | 否 |
| `user.enablePublicNonAdminBrowserDownload` | `true` | 公开账号可浏览器下载 | 用户与权限 | 否 |
| `user.enablePublicNonAdminServerCache` | `false` | 公开账号可写服务器缓存 | 用户与权限 | 否 |
| `user.enablePublicFavorites` | `false` | 公开收藏可见（注入 `_open` 虚拟用户） | 用户与权限 | 否 |
| `user.enablePublicNonAdminAccess` | `false` | 公开账号可查看公开收藏/歌曲 | 用户与权限 | 否 |
| `user.enableCustomMusicDir` | `false` | 自定义歌曲目录总开关 | 用户与权限 | 否 |
| `user.enableLoginCacheRestriction` | `false` | 登录用户核心缓存设置受限 | 用户与权限 | 否 |
| `user.enableCacheSizeLimit` | `false` | 超出容量按 LRU 清理 | 缓存与存储 | 否 |
| `user.cacheSizeLimit` | `2000` | 缓存空间上限 MB | 缓存与存储 | 否 |
| `cache.namingPattern` | `'simple'` | 服务端缓存命名规则 | 缓存与存储 | 是 |
| `serverCacheLocation` | 无（仅类型定义） | 全局缓存位置，仅 `startServer()` 消费 | 缓存与存储 | 是 |
| `maxSnapshotNum` | `10` | 公共最大备份快照数 | 缓存与存储 | 否 |
| `snapshot.backupPath` | `''` | 歌单快照额外备份路径（空=用户目录） | 缓存与存储 | 否 |
| `list.addMusicLocationType` | `'top'` | 加歌到列表位置 top/bottom | 列表 | 否 |
| `proxy.all.enabled` | `false` | 全局外发代理总开关 | 代理 | 否 |
| `proxy.all.address` | `''` | 全局代理地址（http/socks5） | 代理 | 否 |
| `proxy.music.enabled` | `undefined` | 内置音源平台独立代理（undefined=沿用 all） | 代理 | 否 |
| `proxy.music.address` | `''` | 音乐平台代理地址 | 代理 | 否 |
| `proxy.customSource.enabled` | `undefined` | 自定义源脚本请求独立代理 | 代理 | 否 |
| `proxy.customSource.address` | `''` | 自定义源代理地址 | 代理 | 否 |
| `proxy.app.enabled` | `undefined` | 封面代理/AcoustID/远程导入独立代理 | 代理 | 否 |
| `proxy.app.address` | `''` | 应用功能代理地址 | 代理 | 否 |
| `download.syncOwnership` | `true` | 下载文件 chown 同步 | 下载 | 否 |
| `download.ownerUid` | `1026` | chown 目标 UID（≤0 退化为 666） | 下载 | 否 |
| `download.ownerGid` | `100` | chown 目标 GID | 下载 | 否 |
| `webdav.enable` | `false` | WebDAV 同步/备份总开关 | WebDAV | 否 |
| `webdav.url` / `.username` / `.password` | `''` | WebDAV 连接信息 | WebDAV | 否 |
| `webdav.syncPath` | `'/lx-sync'` | 增量同步远端路径 | WebDAV | 否 |
| `webdav.backupPath` | `'/lx-sync-backups'` | 全量备份远端路径 | WebDAV | 否 |
| `webdav.excludeCache` | `false` | 排除 cache 参与同步 | WebDAV | 否 |
| `webdav.excludeMusic` | `false` | 排除 music 参与同步 | WebDAV | 否 |
| `sync.interval` | `60` | 增量同步间隔（分钟） | WebDAV | 否 |
| `sync.backupInterval` | `24` | 全量备份间隔（小时） | WebDAV | 否 |
| `configBackup.enable` | `true` | 本地 config.js 每日备份开关 | 本地配置备份 | 否 |
| `configBackup.retentionDays` | `7` | 本地备份保留天数 | 本地配置备份 | 否 |
| `configBackup.dir` | `''` | 备份目录（空=`<data>/backups`） | 本地配置备份 | 否 |
| `subsonic.enable` | `true` | Subsonic 协议总开关 | Subsonic | 否 |
| `subsonic.path` | `'/rest'` | Subsonic 访问路径 | Subsonic | 否 |
| `subsonic.port` | `0` | 独立监听端口，0=走主端口 | Subsonic | 是 |
| `subsonic.enableDebug` | `false` | Subsonic 调试日志 | Subsonic | 否 |
| `subsonic.onlineSearch` | `true` | 在线全网搜索总开关 | Subsonic 搜索 | 否 |
| `subsonic.onlineSearchMode` | `'fallback'` | fallback/merge/local_only | Subsonic 搜索 | 否 |
| `subsonic.onlineSearchSources` | `'wy,tx,kw,kg,mg'` | 在线搜索默认平台 | Subsonic 搜索 | 否 |
| `subsonic.publicLeaderboards` | `false` | 在线排行榜映射为只读虚拟歌单 | Subsonic 搜索 | 否 |
| `subsonic.leaderboardSource` | `'tx'` | 排行榜平台 | Subsonic 搜索 | 否 |
| `subsonic.sharedListMode` | `'leaderboard'` | 共享歌单内容模式 | Subsonic 搜索 | 否 |
| `subsonic.sharedListSort` | `'hot'` | 共享歌单排序 | Subsonic 搜索 | 否 |
| `subsonic.lyricTranslation` | `true` | 歌词是否含翻译 | Subsonic 歌词 | 否 |
| `subsonic.cacheOnPlay` | `false` | 播放时触发落盘缓存 | Subsonic 播放 | 否 |
| `subsonic.playCacheFirst` | `true` | 优先直传本地缓存 | Subsonic 播放 | 否 |
| `subsonic.recommendPoolSize` | `100` | 推荐池容量 | Subsonic 推荐 | 否 |
| `subsonic.dislikeRating` | `1` | 评分≤该值视为不喜欢，0=关 | dislike 策略 | 否 |
| `subsonic.linkRatingToDislike` | `false` | 正向解耦：评星→不喜欢 | dislike 策略 | 否 |
| `subsonic.linkDislikeToRating` | `false` | 反向解耦：不喜欢→评星 | dislike 策略 | 否 |
| `subsonic.hideDisliked` | `true` | 列表中剔除命中 dislike 的歌曲 | dislike 策略 | 否 |
| `subsonic.dislikeCrossSource` | `false` | 跨平台同名命中（误伤风险） | dislike 策略 | 否 |
| `subsonic.dislikeNoRecommend` | `true` | 推荐类接口排除 dislike | dislike 策略 | 否 |
| `subsonic.dislikeDuetMode` | `'any'` | 多歌手匹配 any/all/primary | dislike 策略 | 否 |
| `subsonic.dislikeNormalizeName` | `true` | 歌名去版本后缀归一化 | dislike 策略 | 否 |
| `subsonic.dislikeRequireSinger` | `true` | 歌曲/专辑级均要求歌手匹配 | dislike 策略 | 否 |
| `subsonic.quality.enabled` | `true` | 音质优选总开关 | 音质优选 | 否 |
| `subsonic.quality.priority` | `'flac,320k,128k'` | 音质优先级 | 音质优选 | 否 |
| `subsonic.quality.clientCapMode` | `'soft'` | 客户端 maxBitrate 上界 hard/soft | 音质优选 | 否 |
| `subsonic.quality.sources` | 无（仅类型定义） | 逐平台音质优先级覆盖 | 音质优选 | 否 |
| `subsonic.source.priority` | `'kw,tx,wy,mg,kg'` | 跨平台优选顺序 | 音质优选 | 否 |
| `subsonic.source.crossPlatform` | `true` | 是否允许跨平台搜替身 | 音质优选 | 否 |
| `subsonic.source.autoSwitchCustom` | `true` | 同源是否切换其它自定义源 | 音质优选 | 否 |
| `subsonic.transcode.enabled` | `false` | 服务端转码（需 ffmpeg） | 转码 | 否 |
| `subsonic.transcode.onQualityMiss` | `true` | 仅音质缺失时才转码 | 转码 | 否 |
| `subsonic.transcode.format` | `'mp3'` | mp3/opus/aac | 转码 | 否 |
| `subsonic.transcode.maxConcurrent` | `2` | 转码并发上限 | 转码 | 否 |
| `music.url.crossPlatform` | `true` | 不分平台并发搜替身 | 音源解析 | 否 |
| `music.url.race` | `true` | 自定义源并发竞速 | 音源解析 | 否 |
| `music.url.raceStagger` | `180` | 竞速错峰间隔 ms | 音源解析 | 否 |
| `music.url.crossStagger` | `150` | 跨平台候选错峰间隔 ms | 音源解析 | 否 |
| `music.url.maxParallelPlatforms` | `3` | 平台候选在途上限 | 音源解析 | 否 |
| `music.url.priorityGrace` | `350` | 低优先级先返回时的反超宽限 ms | 音源解析 | 否 |
| `music.url.maxParallel` | `4` | 同平台自定义源在途上限 | 音源解析 | 否 |
| `music.url.sourceRetries` | `1` | 每源自重试次数 | 音源解析 | 否 |
| `music.url.retryDelay` | `900` | 单源两次尝试间隔 ms | 音源解析 | 否 |
| `music.url.validate` | `true` | 校验返回链接可用性（403/404 判失败） | 音源解析 | 否 |
| `music.url.stickyTtl` | `600` | 解析结果粘滞缓存秒数 | 音源解析 | 否 |
| `music.url.breakerEnabled` | `true` | 死源熔断 | 音源解析 | 否 |
| `music.url.breakerThreshold` | `3` | 连续失败熔断阈值 | 音源解析 | 否 |
| `music.url.breakerCooldown` | `300` | 熔断冷却秒数 | 音源解析 | 否 |
| `singer.sourcePriority` | `['tx','wy']` | 歌手信息源优先级 | 元数据 | 否 |
| `artist.maxFetchPages` | `20` | 歌手歌曲最大抓取页数 | 元数据 | 否 |

**热加载行为**：`config.js` 有文件监听并合并进内存（index.ts:897-927）；`POST /api/config` 原地重写大部分键。例外：`port`、`bindIP`、`subsonic.port`、`cache.namingPattern`、`serverCacheLocation` 只在 `startServer()` 消费 → 改这些必须重启（现有后台 UI 已只提示 `subsonic.*` 两项，**漏了另外 3 个**，台账 D-09）。

## 2. 用户播放设置键（B 表，60 键）

存储：`localStorage['lx_settings']`（app.js:197 读 / 7061 写）+ 镜像到 `settings.json`（`saveAccountSettingsToFile` 开时）。

**播放与逻辑（18）**：`defaultEntry`、`switchPlaylistOnSearchPlay`、`switchPlaylistOnSongListPlay`、`autoFilterDislikedSongs`、`autoResume`、`autoCompactPlaybar`、`enableAutoSwitchSource`、`enableAutoSwitchApiSource`、`enableAutoSkipOnError`、`enableAutoDegradeQuality`、`playbackErrorPriority`、`enablePreloader`、`deduplicatePlaylistByQuality`、`enableSmtcLyric`、`enableKeyboardShortcuts`、`enableCrossfade`、`showSidebarSongInfo`、`playerBackground`

**界面显示（4）**：`lyricFontSize`、`lyricFontFamily`、`hotSearchLimit`、`itemsPerPage`

**歌词（4）**：`showLyricTranslation`、`showLyricRoma`、`swapLyricTransRoma`、`enableLyricGlow`

**可视化（6）**：`showFooterVisualizer`、`footerVisualizerStyle`、`showDetailVisualizer`、`detailVisualizerStyle`、`visualizerGlobalStyle`、`visualizerOpacity`

**音质与下载（6）**：`preferredQuality`、`enableOnlyDownloadMode`、`downloadConcurrency`、`embedLyricToFile`、`enableRemaster`、`preferServerCache`

**服务器/本地缓存（7）**：`enableServerCache`、`enableServerLyricCache`、`serverCacheLocation`、`serverCacheNamingPattern`、`enableLyricCache`、`enableSongUrlCache`、`enablePersistentToken`

**客户端代理（5）**：`enableProxyPlayback`、`enableProxyDownload`、`enableAutoProxy`、`enableCustomProxy`、`customProxyUrl`

**音源与同步（7）**：`enablePublicSources`、`remoteSyncUrl`、`remoteSyncCode`、`enableClientModeSync`、`lastRemoteSyncMode`、`saveAccountSettingsToFile`、`autoUpdateNetworkList`、`networkListAutoCheckInterval`、`favoriteSidebarOrder`

**音效链（9，`soundEffects.js`，localStorage `lx_sound_effects` + `soundEffects.json`）**：`eq`(10 段)、`pitch`、`panner.enable`、`panner.speed`、`panner.distance`、`reverb.id`、`reverb.mainGain`、`reverb.sendGain`、`customPresets`

**外观（localStorage only，不同步服务端）**：`lx_theme`（emerald/blue/amber/violet/rose）、`lx_appearance`（明亮/暗黑/跟随系统）等

**受限键（11 个，公开受限/登录受限模式下需管理员密码解锁）**：`enableServerCache`、`enableServerLyricCache`、`serverCacheLocation`、`serverCacheNamingPattern`、`enableLyricCache`、`enableSongUrlCache`、`enablePersistentToken`、`preferServerCache`、`enableRemaster`、`embedLyricToFile`、`saveAccountSettingsToFile`（app.js:7305、7040-7046；服务端对 `_open` 只放行同 11 键）

## 3. 两个命名空间的歧义键（设置中心必须隔离）

| 相似键 | 全局语义 | 用户语义 |
|---|---|---|
| `serverCacheLocation` | **全局**缓存位置（仅 startServer 消费，无 UI 入口） | 用户选择 data(同步)/root(本地) |
| `proxy.*` / `enableProxy*` | 服务端出站代理（三类分流） | 客户端播放/下载是否走 `/api/music/download` 代理 |
| `download.*` / `downloadConcurrency` | 服务端下载属主 chown | 客户端下载并发 1-5 |
| `enableCustomMusicDir` | 全局总开关 | 用户目录路径与授权（后台 per-user） |
| `maxSnapshotNum` / 快照 `backupPath` | 全局 | 用户 snapshot 目录（运行时查询，阶段 F 要求） |
| `autoUpdateNetworkList` | —（纯用户键） | 网络歌单自动更新（服务端有调度器读取） |

## 4. 默认值漂移（defaultConfig.ts vs config.js）

| 键 | defaultConfig.ts | config.js（仓库根） |
|---|---|---|
| `users` | `[]` | `[{name:'admin',password:'password'}]` |
| `frontend.password` | `'123456'` | `'123456'` |
| `proxy.music.enabled` 等三类 | `undefined`（注释说明沿用 all） | 显式注释掉 |

**结论**：仓库根的 `config.js` 是给容器用的运行配置，与 `defaultConfig.ts` 的差异是有意的（容器默认有 admin 用户）。新设置中心读取必须走 `GET /api/config`，**不要直接读 `defaultConfig.ts` 的默认值**，否则恢复默认会改变容器实际行为。

## 5. 阶段 B 设置中心的分组建议

```
设置
├─ 播放偏好（我的）           ← B 表：播放与逻辑 / 歌词 / 音质下载 / 音效 / 外观
├─ 数据（我的）               ← 歌单 / 收藏 / 厌恶 / 本地音乐 / 同步
├─ 服务器配置（全局）         ← A 表：基础服务 / 访问与鉴权 / 用户与权限 / 缓存与存储
├─ 网络（全局）               ← 代理 / WebDAV / Subsonic
├─ 用户（全局，管理员）        ← 用户管理 + per-user 授权
├─ 仪表盘（全局，管理员）
├─ 日志（全局，管理员）
├─ 文件（全局，管理员）
└─ 关于
```
