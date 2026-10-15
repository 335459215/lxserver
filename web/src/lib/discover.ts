/** 发现：热搜 / 排行榜 / 歌手 / 专辑。接口全部现成，无需改服务端。
 *
 *  - `GET /api/music/hotSearch?source=`            → `{ source, list: string[] }`（无鉴权）
 *  - `GET /api/music/leaderboard/boards?source=`   → `{ list: [{ id, name, bangid }] }`
 *  - `GET /api/music/leaderboard/list?source=&bangid=&page=` → `{ total, list: Song[] }`（已归一化）
 *  - `GET /api/music/search?name=&source=&type=singer` → `[{ id, name, picUrl, alias, albumSize }]`
 *  - `GET /api/music/artistDetail?id=&source=`     → `{ id, name, desc, avatar, musicSize, albumSize }`
 *  - `GET /api/music/artistAlbums?id=&source=&page=` → `{ total, list: AlbumBrief[] }`
 *  - `GET /api/music/artistSongs?id=&source=&order=hot|time` → 裸数组（服务端循环拉全部页）
 *  - `GET /api/music/albumSongs?id=&source=`       → `{ name, publishTime, total, list: Song[] }`
 *
 * **平台覆盖（2026-10 实测，重要）**：歌手搜索 / 歌手详情 / 歌手专辑 / 歌手歌曲 / 专辑歌曲
 * **只有网易云(wy) 与 QQ音乐(tx) 支持**；酷我 / 酷狗 / 咪咕一律 500
 * （"Source kw does not support singer search" / "Cannot read properties of undefined"）。
 * 故所有入口都要先过 `supportsArtistPages()`，不要在这两个平台之外渲染链接，否则就是死链。
 */
import { MusicApiError, dedupeSongs, type Song } from '@/lib/music'
import { getJson, useAsyncResource, type AsyncResource } from '@/lib/asyncResource'

// 通用异步资源已抽到 lib/asyncResource.ts（本地音乐也要用）。
// 类型再导出一次，保持既有引用路径可用。
export type { AsyncResource, AsyncStatus } from '@/lib/asyncResource'

/** 支持歌手页 / 专辑页的平台。其余平台的对应接口不存在，入口必须隐藏。 */
export const ARTIST_SOURCES = ['wy', 'tx'] as const

export function supportsArtistPages(source?: string | null): boolean {
  return !!source && (ARTIST_SOURCES as readonly string[]).includes(source)
}

export interface LeaderboardBoard {
  id: string
  name: string
  bangid: string
  source?: string
}

export interface LeaderboardPageResult {
  total: number
  list: Song[]
}

export interface ArtistDetail {
  id: string | number
  name: string
  /** 简介，可能很长；也可能为空 */
  desc?: string
  avatar?: string
  musicSize?: number
  albumSize?: number
  source?: string
}

export interface AlbumBrief {
  id: string | number
  name: string
  img?: string
  singer?: string
  publishTime?: string
  total?: number
}

export interface ArtistAlbumsResult {
  total: number
  list: AlbumBrief[]
}

export interface AlbumSongsResult {
  name: string
  publishTime?: string
  total: number
  list: Song[]
}

export interface SingerHit {
  id: string | number
  name: string
  picUrl?: string
  alias?: string[]
  albumSize?: number
  source?: string
}

// ===== 热搜 =====

export function useHotSearch(source: string): AsyncResource<string[]> {
  return useAsyncResource(`hot:${source}`, async (signal) => {
    const data = await getJson<{ list?: unknown }>(
      `/api/music/hotSearch?source=${encodeURIComponent(source)}`,
      signal,
    )
    // 服务端在拿不到热搜时会返回空数组而不是报错
    return Array.isArray(data.list) ? data.list.filter((s): s is string => typeof s === 'string') : []
  })
}

// ===== 排行榜 =====

export function cleanBoardName(name: string): string {
  const prefixRegex = /^(酷我|网易云|网易|QQ音乐|QQ|酷狗|咪咕|TME|网易云音乐)\s*[-_·\s]*/i
  const suffixRegex = /\s*[-_·\s]*(酷我|网易云|网易|QQ音乐|QQ|酷狗|咪咕)$/i
  return name.replace(prefixRegex, '').replace(suffixRegex, '').trim()
}

export interface AggregatedBoardTarget {
  source: string
  bangid: string
}

export interface AggregatedLeaderboardBoard {
  id: string
  name: string
  targets: AggregatedBoardTarget[]
}

const PROMINENT_BOARD_ORDER = [
  '飙升榜',
  '新歌榜',
  '热歌榜',
  '原创榜',
  '流行指数榜',
  'TOP500',
  '抖音热歌榜',
  '说唱榜',
  '电音榜',
  'ACG新歌榜',
  'ACG榜',
  '古风金曲榜',
  '古风音乐榜',
  '影视金曲榜',
  '网络歌曲榜',
  '内地榜',
  '欧美榜',
  '港台榜',
  '经典怀旧榜',
  'KTV点唱榜',
  '摇滚榜',
  '民谣榜',
  '说唱先锋榜',
]

/** 全网多平台聚合榜单列表：并发拉取酷我、网易、QQ、酷狗、咪咕，清洗平台名前缀并按纯榜单名聚合 */
export function useAggregatedLeaderboardBoards(): AsyncResource<AggregatedLeaderboardBoard[]> {
  return useAsyncResource('aggregated_boards', async (signal) => {
    const sources = ['kw', 'wy', 'tx', 'kg', 'mg']
    const results = await Promise.allSettled(
      sources.map((src) =>
        getJson<{ list?: LeaderboardBoard[] }>(
          `/api/music/leaderboard/boards?source=${encodeURIComponent(src)}`,
          signal,
        ),
      ),
    )

    const boardMap = new Map<string, AggregatedLeaderboardBoard>()

    results.forEach((res, index) => {
      const src = sources[index]
      if (res.status === 'fulfilled' && Array.isArray(res.value?.list)) {
        for (const item of res.value.list) {
          const rawName = item.name || ''
          const cName = cleanBoardName(rawName)
          if (!cName) continue

          const existing = boardMap.get(cName)
          if (existing) {
            if (!existing.targets.some((t) => t.source === src)) {
              existing.targets.push({ source: src, bangid: String(item.bangid) })
            }
          } else {
            boardMap.set(cName, {
              id: cName,
              name: cName,
              targets: [{ source: src, bangid: String(item.bangid) }],
            })
          }
        }
      }
    })

    // 按知名主流榜单优先排序，后续榜单追加在后
    const ordered: AggregatedLeaderboardBoard[] = []
    for (const name of PROMINENT_BOARD_ORDER) {
      const b = boardMap.get(name)
      if (b) {
        ordered.push(b)
        boardMap.delete(name)
      }
    }
    ordered.push(...Array.from(boardMap.values()))
    return ordered
  })
}

/** 聚合榜单曲目：若属于多个平台则并发拉取、智能去重交织合并 */
export function useAggregatedLeaderboardSongs(
  targets: AggregatedBoardTarget[] | null | undefined,
): AsyncResource<LeaderboardPageResult> {
  const cacheKey =
    targets && targets.length > 0
      ? `agg_board:${targets.map((t) => `${t.source}_${t.bangid}`).sort().join(',')}`
      : ''

  return useAsyncResource(cacheKey, async (signal) => {
    if (!targets || targets.length === 0) {
      return { total: 0, list: [] }
    }

    if (targets.length === 1) {
      const { source, bangid } = targets[0]
      const data = await getJson<{ total?: number; list?: Song[] }>(
        `/api/music/leaderboard/list?source=${encodeURIComponent(source)}&bangid=${encodeURIComponent(
          bangid,
        )}&page=1`,
        signal,
      )
      return { total: data.total ?? 0, list: Array.isArray(data.list) ? data.list : [] }
    }

    // 多个平台：并发请求
    const results = await Promise.allSettled(
      targets.map((t) =>
        getJson<{ total?: number; list?: Song[] }>(
          `/api/music/leaderboard/list?source=${encodeURIComponent(t.source)}&bangid=${encodeURIComponent(
            t.bangid,
          )}&page=1`,
          signal,
        ),
      ),
    )

    const lists: Song[][] = []
    let totalCount = 0

    for (const r of results) {
      if (r.status === 'fulfilled' && Array.isArray(r.value?.list) && r.value.list.length > 0) {
        lists.push(r.value.list)
        totalCount += r.value.total ?? r.value.list.length
      }
    }

    if (lists.length === 0) {
      return { total: 0, list: [] }
    }

    // 交织轮询（Round-Robin）合并，再去重。
    //
    // 【为什么改用 dedupeSongs 而不是本地 Set(键)】
    // 这里原本用的是 `name.toLowerCase()_singer.toLowerCase()` 做键 ——
    // 与搜索页修掉的那个是同一类问题：各平台对全角括号、feat 子句、
    // 歌手顺序、以及「CoCo李玟 / 李玟」的写法都不统一，整串相等判不出重复。
    // 榜单是跨平台聚合的（页面上写着「全网聚合」），重复率只会比搜索更高。
    // 统一走 dedupeSongs，语义与搜索页保持一致：歌手集合有交集即同曲。
    const interleaved: Song[] = []
    const maxLen = Math.max(...lists.map((l) => l.length))
    for (let i = 0; i < maxLen; i++) {
      for (const list of lists) {
        if (i < list.length) interleaved.push(list[i])
      }
    }

    const merged = dedupeSongs(interleaved)
    return { total: totalCount || merged.length, list: merged }
  })
}

export function useLeaderboardBoards(source: string): AsyncResource<LeaderboardBoard[]> {
  return useAsyncResource(`boards:${source}`, async (signal) => {
    const data = await getJson<{ list?: LeaderboardBoard[] }>(
      `/api/music/leaderboard/boards?source=${encodeURIComponent(source)}`,
      signal,
    )
    return Array.isArray(data.list) ? data.list : []
  })
}

/** 榜单曲目。bangid 为空时不请求。 */
export function useLeaderboardSongs(
  source: string,
  bangid: string | null,
): AsyncResource<LeaderboardPageResult> {
  return useAsyncResource(bangid ? `board:${source}:${bangid}` : '', async (signal) => {
    const data = await getJson<{ total?: number; list?: Song[] }>(
      `/api/music/leaderboard/list?source=${encodeURIComponent(source)}&bangid=${encodeURIComponent(
        bangid ?? '',
      )}&page=1`,
      signal,
    )
    return { total: data.total ?? 0, list: Array.isArray(data.list) ? data.list : [] }
  })
}

// ===== 歌手 / 专辑 =====
// 注意：以下全部只有 wy / tx 支持，调用方必须先用 supportsArtistPages() 判断。

export function useArtistDetail(source: string, id: string): AsyncResource<ArtistDetail> {
  return useAsyncResource(id ? `artist:${source}:${id}` : '', async (signal) => {
    return getJson<ArtistDetail>(
      `/api/music/artistDetail?id=${encodeURIComponent(id)}&source=${encodeURIComponent(source)}`,
      signal,
    )
  })
}

export function useArtistAlbums(source: string, id: string): AsyncResource<ArtistAlbumsResult> {
  return useAsyncResource(id ? `artistAlbums:${source}:${id}` : '', async (signal) => {
    const data = await getJson<{ total?: number; list?: AlbumBrief[] }>(
      `/api/music/artistAlbums?id=${encodeURIComponent(id)}&source=${encodeURIComponent(
        source,
      )}&page=1`,
      signal,
    )
    return { total: data.total ?? 0, list: Array.isArray(data.list) ? data.list : [] }
  })
}

/** 歌手歌曲。`order` 取 hot（最热）或 time（最新）。
 *  服务端会循环拉取全部页（上限由 `artist.maxFetchPages` 控制），返回裸数组 ——
 *  头部歌手可能有上千首，调用方务必增量渲染。 */
export function useArtistSongs(
  source: string,
  id: string,
  order: 'hot' | 'time',
): AsyncResource<Song[]> {
  return useAsyncResource(id ? `artistSongs:${source}:${id}:${order}` : '', async (signal) => {
    const data = await getJson<unknown>(
      `/api/music/artistSongs?id=${encodeURIComponent(id)}&source=${encodeURIComponent(
        source,
      )}&order=${order}`,
      signal,
    )
    return Array.isArray(data) ? (data as Song[]) : []
  })
}

export function useAlbumSongs(source: string, id: string): AsyncResource<AlbumSongsResult> {
  return useAsyncResource(id ? `album:${source}:${id}` : '', async (signal) => {
    const data = await getJson<{ name?: string; publishTime?: string; total?: number; list?: Song[] }>(
      `/api/music/albumSongs?id=${encodeURIComponent(id)}&source=${encodeURIComponent(source)}`,
      signal,
    )
    return {
      name: data.name ?? '',
      publishTime: data.publishTime,
      total: data.total ?? (data.list?.length ?? 0),
      list: Array.isArray(data.list) ? data.list : [],
    }
  })
}

/** 按名字搜歌手。只有 wy / tx 支持；其余平台服务端返回 500。
 *  用于「点歌曲的歌手名 → 找到歌手 → 进歌手页」。 */
export async function searchSingers(params: {
  name: string
  source: string
  signal?: AbortSignal
}): Promise<SingerHit[]> {
  const qs = new URLSearchParams({
    name: params.name,
    source: params.source,
    type: 'singer',
    page: '1',
    pages: '1',
  })
  const res = await fetch(`/api/music/search?${qs.toString()}`, { signal: params.signal })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `歌手搜索失败（HTTP ${res.status}）`
    throw new MusicApiError(msg)
  }
  if (!Array.isArray(data)) throw new MusicApiError('歌手搜索返回格式异常')
  return data as SingerHit[]
}

/** 从「温岚、周杰伦」这类多歌手串里取出第一个名字用于搜索。
 *  平台返回的 singer 常把合唱者用顿号/斜杠连在一起，直接拿去搜歌手多半搜不到。 */
export function firstSingerName(singer?: string | null): string {
  if (!singer) return ''
  return singer.split(/[、,，/&]|\sfeat\.?\s*/i)[0].trim()
}
