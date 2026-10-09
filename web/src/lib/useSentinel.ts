import * as React from 'react'

/** 触底哨兵：把返回的 ref 挂到一个（通常零高的）元素上，它进入视口时调用 onHit。
 *
 *  设计要点：
 *  - `onHit` 只作为「最新值」读取（存 ref），避免每次渲染生成的新函数导致 observer 反复重连；
 *    因此调用方不必把 onHit 包 useCallback，也不会因为 results 变化就重建 observer。
 *  - `enabled` 为 false 时直接断开（正在加载、或已没有更多）。
 *    加载完成后 enabled 变回 true 会重新 observe —— 若哨兵仍在视口内会立刻再次触发，
 *    这正是「滚到底就连续加载」想要的行为。
 *  - rootMargin 提前 300px 触发，滚动到底之前就开始加载，观感更连续。
 */
export function useSentinel(onHit: () => void, enabled: boolean): React.RefObject<HTMLDivElement | null> {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const hitRef = React.useRef(onHit)

  React.useEffect(() => {
    hitRef.current = onHit
  })

  React.useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) hitRef.current()
      },
      { rootMargin: '300px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [enabled])

  return ref
}
