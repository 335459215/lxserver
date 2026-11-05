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

/** 推荐流候选池：按日期缓存原始池（与用户无关的部分只算一次） */
const poolCache = new Map<string, { day: string; songs: RecommendSong[] }>()

export function dayKey(now: number = Date.now(), refreshHour = 6): string {
  const d = new Date(now)
  if (d.getHours() < refreshHour) d.setDate(d.getDate() - 1)
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 取（并缓存）当天的原始推荐池。
 *
 *  @param fetchSongs 注入的推荐流抓取函数（生产传 fetchRecommendedSongs，
 *                    单测可传桩，避免测试打外网）
 */
export async function getDailyPool(
  fetchSongs: (size: number) => Promise<RecommendSong[]>,
  now: number = Date.now(),
): Promise<RecommendSong[]> {
  const day = dayKey(now)
  const hit = poolCache.get('pool')
  if (hit && hit.day === day && hit.songs.length > 0) return hit.songs

  let songs: RecommendSong[] = []
  try {
    // 多取一些：后面要按六张卡的主题分别筛选，池子小了每张卡都不够填
    songs = (await fetchSongs(120)) ?? []
  } catch (e) {
    console.error('[今日甄选] 抓取推荐流失败:', e)
    // 抓取失败：有旧池就用旧的（宁可给昨天的推荐，也别开天窗）
    if (hit && hit.songs.length > 0) return hit.songs
    return []
  }
  if (songs.length > 0) poolCache.set('pool', { day, songs })
  return songs.length > 0 ? songs : (hit?.songs ?? [])
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
 *  所以这里的策略是：**按卡顺序逐张取歌，已被前面卡用掉的歌不再给后面的卡**。
 *  卡顺序按「主题越具体越先取」（drive/focus/night/pop/nostalgia 先，radar 最后），
 *  让主题卡先锁定自己的特色曲，radar 拿剩下的 —— 这样既保留个性化，
 *  又保证六张卡内容互不重复。 */
const THEME_FIRST_ORDER = ['drive', 'focus', 'night', 'pop', 'nostalgia', 'radar']

export function buildMixPlaylists(options: BuildOptions): MixResult[] {
  const now = options.now ?? Date.now()
  const day = dayKey(now)
  const limit = options.limit ?? 20
  const affinity = singerAffinity(options.history, options.library, now)
  const recent = recentlyPlayedKeys(options.history, now)
  // 先按日期洗牌：保证每天的开头不总是「最新上架那几张专辑」
  const shuffled = seededShuffle(options.pool, day)

  const usedKeys = new Set<string>()
  const byId = new Map<string, MixResult>()

  for (const id of THEME_FIRST_ORDER) {
    const spec = MIX_SPECS.find((s) => s.id === id)
    if (!spec) continue
    // 候选池里去掉已被其他卡选走的歌，避免六张卡重复
    const pool = shuffled.filter((s) => !usedKeys.has(songIdentityKey(s.name, s.singer)))
    const ranked = rankByTheme(pool, spec.keywords, affinity, recent, limit, 3)
    for (const s of ranked.songs) usedKeys.add(songIdentityKey(s.name, s.singer))
    const basis = spec.keywords.length
      ? `平台新专辑 × 主题「${spec.keywords.slice(0, 2).join('/')}」× 你的口味`
      : '平台新专辑 × 你的口味'
    byId.set(id, { id, songs: ranked.songs, topSingers: ranked.topSingers, basis })
  }

  // 按前端声明顺序返回（CURATED_MIXES 的顺序），保证展示顺序稳定
  return MIX_SPECS.map((s) => byId.get(s.id) ?? { id: s.id, songs: [], topSingers: [], basis: '' })
}

/** 带缓存的对外入口：同一天同一用户同一张卡只算一次。 */
export async function getMixPlaylists(options: {
  userName: string
  history: readonly HistoryEntryLike[]
  library: LibraryLike | null | undefined
  fetchSongs: (size: number) => Promise<RecommendSong[]>
  now?: number
  limit?: number
}): Promise<{ day: string; basis: string; mixes: MixResult[]; cached: boolean }> {
  const now = options.now ?? Date.now()
  const day = dayKey(now)
  const key = `${options.userName}|${day}|${options.limit ?? 20}`
  const hit = playlistCache.get(key)
  if (hit && hit.day === day) {
    return { ...(hit.payload as { day: string; basis: string; mixes: MixResult[] }), cached: true }
  }

  const pool = await getDailyPool(options.fetchSongs, now)
  const mixes = buildMixPlaylists({ ...options, pool, now })
  const payload = {
    day,
    basis: '平台官方推荐流 + 你的播放画像',
    mixes,
  }
  // 只在有货时缓存，避免把「抓取失败的空池」钉住一整天
  if (pool.length > 0) playlistCache.set(key, { day, payload })
  return { ...payload, cached: false }
}

/** 仅供测试：清空所有缓存 */
export function __clearRecommendCaches(): void {
  playlistCache.clear()
  poolCache.clear()
}
