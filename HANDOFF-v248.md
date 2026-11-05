# v2.48 交接：今日甄选改真实推荐算法（2026-11-05）

> **状态：已上线。** 代码 `main` = `ec00917`；镜像 `ghcr.io/335459215/lxserver:2.48.5`
> （NAS 本地构建，GHCR 上无此 tag —— CI 已按 v2.46 的决定关闭 push 触发）；
> NAS 容器已跑 `v2.48.5`（9528）。
> **验收**：API 13/13 + UI 端到端 13/13 + §6 部署清单全过，单测 349/349。
> 截图 `docs/v2485-deploy/`。

---

## 一、用户为什么否掉 v2.47

> 「不对 不应该是这样 你去调研下 看看那些平台 项目他们的算法」

v2.47 的「同主题词池按天轮换」**不是算法，是编辑挑词**：拿一个词去搜索接口捞前 20 首，
结果与该用户听过什么完全无关，同一天所有人看到的一样。用户否得对。

## 二、调研结论（真实做法）

| 平台 | 机制 |
|---|---|
| 网易云「每日推荐」 | 综合**听歌记录、收藏的歌曲/歌单、关注歌手、MV、本地歌曲**，每天 6:00 推 20 首（[官方 FAQ](http://music.163.com/topic?id=19193112)、[算法备案说明](https://y.music.163.com/m/at/661f2af6e36f7c50ead8994b)） |
| Spotify Discover Weekly | **协同过滤**（2 亿用户 × 4000 万歌的共现矩阵）+ 音频特征 + 内容过滤 |
| QQ 音乐「每日 30 首」 | 歌曲知识图谱 + 用户行为序列 + 语义分析出的「音乐肖像」 |

**关键判断**：前两者的核心是海量用户共现矩阵 —— **个人 NAS 只有一两个用户，
没有「相似用户」可找，硬做协同过滤只会得到噪声**。

GitHub 生态调研（按贴合度）：
- [LumePart/Explo](https://github.com/LumePart/Explo) —— 自建音乐系统里的 Discover Weekly，
  **直接接 ListenBrainz 推荐引擎**（Weekly Exploration / Daily Jams），自己不实现算法；
- [ListenBrainz 推荐 API](https://listenbrainz.readthedocs.io/en/latest/users/api/recommendation.html)
  —— 开放 REST，返回 `recording_mbid + score`，背后是 [troi](https://musicbrainz.org/doc/Development/Summer_of_Code/2023/ListenBrainz) 工具包；
- [flozz/daily-mix](https://github.com/flozz/daily-mix) —— 从 Subsonic 生成 Daily Mix 主题歌单；
- [selfhosted-music-overview](https://github.com/basings/selfhosted-music-overview) ——
  Navidrome / Ampache / LMS 的「Smart Recommendations」**全部依赖外部 Last.fm / ListenBrainz**，
  没有一家自建协同过滤，与上面的判断一致。

**结论**：单机场景可行的上层是「**平台官方推荐流（群体智慧的代理）+ 本地行为画像（个人口味的代理）**」。
ListenBrainz 质量更好但要求用户注册并持续提交 scrobble，对家庭 NAS 门槛太高；
本实现已按「多源合并」的结构写，将来要加 ListenBrainz 只是多一个源。

## 三、实现

### 1. `src/modules/recommend/rank.ts`（纯函数，可单测）

| 函数 | 作用 |
|---|---|
| `singerAffinity` | 歌手亲和度 = 播放次数**对数压缩**（防单曲循环垄断）× **14 天半衰期时间衰减**（最近常听 > 去年常听）+ 收藏加权 |
| `recentlyPlayedKeys` | 最近 7 天听过的键集合，用于降权（日推不该重复昨天的） |
| `rankByTheme` | 主题词命中加分 + **单歌手 ≤3 首**防霸屏 + 同名去重 |
| `seededShuffle` | 按日期做种子的洗牌（同一天稳定、跨天变化） |
| `normalizeSinger` / `extractPrimarySinger` | 歌手归一（`周杰伦、杨瑞代` → `周杰伦`）；展示用原始名，匹配用归一值 |

### 2. `src/modules/recommend/pool.ts`（双源候选池）

- **源 A 平台推荐流**：`fetchRecommendedSongs()`（QQ 官方推荐专辑，原本是孤儿代码，零调用方）
- **源 B 口味回响**：拿画像里权重最高的 5 位歌手去搜索，只保留确实是该歌手的结果
- **质量过滤**（只过源 A，源 B 是用户真实偏好不过滤）：
  - `looksClassical`：作曲家名 + 作品编号（`op.` 含 `Op. Posth.` 遗作、`K. 398`、
    `No. 19 In A Minor` 调性写法）+ 体裁词
  - `looksSfx`：白噪音/音效（`白噪音/赫兹/雨声/海浪/ASMR…`），**刻意不匹配
    「助眠」「治愈」**——那是深夜卡的正当主题
  - `isOverlongTitle`：标题 >60 字

### 3. `src/modules/recommend/service.ts`

- 六张卡定义（`MIX_SPECS`）：`radar` 纯个性化（无主题词），其余五张各带主题词
- **两轮分配**：第一轮每卡均分（先保证人人有份），第二轮用剩余好歌按容量回填
- 缓存：候选池按「刷新日 + 画像指纹」缓存（品味变了才重算）；结果按「用户+日+数量」缓存，`force=1` 跳过

### 4. `GET /api/music/recommend/daily?limit=&force=`

读该用户播放历史 + 收藏库 → 重排。返回 `mixes[]`（含 `songs` / `topSingers` / `basis`）、
`poolStats`（discover/taste 各多少首）、`seedSingers`。

### 5. 前端

- `web/src/lib/recommend.ts` 接口层
- `Dashboard.tsx`：六张卡改用推荐结果；**封面直接用推荐自带的 `img`**（零额外请求、与播放一致），
  只有首曲确实没图才退回搜索兜底
- 卡片显示 `20 首 · 常听 周杰伦/张学友`，区块副标题显示
  `平台新专辑 73 首 + 按你的口味（周杰伦、张学友、李宇春）66 首 · 2026-11-05` —— **推荐可解释**

## 四、迭代过程中线上抓到的三个真实缺陷

| 版本 | 问题（线上实测） | 修法 |
|---|---|---|
| 2.48.0 | 候选池只有约 20 首纯新专辑，与历史 24 位歌手**交集 0** —— 画像完全没生效 | 双源池（2.48.1） |
| 2.48.0 | 配额极不均：drive 20 首，radar/pop/nostalgia 各 3 首 | 两轮分配（2.48.1） |
| 2.48.1 | 117 首里 **62% 古典、56% 超长标题**，radar/nostalgia 被莫扎特刷屏 | `looksClassical` + 超长过滤（2.48.2） |
| 2.48.2 | 剔古典后剩白噪音（「528赫兹绿色噪音」「放松海浪」），池子缩到 25 首 | `looksSfx` + 扩大抓取（2.48.3） |
| 2.48.3 | 两张卡封面加载失败显示占位符（多一轮搜索易失败） | 封面用推荐自带图（2.48.4） |
| 2.48.4 | **混合内容回归**：`aqqmusic.tc.qq.com` 不在 v2.46 白名单，点卡播放变回 http | 补 `tc.qq.com`/`qq.com`（2.48.5） |

## 五、最终验收数据

```
池子构成: discover 73 首 + taste 66 首 = 总 139 首（过滤后）
六张卡:   radar/pop/nostalgia/focus/night/drive 各 20 首，合计 120 首，零重复
画像命中: 6 位（周杰伦、张学友、李宇春、许巍、张镒麟…）
质量指标: 古典 0% / 超长标题 0% / 36 位不同歌手
播放:     点卡即播，地址 https，无外网 http 请求
```

## 六、改动的文件

```
src/modules/recommend/rank.ts           新增（打分/亲和度/洗牌，纯函数）
src/modules/recommend/pool.ts           新增（双源池 + 质量过滤）
src/modules/recommend/service.ts        新增（六卡定义/两轮分配/缓存）
src/server/server.ts                    + GET /api/music/recommend/daily
src/server/utils/recommendSongs.ts      ALBUM_POOL 8→24，size 上限 100→400（激活孤儿代码）
web/src/lib/recommend.ts                新增（接口层）
web/src/lib/audioUrl.ts                 白名单补 tc.qq.com / qq.com
web/src/pages/Dashboard.tsx             改用推荐流、封面用自带图、展示依据
test/recommendRank.test.ts              新增（23 条）
test/recommendPool.test.ts              新增（23 条）
test/audioHttps.test.ts                 +2 条 tc.qq.com 回归
删除: web/src/lib/curatedMixes.ts, test/curatedRotation.test.ts（v2.47 方案被取代）
```

## 七、已知限制与后续方向

1. **不做个性化之外的「相似歌曲」**：没有音频特征（BPM/调性/能量），做不到
   Spotify 那种「因为好听所以推同类」。要做得引入音频分析（chromaprint 已在镜像里，
   但只用于指纹不用于特征）。
2. **口味源只搜 5 位歌手**：画像广度取决于历史大小。历史少（新用户）时推荐偏「平台推荐流」，
   会显得大众化 —— 这是冷启动的固有代价，可接受。
3. **8 天/天的边界**：刷新日是凌晨 6:00，跨天后重新进首页才换。
4. **想更进一步可以接 ListenBrainz**：`pool.ts` 已是多源结构，加一个
   `fetchListenBrainz()` 源即可；代价是用户需注册并持续提交 scrobble。
