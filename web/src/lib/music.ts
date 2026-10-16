/** 音乐接口层：聚合搜索 + 播放地址解析。
 *
 * 接口面与鉴权见 docs/stage0/api-and-state-map.md：
 *  - `GET  /api/music/search`  无鉴权，返回**裸数组**（不是 { list } 包裹）
 *  - `POST /api/music/url`     混合鉴权：具名用户须带 token（见 userAuthHeaders），
 *                              否则按公开用户 `open` 处理。解析器内部带粘滞缓存 +
 *                              跨平台竞速 + 源级熔断
 */
import { userAuthHeaders } from '@/lib/auth'
// 去重实现放在零依赖的 songIdentity.ts（便于单测直接 import）。
// 这里必须**同时** import 进来用 + 转发出去：只写 `export {} from` 不会
// 在本文件里建立局部绑定，而 searchMusicAggregate 自己就要调用它。
import { dedupeSongs } from '@/lib/songIdentity'
export { dedupeSongs }

/** 各平台搜索结果字段名不统一，这里只声明公共字段，其余透传。
 *  歌单里的曲目（LX.Music.MusicInfo）也能被这个类型覆盖：它把封面/专辑放在
 *  `meta` 下，故 coverUrl() 会一并兜底 meta.picUrl。 */
export interface Song {
  /** 平台标识：kw / wy / tx / kg / mg / local */
  source: string
  id?: string | number
  songmid?: string
  name: string
  singer: string
  albumName?: string
  albumId?: string | number
  /** 时长，形如 "03:30"；歌单里可能是 null */
  interval?: string | null
  img?: string
  picUrl?: string
  /** 歌单曲目：服务端 meta（songId/picUrl/qualitys…） */
  meta?: {
    songId?: string | number
    albumName?: string
    picUrl?: string | null
    qualitys?: Array<{ type?: string; size?: string | null }>
    [key: string]: unknown
  }
  /** 该曲可用的音质档位 */
  types?: Array<{ type?: string; size?: string | null }>
  /** 直链播放地址。**仅本地音乐（source=local）用**：解析器只认在线平台，
   *  有 url 时播放内核跳过解析直接播（见 lib/player.tsx）。 */
  url?: string
  [key: string]: unknown
}

export interface ResolveAttempt {
  name?: string
  sourceName?: string
  status?: string
  message?: string
}

export interface ResolveResult {
  url: string
  /** **实得**音质档位。注意服务端返回的字段名是 `type` 而不是 `quality`
   *  （实测：请求 flac 时响应里 `type:"flac"` 而 `quality` 为 undefined）。
   *  这里同时声明两者并做归一化，避免再次读错字段导致 UI 谎报档位。 */
  type?: string
  quality?: string
  sourceName?: string
  resolvedSource?: string
  requestedSource?: string
  downloadSource?: string
  attempts?: ResolveAttempt[]
}

/** 解析失败：带上逐源 attempts，便于 UI 展示"试过哪些源" */
export class MusicApiError extends Error {
  attempts?: ResolveAttempt[]
  constructor(message: string, attempts?: ResolveAttempt[]) {
    super(message)
    this.name = 'MusicApiError'
    this.attempts = attempts
  }
}

export const MUSIC_SOURCES = [
  { key: 'all', label: '聚合搜索' },
  { key: 'kw', label: '酷我' },
  { key: 'wy', label: '网易云' },
  { key: 'tx', label: 'QQ音乐' },
  { key: 'kg', label: '酷狗' },
  { key: 'mg', label: '咪咕' },
] as const

export const SOURCE_LABEL: Record<string, string> = {
  all: '全网聚合',
  kw: '酷我',
  wy: '网易云',
  tx: 'QQ音乐',
  kg: '酷狗',
  mg: '咪咕',
}

/** 音质降级序列：首选 320k，失败退 128k（服务端解析器内部还会再按可用档位调整） */
export const QUALITY_FALLBACK = ['320k', '128k'] as const

/** 聚合搜索。服务端支持一次拉多页（pages），返回裸数组。 */
export async function searchMusic(params: {
  name: string
  singer?: string
  source?: string
  page?: number
  pages?: number
  signal?: AbortSignal
}): Promise<Song[]> {
  const qs = new URLSearchParams({
    name: params.name,
    source: params.source ?? 'kw',
    type: 'song',
    page: String(params.page ?? 1),
    pages: String(params.pages ?? 1),
  })
  if (params.singer) qs.set('singer', params.singer)

  const res = await fetch(`/api/music/search?${qs.toString()}`, { signal: params.signal })
  const data: unknown = await res.json().catch(() => null)

  if (!res.ok) {
    const msg =
      (data as { error?: string } | null)?.error ?? `搜索失败（HTTP ${res.status}）`
    throw new MusicApiError(msg)
  }
  if (!Array.isArray(data)) throw new MusicApiError('搜索返回格式异常')
  return data as Song[]
}

/** 分页聚合结果：除合并后的条目外，还带回**原始**分页状态。
 *
 *  【为什么必须带上 rawHasMore，不能让调用方数 items】
 *  聚合搜索会跨平台去重，去重后条数**必然**小于原始条数：
 *  5 个平台各回 20 条、其中 10 对是同一首歌 → 去重后只剩 10 条。
 *  调用方若用「items.length < 20 就是最后一页」判断，第一页就会误判到底，
 *  后面几页永远拉不到（实测已复现）。判断依据必须是**上游是否还有数据**，
 *  而不是我们展示给用户的条数。 */
export interface AggregatePage {
  items: Song[]
  /** 各平台原始返回的条数（未去重） */
  rawCounts: number[]
  /** 是否至少有一个平台返回了满页 —— 满页说明该平台后面可能还有 */
  rawHasMore: boolean
  /** 至少一个平台成功返回（用于区分「真没数据」与「全部请求失败」） */
  anyFulfilled: boolean
}

/** 多平台并发聚合搜索（分页版）：返回条目 + 原始分页状态。 */
export async function searchMusicAggregatePage(params: {
  name: string
  singer?: string
  sources?: string[]
  page?: number
  signal?: AbortSignal
  /** 服务端每页固定条数，用于判断上游是否还有下一页 */
  pageSize?: number
}): Promise<AggregatePage> {
  const targetSources =
    params.sources && params.sources.length > 0
      ? params.sources
      : ['kw', 'wy', 'tx', 'mg', 'kg']
  const pageSize = params.pageSize ?? 20

  const results = await Promise.allSettled(
    targetSources.map((src) =>
      searchMusic({
        name: params.name,
        singer: params.singer,
        source: src,
        page: params.page ?? 1,
        signal: params.signal,
      }),
    ),
  )

  const lists: Song[][] = []
  const rawCounts: number[] = []
  let anyFulfilled = false
  for (const r of results) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      anyFulfilled = true
      rawCounts.push(r.value.length)
      if (r.value.length > 0) lists.push(r.value)
    } else {
      rawCounts.push(0)
    }
  }

  if (lists.length === 0) {
    const firstErr = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
    // 全部请求失败时抛出，让调用方区分「网络错误」与「确实没有更多结果」。
    // 早期把这两种都当成到底，网络抖动一次就永久停止翻页。
    if (firstErr && !anyFulfilled) throw firstErr.reason
    return { items: [], rawCounts, rawHasMore: false, anyFulfilled }
  }

  return {
    items: dedupeSongs(interleave(lists)),
    rawCounts,
    // 只要有**任意**平台返回满页，就认为上游可能还有下一页。
    // 不能用去重后的总数判断（见上面 AggregatePage 的说明）。
    rawHasMore: rawCounts.some((n) => n >= pageSize),
    anyFulfilled,
  }
}

/** 交织合并（Round-Robin）：每个平台各出第 0 首，再出第 1 首，
 *  保证不同平台的热门曲目都能展现。 */
function interleave(lists: Song[][]): Song[] {
  const out: Song[] = []
  const maxLen = Math.max(...lists.map((l) => l.length))
  for (let i = 0; i < maxLen; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i])
    }
  }
  return out
}

/** 多平台并发聚合搜索：同时从酷我、网易云、QQ音乐、咪咕等拉取并交织合并 */
export async function searchMusicAggregate(params: {
  name: string
  singer?: string
  sources?: string[]
  page?: number
  signal?: AbortSignal
}): Promise<Song[]> {
  const targetSources =
    params.sources && params.sources.length > 0
      ? params.sources
      : ['kw', 'wy', 'tx', 'mg', 'kg']

  const results = await Promise.allSettled(
    targetSources.map((src) =>
      searchMusic({
        name: params.name,
        singer: params.singer,
        source: src,
        page: params.page ?? 1,
        signal: params.signal,
      }),
    ),
  )

  const lists: Song[][] = []
  for (const r of results) {
    if (r.status === 'fulfilled' && Array.isArray(r.value) && r.value.length > 0) {
      lists.push(r.value)
    }
  }

  if (lists.length === 0) {
    const firstErr = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
    if (firstErr) {
      throw firstErr.reason
    }
    return []
  }

  // 交织合并（Round-Robin）：每个平台各出第 0 首，再出第 1 首，保证不同平台的热门曲目都能展现。
  // 去重见 dedupeSongs —— 按「歌名 + 歌手集合有交集」跨平台判定。
  // 此前用 `${source}_${id}` 做键，等于**只去掉同平台内的重复**，
  // 同一个作品在五个平台各留一条，用户看到的就是「结果里全是同一首歌」。
  return dedupeSongs(interleave(lists))
}

/** 解析播放地址；失败抛 MusicApiError（带 attempts 明细）。
 *
 *  注意：必须带上用户鉴权头。自定义音源按用户归属落盘，服务端据此挑选可用的源；
 *  不带就退化成公开用户 open（`_open` 目录通常没有源），点歌会一律失败。 */
export async function resolveMusicUrl(params: {
  songInfo: Song
  quality?: string
  excludeApiSources?: string[]
  signal?: AbortSignal
}): Promise<ResolveResult> {
  const res = await fetch('/api/music/url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...userAuthHeaders() },
    signal: params.signal,
    body: JSON.stringify({
      songInfo: params.songInfo,
      quality: params.quality ?? QUALITY_FALLBACK[0],
      enableAutoSwitchApiSource: true,
      excludeApiSources: params.excludeApiSources ?? [],
    }),
  })
  const data = (await res.json().catch(() => null)) as
    | (ResolveResult & { error?: string })
    | null

  if (!res.ok || !data?.url) {
    throw new MusicApiError(data?.error ?? `解析失败（HTTP ${res.status}）`, data?.attempts)
  }
  // 服务端把实得档位放在 `type`（`quality` 恒为 undefined）。这里归一化到 `quality`，
  // 让上层只认一个字段；两侧都留是为了兼容以后服务端可能补上 quality 的情况。
  return { ...data, quality: data.type ?? data.quality }
}

/** 秒 → m:ss（负数/NaN 一律显示 0:00）。用于单曲时长。 */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00'
  const total = Math.floor(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 列表总时长：不足 1 小时用 m:ss，超过则给「4 小时 20 分」这种可读形式
 *  （69 首的试听列表显示成 "260:04" 没人愿意换算）。 */
export function formatTotalDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00'
  const total = Math.floor(sec)
  if (total < 3600) return formatTime(total)
  const h = Math.floor(total / 3600)
  const m = Math.round((total % 3600) / 60)
  return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`
}

/** "03:30" → 210（解析不出来返回 0） */
export function intervalToSeconds(interval?: string | null): number {
  if (!interval) return 0
  const parts = interval.split(':').map((n) => Number.parseInt(n, 10))
  if (parts.some((n) => Number.isNaN(n))) return 0
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

/** 同一首歌的判定：同平台 + 同 songmid/id。
 *  歌单曲目（meta.songId）与搜索结果（songmid）要能对上，故三级兜底。 */
export function sameSong(a: Song | null, b: Song | null): boolean {
  if (!a || !b) return false
  if (a.source !== b.source) return false
  const idA = a.songmid ?? a.id ?? a.meta?.songId
  const idB = b.songmid ?? b.id ?? b.meta?.songId
  return idA != null && idB != null && String(idA) === String(idB)
}

/** 曲目去重键：平台 + songmid/id，缺失时回落「歌名|歌手」。
 *  用于搜索分页追加时去重（各平台翻页结果常出现重复条目），
 *  播放内核也用它记忆「哪些源已经试过且失败」。无曲目时返回空串。 */
export function songKey(song: Song | null): string {
  if (!song) return ''
  const id = song.songmid ?? song.id ?? song.meta?.songId
  return id != null ? `${song.source}:${id}` : `${song.source}:${song.name}|${song.singer}`
}

/** 跨平台身份判定与去重：实现见 lib/songIdentity.ts（零依赖，便于单测直接 import）。
 *  本文件顶部已转发 `dedupeSongs`，既有调用方不受影响。 */


/** 封面地址：各平台字段名不统一，统一兜底（歌单曲目把封面放在 meta.picUrl） */
export function coverUrl(song?: Song | null): string | undefined {
  if (!song) return undefined
  const candidates = [
    song.img,
    song.picUrl,
    song.meta?.picUrl,
    (song.album as { cover?: string } | undefined)?.cover,
  ]
  return candidates.find((u): u is string => typeof u === 'string' && u.length > 0)
}

/** 平台中文名（未知平台回落原标识） */
export function sourceLabel(source?: string): string {
  if (!source) return ''
  // 本地音乐不是在线平台，不在 MUSIC_SOURCES 里，单独给个名字
  if (source === 'local') return '本地'
  return SOURCE_LABEL[source] ?? source.toUpperCase()
}
