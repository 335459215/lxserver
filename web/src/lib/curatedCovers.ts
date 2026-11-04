/** 「今日甄选」6 张卡的封面获取与缓存（v2.44.0 ②）。
 *
 *  【要解决的问题】
 *  `Dashboard.tsx` 的 `CuratedMix` 只有 `gradient` + `badgeColor`，卡片上画的是渐变
 *  + `<Disc3>` 黑胶图标，**本来就没有图**。用户要求「取歌单里第一首歌的海报做封面，
 *  必须有封面」。拍板做法：首页加载时为每张卡各搜一首（只查网易云 `wy`，省流量），
 *  用 `coverUrl()` 归一化封面地址。
 *
 *  【三条必须守住的约束】
 *  1. **绝不阻塞首屏**：本模块不参与渲染路径；调用方在 `useEffect` 里 `void` 掉返回值，
 *     搜到的封面通过 `onCover` 增量回调，单张卡的成败互不影响，失败一律静默。
 *  2. **绝不裂图**：`pickCoverFromSongs` 只接受「可安全放进 `<img src>`」的地址
 *     （https / 相对路径，**拒绝明文 http**，避免 HTTPS 页面 Mixed Content）；
 *     拿不到就返回 undefined，调用方回落现有渐变，永不留白。
 *  3. **缓存要能失效**：localStorage 键带版本前缀（`...:v1:<id>`），并写入时间戳做 TTL；
 *     发版想换一批封面时只改 `CURATED_COVER_CACHE_VERSION` 即可，不必清用户存储。
 *
 *  【为什么零 `@/` 别名依赖】
 *  仓库约定：单测（`npx tsx --test`）直接 import 的模块不能依赖 `@/`（tsx 解析不到 web 的 alias）。
 *  所以这里只用**相对路径**引 `./coverUrl`，与 `coverUrl.ts` / `songIdentity.ts` 同一套路。
 *
 *  ⚠️ 单测不要 import `@/lib/music`：搜索函数由调用方注入（`CoverSearch`），本模块不碰网络实现。
 */

import { coverUrl, type CoverSource } from './coverUrl'

/** localStorage 键前缀（含版本号，便于整体失效） */
export const CURATED_COVER_CACHE_PREFIX = 'lxserver:curatedCovers'
/** 缓存版本：换封面来源/归一化规则时 +1 即可让所有客户端重新取图 */
export const CURATED_COVER_CACHE_VERSION = 'v1'
/** 缓存有效期：7 天。封面是「某首歌的海报」，不会天天变；过期后下次进首页重取。
 *
 *  【为什么 TTL 之外还要有「按天刷新」】甄选卡卖的就是「今日」两个字 ——
 *  网易云的「每日推荐」每天重置一次（官方 FAQ 原话），用户对「每日」类内容的
 *  心理预期就是跨天要换。7 天 TTL 只是兜底（图床挂了/脏数据），真正决定
 *  「今天该不该换一批封面」的是下面的 CURATED_REFRESH_HOUR 按天判定。 */
export const CURATED_COVER_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** 每日刷新的时刻（小时，0-23）。对齐音乐大厂「每日推荐」凌晨 6 点更新的惯例：
 *  6 点前仍算前一天的内容，6 点后跨入新的一天。改这一个值就能整体调整。 */
export const CURATED_REFRESH_HOUR = 6
/** 「上次刷新日」的存储键（与封面缓存同前缀，整体失效时一起清） */
export const CURATED_REFRESH_DAY_STORAGE_KEY = `${CURATED_COVER_CACHE_PREFIX}:refreshDay`
/** 允许的时钟偏差：条目时间戳比本机时间还晚这么多以上，视为脏数据丢弃（改过系统时间） */
const CLOCK_SKEW_MS = 5 * 60 * 1000

/** 一张甄选卡需要封面时必备的信息（`CuratedMix` 结构上兼容它） */
export interface CuratedCoverTarget {
  id: string
  query: string
}

/** 只用到这三个方法的存储形状（`Storage` / 测试用的内存实现都满足） */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** 注入的搜索实现：返回该关键词的曲目列表（元素形状只需兼容 `coverUrl`） */
export type CoverSearch = (query: string, signal?: AbortSignal) => Promise<unknown[]>

/** 该卡的 localStorage 键 */
export function curatedCoverCacheKey(id: string): string {
  return `${CURATED_COVER_CACHE_PREFIX}:${CURATED_COVER_CACHE_VERSION}:${id}`
}

/** 这个地址能不能直接塞进 `<img src>`。
 *
 *  明文 `http://` 必须拒绝 —— 线上页面是 HTTPS，放进去就是 Mixed Content（v2.43.0 刚修过一轮）。
 *  `data:` 只放行 `data:image/`，避免把 `data:text/html` 这类东西当图片地址。 */
export function isUsableCoverUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  const u = url.trim()
  if (!u) return false
  if (/^http:\/\//i.test(u)) return false
  return (
    /^https:\/\//i.test(u) ||
    u.startsWith('//') ||
    u.startsWith('/') ||
    u.startsWith('data:image/') ||
    u.startsWith('blob:')
  )
}

/** 从搜索结果里挑第一张可用封面（`coverUrl` 已把已知图床升级成 https）。 */
export function pickCoverFromSongs(songs: unknown): string | undefined {
  if (!Array.isArray(songs)) return undefined
  for (const song of songs) {
    const url = coverUrl(song as CoverSource | null)
    if (isUsableCoverUrl(url)) return url.trim()
  }
  return undefined
}

/** 浏览器 localStorage；隐私模式/禁用 Cookie 时访问会抛异常，一律降级成「没有存储」。 */
export function getBrowserStorage(): StorageLike | undefined {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return undefined
    return localStorage
  } catch {
    return undefined
  }
}

function removeQuietly(store: StorageLike, key: string): void {
  try {
    store.removeItem(key)
  } catch {
    /* 存储不可用（配额/隐私模式）——缓存不是功能本身，失败就算了 */
  }
}

/** 读缓存的封面。返回 undefined 的四种情况：没存、解析失败、过期、地址不可用。 */
export function readCuratedCover(
  store: StorageLike | null | undefined,
  id: string,
  now: number = Date.now(),
  ttlMs: number = CURATED_COVER_TTL_MS,
): string | undefined {
  if (!store || !id) return undefined
  const key = curatedCoverCacheKey(id)
  // 不写 `= null` 初值：下面 try 里必然赋值，catch 里直接 return，
  // 初值永远读不到 —— ESLint no-useless-assignment 会指出来。
  let raw: string | null
  try {
    raw = store.getItem(key)
  } catch {
    return undefined
  }
  if (!raw) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    removeQuietly(store, key)
    return undefined
  }
  const record = parsed as { url?: unknown; at?: unknown } | null
  if (!record || typeof record !== 'object') {
    removeQuietly(store, key)
    return undefined
  }
  if (!isUsableCoverUrl(record.url) || typeof record.at !== 'number' || !Number.isFinite(record.at)) {
    removeQuietly(store, key)
    return undefined
  }
  if (record.at > now + CLOCK_SKEW_MS || now - record.at > ttlMs) {
    // 时间戳来自未来（改过系统时间）或已过期 —— 丢掉，让调用方重新取
    removeQuietly(store, key)
    return undefined
  }
  return record.url.trim()
}

/** 写缓存。地址不可用就不写（宁可下次重搜，也不缓存一个会裂图的地址）。 */
export function writeCuratedCover(
  store: StorageLike | null | undefined,
  id: string,
  url: string,
  now: number = Date.now(),
): boolean {
  if (!store || !id || !isUsableCoverUrl(url)) return false
  try {
    store.setItem(curatedCoverCacheKey(id), JSON.stringify({ url: url.trim(), at: now }))
    return true
  } catch {
    return false
  }
}

/** 丢弃某张卡的缓存（图片加载失败时调用，下次进首页会重搜）。 */
export function forgetCuratedCover(store: StorageLike | null | undefined, id: string): void {
  if (!store || !id) return
  removeQuietly(store, curatedCoverCacheKey(id))
}

/** 丢弃一批卡的缓存（跨天刷新时整批作废，让首页重新搜图）。返回实际丢弃的张数。 */
export function forgetAllCuratedCovers(
  store: StorageLike | null | undefined,
  targets: readonly CuratedCoverTarget[],
): number {
  if (!store || !Array.isArray(targets)) return 0
  let count = 0
  for (const target of targets) {
    if (!target?.id) continue
    forgetCuratedCover(store, target.id)
    count++
  }
  return count
}

/** 当前时刻所属的「刷新日」键（YYYY-MM-DD）。
 *  以 CURATED_REFRESH_HOUR 为界：凌晨 6 点前算前一天，6 点后算当天 ——
 *  深夜刷首页的人看到的仍是「今天」那一批，不会被凌晨悄悄换掉。 */
export function curatedRefreshDayKey(
  now: number,
  refreshHour: number = CURATED_REFRESH_HOUR,
): string {
  const d = new Date(now)
  if (d.getHours() < refreshHour) d.setDate(d.getDate() - 1)
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 该不该按天刷新：上次刷新日 != 当前刷新日 → 该刷。
 *  从未记录过（null）也返回 true：宁可多刷一次，也不能让「今日」名不副实。 */
export function shouldRefreshDailyCovers(
  lastDay: string | null | undefined,
  now: number,
  refreshHour: number = CURATED_REFRESH_HOUR,
): boolean {
  if (!lastDay) return true
  return lastDay !== curatedRefreshDayKey(now, refreshHour)
}

export function readCuratedRefreshDay(store: StorageLike | null | undefined): string | null {
  if (!store) return null
  try {
    const raw = store.getItem(CURATED_REFRESH_DAY_STORAGE_KEY)
    return raw && raw.trim() ? raw : null
  } catch {
    return null
  }
}

/** 写入「今天已刷新」。任何写入失败都静默 —— 最坏后果是下次进首页多刷一次封面。 */
export function writeCuratedRefreshDay(
  store: StorageLike | null | undefined,
  now: number,
  refreshHour: number = CURATED_REFRESH_HOUR,
): void {
  if (!store) return
  try {
    store.setItem(CURATED_REFRESH_DAY_STORAGE_KEY, curatedRefreshDayKey(now, refreshHour))
  } catch {
    /* 隐私模式/配额满：不影响功能本身 */
  }
}

/** 同步读出所有已缓存的封面（用于首帧直接渲染，避免等网络）。 */
export function readCuratedCovers(
  store: StorageLike | null | undefined,
  targets: readonly CuratedCoverTarget[],
  now: number = Date.now(),
  ttlMs: number = CURATED_COVER_TTL_MS,
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!store) return out
  for (const target of targets) {
    const url = readCuratedCover(store, target.id, now, ttlMs)
    if (url) out[target.id] = url
  }
  return out
}

export interface CuratedCoverFetchOptions {
  /** 搜索实现（调用方注入，通常是 `searchMusic({ source: 'wy' })` 的包装） */
  search: CoverSearch
  /** 缓存用的存储；不传 = 不缓存 */
  store?: StorageLike | null
  /** 可注入时钟（测试用） */
  now?: () => number
  ttlMs?: number
  /** 取消信号：组件卸载时 abort，已发出的请求不再回写 state */
  signal?: AbortSignal
  /** 并发上限，默认 2 —— 6 张卡不抢首屏带宽，也不至于排队排到天荒地老 */
  concurrency?: number
  /** 每个并发槽的启动错峰（毫秒），默认 150；0 = 一起发 */
  staggerMs?: number
  /** 每搜到一张就回调一次（增量渲染），不等 6 张全回来 */
  onCover?: (id: string, url: string) => void
  /** 可注入延时（测试用，避免真的 sleep） */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) {
      resolve()
      return
    }
    // 【为什么用 const + 函数声明】原写法是 `let timer` + 后置赋值，只赋值一次，
    // ESLint prefer-const 会报；但直接改成 const 又变成 done 里「读在声明前」。
    // 用函数声明（会提升）+ const 句柄，两边都干净：onAbort 只可能在
    // setTimeout 之后被调用，那时 timer 一定已初始化。
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

/** 为若干张卡补齐封面：先吃缓存，剩下的按并发上限去搜。
 *
 *  **本函数永不 reject**：任何一张卡搜索失败/超时/没有封面都只是「这张没图」，
 *  调用方照旧渲染渐变。返回值为「最终已知的封面表」（含命中缓存的）。
 */
export async function fetchCuratedCovers(
  targets: readonly CuratedCoverTarget[],
  options: CuratedCoverFetchOptions,
): Promise<Record<string, string>> {
  const covers: Record<string, string> = {}
  const store = options.store ?? null
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs ?? CURATED_COVER_TTL_MS
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 2))
  const staggerMs = Math.max(0, options.staggerMs ?? 150)
  const sleep = options.sleep ?? defaultSleep

  const todo: CuratedCoverTarget[] = []
  for (const target of targets ?? []) {
    if (!target || !target.id || !target.query) continue
    const cached = readCuratedCover(store, target.id, now(), ttlMs)
    if (cached) covers[target.id] = cached
    else todo.push(target)
  }
  if (todo.length === 0) return covers

  let cursor = 0
  const workerCount = Math.min(concurrency, todo.length)
  const runWorker = async (slot: number) => {
    if (slot > 0) await sleep(slot * staggerMs, options.signal)
    for (;;) {
      if (options.signal?.aborted) return
      const index = cursor++
      if (index >= todo.length) return
      const target = todo[index]
      try {
        const songs = await options.search(target.query, options.signal)
        const url = pickCoverFromSongs(songs)
        if (!url) continue // 搜不到 = 回落渐变，绝不裂图
        covers[target.id] = url
        writeCuratedCover(store, target.id, url, now())
        options.onCover?.(target.id, url)
      } catch {
        // 失败静默：搜不到、被 abort、网络抖动都不该在首页弹错误
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, (_, slot) => runWorker(slot)))
  return covers
}
