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
import * as React from 'react'
import { MusicApiError, type Song } from '@/lib/music'

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

// ===== 通用异步资源 hook =====
//
// key 必须完整编码「影响请求的一切参数」：只有 key 变才重新请求，
// 这样对象引用变化不会引发重复请求，也不需要把 load 塞进依赖数组。

export type AsyncStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface AsyncResource<T> {
  status: AsyncStatus
  data: T | null
  error: string | null
  reload: () => void
}

export function useAsyncResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
): AsyncResource<T> {
  // 结果连同「产生它的 key#nonce」一起存：key 或重试次数一变，返回值立刻变成
  // loading，不需要在 effect 里同步 setState 去清空（那会触发级联渲染）。
  const [state, setState] = React.useState<{
    stamp: string
    status: 'ready' | 'error'
    data: T | null
    error: string | null
  }>({ stamp: '', status: 'ready', data: null, error: null })
  const [nonce, setNonce] = React.useState(0)

  // load 只作为「最新值」读取，避免每次渲染生成的新函数触发重请求
  const loadRef = React.useRef(load)
  React.useEffect(() => {
    loadRef.current = load
  })

  React.useEffect(() => {
    if (!key) return
    const stamp = `${key}#${nonce}`
    const ac = new AbortController()
    let alive = true

    loadRef.current(ac.signal)
      .then((data) => {
        if (alive) setState({ stamp, status: 'ready', data, error: null })
      })
      .catch((e: unknown) => {
        if (!alive) return
        if (e instanceof DOMException && e.name === 'AbortError') return
        setState({
          stamp,
          status: 'error',
          data: null,
          error: e instanceof Error ? e.message : '加载失败',
        })
      })

    return () => {
      alive = false
      ac.abort()
    }
  }, [key, nonce])

  const reload = React.useCallback(() => setNonce((n) => n + 1), [])

  // key 为空（例如还没选榜单）→ idle；结果不属于本次 key/重试 → 仍在加载
  if (!key) return { status: 'idle', data: null, error: null, reload }
  if (state.stamp !== `${key}#${nonce}`) {
    return { status: 'loading', data: null, error: null, reload }
  }
  return { status: state.status, data: state.data, error: state.error, reload }
}

/** 统一解包：非 2xx 或结构异常都抛 MusicApiError */
async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`
    throw new MusicApiError(msg)
  }
  if (data == null) throw new MusicApiError('返回格式异常')
  return data as T
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
