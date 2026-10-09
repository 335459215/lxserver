/** 音乐接口层：聚合搜索 + 播放地址解析。
 *
 * 接口面与鉴权见 docs/stage0/api-and-state-map.md：
 *  - `GET  /api/music/search`  无鉴权，返回**裸数组**（不是 { list } 包裹）
 *  - `POST /api/music/url`     混合鉴权：具名用户须带 token（见 userAuthHeaders），
 *                              否则按公开用户 `open` 处理。解析器内部带粘滞缓存 +
 *                              跨平台竞速 + 源级熔断
 */
import { userAuthHeaders } from '@/lib/auth'

/** 各平台搜索结果字段名不统一，这里只声明公共字段，其余透传 */
export interface Song {
  /** 平台标识：kw / wy / tx / kg / mg */
  source: string
  id?: string | number
  songmid?: string
  name: string
  singer: string
  albumName?: string
  albumId?: string | number
  /** 时长，形如 "03:30" */
  interval?: string
  img?: string
  picUrl?: string
  /** 该曲可用的音质档位 */
  types?: Array<{ type?: string; size?: string | null }>
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
  { key: 'kw', label: '酷我' },
  { key: 'wy', label: '网易云' },
  { key: 'tx', label: 'QQ音乐' },
  { key: 'kg', label: '酷狗' },
  { key: 'mg', label: '咪咕' },
] as const

export const SOURCE_LABEL: Record<string, string> = Object.fromEntries(
  MUSIC_SOURCES.map((s) => [s.key, s.label]),
)

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
  return data
}

/** 秒 → m:ss（负数/NaN 一律显示 0:00） */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00'
  const total = Math.floor(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** "03:30" → 210（解析不出来返回 0） */
export function intervalToSeconds(interval?: string): number {
  if (!interval) return 0
  const parts = interval.split(':').map((n) => Number.parseInt(n, 10))
  if (parts.some((n) => Number.isNaN(n))) return 0
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

/** 同一首歌的判定：同平台 + 同 songmid/id */
export function sameSong(a: Song | null, b: Song | null): boolean {
  if (!a || !b) return false
  if (a.source !== b.source) return false
  const idA = a.songmid ?? a.id
  const idB = b.songmid ?? b.id
  return idA != null && idB != null && String(idA) === String(idB)
}

/** 封面地址：各平台字段名不统一，统一兜底 */
export function coverUrl(song?: Song | null): string | undefined {
  if (!song) return undefined
  const candidates = [
    song.img,
    song.picUrl,
    (song.album as { cover?: string } | undefined)?.cover,
  ]
  return candidates.find((u): u is string => typeof u === 'string' && u.length > 0)
}

/** 平台中文名（未知平台回落原标识） */
export function sourceLabel(source?: string): string {
  if (!source) return ''
  return SOURCE_LABEL[source] ?? source.toUpperCase()
}
