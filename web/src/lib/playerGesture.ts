/**
 * 播放页手势判定（纯函数，便于单测）
 *
 * 为什么要单独抽出来：手势这类「阈值 + 多条件」的逻辑写在组件里很难测，
 * 而阈值又最容易在后续改动里被无意破坏（比如把 1.5 倍改成 1.2 倍，
 * 垂直播放列表就会开始误切 Tab）。抽出来后用单测把边界钉死。
 *
 * 判定规则（与 Plex / 飞牛 一致）：
 *   · 左右滑（水平位移明显大于垂直）→ 切换「歌词 ↔ 播放队列」
 *   · 展开态下往下滑 → 收起回封面
 *   · 其余（含纯垂直滑动）→ 不处理，交给原生滚动
 */

/** 水平位移超过这个值才算「切换 Tab」 */
export const SWIPE_X_MIN = 55
/** 垂直位移超过这个值才算「收起」 */
export const SWIPE_Y_MIN = 60
/** 主轴位移必须是次轴的这么多倍，避免斜着划时误判 */
export const SWIPE_AXIS_RATIO = 1.5
/** 手势超过这个时长就不算滑动了（慢慢拖动不该触发） */
export const SWIPE_MAX_MS = 800

export type SwipeAction = 'queue' | 'lyric' | 'collapse' | null

export function decideSwipe(input: {
  dx: number
  dy: number
  durationMs: number
  lyricsExpanded: boolean
}): SwipeAction {
  const { dx, dy, durationMs, lyricsExpanded } = input
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)

  // 太慢：用户是在拖，不是在滑
  if (durationMs > SWIPE_MAX_MS) return null

  // 水平优先：向左（dx<0）去队列，向右回歌词
  if (adx >= SWIPE_X_MIN && adx > ady * SWIPE_AXIS_RATIO) {
    return dx < 0 ? 'queue' : 'lyric'
  }

  // 垂直：只有「已展开」时向下滑才收起；向上滑刻意不处理，
  // 因为歌词本身要能上下滚动，上滑交给原生。
  if (ady >= SWIPE_Y_MIN && ady > adx * SWIPE_AXIS_RATIO && dy > 0 && lyricsExpanded) {
    return 'collapse'
  }

  return null
}
