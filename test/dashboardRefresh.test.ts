/**
 * 首页三区块的刷新机制（v2.45）。
 *
 *  1. 今日甄选歌单 —— 日更型：跨过刷新点（默认 6:00）才换一批封面；
 *  2. 排行榜 / 今日热播 —— 半实时型：数据超过 5 分钟（服务端缓存 TTL）才值得刷；
 *  3. 场景电台 —— 静态型：没有数据，无需机制（这里无可测项）。
 *
 * 这里守住的承诺：
 *  - 阈值与 TTL 对齐：短于 TTL 的「刷新」只会拿回旧数据，判定必须能识别这种无效刷新；
 *  - 按天判定以 6:00 为界：深夜刷首页的人看到的仍是「今天」那一批；
 *  - 存储任何一步坏掉（隐私模式 / 配额满 / 脏数据）都不能抛异常，只降级。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CURATED_REFRESH_DAY_STORAGE_KEY,
  CURATED_REFRESH_HOUR,
  curatedCoverCacheKey,
  curatedRefreshDayKey,
  forgetAllCuratedCovers,
  readCuratedRefreshDay,
  shouldRefreshDailyCovers,
  writeCuratedRefreshDay,
  type StorageLike,
} from '../web/src/lib/curatedCovers.ts'
import {
  LEADERBOARD_FETCHED_AT_KEY,
  LEADERBOARD_STALE_MS,
  isStale,
  readTimestamp,
  writeTimestamp,
} from '../web/src/lib/freshness.ts'

function memStore(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

// ===== 今日甄选：按天刷新 =====

test('刷新日以 6:00 为界：5 点算前一天，6 点算当天', () => {
  // 2026-11-04 05:59:59 本地时间
  const beforeSix = new Date(2026, 10, 4, 5, 59, 59).getTime()
  const atSix = new Date(2026, 10, 4, 6, 0, 0).getTime()
  assert.equal(curatedRefreshDayKey(beforeSix), '2026-11-03')
  assert.equal(curatedRefreshDayKey(atSix), '2026-11-04')
})

test('跨月 / 跨年边界回退一天', () => {
  const monthEdge = new Date(2026, 10, 1, 2, 0, 0).getTime() // 11月1日 凌晨2点
  assert.equal(curatedRefreshDayKey(monthEdge), '2026-10-31')
  const yearEdge = new Date(2026, 0, 1, 1, 0, 0).getTime() // 1月1日 凌晨1点
  assert.equal(curatedRefreshDayKey(yearEdge), '2025-12-31')
})

test('shouldRefreshDailyCovers：从未记录过 / 跨天 → 刷；同一天 → 不刷', () => {
  const now = new Date(2026, 10, 4, 9, 0, 0).getTime()
  assert.equal(shouldRefreshDailyCovers(null, now), true)
  assert.equal(shouldRefreshDailyCovers('', now), true)
  assert.equal(shouldRefreshDailyCovers('2026-11-04', now), false)
  assert.equal(shouldRefreshDailyCovers('2026-11-03', now), true)
  // 凌晨 5 点：昨天 23 点记的「2026-11-03」仍算当天内容，不该刷
  const earlyMorning = new Date(2026, 10, 4, 5, 0, 0).getTime()
  assert.equal(shouldRefreshDailyCovers('2026-11-03', earlyMorning), false)
})

test('刷新日存取：写 → 读 roundtrip；脏值与抛异常的存储都降级', () => {
  const store = memStore()
  const now = new Date(2026, 10, 4, 8, 0, 0).getTime()
  writeCuratedRefreshDay(store, now)
  assert.equal(readCuratedRefreshDay(store), '2026-11-04')
  assert.equal(store.map.has(CURATED_REFRESH_DAY_STORAGE_KEY), true)

  store.setItem(CURATED_REFRESH_DAY_STORAGE_KEY, '   ')
  assert.equal(readCuratedRefreshDay(store), null)

  const hostile: StorageLike = {
    getItem() {
      throw new Error('隐私模式')
    },
    setItem() {
      throw new Error('隐私模式')
    },
    removeItem() {},
  }
  assert.equal(readCuratedRefreshDay(hostile), null)
  assert.doesNotThrow(() => writeCuratedRefreshDay(hostile, now))
})

test('forgetAllCuratedCovers 整批作废并报告张数；空存储 / 脏目标不炸', () => {
  const store = memStore()
  // 用导出的键构造器而不是硬编码 `:v1:` —— 缓存版本一 bump（v1→v2 换过词池），
  // 硬编码的测试就会误报「没删掉」，掩盖真正的回归。
  store.setItem(curatedCoverCacheKey('radar'), '{"url":"https://cdn/a.jpg","at":1}')
  store.setItem(curatedCoverCacheKey('pop'), '{"url":"https://cdn/b.jpg","at":1}')

  const removed = forgetAllCuratedCovers(store, [
    { id: 'radar', query: '经典' },
    { id: 'pop', query: '流行' },
  ])
  assert.equal(removed, 2)
  assert.equal(store.map.size, 0)
  assert.equal(forgetAllCuratedCovers(null, [{ id: 'x', query: 'y' }]), 0)
})

// ===== 排行榜：陈旧度判定 =====

test('陈旧度阈值 = 5 分钟（与服务端缓存 TTL 对齐）', () => {
  assert.equal(LEADERBOARD_STALE_MS, 5 * 60 * 1000)
})

test('isStale：从未记录 / 非数 / 时钟回拨 → 陈旧；TTL 内 → 新鲜', () => {
  const now = 10_000_000
  assert.equal(isStale(null, now), true)
  assert.equal(isStale(undefined, now), true)
  assert.equal(isStale(0, now), true)
  assert.equal(isStale(Number.NaN, now), true)
  assert.equal(isStale(now - LEADERBOARD_STALE_MS, now), false) // 正好 5 分钟不算过期
  assert.equal(isStale(now - LEADERBOARD_STALE_MS - 1, now), true)
  // 时钟被往回拨（用户改系统时间）：不能当成「刚刷新过」
  assert.equal(isStale(now + 60_000, now), true)
})

test('时间戳存取：roundtrip、向下取整、非有限值不写、坏存储静默', () => {
  const store = memStore()
  writeTimestamp(store, LEADERBOARD_FETCHED_AT_KEY, 1234.9)
  assert.equal(readTimestamp(store, LEADERBOARD_FETCHED_AT_KEY), 1234)

  store.setItem(LEADERBOARD_FETCHED_AT_KEY, 'oops')
  assert.equal(readTimestamp(store, LEADERBOARD_FETCHED_AT_KEY), null)
  assert.equal(readTimestamp(store, 'lx.missing'), null)

  assert.doesNotThrow(() => writeTimestamp(store, LEADERBOARD_FETCHED_AT_KEY, Number.NaN))
  const hostile: StorageLike = {
    getItem() {
      throw new Error('隐私模式')
    },
    setItem() {
      throw new Error('隐私模式')
    },
    removeItem() {},
  }
  assert.equal(readTimestamp(hostile, LEADERBOARD_FETCHED_AT_KEY), null)
  assert.doesNotThrow(() => writeTimestamp(hostile, LEADERBOARD_FETCHED_AT_KEY, 1))
})

test('默认刷新时刻是 6 点（改这一个值就能整体调整日切点）', () => {
  assert.equal(CURATED_REFRESH_HOUR, 6)
})
