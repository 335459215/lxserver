# API 面 · 会话态 · 落盘文件 · 缓存

> 勘查时间 2026-10-05，commit `191edb0`。路由是 `src/server/server.ts` 里一条
> `if (pathname === ...)` 线性链（起点 `server.ts:1217`），约 180 个分支。
> **没有任何中间件**：鉴权在每个分支内部手写，这是阶段 B"鉴权统一"的工作量来源。

## 1. 非 `/api` 路由

| 路径 | 用途 | 鉴权 | 位置 |
|---|---|---|---|
| `admin.path`（默认 `/admin`）及 `/admin/**` | 后台静态文件，`/admin` → 301 | 静态文件本身不鉴权，仅前端调 `/api/login` | server.ts:1023-1041 |
| `player.path`（默认 `/`）、`/`、`/index.html` | 播放器 SPA 静态资源；非登录页/非公开资产时 302 跳 `/login` | 混合：`player.enableAuth` 开 = cookie，否则无 | server.ts:1053-1130 |
| `/js/config.js` | 注入 `window.CONFIG` | 无 | server.ts:1133-1176 |
| `/music/**`、`/{prefix}/manifest.json`、`/music/sw.js` | PWA manifest 动态生成 / 旧前缀兼容 | 继承播放器规则 | server.ts:1043-1051,1086-1109 |
| 其它非 `/api/` | 通用静态文件（`staticPath`） | 无 | server.ts:1192-1207 |
| `subsonic.path`（`/rest`） | 转发 Subsonic 处理器 | Subsonic 参数 | server.ts:1209-1214 → subsonic.ts:992 |
| `/{…}/hello`、`/{…}/id`、`/{…}/ah` | LX 同步协议握手/取 ID/认证 | LX 同步协议(RSA+AES) | server.ts:8152-8237, auth.ts:80 |
| WS upgrade 同上 + `?i=<clientId>` | LX 同步 WebSocket | LX 同步协议 | server.ts:8388 → auth.ts:128 |
| 兜底未匹配 | `process.cwd()/public` 静态文件，否则 404 | 无 | server.ts:8210-8236 |

## 2. `/api` 端点（按鉴权方式分组）

鉴权图例：`admin` = `x-frontend-auth` 头等于 `frontend.password`；`cookie` = `lx_player_session`；`token` = `x-user-token`；`混合` = 条件见下。

**管理员专属**（32 个）
`GET /api/status` · `GET/POST/PUT/DELETE /api/users` · `POST /api/data/delete-playlist` · `POST /api/data/delete-song` · `POST /api/data/rename-playlist` · `POST /api/data/batch-delete-songs` · `POST /api/utils/check-dir` · `ANY /api/elfinder/connector` · `GET/POST /api/config` · `GET /api/config/backups` · `POST /api/config/backup-now` · `GET /api/config/backups/download` · `DELETE /api/config/backups/{file}` · `POST /api/config/backups/restore` · `GET /api/config/proxy-status` · `POST /api/config/test-proxy` · `GET /api/logs` · `GET /api/stats` · `POST /api/webdav/test` · `POST /api/webdav/sync-file` · `POST /api/webdav/backup` · `POST /api/webdav/sync` · `GET /api/webdav/backups` · `DELETE /api/webdav/backup` · `POST /api/webdav/restore` · `GET /api/webdav/logs` · `GET /api/webdav/progress`(SSE) · `GET /api/backup/download` · `POST /api/backup/upload` · `POST /api/admin/reload` · `POST /api/restart` · `GET /api/files` · `GET /api/files/download` · `POST/PUT /api/files` · `DELETE /api/files`

**用户 token**（14 个）
`POST /api/music/user/list/remove` · `POST /api/music/user/list/add` · `POST /api/user/logout` · `GET /api/user/auth/verify` · `GET/POST /api/user/token/config` · `POST /api/user/token/add|remove|update|toggle` · `GET /api/user/token/logs` · `GET /api/user/sound-effects` · `POST /api/user/sound-effects` · `GET /api/music/custom/list` · `POST /api/music/custom/sync` · `ANY /api/music/custom/file[/{path}]` · `GET /api/music/custom/cover` · `POST /api/music/custom/{remove,link,updateMetadata,embedLyric}` · `POST /api/music/identify` · `GET /api/music/dislike` · `POST /api/music/dislike/add|remove`

**混合鉴权**（约 45 个，条件各不相同 —— 这是最需要统一的部分）
- `/api/data`、`/api/data/snapshot(s)`、`/snapshot/delete`、`/snapshot/upload-snapshot`、`/restore-snapshot`：管理员信任 `?user=`；`default`/`_open` 直接放行；否则 token 且须匹配
- `/api/user/list`、`/api/user/settings`、`/api/user/library/{artists,albums}`、`/api/user/dislike/library/*`：`user.enablePublicFavorites` 等门控 + token；`/api/user/list` **退化到信任 `x-user-name` 头**
- `/api/music/url`、`/api/music/quality/size`：`x-user-name` 为具名用户时须 token，否则 `open`
- `/api/music/cache/*`（20 个）：`getCacheRequestUsername`（server.ts:420）；命名用户 token，公开用户受 `enablePublicNonAdmin*` 门控
- `/api/tasks/*`、`/api/music/tasks/*`：`/api/tasks/user-data` **token 失败也仍以 `_open` 继续**（弱鉴权，台账 D-02）
- `/api/music/remaster/*`：`getCacheRequestUsername`
- `/api/custom-source/*`：仅当 `user.enablePublicRestriction` 开启且既非管理员也无 token 时 403

**无鉴权**（约 30 个）
`POST /api/login` · `POST /api/user/verify` · `POST /api/user/login` · `/api/music/config` · `/api/music/auth*`（body 密码）· `/api/music/search` · `/api/music/tipSearch` · `/api/music/artistDetail|artistAlbums|artistSongs|albumSongs` · `/api/music/progress`(SSE) · `/api/music/lyric`(GET) · `/api/music/hotSearch` · `/api/music/songList/*` · `/api/music/leaderboard/*` · `POST /api/music/comment` · **`GET /api/music/download`（SSRF 面：任意 `url` 参数，台账 D-01）** · `GET /api/music/cache/progress`

完整逐条 file:line 由勘查记录给出（本次勘查已覆盖全部 120+ 端点）。

## 3. 持有会话/鉴权状态的内存结构（阶段 0 Redis 层的直接对象）

| 名称 | 位置 | 内容 | 落盘 | TTL/清理 | 重启丢失 |
|---|---|---|---|---|---|
| `playerSessions` | server.ts:105 | sessionId → {createdAt}（播放器 cookie） | 否 | 24h，惰性删除 + 每小时全扫 | 是 |
| `userSessions` | server.ts:266 | token → {username, createdAt}（网页登录） | 否 | 7 天，每小时清扫 | 是 |
| `persistentTokens` / `persistentTokenMeta` | server.ts:270/273 | token → username / token → {name,disabled,expiresAt,lastUsed} | 源在 `data/users/<u>/token.json` | 无自身 TTL，按 meta `expiresAt`；10s 防抖回写 | 是（启动时从 token.json 重建） |
| `persistentTokenSaveQueue` | server.ts:276 | username → setTimeout 防抖写盘句柄 | — | 10s | 是 |
| `deviceUserMap` | src/user/data.ts:66 | clientId → userName（LX 同步） | 源 `devices.json` | 永久，启动时构建 | 是（启动重建） |
| `UserDataManage.devicesInfo.clients` | src/user/data.ts:159/191 | clientId → KeyInfo{AES key, deviceName, isMobile} | `devices.json`，100ms throttle | 最多 101 个 | 是 |
| `users`（UserSpace Map） | src/user/index.ts:14 | username → {dataManage,listManage,dislikeManage} | 否 | `releaseUserSpace` 1h 延迟释放 | 是 |
| `status.devices` / `wss.clients` | server.ts:488/8243 | 在线 LX 同步设备 / 全部 WS 连接 | 否 | 30s ping 心跳 | 是 |
| `playbackReportState` | subsonic.ts:539 | username → now-playing | 否 | 15 分钟窗口 | 是 |
| `loveIdSets` / `userRatingsCache` / `currentUsername` | subsonic.ts:718-722 | starred 集合 / 评分缓存 / **单例可变字段（跨请求共享，台账 D-05）** | 否 | 每请求覆盖 | 是 |

**结论**：真正需要迁到 Redis 的是 `playerSessions`、`userSessions`、`persistentTokens(+Meta)`。其余要么有权威落盘文件、要么是纯连接态（重启丢失是正确行为）。

## 4. 落盘 JSON（`data/` 下）

| 文件 | 内容 | 读时机 | 写频率 |
|---|---|---|---|
| `data/users.json` | 用户列表（含密码） | 启动 + 文件监听热重载（index.ts:897-927） | 用户变更时 |
| `data/config.js` | 全局配置 | 启动 + 文件监听 | 后台保存时整文件重写 |
| `data/users/<userDir>/settings.json` | 90 键播放偏好 | 惰性 | 设置保存时 |
| `data/users/<userDir>/soundEffects.json` | 音效链 | 惰性 | 音效保存时 |
| `data/users/<userDir>/token.json` | 持久化 Token | 启动 | 10s 防抖 |
| `data/users/<userDir>/devices.json` | LX 同步客户端密钥 | 启动 | 100ms throttle |
| `data/users/<userDir>/list/*.json`、`dislike/*.json` | 歌单、厌恶库 | 惰性 | 数据变更 |
| `data/users/<userDir>/list/snapshot/*`、`dislike/snapshot/*` | 快照 | 按需 | 快照任务 |
| `data/users/source/<user>/{sources,states,order}.json` | 自定义源元数据 | 启动 + 每次解析（order.json 实时读） | 源管理操作 |
| `data/<userDir>/cache/`、`music/` | 音频缓存与下载（几十 GB 级） | 惰性 | 下载任务 |

`userDir = <filtered_name>_<md5(name)[:6]>`（src/user/data.ts:44-47）。
**`data/` 不在 git 中**，本地工作树没有该目录 —— 这正是冒烟测试必须自建 fixture 的原因。

## 5. 进程内缓存（都不持久化，重启即冷）

| 名称 | 位置 | 内容 | TTL / 上限 |
|---|---|---|---|
| `stickyCache` | musicResolver.ts:73 | 解析结果粘滞缓存 | 600s（可配），500 条上限 |
| `songSourceBlacklist` | musicResolver.ts:116 | 单曲黑名单（按源） | 15 分钟，800 条 |
| `playbackBreakers` | musicResolver.ts:159 | 源级播放熔断 | 10 分钟窗口 / 10 分钟冷却 |
| `innerProbeCache` | musicResolver.ts:452 | 链接深探测结果 | 无显式 TTL（随进程） |
| `sourceBreakers` | userApi.ts:493 | 自定义源熔断 | 阈值 3 / 冷却 300s（可配） |
| `store`（LRU） | src/utils/cache.ts:4 | IP 失败计数（LX 同步协议封禁） | max 10000，ttl 48h |
| `fileCache.activeTasks` | fileCache.ts:73 | 下载任务控制器 | 随任务 |
| `innerProbeCache` 之外的探测缓存 | fileCache.ts | 缓存文件索引 | 随进程 |

## 6. 请求热路径日志量（NAS 日志膨胀风险）

- 每次解析尝试都有 `console.warn`/`console.info`（musicResolver.ts、userApi.ts 多处），受 `debug.enabled` 部分门控但**解析失败路径不受门控**
- `appendSearchDebug` 每次搜索都写（debug 开启时）
- LX 同步协议与 WS 心跳有固定频率日志
- 结论：阶段 A 做日志分级时，**解析器是最大头**。台账 D-08。
