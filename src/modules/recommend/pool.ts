/** 今日甄选的候选池构建（v2.48.1）。
 *
 * 【v2.48.0 线上暴露的问题｜实测数据】
 * 只用 `fetchRecommendedSongs()`（QQ 官方推荐新专辑）做候选池时：
 *   - 池子只有约 20 首（8 张专辑聚合后去重），请求 120 也拿不到更多；
 *   - 这 20 首来自「六大地区随机新专辑」，与该用户听过什么**毫无交集**
 *     —— 实测推荐结果与播放历史里 24 位歌手的交集是 **0**；
 *   - 六张卡里 drive 拿到 20 首、radar/pop/nostalgia 各 3 首（池子被主题词切碎）。
 * 即：**个性化没有作用空间**，因为画像里的歌手根本不在候选池里。
 *
 * 【修法：双源候选池】
 *   源 A｜平台推荐流：`fetchRecommendedSongs()` —— 「外面有什么新的」，负责发现。
 *   源 B｜口味回响：拿用户最偏好的几位歌手去搜索，取他们的歌 —— 「你可能还想听」，
 *        负责让画像**真的能命中**（这也是网易云「综合听歌记录/收藏歌手」的最朴素落地）。
 *
 * 两源合并后：A 负责「新」，B 负责「准」，再用 rank.ts 的打分把两者混排。
 * 比例默认 A:B = 1:1（可通过 options 调整），保证既不完全重复历史、也不全是陌生内容。
 *
 * 【为什么不直接接 ListenBrainz】
 * 调研过（Explo / ListenBrainz 推荐 API 都用它），质量确实更好，但要求用户注册
 * ListenBrainz 并持续提交 scrobble —— 对家庭 NAS 场景门槛太高。本地双源方案
 * 零注册、零外部依赖，是当前场景下的合理上限；将来要接 ListenBrainz 可以作为一个
 * 额外的源插进来（本文件已按「多源合并」的结构写）。
 */
import type { RecommendSong } from '@/modules/recommend/rank.js'

/** 去重键（跨平台同名同歌手视为同一首） */
export function poolKey(song: RecommendSong): string {
  const n = String(song?.name ?? '').trim().toLowerCase()
  const s = String(song?.singer ?? '').split(/[、,，;；&/]/)[0].trim().toLowerCase()
  return n ? `${n}::${s}` : ''
}

/** 古典/器乐大专辑的识别特征。
 *
 * 【为什么需要过滤｜v2.48.1 线上实测】
 * `fetchRecommendedSongs` 抓的是 QQ 六个地区的「新上架专辑」，其中古典乐占比极高
 * （唱片公司持续数字化重发老录音）。实测推荐池里 **62% 是古典曲目、56% 的标题超过 50 字**
 * （如 `Serenade in C Major, K. 648 "A Very Little Night Music" (Original Version ...)`），
 * 直接把 radar / nostalgia 两张卡刷成了莫扎特专辑 —— 对一个「流行音乐播放器」来说
 * 这是明显的质量事故。
 *
 * 过滤策略：**只对「平台推荐流」这一源做古典降权**，不去动用户口味源 ——
 * 用户自己常听古典的话，源 B 仍然会把古典搜回来（那是他的真实偏好，不该被算法歧视）。
 */
const CLASSICAL_MARKERS = [
  'mozart', 'bach', 'beethoven', 'chopin', 'haydn', 'schubert', 'brahms',
  'tchaikovsky', 'debussy', 'liszt', 'vivaldi', 'handel', 'rachmaninoff',
  'symphony', 'concerto', 'sonata', 'variations on', 'minuets', 'serenade in',
  'nocturne', 'prelude in', 'fugue', 'requiem', 'orchestra', 'philharmonic',
]

/** 白噪音/助眠音效的识别特征。
 *
 * 【为什么也要过滤｜v2.48.2 线上实测】
 * 剔掉古典后，QQ 新专辑流里剩下的「长篇内容」变成了白噪音/助眠音效专辑
 * （实测 radar 卡首三首是「轻柔雨滴 - 528赫兹绿色噪音」「放松海浪」「自然之声- 布朗噪音」）。
 * 这类内容在音乐推荐位上属于噪音：用户点「每日私享雷达」期待的是歌，不是雨声采样。
 *
 * 注意：「助眠」「治愈」这类词本身是**正当主题**（深夜卡需要它们），
 * 所以只匹配「音效体裁词」，不匹配情绪词。 */
const SFX_MARKERS = [
  '白噪音', '白噪声', '布朗噪音', '布朗噪声', '绿色噪音', '粉红噪音', '粉噪声',
  '赫兹', 'hz噪音', '自然之声', '雨声', '海浪', '溪流', '鸟鸣', '篝火', '炉火',
  'whitenoise', 'white noise', 'brown noise', 'pink noise', 'rain sound',
  'ocean sound', 'nature sound', 'asmr', 'binaural', 'sound of ',
]

/** 判断是否「音效/白噪音」类内容。 */
export function looksSfx(song: RecommendSong): boolean {
  const hay = `${song?.name ?? ''} ${song?.albumName ?? ''}`.toLowerCase()
  return SFX_MARKERS.some((m) => hay.includes(m))
}
export function looksClassical(song: RecommendSong): boolean {
  const hay = `${song?.name ?? ''} ${song?.albumName ?? ''} ${song?.singer ?? ''}`.toLowerCase()
  // 作品编号是强特征。
  // 注意 `Op.` 后面不一定是数字（`Op. Posth.` = 遗作，古典唱片里很常见），
  // 所以只要求出现 `op.` 标记本身即可；`K. 398` 这类要带数字以免误伤英文名。
  if (/\bop\.\s/i.test(hay) || /\bk\.\s*\d{2,}/i.test(hay)) return true
  // 「No. 19 In A Minor」这类调性+编号写法也是古典专属
  if (/\bno\.\s*\d+\s+in\s+[a-g]\b/i.test(hay)) return true
  return CLASSICAL_MARKERS.some((m) => hay.includes(m))
}

/** 标题是否过长（古典曲目的典型特征，移动端列表里根本显示不下）。 */
export function isOverlongTitle(song: RecommendSong, max = 60): boolean {
  return String(song?.name ?? '').length > max
}

/** 过滤候选池的明显劣质内容。
 *
 *  @param song      待判断
 *  @param dropClassical 是否剔除古典与白噪音（只对平台推荐流为 true；口味源为 false ——
 *                       用户自己常听古典/助眠音，那是真实偏好，不该被算法歧视）
 */
export function isLowQuality(song: RecommendSong, dropClassical: boolean): boolean {
  if (!song || typeof song.name !== 'string' || !song.name.trim()) return true
  if (isOverlongTitle(song)) return true
  if (dropClassical && looksClassical(song)) return true
  if (dropClassical && looksSfx(song)) return true
  return false
}

/** 合并多个候选源并去重（先到的优先 —— 调用方按「质量从高到低」排列各源）。 */
export function mergePools(...sources: (readonly RecommendSong[] | undefined | null)[]): RecommendSong[] {
  const out: RecommendSong[] = []
  const seen = new Set<string>()
  for (const src of sources) {
    for (const song of src ?? []) {
      if (!song || typeof song.name !== 'string' || !song.name.trim()) continue
      const k = poolKey(song)
      if (!k || seen.has(k)) continue
      seen.add(k)
      out.push(song)
    }
  }
  return out
}

/** 从画像里挑出最值得去搜的几位歌手。
 *
 *  过滤规则（都是为了搜索质量）：
 *   - 名字里必须至少有一个**字母或汉字**（纯符号如 "-" / "·" 搜不出东西）；
 *   - 去掉标点后长度 ≥ 2（单个字符做查询词噪音极大）。
 *
 *  ⚠️ 注意不要按「原始长度」判断：中日文歌手名普遍 2-3 字，
 *  英文名可能是 'Jay'、'LiSA'，都应该放行。 */
export function pickSeedSingers(
  affinity: Map<string, number>,
  limit = 6,
): string[] {
  return Array.from(affinity.entries())
    .filter(([name, weight]) => {
      if (!name || weight <= 0) return false
      // 必须含字母或汉字（排除纯符号/纯数字）
      if (!/[\p{L}]/u.test(name)) return false
      // 去掉标点空白后至少 2 个字符
      const compact = name.replace(/[^\p{L}\p{N}]/gu, '')
      return compact.length >= 2
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, limit))
    .map(([name]) => name)
}

export interface PoolBuildResult {
  /** 合并后的候选池 */
  pool: RecommendSong[]
  /** 实际用来搜歌的种子歌手（便于日志/排查与前端展示） */
  seedSingers: string[]
  /** 各源贡献了多少首（诊断用） */
  stats: { discover: number; taste: number; total: number }
}

/** 构建双源候选池。
 *
 *  @param fetchDiscover 源 A：平台推荐流（生产传 fetchRecommendedSongs）
 *  @param searchSongs   源 B：按关键词搜索（生产传平台聚合搜索）
 *  @param affinity      用户歌手亲和度（决定搜谁）
 *  @param perSinger     每位种子歌手取多少首
 *  @param maxSeeds      最多搜几位歌手（控制请求数与耗时）
 */
export async function buildCandidatePool(options: {
  fetchDiscover: (size: number) => Promise<RecommendSong[]>
  searchSongs: (keyword: string) => Promise<RecommendSong[]>
  affinity: Map<string, number>
  discoverSize?: number
  perSinger?: number
  maxSeeds?: number
}): Promise<PoolBuildResult> {
  // 过滤会砍掉大量内容（实测古典+白噪音合计约 70%），所以要多抓一些：
  // 抓 200 过滤后剩 40-60 首，六张卡才够分。引擎内部按专辑聚合，多抓不会明显变慢。
  const discoverSize = options.discoverSize ?? 200
  const perSinger = options.perSinger ?? 15
  const maxSeeds = options.maxSeeds ?? 5

  // 源 A：平台推荐流（失败不影响整体 —— 有 B 也能出推荐）
  let discover: RecommendSong[] = []
  try {
    const raw = (await options.fetchDiscover(discoverSize)) ?? []
    // 推荐流里古典/超长标题占比极高（实测 62%/56%），这里剔除。
    // 注意只过滤源 A：源 B 是用户真实口味，不该被过滤。
    const kept = raw.filter((s) => !isLowQuality(s, true))
    const dropped = raw.length - kept.length
    if (dropped > 0) {
      console.log(`[今日甄选] 推荐流剔除劣质内容 ${dropped}/${raw.length} 首（古典/超长标题）`)
    }
    discover = kept
  } catch (e) {
    console.error('[今日甄选] 平台推荐流抓取失败，继续用口味源:', e)
  }

  // 源 B：拿最偏好的几位歌手去搜。
  // 串行 + 每人只取一份结果：并发打搜索接口容易触发上游限流（实测 500）。
  const seedSingers = pickSeedSingers(options.affinity, maxSeeds)
  const taste: RecommendSong[] = []
  for (const singer of seedSingers) {
    try {
      const songs = (await options.searchSongs(singer)) ?? []
      // 只保留确实是这位歌手的结果，避免搜索把别人的歌塞进来污染画像
      const own = songs.filter((s) => {
        const got = String(s?.singer ?? '').split(/[、,，;；&/]/)[0].trim().toLowerCase()
        return got === singer.toLowerCase()
      })
      // 口味源只过滤「空曲名/超长标题」，不过滤古典 —— 用户真听古典就该推
      taste.push(...own.filter((s) => !isLowQuality(s, false)).slice(0, perSinger))
    } catch (e) {
      console.error(`[今日甄选] 种子歌手「${singer}」搜索失败:`, e)
    }
  }

  const pool = mergePools(taste, discover)
  return {
    pool,
    seedSingers,
    stats: { discover: discover.length, taste: taste.length, total: pool.length },
  }
}
