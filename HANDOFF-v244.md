# v2.44.0 交接：用户新提的 6 项需求（2026-10-31）

> **状态（2026-11-02 更新）：6 项需求已完成；另修「今日甄选点播错歌」= v2.44.2。**
> 代码 `main` = `037dfbc`；镜像 `ghcr.io/335459215/lxserver:2.44.2`
> （digest `sha256:bc9bb25ab380853e6a00310923743ef81e6f5495a6854bab67fcdbd630bb7b7a`）；
> NAS 容器已跑 `v2.44.2`（9528），**通过群晖 Container Manager 的 Compose 项目部署**
> （项目目录 `/volume1/docker/lxserver`，compose 二进制用 ContainerManager 自带的那份）。
> **验收**：LAN 30/30 + 公网 HTTPS 30/30，截图见 `docs/v244/` 与 `docs/v244/https/`。

### v2.44.2：今日甄选「显示 A 播 B」根因与修复

线上实测：`吻别/张学友(kw:157908)` 与 `时光/许巍(kw:27811583)` 被解析成**同一条**
kuwo 直链，且都 `fromCache=true` —— 所以每次点播都错、换源重试也没用。

三层根因：
1. 第三方聚合音源（K×H测试/星海）忽略 songmid 返回同一条直链，服务端无校验；
2. `musicMatch.getSongMatchScore` 用 `includes()` 匹配歌名，父串/子串候选可顶替；
3. 粘滞缓存把错误结果固化 10 分钟。

修复：
- 新增 `src/server/songIdentityGuard.ts`：同一 URL 10 分钟内不得服务两个不同歌曲身份；
  解析结果自带元信息时歌名/歌手必须一致；**粘滞缓存命中时同样校验**。
- 歌名匹配由包含改为**归一化后完全相等**（仅放行 feat./ft. 署名差异）。
- 判定错歌后记入按歌黑名单并**自动换源重试一次**，不把 500 抛给用户。

验证：6 张甄选卡逐首解析 6/6 名称一致且 URL 互不重复；真实 UI 点播 3 张卡 src 各不相同；
单测 281/281。


---

## 本轮完成情况（给下一个会话）

| # | 需求 | 结果 | 关键改动 |
|---|------|------|----------|
| ① | 内置歌单可改名/删除 | ✅ | `listDataManage.ts` 快照加 `defaultMeta/loveMeta`（name/deleted，旧快照兼容）；`lists.ts` 去掉写死名字与内置 id 限制；`PlaylistView` 全列表可改名删除 |
| ② | 今日甄选 6 卡真封面 | ✅ | 新增 `web/src/lib/curatedCovers.ts` + `Dashboard.tsx` 挂载时各搜一首（wy）、localStorage 7 天缓存、失败回落渐变 |
| ③ | 移动端搜索行占满 | ✅ | `SearchPage` 结果卡通栏（`-mx-4` 抵消 main 的 p-4）+ `SongList` 收紧 gap/封面、手机隐藏时长；实测 li 316→378px |
| ④ | 返回保留搜索结果 | ✅ | `runSearch()` 用 replace 写 `q/source/type` 到 URL；`searchedKeyRef` 跳过重复搜索（实测返回后 0 次新搜索） |
| ⑤ | PWA 缓存 | ✅ | `sw.js` VERSION=v3：白名单图床封面缓存 + 排行榜 SWR；`server.ts` leaderboard/list 加 `Cache-Control: max-age=300` + `leaderboardCache.ts` 内存短缓存 |
| ⑥ | 音源链接/文件/代理 | ✅ | `SourcesGroup` 一行输入 + 使用代理勾选 + 「+」文件选择；服务端 `customSourceUrl.ts`/`customSourceFetch.ts`（仅 http(s)/拦回环/逐跳校验/2MB/20s/HTML 识别），默认直连 |

**验收方式**：`python .playwright/_v244_verify.py`（390×844 无头 Chromium，30 条断言全过，
截图写入 `docs/v244/`）。① 的删除测试先备份 `/api/user/list`、结束整份写回，可逆。

## 部署环境（已定稿，别改网络拓扑）

1. **容器 DNS**：已恢复为原来的 `192.168.1.2` 优先，另加 `223.5.5.5 / 119.29.29.29` 兜底。
   - 排查时的现象（**已自愈，勿据此再改**）：11-01 20:00 前后容器内对 192.168.1.2 的查询
     整段超时/`REFUSED`，所有平台 `EAI_AGAIN`；22:40 复测同一地址已能解析全部平台域名
     （wy/kg/tx/kw/mg 5/5 通过）。属上游 DNS 的临时故障，不是配置问题。
2. **网络**：lxserver **只挂共享 `infra` 网络**（`networks: [infra]`），
   `REDIS_URL=redis://:moviepilot@infra-redis:6379` 保持原样。
   - **不占用 172.18 网段**（那是反代容器的），也没有另建网段；
   - 共享容器 `infra-redis` / `infra-postgres` / `infra-mysql` **未做任何改动**
     （uptime 2 天 / 22 小时，网络 `infra` id `711113fb…` 未变，仅 lxserver 自己重连）。
   - ⚠️ 不要再给 lxserver 加第二个网络：docker 24 对多网络默认网关的选择是随机的，
     重建后可能把默认路由分到 infra 而整机断网（本轮踩过）。
   - compose 备份：`compose.yaml.bak-v244-infra`（定稿前）、`.bak-v244-net`、
     `.bak-v244-subnet`、`.bak-v244-bridge`（探索过程）。

**反代**：反代容器（51739）此前因 172.18 网段冲突起不来；已把 lxserver 移出该网段（只挂 infra）。
反代修复后已复测：`https://lx.131452188.xyz:51739` 返回 200，`/api/music/leaderboard/list`
带 `Cache-Control: public, max-age=300`，SW 缓存桶 `lxserver-app-v3 / img-v3 / api-v3` 均建立，
390×844 全套 **30/30** 通过（截图 `docs/v244/https/`）。

**构建备忘**：alpine `latest` 的 apk 索引已坏（nodejs-current 依赖缺失），
`/volume1/docker/lxbuild/Dockerfile.local` 已钉 `FROM alpine:3.22`；构建日志
`/volume1/docker/lxbuild/build244.log`（`===== BUILD EXIT=0 =====`）。

---

## 已完成、不要重做（v2.43.0）

- 自建歌单改名/删除/加歌；封面 http→https 客户端直连 CDN。
- 已推送 `main`（`4b6f10b`）、已部署 NAS（服务在 9528）、已 `docker push` 到
  `ghcr.io/335459215/lxserver:2.43.0`（digest `sha256:2318bddb...`）。
- 线上回归 14/14 通过；证书正常、无 Mixed Content。

---

## 要实现的 6 项（用户原话要点 + 已查实根因）

### ① 所有歌单都能改名/删除（含「试听列表」「我的收藏」）
用户要求：**所有歌单都可以编辑、都可以删除**，移动端也一样。
用户已拍板：**真正做到可改名/可删除**（不是本机隐藏，不是只清空）。

**根因**：
- `src/modules/list/listDataManage.ts:26` `restore()` 每次强制
  `allMusicList.set(LIST_IDS.DEFAULT,...)` / `set(LIST_IDS.LOVE,...)`，
  `getListData()`(:40) 也从这两条固定 key 取值 → 内置列表删了会被立刻重建。
- 内置列表**名字不存服务端**：前端 `web/src/lib/lists.ts:116-121` 的
  `findPlaylist()` 写死 `'试听列表'` / `'我的收藏'`。
- `web/src/components/player/PlaylistView.tsx:105`
  `const canRemove = listId !== LIST_DEFAULT_ID && listId !== LIST_LOVE_ID`
  → 内置列表连按钮都不渲染。
- `web/src/lib/lists.ts:278` `deletePlaylist()` 主动拒绝内置 id。
- 「我的收藏」还挂着 L 键收藏（`KeyboardShortcuts`）和
  `AddToPlaylistMenu` 里的「加到「我的收藏」」项，删除要考虑这些入口。

**改法方向**：让 default/love 的元信息（name、visible/deleted 标记）也能
存进快照 payload；`restore()` / `getListData()` 尊重这些字段；
前端去掉写死的名字与 `canRemove` 限制。**要动服务端 → 必须重建镜像**。

### ② 「今日甄选」6 张卡要有真封面
用户要求：取歌单里**第一首或随机一首**的歌的海报做封面，**必须有封面**。
用户已拍板：**首页加载时为 6 张卡各搜一首取封面**（接受多 6 次请求）。

**根因**：`web/src/pages/Dashboard.tsx:98-115` 的 `CuratedMix` 只有
`gradient` + `badgeColor`，卡片(:406-470)渲染的是渐变 + `<Disc3>` 黑胶图标，
**本来就没有图**。6 张卡的 `query` 是硬编码关键词（经典/流行/时光/纯音乐/晚安/摇滚），
点卡时才去五大平台实时搜歌。

**改法方向**：加载时为每张卡搜一首（建议只查网易云 `wy` 取第一首，省流量），
取 `coverUrl()` 当封面，结果缓存到 localStorage（加版本前缀，便于失效）。
搜不到时仍回落现有渐变（保证不裂图）。

### ③ 移动端搜索结果行要占满宽度
用户要求：手机屏够宽，但结果**挤在中间**，歌曲名看不到，要求左右拉满。

**实测数据（已在 390×844 复现）**：`<li>` 宽只有 **316px**（视口 390），
歌名被截成「周杰…」、歌手「周杰…」，中间大片空白；无水平溢出
（`scrollWidth - clientWidth = 0`）。

**根因位置**：`web/src/components/player/SongList.tsx`
- 行容器 `:100` `flex w-full items-center gap-3.5 px-3.5 py-2.5`
- 标题区 `:138-146` `<span className="min-w-0 flex-1">` + 两层 `truncate`
- 平台徽标 `:168` `hidden ... sm:block`（手机上隐藏，但布局仍留 gap）
- 时长 `:171` `w-12 shrink-0`
- 操作区 `:178` `flex shrink-0 items-center gap-1`（两个 36px 按钮）

**注意**：外层卡片还有 padding，需一并检查 `SearchPage.tsx:717`
`<SongList songs={results} showSource />` 的父容器宽度。
目标：手机上歌名/歌手完整可读，行作用区用满 390 - 安全边距。

### ④ 从播放页返回，必须保留搜索结果
用户要求：搜索→点歌→进详情→返回，**要回到有结果的搜索页，不能空**；
清空结果只由用户主动操作。

**根因**：`web/src/pages/player/SearchPage.tsx`
- `:65-77` 恢复逻辑要求 URL 带 `q`：`const q = p.get('q'); if (!q) return null`
- 但 `runSearch()`(:136)**从不写 URL**，全文件没有 `setParams`/`navigate`，
  实测搜索后 URL 恒为 `/app/search`（无 `q`）→ 恢复分支永远进不去。
- 即「返回保留结果」这套机制**从未生效过**（代码注释描述的是理想态）。

**改法方向**：搜索时把 `q`/`source`/`type` 写进 URL（`replace`，不新增历史项），
让恢复条件成立；或改恢复判据（用 `searchedFor` 与快照比对而不依赖 URL）。
**改完必须实测「返回后结果仍在且未重搜」**。
注意 `:207` `restoredSearchRef` 用于跳过恢复那一次的重复搜索，别改坏。

### ⑤ PWA 端缓存（静态资源 + 封面 + 定时更新的歌单）
用户要求：反代不开缓存，但**客户端要缓存**；封面、定时更新的歌单要更快。
实测痛点：**切换排行榜每次要等 1-3 秒**，明明该有缓存。

**根因（两处）**：
1. `web/public/sw.js` 三条红线**主动排除了**：
   `/api/` 一律不缓存（含排行榜数据）；**跨域一律放行**（封面 CDN 不缓存）。
   只有同源静态资源 `handleAsset()` 是缓存优先。
   `VERSION = 'v2'`，改缓存策略必须 bump 版本号，否则老 SW 不更新。
2. **排行榜列表接口没发缓存头** —— `src/server/server.ts:6560` 附近
   `/api/music/leaderboard/list` 的 `res.writeHead(200, {...})` **只有
   Content-Type，没有 Cache-Control**（对比 `:6531` boards 接口是有
   `'public, max-age=600'` 的）。→ 浏览器每次切换都重新打上游。

**改法方向**：
- 服务端给 leaderboard/list 加合理 `Cache-Control`（如 `max-age=300`），
  或做服务端内存短缓存（更有效，且用户反代不开缓存也不受影响）。
- SW 里**精确白名单**缓存封面（只允许已知图床 `music.126.net` /
  `musicapp.migu.cn` / `kugou.com` / `kuwo.cn` / `gtimg.cn` / `y.qq.com`），
  仍绝不碰音频 Range、绝不缓存登录态类接口。
- 改完 bump `VERSION`，并验证老 SW 被替换。

### ⑥ 自定义音源：支持链接 + 文件，UI 改成一行
用户要求：
- **支持链接导入和文件导入**；
- 输入框右边放「**使用代理**」勾选，勾了就走代理拉取；
- 更右边或上方放「**+**」，点击调起手机/电脑的**本地文件选择器**；
- 现在的输入框**太大**，只要**一行**输入链接。

**现状**：`web/src/pages/settings/groups/SourcesGroup.tsx:77-180`
`ImportSourceDialog` 只有一个 `h-48` 的 `<textarea>` 粘贴 JS，无链接、无文件、无代理选项。

**已有可复用**：
- 服务端 `POST /api/custom-source/upload`（`src/server/customSourceHandlers.ts:154`
  `handleUpload`）接受 `{ filename, content, username, allowUnsafeVM }`
  —— 注意它收的是**脚本内容**，不是 URL，需要新增「服务端按 URL 抓取」能力。
- 服务端 `POST /api/custom-source/import` 走粘贴内容路径。
- 代理开关已有 `proxy.customSource.enabled`（见
  `web/src/pages/settings/groups/NetworkGroup.tsx:75-78`），但 NAS 上
  customSource 是**强制直连**的（needle+tunnel 经代理会 ECONNRESET），
  做「勾选走代理」时要认真验证，别把现有直连搞坏。

---

## 环境坑（照做，别重踩）

**构建（本机没有 Docker，只能在 NAS 构建）**
- NAS：`192.168.1.28`，**SSH 端口 1314**，root，密码在
  `G:\project\lxmusic\.playwright\_nas.py`。
- Docker：`/usr/local/bin/docker`（不在 PATH），24.0.2 / linux-amd64。
  服务在 **9528**（compose `9528:9527`），compose 在
  `/volume1/docker/lxserver/compose.yaml`。
- ⚠️ **代理 `192.168.1.4:7890` 拉 alpine CDN 完全不通（60 秒零字节）**。
  给 `docker build` 传 `--build-arg HTTPS_PROXY` 会让构建假死（上次 40 分钟
  只到 apk 第 17 步）。**正解：不传代理 + 换国内源**：
  - apk 换 `https://mirrors.aliyun.com`（实测 2.3MB/s，官方源仅 11KB/s）
  - npm 设 `ENV npm_config_registry=https://registry.npmmirror.com`（14MB/s）
  - 用 `Dockerfile.local`（只改源，其余与官方 Dockerfile 一致）。
    改完实测 **6.5 分钟**构建完成。
- ⚠️ **SSH 断开会把 docker build 杀掉**，`nohup` 挡不住 → 必须
  `setsid sh run_build.sh </dev/null >/dev/null 2>&1 &`。
- ⚠️ **判断构建是否结束别用 pgrep（Synology 没有）/ ps**：
  以日志里的 `===== BUILD EXIT=0 =====` 标记为准。
- 源码运输：`git archive --format=tar HEAD | gzip` 打包 → 经 SSH
  **stdin 管道**上传（`cat > file`），SFTP 偶发 `Channel closed`。
- 推镜像：本机 `gh auth token` 拿 40 字符 PAT（含 `write:packages`），
  传到 NAS 后 `docker login ghcr.io -u 335459215 --password-stdin`。

**本机 / 工具链**
- `gh` CLI **已登录**（`335459215`，含 repo/workflow）→ `git push` 直接可用，
  **不需要 OAuth device flow**。代理用 `git config http.proxy http://192.168.1.4:7890`。
- **`python -I` 会同时丢掉 paramiko 和 PYTHONPATH**。NAS/Playwright 脚本首行写
  `sys.path.insert(0, r'C:\Users\H3354\AppData\Roaming\Python\Python313\site-packages')`。
- Windows 控制台是 GBK，打印中文/`✓` 会 `UnicodeEncodeError` →
  `PYTHONIOENCODING=utf-8`，或 `sys.stdout.buffer.write(s.encode('utf-8','replace'))`。
- 工作副本在 `~/tmp/lxwork/lxrepo`（tar 复制 + 软链 `node_modules`
  到 `/g/project/lxmusic/lxserver-src/node_modules`）。
  挂载盘**不能 unlink**，`lxserver-src/.git/index.lock` 是死文件。
- **`G:\project\lxmusic` 与沙箱挂载是两份文件**，改一边必须 `cp` 到工作副本再 build。
- `~/.cache` 会被回收，浏览器等大件放 `$HOME/tmp`。

**线上验证**
- Playwright 账号 `yueyue` / `HH246437,yongyuan`，用
  `.playwright/_auth.py` 的 `login_and_inject(ctx, BASE, user, pass)`。
- 线上地址 `https://lx.131452188.xyz:51739`。
- ⚠️ **`GET /api/user/list` 原始 JSON 里 userList 每项曲目字段是 `list`，
  不是 `songs`**（`fetchLists()` 才规范化成 `songs`）。直接读原始 JSON 时
  读 `list`，写回时也必须带 `list` —— 这个坑已误判过一次「加歌失败」。
- 移动端复现：`viewport={width:390,height:844}, is_mobile=True, has_touch=True`。
  搜索要用 `input.fill()` + `press('Enter')`，URL 带 `?kw=` **不生效**。

---

## 版本与发布
- 下一个版本号 **v2.44.0**：`package.json` 写 `2.44.0`（不带 v），
  `version` 文件写 `v2.44.0`（带 v）。
- 发布顺序：本地全链（web lint/build → 根 build → `test:unit` →
  `test:mutation`）→ 合并推送 `main` → NAS 构建 → 部署 → 线上回归。
- 用户明确要求：**修复完必须实际验收**（真机尺寸的无头 Chrome 截图 + 断言）。

### 部署方式（2026-11-02 定稿）：必须走群晖 Container Manager 的「项目」

**不要**在 SSH 里 `docker compose up` —— 那样建出来的容器 DSM 不认，项目页会显示成
`<容器短ID>_lxserver`，而且项目里的「停止/构建」对它无效（本轮踩过）。

正确流程：
1. 改 `/volume1/docker/lxserver/compose.yaml`（镜像 tag 等）；
2. 浏览器打开 DSM → Container Manager → 项目 → lxserver；
3. `操作 → 构建`，DSM 用自带 compose 重建容器。

成功标志：`/var/packages/ContainerManager/etc/lxserver.config` 里 `"name":"lxserver"`（无哈希前缀），
`docker ps` 名字 `lxserver`、标签 `com.docker.compose.project=lxserver`。

### 2026-11-02：另外两个容器也修正为 Container Manager 项目构建

`cfst`、`moviepilot-v3` 原先也是 SSH 里建出来的游离容器（DSM 里显示 `e353e4f12a23_cfst` /
`c7976dc0274c_moviepilot-v3`，项目里「停止/构建」对它们无效）。已同样处理：
删除旧容器 → Container Manager → 项目 → 构建。现在：

| 项目 | 容器名 | 状态 |
|---|---|---|
| lxserver | lxserver | Up，v2.44.2 |
| cfst | cfst | Up (healthy) |
| moviepilot-v3 | moviepilot-v3 | Up (healthy) |

三个项目的 `lxxserver.config/cfst.config/moviepilot-v3.config` 里 `"name"` 均无哈希前缀。

### 2026-11-02 复验（三个项目重建后）

| 检查项 | 结果 |
|---|---|
| lxserver 容器 | `lxserver`，Up，镜像 2.44.2，9528 正常 |
| cfst 容器 | `cfst`，Up (healthy) |
| moviepilot-v3 容器 | `moviepilot-v3`，Up (healthy)，3000 正常 |
| DSM 项目登记 | 29 个 compose 容器全部有对应 `<name>.config`，无 `短ID_xxx` 命名 |
| 业务接口 | 登录 200；吻别/时光/流行 均 200 且 URL 互不重复 |
| 歌单数据 | 试听列表 69 首、defaultMeta 干净 |
| 公网 HTTPS | `https://117.67.45.76:51739` 返回 200（域名解析到该 IP） |

遗留：`5fb5e828ad2e_coturn.config`、`c69de599023e_navidrome.config` 是容器已不存在的旧配置，
DSM 项目页不会显示，未删除（避免动无关套件）。
