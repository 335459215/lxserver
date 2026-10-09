import * as React from 'react'
import { fetchLists, type ListsSnapshot } from '@/lib/lists'

/** 读取当前用户的列表快照（试听/收藏/自建歌单）。
 *  各页面独立持有，不引全局 store：数据量小，且避免跨页状态同步的复杂度。 */
export function useLists() {
  const [snapshot, setSnapshot] = React.useState<ListsSnapshot | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const abortRef = React.useRef<AbortController | null>(null)

  /** 真正取数。第一个语句就是 await —— 挂载路径因此不会在 effect 体内同步 setState
   *  （react-hooks/set-state-in-effect 关心的级联渲染）。 */
  const runFetch = React.useCallback(async (ac: AbortController) => {
    try {
      const data = await fetchLists(ac.signal)
      if (ac.signal.aborted) return
      setSnapshot(data)
      setError(null)
    } catch (e) {
      if (ac.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
      setError(e instanceof Error ? e.message : '读取歌单失败')
    } finally {
      if (!ac.signal.aborted) setLoading(false)
    }
  }, [])

  /** 手动刷新：可以同步置 loading，让按钮/骨架立刻有反馈。
   *  silent=true 用于「改完数据后悄悄对齐服务端」，不闪骨架。 */
  const reload = React.useCallback(
    async (silent = false) => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      if (!silent) {
        setLoading(true)
        setError(null)
      }
      await runFetch(ac)
    },
    [runFetch],
  )

  React.useEffect(() => {
    const ac = new AbortController()
    abortRef.current = ac
    // loading 初值即 true，挂载路径不需要同步 setState：runFetch 的第一个语句
    // 就是 await fetchLists(...)，所有 setState 都在 await 之后。规则静态看不出来，
    // 与 lib/auth.tsx 的挂载探测同一处理方式。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runFetch(ac)
    return () => ac.abort()
  }, [runFetch])

  return { snapshot, loading, error, reload }
}
