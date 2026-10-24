/** 睡眠定时器（v2.35.0）的纯状态机。
 *
 *  两种模式（与主流播放器一致）：
 *  - endOfSong 播完当前这首就停（单曲循环时也停 —— 「播完这首」的语义
 *    是停止点，不是推进点； Spotify 同款行为）
 *  - after     N 分钟后停（**跨歌继续计时** —— 定的是「睡前还有多久」，
 *    中途切歌不该重置；网易云同款）
 *
 *  为什么是纯函数：到点/播完的触发由播放内核的 timeout / ended 事件负责，
 *  「状态如何迁移」抽成纯逻辑后单测直接覆盖（含变异脚本），
 *  内核只做接线 —— 与 searchPaging / historyStats 同一架构套路。
 */

export type SleepMode = 'off' | 'endOfSong' | 'after'

export interface SleepTimerState {
  mode: SleepMode
  /** 'after' 模式的到期时间戳（ms）；其余为 null */
  endsAt: number | null
  /** 'after' 模式设定的分钟数（恢复/显示用）；其余为 0 */
  minutes: number
}

export const SLEEP_OFF: SleepTimerState = { mode: 'off', endsAt: null, minutes: 0 }

export type SleepAction =
  | { type: 'set'; mode: Exclude<SleepMode, 'off'>; minutes?: number; now: number }
  | { type: 'cancel' }
  /** 一首歌自然播完：仅 endOfSong 被消费（→ off）；after 模式继续计时 */
  | { type: 'songEnded' }
  /** 计时到点（外层 timeout 触发后调用）→ off */
  | { type: 'expire' }

export function applySleepAction(state: SleepTimerState, action: SleepAction): SleepTimerState {
  switch (action.type) {
    case 'set': {
      if (action.mode === 'after') {
        // 分钟数兜底：非法值按 1 分钟算（UI 只会给 15/30/60，这里防的是未来
        // 的调用方传错 —— 静默当 off 会让「以为定了时」的用户睡不着觉被吵醒）
        const minutes = Math.max(1, Math.round(action.minutes ?? 1))
        return { mode: 'after', endsAt: action.now + minutes * 60_000, minutes }
      }
      // 重新设定时必须清掉旧 endsAt —— 状态残留会让「播完即停」模式
      // 误认为还有计时（UI 会显示出不存在的倒计时）
      return { mode: 'endOfSong', endsAt: null, minutes: 0 }
    }
    case 'cancel':
    case 'expire':
      return SLEEP_OFF
    case 'songEnded':
      return state.mode === 'endOfSong' ? SLEEP_OFF : state
  }
}

/** 剩余毫秒；非 after 模式或已到期返回 0（不返回负数 —— UI 不该显示 -00:01） */
export function remainingMs(state: SleepTimerState, now: number): number {
  if (state.mode !== 'after' || state.endsAt == null) return 0
  return Math.max(0, state.endsAt - now)
}

/** 剩余时长显示：MM:SS，超过 1 小时 H:MM:SS */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`
}
