# 播放器逐项明细（155 项）

> 对应契约 [`feature-inventory.md`](feature-inventory.md) 的展开。
> 路径以 `public/music/` 为根（如 `app.js` = `public/music/app.js`）。
> 勘查时间：2026-10-05，commit `191edb0`。
>
> 「未发现」条目一并列出——它们是"以为有其实没有"的功能，重构时不要凭印象补出来。

| # | 功能 | 入口/位置 | 说明 | 桌面 | 移动 | 难度 |
|---|---|---|---|---|---|---|
| 1 | 播放/暂停 | app.js:6110 `togglePlay`；index.html:3760 `#btn-play` | 播放条中央圆钮，切歌时淡入淡出并重置恢复标志 | ✅ | ✅ | 低 |
| 2 | 上一首/下一首 | app.js:6158 `playNext`、6181 `playPrev`；index.html:3744,3758 | 依播放模式取索引，随机模式用预选索引保证预读一致 | ✅ | ✅ | 中 |
| 3 | 进度条拖动/点击 seek | app.js:6628 `seek`；index.html:3709 `#progress-container` | 百分比跳转 currentTime，直播流(非有限时长)禁用 | ✅ | ✅ | 中 |
| 4 | 当前/总时长显示 | app.js:6487 `updatePositionState` | 播放过程高频刷新时间文本 | ✅ | ✅ | 低 |
| 5 | 播放模式（列表循环/单曲/随机/顺序） | app.js:6705 `setPlayMode`、6802 `updatePlayModeUI` | hover 下拉四模式，持久化 `lx_play_mode` | ✅ | ✅ | 中 |
| 6 | 倍速播放 0.5–2.0x | app.js:6745 `setPlaybackRate`；index.html:3776-3807 | 六档倍速菜单，按钮显示当前倍率 | ✅ | ✅ | 低 |
| 7 | 音量条 + 静音 | app.js:6653 `setVolume`、6674 `toggleMute` | 点击设音量、一键静音，持久化 `lx_volume` | ✅ | ❌（`hidden md:flex`，依赖系统音量） | 低 |
| 8 | 播放栏整体折叠/展开 | app.js:15282 `togglePlayerPanel` | 播放条下移出屏、悬浮展开钮 3s 自动淡化，视图底部 padding 联动 | ✅ | ✅ | 中 |
| 9 | 长按播放键切精简播放栏 | app.js:15073-15100 `setCompactPlaybar` | 长按 600ms 隐藏封面信息区并震动，可自动/手动 | ✅ | ✅ | 中 |
| 10 | 播放状态/来源短文案 | app.js:5709 `setPlayerStatus` | 解析中、降级、错误等状态提示 | ✅ | ✅ | 低 |
| 11 | 喜欢（爱心）按钮 | app.js:11732 `toggleLove` | 加入/移出"我的喜爱"列表并推送同步 | ✅ | ✅ | 低 |
| 12 | 侧边栏迷你播放信息 | index.html:232-244；app.js:5952 `updatePlayerInfo` | 左下角封面+歌名+歌手，窄屏/低高度自动隐藏 | ✅ | ❌ | 低 |
| 13 | 播放失败自动恢复（换源/降级/跳过） | app.js:5160 `runRecoveryFlow`、4367 `fetchSongUrl` | 按策略优先级跨平台换源、降音质、失败自动下一首 | ✅ | ✅ | 高 |
| 14 | 下一首预读 | app.js:4552 `prefetchNextSong` | 后台预解析下一首并跳过不可播歌曲 | ✅ | ✅ | 高 |
| 15 | 淡入淡出 crossfade | app.js:6217 `fadeVolume` | 切歌音量平滑过渡 | ✅ | ✅ | 中 |
| 16 | 播放状态持久化与恢复 | app.js:6371 `savePlaybackState`、6393 `restorePlaybackState` | 保存歌曲+队列(≤300)+进度+模式，刷新恢复并回跳 Tab | ✅ | ✅ | 中 |
| 17 | MediaSession 锁屏元数据 | app.js:6599 `updateMediaSessionMetadata` | 6 档 artwork + 标题/歌手/专辑 | ✅ | ✅ | 中 |
| 18 | SMTC 歌词实时写入媒体标题 | app.js `enableSmtcLyric`；index.html:3384 | 把当前歌词行高频写入系统媒体标题 | ✅ | ❌ | 中 |
| 19 | 播放历史（最近 50 首） | app.js:5764 `savePlayHistory` | localStorage 记录播放轨迹 | ✅ | ✅ | 低 |
| 20 | 播放队列抽屉 | app.js:1755 `toggleQueueDrawer`；index.html:4771-4811 | 右侧抽屉、曲目数、当前曲高亮+ping 点 | ✅ | ✅ | 中 |
| 21 | 队列拖拽排序 | app.js:1853 Sortable(queue-list) | 拖手柄重排，自动修正 currentIndex 并保存（含触摸 delay） | ✅ | ✅ | 中 |
| 22 | 队列内播放/移除单曲 | app.js:1922 `playSongFromQueue`、1928 `removeFromQueue` | 点击播放、垃圾桶移除 | ✅ | ✅ | 低 |
| 23 | 清空队列 | app.js:1958 `clearQueue` | 一键清空 | ✅ | ✅ | 低 |
| 24 | 定位当前播放 | app.js:1785 `scrollToCurrentSongInQueue` | 滚动并闪烁高亮当前曲目 | ✅ | ✅ | 低 |
| 25 | 队列去重（同 ID 取最高音质） | app.js `deduplicatePlaylistByQuality` | 入队前同 ID 仅留最高音质 | ✅ | ✅ | 中 |
| 26 | 全屏歌词页（播放详情） | app.js:8061 `toggleLyrics` | 封面+歌词布局，双击隐藏封面，pushState 返回 | ✅ | ✅ | 中 |
| 27 | 歌词自动滚动/跟随 | app.js:8493 `scrollToActiveLine` | 黄金比例参考线居中滚动 | ✅ | ✅ | 高 |
| 28 | 逐词卡拉 OK 进度 | app.js:8593 `startWordProgressUpdate` | klyric 逐字填充、译文/罗马音按行进度同步染色 | ✅ | ✅ | 高 |
| 29 | 译文/罗马音显示与位置交换 | app.js:8210 `fetchLyric` | 翻译、罗马音开关及两者上下交换 | ✅ | ✅ | 中 |
| 30 | 歌词字号滑杆 | app.js:1441 `changeLyricFontSize` | 0.8–3.0 rem 实时生效 | ✅ | ✅ | 低 |
| 31 | 歌词字体选择/读取系统字体/预览 | app.js:1454 `loadLocalFonts`、1518 `changeLyricFontFamily` | 预置字体集+本地字体枚举+实时预览面板 | ✅ | ✅ | 中 |
| 32 | 歌词荧光效果 | index.html:2816 | 当前行发光 | ✅ | ✅ | 低 |
| 33 | 手动滚动暂停跟随+参考线时间 | app.js:8693 `handleLyricScroll`、8766 `updateScrollIndicator` | 用户滚动暂停自动跟随并显示虚线参考线与时间 | ✅ | ✅（触摸滚动） | 中 |
| 34 | 内嵌歌词读取 | app.js:8152 `fetchEmbedLyricForLocalSong` | 本地文件 USLT 标签歌词 | ✅ | ✅ | 高 |
| 35 | 歌词卡片导出 | js/lyric-card.js；index.html:4437-4683 | 竖/横/方三比例、深/浅/专辑色、1/3/5 行、字号/行距/字体、滚轮缩放拖拽移动双击重置、下载/复制图片 | ✅ | ✅ | 高 |
| 36 | 关键词搜索（歌曲/歌手/专辑） | app.js:1988 `performSearch`、2024 `handleSearchTypeChange` | 三种类型切换 | ✅ | ✅ | 中 |
| 37 | 多平台聚合搜索 | index.html:371-379 `#search-source` | 全部聚合或 wy/tx/kg/kw/mg 单平台，选择持久化 | ✅ | ✅ | 中 |
| 38 | 搜索建议下拉（键盘导航） | app.js:15423 `initSearchTips`、15495、15516 | 300ms 防抖 tipSearch、↑↓选择、Enter、Esc、AbortController | ✅ | ✅ | 中 |
| 39 | 热搜榜 | app.js:2290 `fetchHotSearch`、2320、2409 | 默认热搜卡片网格、点击即搜、刷新、排名配色 | ✅ | ✅ | 低 |
| 40 | 热搜显示数量（0–50，0 关闭） | index.html:2634 `hot-search-limit-input` | 控制热词条数 | ✅ | ✅ | 低 |
| 41 | 结果分页（首页/上/下/末页/跳页+预取） | app.js:2084 `doSearch`；js/batch_pagination.js:380-440 | 分页条+页码跳转；网络结果触底自动追加 3 页 | ✅ | ✅ | 中 |
| 42 | 列表内搜索（按 `/`） | js/list_search.js；index.html:456-507 | 当前页结果过滤、上一个/下一个、仅显示匹配开关 | ✅ | ✅ | 中 |
| 43 | 歌手详情页 | app.js:2635 `enterArtist`–3335 | 歌手头部(折叠)、歌曲 Tab 分页、热门/时间排序、专辑 Tab 全量拉取、整专下载 | ✅ | ✅ | 高 |
| 44 | 专辑详情页 | app.js:3389 `enterAlbum` | 专辑头部+曲目列表 | ✅ | ✅ | 中 |
| 45 | 返回上一级（history 集成） | app.js:3436 `goBackToSearch` | pushState/popstate 返回歌手/专辑/搜索列表 | ✅ | ✅ | 中 |
| 46 | 搜索结果缓存 | app.js:2056-2081 | 同关键词+源+页 LRU 缓存 | ✅ | ✅ | 中 |
| 47 | 播放即加入默认列表 | app.js:5794 `addToDefaultList` | 试听列表，位置(顶/底)可配 | ✅ | ✅ | 中 |
| 48 | 添加到歌单（弹窗网格） | app.js:13096 `openPlaylistAddModal`、13008、13299 | 单曲/批量加入指定歌单，含勾选态 | ✅ | ✅ | 中 |
| 49 | 下载/缓存选择 | js/single_song_ops.js:353 `downloadSong`；app.js:14066 | 弹窗选"浏览器下载/缓存到服务器"，已缓存标注、权限拦截 | ✅ | ✅ | 中 |
| 50 | 不喜欢（歌曲） | js/dislike_manager.js；app.js:3734 `toggleDislikeSong` | 标记后行内置灰，播放队列自动剔除 | ✅ | ✅ | 中 |
| 51 | 查看评论 | app.js:13479 `toggleCommentModal`、13527、13576 | 最热/最新双 Tab、翻页、来源标识、刷新 | ✅ | ✅ | 中 |
| 52 | 歌手名点击跳转搜索 | app.js `renderResults` 行内 onclick（3640 附近） | 点歌手列以该歌手重搜 | ✅ | ✅（歌手列 `hidden sm:flex`） | 低 |
| 53 | 删除单曲 | js/single_song_ops.js:184 `deleteSingleSong` | 确认弹窗+服务端删除（不喜欢列表为取消不喜欢） | ✅ | ✅ | 低 |
| 54 | 音质/来源标签 | app.js:2445 `getQualityTags`、2498 `getSourceTag`；js/quality.js | 行内音质徽标与平台标签 | ✅ | ✅ | 低 |
| 55 | 歌单广场（网格+分页） | js/songlist_manager.js；index.html:635-666 | 卡片封面/播放量/作者，2→6 列响应式 | ✅ | ✅ | 中 |
| 56 | 歌单搜索+分类+排序 | index.html:576-632；js/songlist_manager.js:588 `changeSort` | 关键词、分类弹窗、动态排序按钮（最热等） | ✅ | ✅ | 中 |
| 57 | 歌单详情 | index.html:669-845 | 播放全部、收藏、简介展开、头部折叠、批量工具、内搜索 | ✅ | ✅ | 中 |
| 58 | 新建/重命名/删除歌单 | app.js:11492、11527、10730 | 侧栏新建按钮+行内菜单 | ✅ | ✅ | 中 |
| 59 | 刷新网络歌单 | app.js:11268 `handleRefreshList` | 从原始地址同步最新内容 | ✅ | ✅ | 中 |
| 60 | 跳转原始歌单链接 | app.js:11756 `handleJumpToOriginalList` | 打开歌单源页面 | ✅ | ✅ | 低 |
| 61 | 导出歌单为 JSON | app.js:10779 `exportPlaylistToLocal`、10751 `buildPlaylistExport` | 下载 `name.json`（type `lxserver-playlist`） | ✅ | ✅ | 低 |
| 62 | 收藏侧栏拖拽排序 | app.js:10848 `initFavoriteSidebarSortable`、10817 | 拖拽重排"我的收藏"子项并持久化 | ✅ | ✅ | 中 |
| 63 | 外部歌单导入（链接/ID/QQ号） | js/songlist_manager.js；index.html:3866-3955 | 打开外部歌单弹窗、QQ 用户歌单选择弹窗 | ✅ | ✅ | 中 |
| 64 | 收藏网络歌单到我的收藏 | app.js:11676 `collectCurrentSongList` | 将网络歌单复制为本地收藏 | ✅ | ✅ | 中 |
| 65 | LX 协议远程同步（ws 配对） | js/user_sync.js；index.html:3981-4050 | ws:// URL+连接码、AES+gzip 数据通道、心跳、客户端模式 | ✅ | ✅ | 高 |
| 66 | 远程覆盖同步模式选择 | app.js:10519 `showRemoteOverwriteModal`、10572 | 合并/完全覆盖（本地或远程）步骤流 | ✅ | ✅ | 高 |
| 67 | 同步下载面板（歌单→本地） | js/sync_download.js；index.html:5629-5861 | 开关/音质/存储位置、进度条、增删失败统计、失败列表、目录迁移 | ✅ | ✅ | 高 |
| 68 | 账号设置推送/手动保存到服务器 | app.js:10014 `pushSettingsToServer`、10056 | 多端设置同步 | ✅ | ✅ | 中 |
| 69 | 数据变更即时推送 | app.js:11927 `pushDataChange` | 列表写操作后同步服务端 | ✅ | ✅ | 中 |
| 70 | 网络歌单自动更新+间隔选择器 | app.js:463 `setupNetworkListAutoCheck`、481 | 预设(30m–7d)+复合(天/时/分)+上次/下次执行徽章+立即检查 | ✅ | ✅ | 高 |
| 71 | 我的收藏空态登录引导 | index.html:1070-1094 | 未登录展示引导卡+跳转设置登录 | ✅ | ✅ | 低 |
| 72 | 收藏侧栏折叠/计数 | index.html:102-186；app.js:9001 | 折叠面板、各列表歌曲计数 | ✅ | ✅ | 低 |
| 73 | 歌手/专辑库视图 | app.js:9540 `renderLibraryArtists`、9621 `renderLibraryAlbums` | 网格视图+批量选择/全选/删除 | ✅ | ✅ | 中 |
| 74 | 歌手/专辑收藏与不喜欢切换 | app.js:9337、9384、9251、9298 | 心形/禁止按钮切换并同步 | ✅ | ✅ | 中 |
| 75 | 厌恶库（歌曲/歌手/专辑） | index.html:128-181；app.js:11372–11492 | 三个虚拟列表、计数、置灰过滤联动 | ✅ | ✅ | 中 |
| 76 | 批量操作（全选/清空/收藏/下载/删除） | js/batch_pagination.js；index.html:396-425,729-755,924-950 | 搜索/歌单详情/排行榜三处统一批量工具栏 | ✅ | ✅ | 中 |
| 77 | 排行榜 | js/leaderboard_manager.js；index.html:849-1067 | 五平台、榜单切换、播放全部、批量、内搜索、分页边界跳转 | ✅ | ✅ | 中 |
| 78 | 榜单侧栏（桌面侧栏/移动抽屉） | index.html:891-917 | 桌面固定，移动端滑出+遮罩自动收起 | ✅ | ✅（抽屉） | 中 |
| 79 | 本地音乐扫描与列表 | js/local_music.js:997 `fetchData`、1298 `render` | 服务端目录扫描、分页、封面懒加载、ID3/歌词状态渲染 | ✅ | ✅ | 高 |
| 80 | 布尔语法快速搜索 | js/local_music.js:451 `parseSearchExpression`、506 `createSearchMatcher` | `&`/`|`/`!`/`()` 高亮成方框标签，语法错误提示 | ✅ | ✅ | 高 |
| 81 | 高级筛选面板 | js/local_music.js:693 `toggleFilterTag`、1085 `applyFilters` | 音质/来源/状态(缺标签/缺封面/缺词/缺嵌入/未索引)/位置/排序方向/目录 | ✅（内嵌） | ✅（浮层） | 中 |
| 82 | 智能检测（AcoustID 指纹）与手动关联 | js/local_music.js:2569 `autoLinkAll`、2627、2205、2315 | 指纹识别自动匹配+手动搜索关联 | ✅ | ✅ | 高 |
| 83 | 本地音乐批量操作 | index.html:1404-1471；js/local_music.js:1739-2162 | 加入歌单/补全歌词/嵌入歌词/补全元信息/移动目录/云端同步/保存到设备/删除 | ✅ | ✅ | 高 |
| 84 | 子目录选择/新建/重命名/删除 | js/local_music.js:2726 `openSubPathModal`、330 | 子路径筛选弹窗、两步删除确认 | ✅ | ✅ | 中 |
| 85 | 自定义目录模式 + 目录树筛选 | js/customDir.js；index.html:4284-4377,196-204 | 用户目录开关、目录树多选/级联全选/徽章计数 | ✅ | ✅ | 高 |
| 86 | 歌曲洗版（Remaster） | index.html:5386-5560；js/local_music.js:3136+ | 选歌+目标音质、进度、结果分类(替换/降级/跳过/失败)、风险提示 | ✅ | ✅ | 高 |
| 87 | 内嵌封面/内嵌歌词/元信息徽标 | js/local_music.js:1440-1495 | "封""词""外置词"、缺标签/缺封面/缺词/完整状态、码率/采样率/位深 | ✅ | ✅ | 低 |
| 88 | 本地单曲操作（播放/保存/加歌单/删除） | js/local_music.js:1782、2162、1767、1827 | 行内四按钮 | ✅ | ✅ | 中 |
| 89 | 公开歌曲切换 | js/local_music.js:735 `togglePublicSongs` | 查看公开用户的本地歌曲 | ✅ | ✅ | 中 |
| 90 | 位置/目录筛选与分页 | index.html:1113-1117,1321-1327 | 根目录/数据目录、下载/缓存、时间/歌名/歌手/专辑/大小排序+方向 | ✅ | ✅ | 低 |
| 91 | 下载管理抽屉 | index.html:4897-4966；js/download_manager.js | 任务卡片、封面、状态徽标、单任务进度、全局速度与总进度 | ✅ | ✅ | 高 |
| 92 | 任务控制（暂停/继续/重试/取消/清空） | js/download_manager.js:1040-1200 | 单任务与全队列操作 | ✅ | ✅ | 中 |
| 93 | 下载并发数（1–5） | app.js:147 `normalizeDownloadConcurrency` | 本地+服务端并发同步 | ✅ | ✅ | 中 |
| 94 | 服务器下载队列同步与轮询 | js/download_manager.js:185、361 | 服务端托管任务状态、缺失任务重查、并发槽位协调 | ✅ | ✅ | 高 |
| 95 | 歌词补全（单条/全部重试） | js/download_manager.js:517 `checkTaskLyric`、561、586 | 完成后自动检测缺失歌词，可一键补全 | ✅ | ✅ | 中 |
| 96 | 下载任务持久化 | js/download_manager.js:1345-1423（sessionStorage） | 刷新后恢复浏览器下载任务 | ✅ | ✅ | 中 |
| 97 | 批量下载（浏览器/服务器队列） | js/single_song_ops.js:476、582 | 大批量走原生/服务端、小批量走队列 | ✅ | ✅ | 中 |
| 98 | 10 段均衡器 | js/sound-effects.js（31–16000Hz）；index.html:5085 | Web Audio peaking 滤波链，两列推子 | ✅ | ✅ | 高 |
| 99 | EQ 预设（9 内置+自定义增删） | js/sound-effects.js:15-23,358-380 | 流行/舞曲/摇滚/古典/人声/慢歌/电子/重低音/柔和 | ✅ | ✅ | 中 |
| 100 | 环境混响（14 种）+DRY/WET | js/sound-effects.js:30-44；index.html:4998-5017 | Convolver 脉冲响应+干/湿增益滑杆 | ✅ | ✅ | 高 |
| 101 | 变调（0.5–2.0x） | index.html:5024-5037；js/pitch-shifter/ | Phase-Vocoder / OLA 变调器 | ✅ | ✅ | 高 |
| 102 | 3D 立体环绕 | index.html:5043-5070 | Panner 环绕速度/距离、启用开关 | ✅ | ✅ | 中 |
| 103 | 音效持久化与账号同步 | js/sound-effects.js:179-240 | localStorage + 本地账号 json 同步 | ✅ | ✅ | 中 |
| 104 | 底部播放栏波形 | js/visualizer.js；index.html:3703-3707 | bars/wave 风格、随播放栏折叠清理画布 | ✅ | ✅ | 中 |
| 105 | 详情页背景可视化 | js/visualizer.js；index.html:3544,2699-2767 | pulse/dots/flower、全局方块/连体、透明度滑杆 | ✅ | ✅ | 中 |
| 106 | 音效面板入口按钮 | index.html:3814(桌面)/3701(移动) | 播放条内均衡器弹窗开关 | ✅ | ✅ | 低 |
| 107 | 服务器缓存管理抽屉 | app.js:7586 `toggleCacheDrawer`、7602、7640 | 缓存列表、总占用、批量删除、清空服务端缓存 | ✅ | ✅ | 高 |
| 108 | 缓存项操作 | app.js:7745、7759、7884 | 播放所属歌单/重试歌词/删除单条 | ✅ | ✅ | 中 |
| 109 | 一键补全缓存缺失歌词 | app.js:7797 `downloadAllCacheLyrics` | 批量拉取缺失歌词 | ✅ | ✅ | 中 |
| 110 | 缓存开关组 | index.html:2118-2242 | 歌词/链接/歌曲文件/歌词文件/下载嵌入歌词/优先播放缓存 | ✅ | ✅ | 中 |
| 111 | 缓存位置/命名规则/查看目录 | index.html:2312-2358；app.js:4919、4991 | data/root、5 种命名模板、显示物理绝对路径 | ✅ | ✅ | 中 |
| 112 | 存储占用统计 | app.js:7397 `calcStorageUsage`、7425、7533 | 浏览器 storage + 服务端 music/cache 双目录统计 | ✅ | ✅ | 中 |
| 113 | 清除歌词/链接缓存、重置所有设置 | app.js:7456、7432 | 一键清理与恢复默认（含彻底清空存储） | ✅ | ✅ | 中 |
| 114 | 设置页四 Tab（系统/显示/逻辑/日志） | js/theme_manager.js:96 `switchSettingsTab` | 移动端 Tab 自动居中滚动、日志 Tab 懒渲染 | ✅ | ✅ | 低 |
| 115 | 系统设置（自定义源/公开源/音质/每页数/默认入口） | index.html:1551-1673 | 音质 8 档、每页 10/20/50/100/全部、默认入口 5 选 1 | ✅ | ✅ | 中 |
| 116 | 网络设置（播放/下载/自动/自定义代理+并发） | index.html:1676-1796 | CORS/混合内容自动走服务端代理，自定义 `{url}` 模板 | ✅ | ✅ | 中 |
| 117 | 数据同步（本地登录/远程 ws/Token 管理） | index.html:1799-1886；app.js:10355 | 本地服务器账号登录、远程两步连接、连接状态 | ✅ | ✅ | 高 |
| 118 | 外观（明亮/暗黑/跟随系统） | js/theme_manager.js:39 `setAppearance` | 三模式+系统偏好变化监听 | ✅ | ✅ | 低 |
| 119 | 主题色（5 套） | js/theme_manager.js:18 `setTheme` | 森之韵/深海谧/暖阳愿/紫微星/绯红月，CSS 变量切换 | ✅ | ✅ | 低 |
| 120 | 界面与布局设置 | index.html:2558-2642 | 自动精简控制栏、侧边栏封面、热搜数量 | ✅ | 部分（精简播放栏仅手机，侧栏封面仅电脑） | 低 |
| 121 | 播放背景与视觉特效设置 | index.html:2644-2769 | 封面虚化/纯色/黑色、底部与详情页可视化开关与风格、全局透明度 | ✅ | ✅ | 中 |
| 122 | 歌词显示设置 | index.html:2771-2954 | 字号/荧光/翻译/罗马音/交换/字体+预览 | ✅ | ✅ | 中 |
| 123 | 播放逻辑设置 | index.html:2960-3082 | 搜索/歌单播放时切列表、去重、剔除不喜欢 | ✅ | ✅ | 中 |
| 124 | 播放体验设置 | index.html:3084-3193 | 预读、自动恢复进度、淡入淡出、屏幕常亮 | ✅ | ✅ | 中 |
| 125 | 播放失败策略设置 | index.html:3195-3352 | 自动降质/切平台/换源/自动下一首+策略优先级排序 | ✅ | ✅ | 高 |
| 126 | 系统交互与外设设置 | index.html:3354-3468 | SMTC 歌词、键盘快捷键开关+速查表 | ✅ | 部分（快捷键仅电脑） | 低 |
| 127 | 系统日志查看器 | js/log_viewer.js；index.html:3476-3505 | 劫持 console、自动滚动、清空/刷新 | ✅ | ✅ | 低 |
| 128 | 自定义音源管理 | app.js:12041–12796 | 上传 .js / URL 导入、启用禁用/重载/删除、公开范围切换、平台勾选编辑 | ✅ | ✅ | 高 |
| 129 | Token 管理 | app.js:15581、15734、15876、15920、16036 | 生成/编辑/删除持久化 Token、偏移或绝对过期、掩码展示、调用日志 | ✅ | ✅ | 高 |
| 130 | 管理员登录/退出 | app.js:4638、4684、4708 | 开放写权限校验、管理员徽标 | ✅ | ✅ | 中 |
| 131 | 后台管理入口 | js/common_ui.js:82 `goToAdmin` | 跳转 filemanager 后台 | ✅ | ✅ | 低 |
| 132 | 关于页（markdown 渲染+检查更新） | app.js:1678 `loadAboutContent` | about.md 用 marked 渲染、云端检查版本更新 | ✅ | ✅ | 低 |
| 133 | 项目使用声明弹窗 | js/common_ui.js:94 `checkProjectAgreement` | 首次进入强制确认，接受后跳转关于页协议段 | ✅ | ✅ | 低 |
| 134 | 访问密码登录页 | login.html:112-160 `handleLogin` | 未开启认证自动跳转、错误抖动动画、加载态按钮 | ✅ | ✅ | 低 |
| 135 | 用户登录/切换/退出 | app.js:1212 `handleLogout`、1110 `handleHeaderLogout` | 头部登录钮、用户名悬停显示退出 | ✅ | ✅ | 中 |
| 136 | 登录状态与权限 UI | app.js:955 `updateUserUI`、4736 `updateAdminUI` | 管理员标签、自定义目录开关显隐、收藏引导切换 | ✅ | ✅ | 低 |
| 137 | PWA 安装按钮 | js/pwa.js；index.html:305-309 | `beforeinstallprompt` 捕获→A2HS 提示 | ✅ | ✅ | 中 |
| 138 | Service Worker 离线缓存 | sw.js | 预缓存 40+ 资源、Stale-While-Revalidate、音频/API 不拦截、旧缓存清理 | ✅ | ✅ | 中 |
| 139 | iOS 后台播放保活 | js/ios-background-audio.js | MediaStreamDestination 桥接隐藏 audio 锚点、中断恢复 | ❌ | ✅（iOS only） | 高 |
| 140 | 屏幕常亮 | app.js:6286 `toggleNoSleep`；js/NoSleep.min.js | 播放期间保持屏幕唤醒 | ❌ | ✅ | 中 |
| 141 | 通用 Toast | app.js:14634 `showToast` | success/info/error 三型，堆叠上浮、跑马灯、悬停暂停、点击重置计时、避让 RecoveryToast | ✅ | ✅ | 中 |
| 142 | 全局加载遮罩 | app.js:14740 `showLoading`、14759 `hideLoading` | 阻塞式蒙层+旋转图标 | ✅ | ✅ | 低 |
| 143 | 换源提示 RecoveryToast（深度堆栈） | app.js RecoveryToast 类（14380-14631） | 尝试历史堆栈、悬停散开、滚轮翻历史、成功/失败态、PWA 后台暂停动画、抑制普通 Toast 覆盖 | ✅ | ✅ | 高 |
| 144 | 版本/公告通知 | public/js/notification-engine.js | 云端公告卡片、版本更新提示、手动检查 | ✅ | ✅ | 中 |
| 145 | 自定义模态弹窗（input/select/options） | app.js:13858 `showInput`、13939 `showSelect`、14009 `showOptions` | Promise 化弹窗（删除确认、下载目标、音质选择、管理员验证） | ✅ | ✅ | 中 |
| 146 | 睡眠定时 | app.js:14790-14930；index.html:4379-4434 | 15/30/45/60/90m 预设+自定义分钟(1-1440)、倒计时、到时停播 | ✅ | ✅ | 中 |
| 147 | 顶部睡眠定时入口与倒计时 | index.html:268-274 | 头部时钟按钮实时显示剩余时间 | ✅ | ✅ | 低 |
| 148 | 主界面布局（侧栏/视图切换） | app.js:1529 `switchTab`、15125 `toggleSidebar` | 桌面固定 72 宽侧栏；移动抽屉+遮罩；默认入口可配 | ✅ | ✅（抽屉） | 中 |
| 149 | 顶部标题栏 | index.html:258-328 | 页面标题、登录、PWA 安装、退出、版本号、GitHub 链接，响应式逐级隐藏 | ✅ | 部分 | 低 |
| 150 | 设置项提示气泡 | js/common_ui.js:12 `clampTooltipPosition` | 桌面 hover；移动端点按展开并做视口边缘钳制 | ✅ | ✅ | 低 |
| 151 | 图片懒加载 | app.js:3850 `lazyLoadImages` | IntersectionObserver + logo 占位 + onerror 回退 | ✅ | ✅ | 中 |
| 152 | 跑马灯长文本 | app.js:3796 `createMarqueeHtml`、3804 `applyMarqueeChecks` | 超长歌名/歌手/Toast 自动滚动，hover 暂停 | ✅ | ✅ | 中 |
| 153 | 播放列表作用域（网络/本地列表/本地全部） | app.js `currentPlayingScope`、5153 `playFromView` | 队列随来源切换，默认列表自动追加 | ✅ | ✅ | 中 |
| 154 | 音质智能降级与探测 | js/quality.js；app.js:3936 `probeUrl`、4159 `getSongMatchScore` | 偏好音质不可用时按优先级降级，跨源匹配打分 | ✅ | ✅ | 高 |
| 155 | 本地歌词/链接缓存清理入口 | index.html:2406-2423 | 清除歌词缓存、清除链接缓存、刷新统计、管理服务端缓存 | ✅ | ✅ | 中 |

## 明确不存在的功能（不要凭印象补）

- **搜索历史**：不存在。只有热搜、搜索建议、播放历史（`play_history`）。
- **歌单 JSON 导入回端**：不存在。只有外部歌单链接/ID/QQ 号导入、快照上传恢复。
- **队列去重按钮**：不存在。去重是设置项（`deduplicatePlaylistByQuality`）在入队时自动执行。
- **自定义源排序 UI**：不存在显式排序（后端有 `order.json` 排序能力，前端只按列表顺序渲染）。
- **波形编辑器**：不存在。`wave.js` 是 Canvas 频谱可视化，不是音频波形剪辑。
