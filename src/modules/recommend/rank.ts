/** 今日甄选的推荐算法（v2.48.0）。
 *
 * 【为什么要重做】
 * v2.47 用「同主题词池按天轮换」冒充推荐 —— 那只是**编辑挑词**，不是算法：
 * 同一批词反复搜，内容池就是这个关键词的前 20 条，跟你的口味毫无关系。
 *
 * 【大厂真实做法（调研结论）】
 *   - 网易云「每日推荐」：综合听歌记录、收藏的歌/歌单、关注的歌手、MV、本地歌曲，
 *     每天 6:00 推 20 首（官方 FAQ + 算法备案说明）；
 *   - Spotify Discover Weekly：**协同过滤**（2 亿用户 × 4000 万首的共现矩阵）
 *     + 音频特征 + 内容过滤；
 *   - QQ 音乐「每日 30 首」：歌曲知识图谱 + 用户行为序列 + 语义分析出的「音乐肖像」。
 *
 * 前两者都依赖海量用户共现矩阵 —— 个人 NAS 只有一两个用户，**协同过滤无从谈起**。
 * 能在单人规模上站得住的，是「内容源 + 行为画像」两条：
 *
 *   1. **内容源**：抓平台官方的推荐流（QQ 音乐推荐专辑），而不是自己拍脑袋选关键词。
 *      服务端已有 `fetchRecommendedSongs()`（孤儿代码，v2.48 之前没人调用）正是干这个的，
 *      它取 QQ 六个地区的推荐新专辑 → 逐张拉歌 → 按日期做种子洗牌。
 *   2. **行为画像**：用本地已有的播放历史（playCount + playedAt）算歌手亲和度，
 *      对推荐流重排 + 过滤掉最近听腻的。
 *
 * 【为什么本文件是纯函数】
 * 打分/重排/淘汰这些逻辑最容易写错、也最容易被以后改动悄悄破坏，
 * 所以全部抽成无副作用、可被 node --test 直接 import 的纯函数
 * （仓库既有惯例：songIdentity.ts / curatedCovers.ts 同一套路，零 `@/` 依赖）。
 */

/** 推荐引擎产出的一首歌（只需这些字段就能打分与播放）。 */
export interface RecommendSong {
  name: string
  singer: string
  source?: string
  songmid?: string
  albumName?: string
  img?: string | null
  interval?: string | null
  [key: string]: unknown
}

/** 播放历史条目（服务端 HistoryDataManage 的形状）。 */
export interface HistoryEntryLike {
  singer?: string
  name?: string
  playCount?: number
  playedAt?: number
  [key: string]: unknown
}

/** 收藏库的形状（服务端 library/*.json）。 */
export interface LibraryLike {
  singers?: { name?: string }[]
  songs?: { singer?: string; name?: string }[]
  [key: string]: unknown
}

/** 歌手归一：去掉 feat./合唱后缀、全角空格、括号里的合作者，只留主歌手。
 *
 *  归一的重要性：历史里存的是 "周杰伦"、推荐流里常是 "周杰伦、杨瑞代"，
 *  不归一会算成两个歌手，亲和度全散掉。 */
export function normalizeSinger(singer: unknown): string {
  return extractPrimarySinger(singer).toLowerCase()
}

/** 取主歌手的**原始写法**（保留大小写与中文），用于展示。
 *
 *  与 normalizeSinger 分开的原因：展示「常听 周杰伦」是给人看的，
 *  展示「常听 zhoujielun」是给机器看的 —— 归一化只该用于匹配与打分。 */
export function extractPrimarySinger(singer: unknown): string {
  if (typeof singer !== 'string') return ''
  let s = singer.trim()
  if (!s) return ''
  // 只取第一个分隔符之前的主歌手
  s = s.split(/[、,，;；&/]|\s+feat\.?\s+|\s+ft\.?\s+/i)[0]
  // 去掉结尾的括号注释（(Live) / （女声版） / [Remix]）
  s = s.replace(/[(（[【][^)）\]】]*[)）\]】]\s*$/g, '')
  return s.trim()
}

/** 歌手亲和度表：归一化歌手 → 权重（0..N，越大越偏好）。
 *
 *  权重构成（对齐「听得多 = 更偏好」的直觉）：
 *   - 播放次数 playCount（对数压缩，防止一首歌循环 50 次就垄断画像）；
 *   - 时间衰减：越久没听权重越低（半衰期 14 天）——「最近常听」比「去年常听」更代表当下口味；
 *   - 收藏库里的歌手额外加分（收藏是比播放更强的偏好信号）。
 *
 *  @param now 当前时间戳（注入以便单测；默认 Date.now()）
 */
export function singerAffinity(
  history: readonly HistoryEntryLike[],
  library: LibraryLike | null | undefined,
  now: number = Date.now(),
): Map<string, number> {
  const affinity = new Map<string, number>()
  const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000

  for (const item of history ?? []) {
    const key = normalizeSinger(item?.singer)
    if (!key) continue
    const plays = Math.max(1, Number(item?.playCount) || 1)
    const playedAt = Number(item?.playedAt)
    // 时间衰减：半衰期 14 天。playedAt 缺失/非法时不衰减（保守处理）
    let decay = 1
    if (Number.isFinite(playedAt) && playedAt > 0 && playedAt <= now) {
      const ageDays = (now - playedAt) / HALF_LIFE_MS
      decay = Math.pow(0.5, ageDays)
    }
    // 对数压缩：1 次 → 1.0，8 次 → 2.08，64 次 → 3.17（单调但不会碾压）
    const weight = Math.log2(plays + 1) * decay
    affinity.set(key, (affinity.get(key) ?? 0) + weight)
  }

  // 收藏的歌手：强偏好信号，单独加一笔（不与播放次数混淆）
  const LIB_WEIGHT = 1.5
  for (const s of library?.singers ?? []) {
    const key = normalizeSinger(s?.name)
    if (!key) continue
    affinity.set(key, (affinity.get(key) ?? 0) + LIB_WEIGHT)
  }
  for (const s of library?.songs ?? []) {
    const key = normalizeSinger(s?.singer)
    if (!key) continue
    affinity.set(key, (affinity.get(key) ?? 0) + LIB_WEIGHT * 0.5)
  }

  return affinity
}

/** 最近听过的「歌名+歌手」集合 —— 用来把推荐流里刚听过的排到后面。
 *
 *  只认最近 RECENT_DAYS 天、且播放过的，避免把「很久以前听过一次」也算进来。 */
export const RECENT_DAYS = 7
export function recentlyPlayedKeys(
  history: readonly HistoryEntryLike[],
  now: number = Date.now(),
): Set<string> {
  const out = new Set<string>()
  const cutoff = now - RECENT_DAYS * 24 * 60 * 60 * 1000
  for (const item of history ?? []) {
    const playedAt = Number(item?.playedAt)
    if (!Number.isFinite(playedAt) || playedAt < cutoff) continue
    const k = songIdentityKey(item?.name, item?.singer)
    if (k) out.add(k)
  }
  return out
}

/** 歌名+主歌手的判重键（跨平台同名的同一首歌视为同一首）。 */
export function songIdentityKey(name: unknown, singer: unknown): string {
  const n = typeof name === 'string' ? name.trim().toLowerCase() : ''
  const s = normalizeSinger(singer)
  return n ? `${n}::${s}` : ''
}

/** 一轮推荐的候选池打散（按日期做种子，同一天稳定、跨天变化）。
 *
 *  为什么还要洗牌：推荐流本身按「新专辑上架」排序，前几首总是最新的几张专辑，
 *  不洗牌则每天的卡片开头永远相似。种子只取日期 → 同一天所有客户端一致。 */
export function seededShuffle<T>(items: readonly T[], dateKey: string): T[] {
  const arr = Array.from(items ?? [])
  let seed = 0
  for (const ch of String(dateKey ?? '')) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0xffffffff
  }
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** 一张甄选卡的推荐结果。 */
export interface RankedPlaylist {
  songs: RecommendSong[]
  /** 命中的偏好歌手（用于卡片上的说明文案，让推荐「可解释」） */
  topSingers: string[]
}

/** 把候选池排成一张卡要播的列表。
 *
 *  排序规则（权重从大到小）：
 *   1. 歌手亲和度高的优先（个性化）；
 *   2. 最近 7 天听过的降权（避免「每日推荐推的还是昨天那几首」）；
 *   3. **同歌手最多连续/累计 N 首**，防止某个歌手霸屏；
 *   4. 同歌名+歌手去重。
 *
 *  @param affinity     singerAffinity() 的结果（空 Map = 纯内容源顺序，冷启动也合理）
 *  @param recent       最近听过的键集合
 *  @param limit        取多少首
 *  @param maxPerSinger 单个歌手最多几首
 */
export function rankRecommended(
  candidates: readonly RecommendSong[],
  affinity: Map<string, number>,
  recent: Set<string>,
  limit = 20,
  maxPerSinger = 3,
): RankedPlaylist {
  const scored: { song: RecommendSong; score: number }[] = []
  const seen = new Set<string>()
  const singerCount = new Map<string, number>()
  // 展示名 → 入选首数（key 用归一值，展示用原始名）
  const singerScore = new Map<string, number>()
  const singerDisplay = new Map<string, string>()

  for (const song of candidates ?? []) {
    if (!song || typeof song.name !== 'string' || !song.name.trim()) continue
    const idKey = songIdentityKey(song.name, song.singer)
    if (!idKey || seen.has(idKey)) continue
    seen.add(idKey)

    const singerKey = normalizeSinger(song.singer)
    // 该歌手已入选数量超限：直接跳过（硬性防霸屏，比软降权更符合「6 张卡要不一样」）
    const used = singerCount.get(singerKey) ?? 0
    if (singerKey && used >= maxPerSinger) continue

    let score = affinity.get(singerKey) ?? 0
    // 刚听过：大幅降权但不彻底排除（可能就是想再听）
    if (recent.has(idKey)) score -= 2.5
    // 无歌手信息：轻度降权，让信息完整的歌排在前面
    if (!singerKey) score -= 0.5

    scored.push({ song, score })
    if (singerKey) {
      singerCount.set(singerKey, used + 1)
      singerScore.set(singerKey, (singerScore.get(singerKey) ?? 0) + 1)
      if (!singerDisplay.has(singerKey)) {
        singerDisplay.set(singerKey, extractPrimarySinger(song.singer))
      }
    }
  }

  // 稳定排序：同分保持候选池原有顺序（候选池本身已按日期洗牌）
  scored.sort((a, b) => b.score - a.score)

  const topSingers = Array.from(singerScore.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => singerDisplay.get(k) ?? k)

  return { songs: scored.slice(0, Math.max(1, limit)).map((x) => x.song), topSingers }
}

/** 把候选池按卡的主题做「偏好加权」——六张卡的差异化靠**打分维度**，
 *  而不是换关键词（v2.47 的错误做法）。
 *
 *  每张卡声明自己偏好的歌手/歌名特征词；命中则加分。这样同一份推荐流
 *  可以切出六张不同的卡，且每张都还是「算法选出来的」而非人工挑词。
 *
 *  @param keywords 该卡的主题特征词（如「摇滚」「钢琴」「晚安」）
 *  @param affinity 用户歌手亲和度
 */
export function themeScore(
  song: RecommendSong,
  keywords: readonly string[],
  affinity: Map<string, number>,
): number {
  const hay = `${song?.name ?? ''} ${song?.albumName ?? ''} ${song?.singer ?? ''}`.toLowerCase()
  let score = affinity.get(normalizeSinger(song?.singer)) ?? 0
  for (const kw of keywords ?? []) {
    const k = String(kw ?? '').trim().toLowerCase()
    if (k && hay.includes(k)) score += 1.2
  }
  return score
}

/** 按主题把候选池切成一张卡（差异化由主题词 + 亲和度共同决定）。 */
export function rankByTheme(
  candidates: readonly RecommendSong[],
  keywords: readonly string[],
  affinity: Map<string, number>,
  recent: Set<string>,
  limit = 20,
  maxPerSinger = 3,
): RankedPlaylist {
  const scored: { song: RecommendSong; score: number }[] = []
  const seen = new Set<string>()
  const singerCount = new Map<string, number>()
  const singerHits = new Map<string, number>()
  const singerDisplay = new Map<string, string>()

  for (const song of candidates ?? []) {
    if (!song || typeof song.name !== 'string' || !song.name.trim()) continue
    const idKey = songIdentityKey(song.name, song.singer)
    if (!idKey || seen.has(idKey)) continue
    seen.add(idKey)

    const singerKey = normalizeSinger(song.singer)
    const used = singerCount.get(singerKey) ?? 0
    if (singerKey && used >= maxPerSinger) continue

    let score = themeScore(song, keywords, affinity)
    if (recent.has(idKey)) score -= 2.5

    scored.push({ song, score })
    if (singerKey) {
      singerCount.set(singerKey, used + 1)
      singerHits.set(singerKey, (singerHits.get(singerKey) ?? 0) + 1)
      if (!singerDisplay.has(singerKey)) {
        singerDisplay.set(singerKey, extractPrimarySinger(song.singer))
      }
    }
  }

  scored.sort((a, b) => b.score - a.score)
  const picked = scored.slice(0, Math.max(1, limit)).map((x) => x.song)

  // topSingers 必须反映**最终入选**的那批歌（而不是候选池前几个）：
  // 否则会出现「推荐里有周杰伦，但 topSingers 报的是别的歌手」这种自相矛盾。
  const finalCount = new Map<string, number>()
  const finalDisplay = new Map<string, string>()
  for (const s of picked) {
    const k = normalizeSinger(s.singer)
    if (!k) continue
    finalCount.set(k, (finalCount.get(k) ?? 0) + 1)
    if (!finalDisplay.has(k)) finalDisplay.set(k, extractPrimarySinger(s.singer))
  }
  const topSingers = Array.from(finalCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => finalDisplay.get(k) ?? k)

  return { songs: picked, topSingers }
}
