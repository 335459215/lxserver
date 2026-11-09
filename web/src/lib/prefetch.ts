/** 播放预加载（v2.49.4）：在**当前歌曲还在播**的时候，就把下一首的字节提前抓进播放缓存。
 *
 *  【为什么需要它】现有播放缓存（audioCache.ts）是「播了 15 秒后开始后台下载」——
 *  对**当前这首**是事后诸葛：等它下完，歌已经放完了。于是：
 *    · 每次切歌仍要实时解析 + 边下边播 → 网络一抖就卡；
 *    · 首次听一首歌，全程受实时网速支配。
 *  用户的原话是「不能一直靠实时网速播放，要做提前加载」——缺的正是**下一首**。
 *
 *  【本文件只做决策，不碰网络】真正的抓取在 player.tsx 里（要复用鉴权头、
 *  AbortController 与 existing cache）。这样「什么时候该预取、预取哪一首」
 *  这些容易改错的判断可以直接单测，不必起浏览器。
 *
 *  【三条硬约束（都是血泪）】
 *  1. **随机播放不预取**：`advance()` 用 `Math.random()` 选下一首，
 *     预取的那首大概率不是真正要播的那首 —— 白耗流量，还会把缓存挤掉。
 *  2. **省流模式不预取**：`navigator.connection.saveData` 或 2G/3G 网络下，
 *     预取会跟当前播放抢带宽，反而让当前这首卡（与目的相反）。
 *  3. **同一时间只允许一个预取任务**：并发预取两首会平均分配带宽，
 *     结果是谁都下不完、切歌时一首都没命中。
 */

import type { Song } from './music'

/** 预取所需的运行时环境（从浏览器采集后传进来，便于单测构造） */
export interface PrefetchEnv {
  /** 设置里的「播放缓存」开关；关掉时整条预取链路不工作 */
  cacheEnabled: boolean
  /** `navigator.connection.saveData` */
  saveData?: boolean
  /** `navigator.connection.effectiveType`，如 '4g' / '3g' / '2g' / 'slow-2g' */
  effectiveType?: string
  /** 队列长度 */
  queueLength: number
  /** 当前下标 */
  index: number
  /** 是否随机播放 */
  shuffle: boolean
  /** 循环模式：单曲循环时下一首还是这首，预取无意义 */
  repeat: 'off' | 'all' | 'one'
  /** 是否已有预取任务在跑 */
  busy: boolean
  /** 是否在线；离线时不预取（必然失败，只浪费一次请求） */
  online: boolean
}

/**
 * 下一首"按顺序"会播的是哪一首。
 *
 * 与 `advance(1, true)` 的取值保持一致（自然播完时的行为）：
 *  · 单曲循环 → 还是这一首（调用方据此跳过预取）；
 *  · 到末尾 + 不循环 → 没有下一首；
 *  · 到末尾 + 列表循环 → 回到第 0 首。
 *
 * 随机播放下**不预测**（返回 null），理由见文件头。
 */
export function nextSongForPrefetch(
  queue: Song[],
  index: number,
  opts: { shuffle: boolean; repeat: 'off' | 'all' | 'one' },
): Song | null {
  if (opts.shuffle) return null
  if (opts.repeat === 'one') return null
  const len = queue.length
  if (len === 0) return null
  if (index < 0 || index >= len) return null
  const nextIdx = index + 1
  if (nextIdx >= len) {
    if (opts.repeat === 'off') return null
    return queue[0] ?? null
  }
  return queue[nextIdx] ?? null
}

/** 现在该不该发起预取。返回 false 的每一种情况都在注释里写明原因。 */
export function shouldPrefetch(env: PrefetchEnv): boolean {
  if (!env.cacheEnabled) return false      // 用户关掉了播放缓存
  if (!env.online) return false            // 离线：请求必然失败
  if (env.saveData) return false           // 省流模式：尊重用户的选择
  if (env.busy) return false               // 已有任务在跑，避免互相抢带宽
  if (env.queueLength < 2) return false    // 只有一首，没有"下一首"
  if (env.shuffle) return false            // 随机：预测不了
  if (env.repeat === 'one') return false   // 单曲循环：下一首还是自己
  const t = (env.effectiveType || '').toLowerCase()
  if (t === 'slow-2g' || t === '2g') return false
  if (t === '3g') return false             // 3G 下预取会拖慢当前播放，得不偿失
  return true
}

/**
 * 什么时候开始预取。
 *
 * 【为什么要等一会儿】刚点下播放的那几秒，当前歌曲正在**抢首字节**。
 * 这时立刻并发一条整曲下载，会把带宽分走一半，直接造成"刚点就卡"。
 * 等当前曲进入稳定播放（默认 8 秒）再开始，用户通常已经在听副歌了，
 * 余下几十秒足够把下一首下完（常见 4G 下 4MB 的 320k 约 2~4 秒）。
 */
export const PREFETCH_START_DELAY_MS = 8000

/** 预取是否"还来得及"：距离当前曲结束不足 safetySec 时不启动新任务（避免下到一半切歌）。 */
export function hasEnoughTimeLeft(
  durationSec: number,
  positionSec: number,
  safetySec = 20,
): boolean {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return false
  return durationSec - positionSec >= safetySec
}
