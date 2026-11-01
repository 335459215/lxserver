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
/** 缓存有效期：7 天。封面是「某首歌的海报」，不会天天变；过期后下次进首页重取。 */
export const CURATED_COVER_TTL_MS = 7 * 24 * 60 * 60 * 1000
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
  let raw: string | null = null
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
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = () => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener?.('abort', done)
      resolve()
    }
    timer = setTimeout(done, ms)
    signal?.addEventListener?.('abort', done, { once: true })
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
