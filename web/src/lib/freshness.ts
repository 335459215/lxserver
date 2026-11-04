/** 首页「排行榜 / 今日热播」的数据陈旧度判定（纯函数，单测直接 import）。
 *
 *  【为什么阈值是 5 分钟】与服务端排行榜内存缓存 TTL 对齐（leaderboardCache.ts 默认
 *  5*60*1000，响应头也是 max-age=300）：短于它的请求就算发了，服务端也会直接返回
 *  缓存里的旧数据，SW 的 30 分钟 stale-while-revalidate 更是原样返回 —— 发了也白发。
 *  超过它才有「可能拿到新数据」的价值，此时才值得发起一次（强刷）请求。
 *
 *  与 curatedCovers.ts 的「按天刷新」是两套机制：那边管日更型内容（今日甄选封面），
 *  这边管半实时内容（榜单歌曲）。场景电台是静态入口，两边都不需要。
 */
import type { StorageLike } from './curatedCovers'

/** 榜单数据超过这么久没更新就该刷新（毫秒） */
export const LEADERBOARD_STALE_MS = 5 * 60 * 1000

/** 首页榜单数据的「上次就绪时间」存储键（lx.* 前缀，与全库约定一致） */
export const LEADERBOARD_FETCHED_AT_KEY = 'lx.dashboard.leaderboardFetchedAt'

/** 数据是否已陈旧。
 *
 *  三种情况一律算陈旧：从未记录过、值不是数、时钟被回拨过（lastFetchedAt > now）。
 *  时钟回拨时不能当成「刚刷新过」——那会让用户在这一轮里永远看不到新数据。 */
export function isStale(
  lastFetchedAt: number | null | undefined,
  now: number,
  ttlMs: number = LEADERBOARD_STALE_MS,
): boolean {
  if (typeof lastFetchedAt !== 'number' || !Number.isFinite(lastFetchedAt) || lastFetchedAt <= 0) {
    return true
  }
  if (now <= lastFetchedAt) return true
  return now - lastFetchedAt > ttlMs
}

/** 读「上次就绪时间」。存储不可用（隐私模式等）时返回 null —— 调用方按陈旧处理。 */
export function readTimestamp(store: StorageLike | null | undefined, key: string): number | null {
  if (!store || !key) return null
  try {
    const raw = store.getItem(key)
    if (!raw) return null
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

/** 写「上次就绪时间」。失败静默：最坏后果是多刷一次，不该为记时间戳弹错误。 */
export function writeTimestamp(store: StorageLike | null | undefined, key: string, at: number): void {
  if (!store || !key || !Number.isFinite(at)) return
  try {
    store.setItem(key, String(Math.floor(at)))
  } catch {
    /* 隐私模式/配额满：不影响功能本身 */
  }
}
