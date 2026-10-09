/** 发现：热搜 + 排行榜。接口全部现成，无需改服务端。
 *
 *  - `GET /api/music/hotSearch?source=`            → `{ source, list: string[] }`（无鉴权）
 *  - `GET /api/music/leaderboard/boards?source=`   → `{ list: [{ id, name, bangid }] }`
 *  - `GET /api/music/leaderboard/list?source=&bangid=&page=` → `{ total, list: Song[] }`（已归一化）
 *
 * 五平台（kw/wy/tx/kg/mg）都支持榜单；热搜在部分平台缺失时服务端会自动回落。
 */
import * as React from 'react'
import { MusicApiError, type Song } from '@/lib/music'

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

function useAsyncResource<T>(
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
