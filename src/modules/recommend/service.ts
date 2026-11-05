/** 今日甄选的推荐流接口（v2.48.0）。
 *
 *  把「内容源」与「打分」拼起来：
 *    1. 内容源：`fetchRecommendedSongs()` —— 抓 QQ 音乐官方推荐专辑（六个地区），
 *       逐张拉歌后按日期洗牌。这是「平台推荐了什么」，不是我们瞎猜关键词。
 *    2. 行为画像：读该用户的播放历史 + 收藏库 → 歌手亲和度 + 最近听过的集合。
 *    3. 切卡：按每张卡的主题词 + 亲和度打分，六张卡各有侧重。
 *
 *  【缓存策略】
 *  推荐流本身按自然日稳定（引擎内部有日期缓存），但**个性化重排是每用户不同的**，
 *  所以这里按 `用户名 + 日期 + 卡 id` 缓存最终结果 —— 同一天内重复进首页不再算一遍。
 *  缓存只在内存里，进程重启即失效，不需要持久化。
 *
 *  【为什么不做协同过滤】
 *  单机/个人 NAS 只有一两个用户，没有「相似用户」可找。硬做只会得到噪声。
 *  能用的是：平台官方推荐流（群体智慧的代理） + 本地行为画像（个人口味的代理）。
 */
import {
  normalizeSinger,
  rankByTheme,
  recentlyPlayedKeys,
  seededShuffle,
  singerAffinity,
  songIdentityKey,
  type HistoryEntryLike,
  type LibraryLike,
  type RecommendSong,
} from '@/modules/recommend/rank.js'
import { buildCandidatePool, mergePools, type PoolBuildResult } from '@/modules/recommend/pool.js'

/** 一张甄选卡的服务端定义。
 *
 *  ⚠️ 与前端 `web/src/pages/Dashboard.tsx` 的 `CURATED_MIXES` 必须保持一致
 *  （id 与主题词）。前端只负责展示与播放，不再自己搜关键词。 */
export interface MixSpec {
  id: string
  /** 主题特征词：命中歌名/专辑名/歌手则加分。这是「差异化」的来源，
   *  与 v2.47 的「换个词去搜」本质不同 —— 这里候选池是同一份推荐流，只是打分侧重不同。 */
  keywords: string[]
}

export const MIX_SPECS: MixSpec[] = [
  { id: 'radar', keywords: [] }, // 纯个性化：完全跟着你的口味走
  { id: 'pop', keywords: ['流行', 'pop', '热歌', '热门', 'hit'] },
  { id: 'nostalgia', keywords: ['经典', '老歌', '怀旧', '千禧', '粤语', '港台'] },
  { id: 'focus', keywords: ['钢琴', '纯音乐', '器乐', '轻音乐', 'piano', 'instrumental', 'lofi'] },
  { id: 'night', keywords: ['晚安', '治愈', '温柔', '民谣', '慢', '夜'] },
  { id: 'drive', keywords: ['摇滚', '电音', '节奏', '舞曲', 'rock', 'edm', 'remix'] },
]

interface CacheEntry {
  day: string
  payload: unknown
}

/** 每用户每卡一天一份 */
const playlistCache = new Map<string, CacheEntry>()

/** 推荐流候选池：按「刷新日 + 画像指纹」缓存（与用户有关，所以带指纹） */
const poolCache = new Map<string, { key: string; result: PoolBuildResult }>()

export function dayKey(now: number = Date.now(), refreshHour = 6): string {
  const d = new Date(now)
  if (d.getHours() < refreshHour) d.setDate(d.getDate() - 1)
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 取（并缓存）当天的候选池（双源：平台推荐流 + 口味回响）。
 *
 *  @param fetchSongs    源 A：平台推荐流（生产传 fetchRecommendedSongs）
 *  @param searchSongs   源 B：按关键词搜索（生产传平台搜索）；不传则退化成单源
 *  @param affinity      用户歌手亲和度 —— 决定源 B 搜谁
 *
 *  【为什么必须缓存】源 B 要串行搜好几位歌手，每次进首页都跑一遍太慢，
 *  且容易触发上游限流。按「刷新日 + 画像指纹」缓存：画像变了才重算，
 *  同一天同一口味只算一次。
 */
export async function getDailyPool(
  fetchSongs: (size: number) => Promise<RecommendSong[]>,
  now: number = Date.now(),
  searchSongs?: (keyword: string) => Promise<RecommendSong[]>,
  affinity?: Map<string, number>,
): Promise<PoolBuildResult> {
  const day = dayKey(now)
  // 缓存键带上画像指纹：品味变了（听了新歌手）就该换池子，不能钉死一整天
  const seedKey = affinity
    ? Array.from(affinity.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([k, v]) => `${k}:${v.toFixed(1)}`).join('|')
    : 'noaffinity'
  const cacheKey = `${day}|${seedKey}`
  const hit = poolCache.get('pool')
  if (hit && hit.key === cacheKey && hit.result.pool.length > 0) return hit.result

  let result: PoolBuildResult
  if (searchSongs && affinity && affinity.size > 0) {
    result = await buildCandidatePool({
      fetchDiscover: fetchSongs,
      searchSongs,
      affinity,
    })
  } else {
    // 无画像（新用户）：只有平台推荐流，冷启动也给出内容
    let discover: RecommendSong[] = []
    try {
      discover = (await fetchSongs(80)) ?? []
    } catch (e) {
      console.error('[今日甄选] 抓取推荐流失败:', e)
    }
    result = {
      pool: mergePools(discover),
      seedSingers: [],
      stats: { discover: discover.length, taste: 0, total: discover.length },
    }
  }

  if (result.pool.length > 0) poolCache.set('pool', { key: cacheKey, result })
  return result.pool.length > 0 ? result : (hit?.result ?? result)
}

export interface BuildOptions {
  userName: string
  history: readonly HistoryEntryLike[]
  library: LibraryLike | null | undefined
  /** 当天的原始推荐池 */
  pool: readonly RecommendSong[]
  now?: number
  limit?: number
}

export interface MixResult {
  id: string
  songs: RecommendSong[]
  /** 命中的偏好歌手（前端展示「因为你常听 X」） */
  topSingers: string[]
  /** 这一卡为什么是这些歌 —— 让推荐可解释 */
  basis: string
}

/** 生成六张卡的结果。纯计算，不碰网络与磁盘（便于单测）。
 *
 *  【卡间去重要点】六张卡共用同一份候选池，而「偏好歌手」是全局信号 ——
 *  如果每张卡独立排序，那个歌手会在六张卡里都排第一，六张卡的首曲就完全一样，
 *  又退回「点哪张都听同一批」的老问题。
 *
 *  【v2.48.0 线上暴露的第二个问题｜配额极不均】
 *  第一版是「按卡顺序逐张取，取完从池子删掉」，结果池子小的时候前面的卡把好歌吃光：
 *  实测 drive 拿到 20 首，radar/pop/nostalgia 各只有 3 首。
 *
 *  现在改成**两轮分配**：
 *    第一轮每张卡只取 targetPerCard 首（先保证人人有份、主题卡先挑）；
 *    第二轮把剩下的好歌按各卡剩余容量回填（不浪费池子）。
 *  这样既避免重复，也不会出现「一张卡 20 首、另一张 3 首」。
 */
const THEME_FIRST_ORDER = ['drive', 'focus', 'night', 'pop', 'nostalgia', 'radar']

export function buildMixPlaylists(options: BuildOptions): MixResult[] {
  const now = options.now ?? Date.now()
  const day = dayKey(now)
  const limit = options.limit ?? 20
  const affinity = singerAffinity(options.history, options.library, now)
  const recent = recentlyPlayedKeys(options.history, now)
  // 先按日期洗牌：保证每天的开头不总是「最新上架那几张专辑」
  const shuffled = seededShuffle(options.pool, day)

  // 第一轮每卡的目标首数：池子够就均分，池子小就每人至少几首
  const cardCount = MIX_SPECS.length
  const fairShare = Math.max(3, Math.floor(shuffled.length / cardCount))
  const targetPerCard = Math.min(limit, fairShare)

  const usedKeys = new Set<string>()
  const byId = new Map<string, MixResult>()
  const remaining = new Map<string, number>()

  // ---- 第一轮：每卡取 targetPerCard 首 ----
  for (const id of THEME_FIRST_ORDER) {
    const spec = MIX_SPECS.find((s) => s.id === id)
    if (!spec) continue
    const pool = shuffled.filter((s) => !usedKeys.has(songIdentityKey(s.name, s.singer)))
    const ranked = rankByTheme(pool, spec.keywords, affinity, recent, targetPerCard, 3)
    for (const s of ranked.songs) usedKeys.add(songIdentityKey(s.name, s.singer))
    byId.set(id, {
      id,
      songs: ranked.songs,
      topSingers: ranked.topSingers,
      basis: spec.keywords.length
        ? `平台新专辑 × 主题「${spec.keywords.slice(0, 2).join('/')}」× 你的口味`
        : '平台新专辑 × 你的口味',
    })
    remaining.set(id, Math.max(0, limit - ranked.songs.length))
  }

  // ---- 第二轮：剩余好歌按各卡剩余容量回填 ----
  const leftover = shuffled.filter((s) => !usedKeys.has(songIdentityKey(s.name, s.singer)))
  if (leftover.length > 0) {
    for (const id of THEME_FIRST_ORDER) {
      const cap = remaining.get(id) ?? 0
      if (cap <= 0) continue
      const spec = MIX_SPECS.find((s) => s.id === id)!
      const cur = byId.get(id)!
      // 已选歌的歌手也要计入防霸屏（否则回填会把同一歌手堆进来）
      const existingBySinger = new Map<string, number>()
      for (const s of cur.songs) {
        const k = normalizeSinger(s.singer)
        existingBySinger.set(k, (existingBySinger.get(k) ?? 0) + 1)
      }
      const pool = leftover.filter((s) => {
        const k = songIdentityKey(s.name, s.singer)
        if (usedKeys.has(k)) return false
        const sk = normalizeSinger(s.singer)
        return (existingBySinger.get(sk) ?? 0) < 3
      })
      if (pool.length === 0) continue
      const ranked = rankByTheme(pool, spec.keywords, affinity, recent, cap, 3)
      for (const s of ranked.songs) usedKeys.add(songIdentityKey(s.name, s.singer))
      byId.set(id, {
        ...cur,
        songs: [...cur.songs, ...ranked.songs],
        topSingers: cur.topSingers.length ? cur.topSingers : ranked.topSingers,
      })
    }
  }

  // 按 SERVER 声明顺序返回（CURATED_MIXES 的顺序），保证展示顺序稳定
  return MIX_SPECS.map((s) => byId.get(s.id) ?? { id: s.id, songs: [], topSingers: [], basis: '' })
}

/** 带缓存的对外入口：同一天同一用户同一张卡只算一次。 */
export async function getMixPlaylists(options: {
  userName: string
  history: readonly HistoryEntryLike[]
  library: LibraryLike | null | undefined
  fetchSongs: (size: number) => Promise<RecommendSong[]>
  /** 源 B：按关键词搜索（可选；不传则退化成只有平台推荐流） */
  searchSongs?: (keyword: string) => Promise<RecommendSong[]>
  now?: number
  limit?: number
}): Promise<{
  day: string
  basis: string
  mixes: MixResult[]
  cached: boolean
  seedSingers: string[]
  stats: { discover: number; taste: number; total: number }
}> {
  const now = options.now ?? Date.now()
  const day = dayKey(now)
  const key = `${options.userName}|${day}|${options.limit ?? 20}`
  const hit = playlistCache.get(key)
  if (hit && hit.day === day) {
    return { ...(hit.payload as ReturnType<typeof buildPayload>), cached: true }
  }

  const affinity = singerAffinity(options.history, options.library, now)
  const poolResult = await getDailyPool(options.fetchSongs, now, options.searchSongs, affinity)
  const mixes = buildMixPlaylists({ ...options, pool: poolResult.pool, now })
  const payload = buildPayload(day, mixes, poolResult)
  // 只在有货时缓存，避免把「抓取失败的空池」钉住一整天
  if (poolResult.pool.length > 0) playlistCache.set(key, { day, payload })
  return { ...payload, cached: false }
}

function buildPayload(day: string, mixes: MixResult[], poolResult: PoolBuildResult) {
  return {
    day,
    basis: '平台官方推荐流 + 你的播放画像',
    mixes,
    seedSingers: poolResult.seedSingers,
    stats: poolResult.stats,
  }
}

/** 仅供测试：清空所有缓存 */
export function __clearRecommendCaches(): void {
  playlistCache.clear()
  poolCache.clear()
}
