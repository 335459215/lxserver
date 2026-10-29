/** 搜索会话快照（内存模块级，**不持久化到 localStorage**）。
 *
 *  【要解决的问题】用户实测：搜出结果 → 点一首播放 → 从播放页返回，
 *  搜索页变成**全空白**，必须重新搜一遍。歌单/歌手页无此问题，
 *  因为那些页面的数据是从路由参数重新拉取的。
 *
 *  【根因】SearchPage 把 keyword / source / kind / results / phase 全部放在
 *  组件本地 state。React Router 切走路由时组件**卸载**，所有 state 归零；
 *  返回时重新挂载 = 全新实例 = 空态。搜索结果本身是几百 KB 的数组，
 *  重建要重打 5 个上游平台（数秒），用户体感就是「白屏 + 重搜」。
 *
 *  【为什么不放 URL query】结果数组几百 KB，塞 URL 会撑爆历史栈与
 *  浏览器地址栏上限，而且每次翻页都要改 URL（污染后退历史）。
 *
 *  【为什么不用 localStorage】搜索结果是**会话级**的（同 searchHistory 的理由：
 *  搜索结果带时效性，隔天恢复一份昨天的列表会让用户以为搜出来的是新的）。
 *  模块级变量随页面刷新自然清空，语义刚好。
 *
 *  【单例而非 Context 的理由】只有一个消费者（SearchPage），且需要在
 *  **组件卸载之后**仍然存活 —— Context 挂在树上，卸载时就没了。
 *  纯模块变量 + 读写函数最直接，也便于单测（不依赖 React）。
 */

import type { Song } from '@/lib/music'
import type { SingerHit } from '@/lib/discover'

/** 搜索类型：歌曲（默认）或歌手。与 SearchPage 内的 Kind 同构。 */
export type SearchKind = 'song' | 'singer'
export type SearchPhase = 'idle' | 'loading' | 'done' | 'error'

/** 一次搜索的完整可恢复快照。字段与 SearchPage 的渲染 state 一一对应。 */
export interface SearchSnapshot {
  /** 输入框里的词 */
  keyword: string
  /** 已提交搜索的词（结果区标题/重试用） */
  searchedFor: string
  source: string
  kind: SearchKind
  phase: SearchPhase
  results: Song[]
  singers: SingerHit[]
  error: string | null
  hasMore: boolean
  /** 离开页面时的滚动位置（px）。返回后回到原处 —— 用户点了列表第 30 首，
   *  回来却停在页顶，等于还要再滚一遍才找得到刚才听的那首。 */
  scrollY: number
  /** 快照生成时间（ms），仅用于诊断/将来加过期策略 */
  savedAt: number
}

let snapshot: SearchSnapshot | null = null

/** 读回上次搜索快照；没有则 null。 */
export function loadSearchSnapshot(): SearchSnapshot | null {
  return snapshot
}

/** 覆盖式保存（每次搜索状态变化都调用，保留最近一次）。 */
export function saveSearchSnapshot(s: Omit<SearchSnapshot, 'savedAt'>): void {
  snapshot = { ...s, savedAt: Date.now() }
}

/** 只更新滚动位置（离开页面时调用）。
 *
 *  【为什么不跟其他字段一起在渲染 effect 里存】scrollY 在滚动时变化极频繁，
 *  若绑进依赖数组会让快照每次滚动都重写；而它只在**离开那一刻**有意义。
 *  单独一个轻量函数，由卸载清理钩子调用。 */
export function saveSearchScrollY(y: number): void {
  if (snapshot) snapshot.scrollY = y
}

/** 显式清空（用户主动清空搜索/退出登录时）。 */
export function clearSearchSnapshot(): void {
  snapshot = null
}

/** 这份快照是否值得恢复。
 *
 *  【为什么不恢复 loading 态】离开页面时正在搜，回来时那个请求早被
 *  AbortController 取消了 —— 恢复一个永远转圈的骨架屏比空态更糟。
 *  同理 error 态恢复成 done + 原错误也容易让人误以为刚失败。
 *  只恢复「已出结果」与「确认无结果」两种终态。 */
export function isRestorable(s: SearchSnapshot | null): s is SearchSnapshot {
  if (!s) return false
  if (s.phase !== 'done') return false
  if (!s.searchedFor.trim()) return false
  // done 但两项结果都空 = 当时就是「没找到」，也值得恢复（用户能看到搜过什么）
  return true
}
