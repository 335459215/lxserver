/** 通用异步资源 hook：把「按 key 取数」的样板收敛到一处。
 *
 *  key 必须完整编码「影响请求的一切参数」：只有 key 变才重新请求，
 *  这样对象引用变化不会引发重复请求，也不需要把 load 塞进依赖数组。
 *  key 为空字符串表示「条件不满足、先不请求」，此时状态为 idle。
 *
 *  从 discover.ts 抽出来是因为本地音乐（lib/localMusic.ts）也要用 ——
 *  它不属于「发现页数据」，放在 discover 里名不副实。
 */
import * as React from 'react'
import { MusicApiError } from '@/lib/music'

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

  // key 为空（例如条件不满足）→ idle；结果不属于本次 key/重试 → 仍在加载
  if (!key) return { status: 'idle', data: null, error: null, reload }
  if (state.stamp !== `${key}#${nonce}`) {
    return { status: 'loading', data: null, error: null, reload }
  }
  return { status: state.status, data: state.data, error: state.error, reload }
}

/** 统一解包：非 2xx 或结构异常都抛 MusicApiError */
export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`
    throw new MusicApiError(msg)
  }
  if (data == null) throw new MusicApiError('返回格式异常')
  return data as T
}
