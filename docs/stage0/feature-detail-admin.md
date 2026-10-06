# 后台逐项明细（121 项）

> 对应契约 [`feature-inventory.md`](feature-inventory.md) 的展开。
> `index.html`/`app.js` 指 `public/` 根下的后台壳（`public/index.html`、`public/app.js`）。
> 断点：style.css 使用 640 / 768 / 900 / 1024 / 1200 px（**与播放器断点不一致，见缺陷台账 D-07**）。
> 勘查时间：2026-10-05，commit `191edb0`。

| # | 功能 | 入口/位置 | 说明 | 桌面 | 移动 | 难度 |
|---|---|---|---|---|---|---|
| 1 | 管理员登录页（密码登录） | index.html:63-78; app.js:257-283 | 遮罩层登录框，`POST /api/login`，密码存 `localStorage.lx_auth` | ✅ | ✅ | 低 |
| 2 | 登录态持久化 / 401 自动登出 | app.js:50-56,285-288,3318-3321 | `lx_auth` 恢复会话；任何请求 401 即 `logout()` | ✅ | ✅ | 低 |
| 3 | 侧边栏导航 + 视图切换 | index.html:96-192; app.js:295-372 | 8 个 `data-view` 导航项 + 2 个跳转项，切换 `.view.active` 并更新 `#page-title` | ✅ | ✅ | 低 |
| 4 | 移动端抽屉侧边栏 + 遮罩 | index.html:82,215; app.js:210-246 | ≤768px 唤出 280px 侧栏，点击遮罩/导航自动收起 | ❌ | ✅ | 中 |
| 5 | 顶栏：重启服务器按钮 | index.html:239-247; app.js:4718-4737 | `showSelect` 二次确认后 `POST /api/restart`，5s 后自动刷新 | ✅ | ✅（≤1024px 仅图标） | 低 |
| 6 | 顶栏：服务器运行状态指示 | index.html:248-251 | `#server-status` + `.status-dot`（静态文案，≤900px 隐藏文字） | ✅ | 部分 | 低 |
| 7 | 顶栏：GitHub 项目链接 | index.html:252-260 | 外链，≤1200px 仅图标 | ✅ | ✅ | 低 |
| 8 | 顶栏：版本号徽标 | index.html:224-225; app.js:423-441 | `#console-version` 显示 `window.CONFIG.version` | ✅ | ✅ | 低 |
| 9 | 侧栏底部版权 / 许可 | index.html:194-199 | Copyright © 2026 xcq0607 / Apache-2.0 | ✅ | ✅ | 低 |
| 10 | 退出登录 | index.html:200-207; app.js:285-288 | 清除 `lx_auth` 并 `location.reload()` | ✅ | ✅ | 低 |
| 11 | 仪表盘欢迎语 + 本地化日期 | index.html:267-270; app.js:470-489 | 按时段问候（深夜好/早安/…）与中文长日期 | ✅ | ✅ | 低 |
| 12 | 统计卡：用户总数 + 在线设备（双联卡） | index.html:274-306; app.js:443-467 | `GET /api/status`，点击卡片跳转用户管理；设备数 = WebSocket `wss.clients.size` | ✅ | ✅ | 低 |
| 13 | 统计卡：CPU 负载（系统/服务） | index.html:309-328; app.js:514-517,631-640 | `cpuUsage` / `processCpuUsage`，副文案核数与主频 | ✅ | ✅ | 低 |
| 14 | 统计卡：内存占用（系统/服务） | index.html:331-350; app.js:566-589 | 系统百分比、服务 RSS 百分比、绝对值 `formatFileSize` | ✅ | ✅ | 低 |
| 15 | 统计卡：运行时间 + 音源数 + WebDAV 状态 | index.html:353-369; app.js:628,643-661 | `formatUptime`、`sourcesCount`、`isWebDAVConfigured` 三态徽标 | ✅ | ✅ | 低 |
| 16 | 实时 CPU 折线监控图（Chart.js） | index.html:375-410; app.js:536-559,664-766 | 20 点滑窗，双序列（系统/本服务），动态纵轴量程 + 自定义 tooltip | ✅ | ✅（单列） | 中 |
| 17 | 实时内存折线监控图（Chart.js） | index.html:413-447; app.js:597-620 | 同上，内存双序列 | ✅ | ✅ | 中 |
| 18 | 监控轮询定时器（3s） | app.js:491-506 | 仅 `currentView === 'dashboard'` 时轮询，离开即清除 | ✅ | ✅ | 低 |
| 19 | 快速操作区（3 个入口） | index.html:456-498; app.js:374-387 | 添加用户 / 查看日志 / 系统设置 | ✅ | ✅ | 低 |
| 20 | 用户管理：添加用户 | index.html:505-512; app.js:1070-1112 | 通用 `#modal` 内动态表单，`POST /api/users` | ✅ | ✅ | 低 |
| 21 | 用户管理：用户名搜索过滤 | index.html:513-520; app.js:1056-1068 | `oninput` 客户端按行文本过滤 | ✅ | ✅ | 低 |
| 22 | 用户管理：刷新列表（保存配置+重载） | index.html:523-530; app.js:87-98 | 先 `saveConfig(true)` 再 `POST /api/admin/reload` | ✅ | ✅ | 低 |
| 23 | 用户管理：密码显示/隐藏 | index.html:1022-1029; app.js:1115-1125 | 行内 `******` 与明文切换 | ✅ | ✅ | 低 |
| 24 | 用户管理：修改密码 | index.html:2387-2404; app.js:1128-1160 | `#edit-password-modal`，`PUT /api/users` | ✅ | ✅ | 低 |
| 25 | 用户管理：删除用户（含数据选项） | app.js:1162-1223 | `showDeleteUserDialog`，可勾选"同时删除用户数据文件夹" | ✅ | ✅ | 低 |
| 26 | 用户管理：批量删除 + 全选 | index.html:531-539,545; app.js:892-993 | checkbox 多选、计数、`DELETE /api/users` | ✅ | ✅（行转卡片） | 中 |
| 27 | 用户管理：用户配置（重命名） | index.html:2405-2495; app.js:1311-1384 | `#rename-user-modal`，支持 `newName`，警告会断开所有设备 | ✅ | ✅ | 中 |
| 28 | 用户级：自定义歌曲目录开关 + 路径 + 检测 | index.html:2419-2451; app.js:1263-1308 | `POST /api/utils/check-dir` 校验目录可用性 | ✅ | ✅ | 中 |
| 29 | 用户级：允许操作目录歌曲 / 允许写入歌曲文件 | index.html:2461-2484; app.js:1328-1351 | `allowOperateCustomMusicDir` / `allowWriteCustomMusicDir` 双开关 | ✅ | ✅ | 低 |
| 30 | 用户级：启用自动下载歌曲授权 | index.html:2428-2441; app.js:1330-1366 | `enableAutoDownload`，附三步启用说明 | ✅ | ✅ | 低 |
| 31 | 用户头像 / 彩虹色标识 | app.js:20-28,1011 | `stringToColor()` 由用户名 hash 生成 HSL 背景 | ✅ | ✅ | 低 |
| 32 | 数据查看：用户选择器（自定义下拉） | index.html:560-577; app.js:769-880 | 支持公开用户 `_open`，下拉外点关闭 | ✅ | ✅ | 中 |
| 33 | 数据查看：用户选择网格（未选用户时） | app.js:818-859 | 卡片网格展示全部用户，含"公开用户"特殊卡片 | ✅ | ✅ | 中 |
| 34 | 数据查看：6 张统计卡 | app.js:1434-1477 | 总歌曲数/试听列表/我的收藏/播放列表/收藏专辑/收藏歌手，均可点击钻取 | ✅ | ✅ | 低 |
| 35 | 数据查看：Tab 导航（全部/播放列表/收藏专辑/收藏歌手） | index.html:587-628; app.js:1512-1563 | `setDataTab` 切换 + 角标计数 | ✅ | ✅ | 低 |
| 36 | 数据查看：播放列表卡片网格 | app.js:1565-1627 | 显示 ID、歌曲数、查看详情/删除歌单 | ✅ | ✅ | 低 |
| 37 | 数据查看：收藏专辑卡片网格 | app.js:1629-1700 | 封面懒加载 + onerror 占位、来源徽标 | ✅ | ✅ | 低 |
| 38 | 数据查看：收藏歌手卡片网格 | app.js:1702-1756 | 头像 + 来源徽标 + ID | ✅ | ✅ | 低 |
| 39 | 数据查看：专辑曲目详情 | app.js:1758-1844 | 返回按钮 + 搜索/排序栏 + 歌曲表 | ✅ | ✅（≤1024px 隐藏部分列） | 中 |
| 40 | 数据查看：歌单详情 + 重命名 | app.js:1846-1948,2088-2111 | 行内铅笔按钮，`POST /api/data/rename-playlist` | ✅ | ✅ | 中 |
| 41 | 数据查看：系统列表（试听列表/我的喜爱） | app.js:2019-2086 | 查看并逐曲删除 | ✅ | ✅ | 中 |
| 42 | 数据查看：歌曲批量选择（全选/反选/清空） | app.js:2114-2162 | `.song-checkbox` + indeterminate 全选框 | ✅ | ✅ | 中 |
| 43 | 数据查看：批量删除歌曲 | app.js:2165-2196 | 索引降序删除，`POST /api/data/batch-delete-songs` | ✅ | ✅ | 中 |
| 44 | 数据查看：歌曲搜索 + 排序 | app.js:2199-2252 | 按歌名/歌手过滤；按歌名/歌手/所属列表升降序（zh-CN localeCompare） | ✅ | ✅ | 中 |
| 45 | 数据查看：所有歌曲聚合视图 | app.js:2255-2353 | 合并试听/收藏/全部自定义歌单，带"所属列表"列 | ✅ | ✅（≤1024px 隐藏该列） | 中 |
| 46 | 歌曲音质/来源标签渲染 | app.js:3766-3826 | Hi-Res/SQ/HQ 标签、封面 onerror 兜底 | ✅ | ✅ | 中 |
| 47 | 系统配置：表单加载（91 键回填） | app.js:2355-2696 | `GET /api/config`，逐 `form.elements[name]` 赋值 checkboxes/inputs/selects/hidden | ✅ | ✅ | 中 |
| 48 | 系统配置：保存（91 键提交） | app.js:3042-3236 | `POST /api/config`，FormData 转扁平点号键；`silent` 模式 | ✅ | ✅ | 中 |
| 49 | 系统配置：重新加载按钮 | index.html:1871-1879; app.js:152-155 | 静默保存 + 重新 `loadConfig()` | ✅ | ✅ | 低 |
| 50 | 系统配置：admin/player 路径冲突校验 | app.js:3047-3069; index.html:1222-1225 | 5 条规则（空/不以/开头/与后台相同/以 /api 开头） | ✅ | ✅ | 低 |
| 51 | 系统配置：需重启才发现并提示一键重启 | app.js:3169-3231 | 对比 `subsonic.enable` / `subsonic.port`，弹 `showSelect(danger)` → `POST /api/restart` | ✅ | ✅ | 中 |
| 52 | 配置：密码变更同步本地会话 | app.js:3186-3190 | 若 `frontend.password` 改变，覆写 `localStorage.lx_auth` | ✅ | ✅ | 低 |
| 53 | 配置卡：基本配置 | index.html:637-676 | serverName / list.addMusicLocationType / debug.enabled | ✅ | ✅ | 低 |
| 54 | 配置卡：下载文件属主 | index.html:679-715 | download.syncOwnership / ownerUid / ownerGid（chown 664） | ✅ | ✅ | 低 |
| 55 | 配置卡：代理配置（统一 + 三类分流） | index.html:718-849; app.js:3376-3398 | 反代开关、统一代理地址+测试、music/customSource/app 三类 inherit/off/on + 独立地址+测试 | ✅ | ✅ | 高 |
| 56 | 配置卡：代理"当前实际生效"回显 | index.html:840-847; app.js:3400-3430 | `GET /api/config/proxy-status`，区分"沿用/直连/走代理→地址" | ✅ | ✅ | 中 |
| 57 | 配置项：代理地址连通性测试 | index.html:764-832; app.js:3432-3456,4207-4221 | 4 个测试按钮，`POST /api/config/test-proxy` | ✅ | ✅ | 低 |
| 58 | 配置卡：前端访问配置 | index.html:852-889 | frontend.password / player.enableAuth / player.password | ✅ | ✅ | 低 |
| 59 | 配置卡：自定义歌曲目录 | index.html:892-941 | user.enableCustomMusicDir + 跨平台路径示例 | ✅ | ✅ | 低 |
| 60 | 配置卡：WebDAV 同步配置 | index.html:944-1065; app.js:2698-2711 | enable 开关联动显隐，url/username/password/syncPath/backupPath/interval/backupInterval/excludeCache/excludeMusic | ✅ | ✅ | 中 |
| 61 | 配置卡：备份与恢复 | index.html:1068-1151 | maxSnapshotNum / configBackup.* / snapshot.backupPath + 三种路径写法图文说明 | ✅ | ✅ | 中 |
| 62 | 配置卡：用户路径配置 | index.html:1154-1192 | user.enableRoot / user.enablePath | ✅ | ✅ | 低 |
| 63 | 配置卡：访问路径配置 | index.html:1195-1227 | admin.path / player.path，保存后即时改侧栏播放器链接 | ✅ | ✅ | 低 |
| 64 | 配置卡：权限与缓存限制（含二级联动） | index.html:1230-1357; app.js:3026-3041 | 公开限制 + 3 个非管理员子开关；公开收藏；登录用户缓存限制；缓存空间限制；VM 沙盒开关 | ✅ | ✅ | 中 |
| 65 | 配置卡：Subsonic 协议配置 | index.html:1360-1857 | 17 组开关/输入，含独立端口、公开排行榜、在线搜索、歌词翻译、评分联动、音质/源优选 | ✅ | ✅ | 高 |
| 66 | 配置控件：标签单选组（4 组） | index.html:1444-1562; app.js:2729-2792 | leaderboardSource(5) / sharedListMode(3) / sharedListSort(2) / onlineSearchSources(5，至少留 1) | ✅ | ✅ | 中 |
| 67 | 配置控件：可拖拽排序标签组（2 组） | index.html:1734,1748; app.js:2825-3024 | 音质优先级 / 跨平台源优先级；HTML5 drag + ✕ 禁用置底 + 序号徽标 | ❌（触屏 drag 不可靠） | 部分 | 高 |
| 68 | 配置：Subsonic 独立端口开关与冲突提示 | index.html:1410-1427; app.js:2521-2551 | port>0 视为开启，默认填 4050；冲突时红字警示 | ✅ | ✅ | 中 |
| 69 | WebDAV 视图：未配置引导卡 | index.html:1956-1974; app.js:4739-4756 | 显示引导 + "立即配置 WebDAV" 平滑滚动定位高亮 | ✅ | ✅ | 中 |
| 70 | WebDAV：测试连接 | index.html:2039-2050; app.js:3360-3371 | `POST /api/webdav/test` | ✅ | ✅ | 低 |
| 71 | WebDAV：立即全量备份（本地→云端 ZIP） | index.html:1996-2008; app.js:3458-3487 | `showSelect` 确认 + `POST /api/webdav/backup {force:true}` | ✅ | ✅ | 中 |
| 72 | WebDAV：同步所有文件（增量多线程上传） | index.html:2010-2023; app.js:3683-3709 | `POST /api/webdav/sync` | ✅ | ✅ | 中 |
| 73 | WebDAV：从云端恢复（双模式弹窗） | index.html:2498-2563; app.js:3489-3522 | Tab：全量 ZIP / 散文件增量 | ✅ | ✅ | 中 |
| 74 | WebDAV：云端备份 ZIP 列表 + 单点恢复/删除 | app.js:3524-3614 | `GET /api/webdav/backups`，"最新快照"角标，逐项恢复/删除 | ✅ | ✅ | 中 |
| 75 | WebDAV：全量 ZIP 恢复执行 | app.js:3616-3648 | `POST /api/webdav/restore {mode:'zip'}`，成功后刷新 | ✅ | ✅ | 中 |
| 76 | WebDAV：散文件增量恢复执行 | app.js:3650-3681 | `{mode:'files'}`，双向合并不删本地独有文件 | ✅ | ✅ | 中 |
| 77 | WebDAV：任务进度中心（4 步指示器） | index.html:1899-1953; app.js:3711-3763 | 准备/打包压缩/数据传输/完成，进度条 + %徽标 + 元信息 | ✅ | ✅ | 中 |
| 78 | WebDAV：SSE 实时进度推送 | app.js:3828-3930 | `EventSource('/api/webdav/progress?auth=')`，四类事件 | ✅ | ✅ | 中 |
| 79 | WebDAV：同步状态与健康度面板 | index.html:2095-2113 | `#sync-status-content` 文案随操作切换 | ✅ | ✅ | 低 |
| 80 | WebDAV：实时同步日志面板 | index.html:2116-2144; app.js:3932-3999 | SSE 推送插入 + 手动刷新，类型徽标，上限 100 条 | ✅ | ✅ | 中 |
| 81 | WebDAV：使用场景与原理说明弹窗 | index.html:2566-2751; app.js:4774-4786 | 4 大场景指引 + 排除目录机制 + 冲突处理原则 | ✅ | ✅ | 中 |
| 82 | WebDAV：打包本地备份（浏览器下载 ZIP） | index.html:2062-2074; app.js:4613-4641 | `GET /api/backup/download?auth=` 直接 a.download | ✅ | ✅ | 中 |
| 83 | WebDAV：上传还原备份（ZIP） | index.html:2075-2087; app.js:4644-4693 | 危险确认 + 全屏 loading + `POST /api/backup/upload` | ✅ | ✅ | 中 |
| 84 | 日志查看：日志类型切换（5 类） | index.html:2152-2158; app.js:3239-3250 | app/access/login/token/errors | ✅ | ✅ | 低 |
| 85 | 日志查看：分级着色高亮 | app.js:3263-3268 | 正则替换 INFO/WARN/ERROR 标签类 + 时间戳高亮 | ✅ | ✅ | 低 |
| 86 | 日志查看：自动轮询开关（3s） | index.html:2160-2167; app.js:173-176,3287-3302 | pill-toggle，离开视图自动停止 | ✅ | ✅ | 低 |
| 87 | 日志查看：滚动贴底策略 | app.js:3253,3273-3276 | 用户上滚浏览历史时不强制贴底 | ✅ | ✅ | 低 |
| 88 | 日志查看：终端风格外壳 + 行数徽标 | index.html:2177-2186 | 三色圆点 + `#terminal-active-type` + `#terminal-line-count` | ✅ | ✅ | 低 |
| 89 | 备份管理：双 Tab（系统配置备份 / 歌单快照） | index.html:2197-2222; app.js:4240-4260 | 自动备份状态圆点 | ✅ | ✅ | 低 |
| 90 | 备份管理：配置备份状态概览卡 | index.html:2228-2268; app.js:4272-4296 | 自动备份模式徽标、保留天数、备份目录 | ✅ | ✅ | 低 |
| 91 | 备份管理：立即备份配置 | index.html:2248-2257; app.js:4359-4376 | `POST /api/config/backup-now`，防重复点击 | ✅ | ✅ | 低 |
| 92 | 备份管理：配置备份列表（下载/恢复/删除） | app.js:4304-4346,4378-4425 | 手动/每日自动类型标签；恢复前自动安全备份并热重载 | ✅ | ✅ | 中 |
| 93 | 备份管理：歌单快照列表（下载/回滚/删除） | index.html:2332-2342; app.js:4427-4498 | 按用户隔离，`GET /api/data/snapshots?user=` | ✅ | ✅ | 中 |
| 94 | 备份管理：上传快照 JSON | index.html:2309-2318; app.js:4499-4544 | `POST /api/data/upload-snapshot` | ✅ | ✅ | 中 |
| 95 | 备份管理：下载快照为 LX Music 备份格式 | app.js:4575-4610 | 客户端重组 `playList_v2`（default/love/userList）+ Blob 下载 | ✅ | ✅ | 中 |
| 96 | 备份管理：回滚快照 | app.js:4695-4717 | `POST /api/data/restore-snapshot`，三步后果警示 | ✅ | ✅ | 中 |
| 97 | 关于页：Markdown 渲染 | index.html:2347-2353; app.js:389-413 | `fetch('/about.md')` → `marked.parse`，替换 `{{version}}`/`{{buildHash}}` | ✅ | ✅ | 低 |
| 98 | 关于页：检查版本更新 | index.html:2356-2370; app.js:415-421 | `window.LxNotification.checkUpdates(true)` | ✅ | ✅ | 中 |
| 99 | 版本更新提示弹窗（通知引擎） | public/js/notification-engine.js:101-267,433-506 | 队列 FIFO、按类型配色、当前 vs 最新版本徽标、发布日期、动作（reload/link/close）、localStorage 按 interval 去重 | ✅ | ✅ | 中 |
| 100 | 更新检查受阻/AdBlocker/禁用遥测的分流提示 | notification-engine.js:389-414,454-475 | 404 / `disableTelemetry` / `_ph_blocked` 三种具体文案 | ✅ | ✅ | 中 |
| 101 | Toast 通知（success/info/error） | public/js/ui-utils.js:85-152,329-331 | 右下角堆叠、自增 bottom 偏移、手动关闭、自动消失 | ✅ | 部分（小屏贴边） | 低 |
| 102 | 通用确认弹窗 `showSelect` | public/js/ui-utils.js:157-220 | Promise 化，`danger` 切换配色与图标，遮罩点击不可关 | ✅ | ✅ | 低 |
| 103 | 通用输入弹窗 `showInput` | public/js/ui-utils.js:225-295 | Promise 化，focus/select、Enter 确认、Esc 取消 | ✅ | ✅ | 低 |
| 104 | 长文本跑马灯（truncate→marquee） | public/js/ui-utils.js:300-323,336-339 | `applyMarqueeChecks()` + resize 防抖 | ✅ | ✅ | 中 |
| 105 | 危险操作二次确认体系 | app.js:3459,3594,3618,3651,3684,4389,4406,4548,4614,4648,4702,4719 | 12 处 `showSelect(..., {danger:true})`，覆盖删除/恢复/重启类操作 | ✅ | ✅ | 低 |
| 106 | 文件管理器：跳转到独立 elFinder 页 | index.html:177-183; app.js:360-363 | `data-view="files"` 直接 `location.href='filemanager.html'`，无 `#view-files` DOM | ✅ | ✅ | 低 |
| 107 | 文件管理器：elFinder 2.1.62 CDN 集成 | filemanager.html:11-25,186-230 | jQuery 3.7.1 + jQuery UI 1.13.2 + elFinder.min.js + zh_CN + Material 主题，全部走 cdnjs/jsdelivr | ✅ | ✅（≤768px 移除 tree） | 中 |
| 108 | 文件管理器：elFinder 认证透传 | filemanager.html:171,188-193 | `localStorage.lx_auth` → URL `?auth=` + `customHeaders['x-frontend-auth']` 双保险 | ✅ | ✅ | 低 |
| 109 | 文件管理器：上下文菜单裁剪 | filemanager.html:202-211 | navbar/cwd/files 三套命令白名单 | ✅ | ✅ | 中 |
| 110 | 文件管理器：工具栏裁剪 | filemanager.html:215-228 | 分组 toolbar：back/forward、reload、home/up、mkdir/upload、open/download、info、copy/cut/paste、rm、rename/edit、extract/archive、search、view/sort | ✅ | ✅ | 中 |
| 111 | 文件管理器：返回后台（感知 admin.path） | filemanager.html:242-245 | `window.CONFIG['admin.path']` 默认 `/admin` | ✅ | ✅ | 低 |
| 112 | 文件管理器：动态 `<base>` 适配自定义路径 | filemanager.html:128-135; index.html:10-19 | 依 `location.pathname` 注入 base，支持自定义 admin.path 子路径部署 | ✅ | ✅ | 中 |
| 113 | 文件管理器后端：elFinder 命令集 | src/server/elfinderConnector.ts:127-180 | 21 个命令 | ✅ | ✅ | 高 |
| 114 | 文件管理器后端：路径安全（base64 hash + 穿越防护） | elfinderConnector.ts:18-47 | `l1_` 前缀编码、`Path traversal detected`、`TMP_` 目录限制在 os.tmpdir() | ✅ | ✅ | 中 |
| 115 | 文件管理器后端：未知扩展名按 text/plain 以便在线编辑 | elfinderConnector.ts:96-124 | 20 种 MIME 映射 + 默认 text/plain | ✅ | ✅ | 低 |
| 116 | 内置简易文件管理器（旧版，代码仍在） | app.js:4016-4197 | `loadFiles/renderFileList/...`，依赖 `#file-items` 等 DOM — **index.html 无对应节点，实际为死代码** | ❌ | ❌ | — |
| 117 | PWA：manifest + ServiceWorker | public/manifest.json; index.html:30-44; public/sw.js | standalone 显示、`lx-sync-server-v3` 缓存、跳过 `/api/` 与 `/music/`、离线回退 | ✅ | ✅ | 中 |
| 118 | PWA：安装应用按钮 | index.html:229-238; app.js:192-201,248-255 | `beforeinstallprompt` 捕获后显示 `#install-pwa-btn` | ❌ | ✅ | 中 |
| 119 | Web 播放器跳转链接 | index.html:184-191; app.js:436-440,3193-3194 | `#nav-player-link` href 由 `player.path` 驱动，配置保存后即时更新 | ✅ | ✅ | 低 |
| 120 | PostHog 遥测（可被 disableTelemetry 关闭） | index.html:21-27 | 匿名产品分析，无管理界面开关（靠服务端 config 注入） | ✅ | ✅ | 低 |
| 121 | 前端性能补丁（仅 Web 播放器） | public/js/perf-optimizer.js | fetch 5s TTL 缓存 / switchTab DOM 缓存 / renderQueue rAF 合并 — **index.html 未加载，仅 public/music/index.html:24 使用** | ❌ | ❌ | — |

## 后台独有注意事项

1. **47 个模态框**（`*-modal`）各自为政，新前端必须用组件库统一替换（契约 AD04/AD06/AD07 覆盖）。
2. **elFinder 走 CDN**（cdnjs/jsdelivr）：内网/离线不可用时文件管理器直接失效。移动端要单独评估是否保留 elFinder（契约 AD09）。
3. **`/api/users` 返回明文密码**（`server.ts:1316`）：阶段 B 必须与本清单同批处理，否则打断现有后台 UI。见缺陷台账 D-03。
4. **死代码两处**：`app.js:4016-4197` 旧文件管理器、`perf-optimizer.js` 未在后台加载。搬迁时直接丢弃，不要移植。
