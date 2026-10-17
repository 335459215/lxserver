/**
 * staticCache.ts — 静态资源内容缓存（D-007）。
 *
 * 【为什么要它】
 * `serveStatic` 原先每个请求都 `fs.readFile` + （对文本）`gzip`。
 * NAS 的弱 CPU 上，707KB 的 bundle 每次重压 30~80ms，并发时直接吃掉 CPU 预算；
 * 即便命中构建期预压缩（.br/.gz 兄弟文件），也仍是每次 `stat` + `readFile` 两趟磁盘 IO。
 * 这些文件在**两次发版之间是只读的**，内容不会变，重复读毫无意义。
 *
 * 【三个必须做对的地方】（这类缓存翻车几乎都在这三点）
 *
 * 1. **必须有界**。缓存键是绝对路径，而路径来自 HTTP 请求 → 攻击者可以构造
 *    大量不存在的路径把内存撑爆（缓存穿透）。这里用 LRU + 字节上限双重约束，
 *    并且**只缓存 stat 成功的文件**，不存在的一律不写缓存。
 *
 * 2. **必须能被发版失效**。判断"内容有没有变"不能只看 key 存不存在，
 *    必须带上 `mtime` 与 `size`：镜像更新后同名文件（如 `app.js` 不带哈希）
 *    内容变了而路径没变，只按 key 命中会**永远发旧内容**。
 *    这里把 `{mtimeMs, size}` 作为缓存条目的"版本指纹"，不匹配就重新读。
 *
 * 3. **必须区分压缩表示**。`index.js` 与 `index.js.gz` 是两份不同字节，
 *    缓存键必须包含编码变体，否则把 gzip 字节当成原文发出去（或反之）——
 *    表现为浏览器白屏/乱码，且只在特定 Accept-Encoding 下复现，极难排查。
 *
 * 另外做了 **in-flight 去重**：并发请求同一个冷文件时只读一次盘，
 * 其余等待同一个 Promise。否则冷启动瞬间 N 个并发请求 = N 次读盘 + N 次压缩。
 */

export interface CachedEntry {
  /** 文件内容（原文，或预压缩的 .gz/.br 字节） */
  body: Buffer
  /** 版本指纹：任一变化即视为失效 */
  mtimeMs: number
  size: number
  /** 该条目占用字节数（用于总量控制；body 之外还有键与对象的固定开销） */
  bytes: number
}

export interface StaticCacheOptions {
  /** 最多缓存多少字节。默认 64MB —— 本项目 public/ 共 5.6MB，留足余量 */
  maxBytes?: number
  /** 最多缓存多少个条目 */
  maxEntries?: number
  /** 单个条目上限。默认 8MB：`music/bin/fpcalc.exe` 这类大二进制只服务一次，
   *  缓存它会把真正热点的 bundle 挤出去，得不偿失。 */
  maxEntryBytes?: number
  /** 可注入时钟（测试用） */
  now?: () => number
}

export interface StaticCacheStats {
  entries: number
  bytes: number
  hits: number
  misses: number
  evictions: number
  /** 因文件变更而失效的次数（发版后应 > 0） */
  invalidations: number
  /** 命中率，便于判断缓存是否真的起作用 */
  hitRate: number
}

/** Map 的插入顺序即 LRU 顺序：命中时 delete + set 把它移到末尾。 */
export function createStaticCache(options: StaticCacheOptions = {}) {
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024
  const maxEntries = options.maxEntries ?? 512
  const maxEntryBytes = options.maxEntryBytes ?? 8 * 1024 * 1024

  const entries = new Map<string, CachedEntry>()
  /** 冷文件并发去重：key → 正在进行的读取 */
  const inflight = new Map<string, Promise<CachedEntry | null>>()

  let bytes = 0
  let hits = 0
  let misses = 0
  let evictions = 0
  let invalidations = 0

  /** 条目实际占用的估算字节：内容 + 键长 + 对象固定开销。
   *  只算 body.length 会严重低估（500 个小文件时开销占大头）。 */
  const costOf = (key: string, body: Buffer) => body.length + key.length * 2 + 128

  const touch = (key: string, entry: CachedEntry) => {
    // 移到 Map 末尾 = 最近使用
    entries.delete(key)
    entries.set(key, entry)
  }

  const evictUntilFits = (incoming: number) => {
    // 先按条目数淘汰
    while (entries.size > 0 && entries.size >= maxEntries) {
      const oldestKey = entries.keys().next().value as string
      remove(oldestKey)
    }
    // 再按字节数淘汰（可能淘汰多个）
    while (bytes + incoming > maxBytes && entries.size > 0) {
      const oldestKey = entries.keys().next().value as string
      remove(oldestKey)
    }
  }

  const remove = (key: string) => {
    const e = entries.get(key)
    if (!e) return
    bytes -= e.bytes
    entries.delete(key)
    evictions++
  }

  /** 取缓存条目；`stat` 与条目记录的指纹不一致则视为失效（发版场景）。
   *  返回 null 表示未命中，调用方应自行读盘后 `set`。 */
  const get = (key: string, stat: { mtimeMs: number, size: number }): CachedEntry | null => {
    const e = entries.get(key)
    if (!e) {
      misses++
      return null
    }
    if (e.mtimeMs !== stat.mtimeMs || e.size !== stat.size) {
      // 文件变了（发版/热更新）—— 旧条目必须丢弃，否则会一直发旧内容
      invalidations++
      misses++
      remove(key)
      return null
    }
    hits++
    touch(key, e)
    return e
  }

  const set = (key: string, body: Buffer, stat: { mtimeMs: number, size: number }) => {
    // 超大文件不缓存：一是单个条目就超总上限时会把有用的全淘汰掉，
    // 二是 fpcalc 这类大二进制只被服务一次，留在内存里纯属浪费。
    if (body.length > maxEntryBytes) return null
    const cost = costOf(key, body)
    if (cost > maxBytes) return null
    const existing = entries.get(key)
    if (existing) {
      bytes -= existing.bytes
      entries.delete(key)
    }
    evictUntilFits(cost)
    const entry: CachedEntry = { body, mtimeMs: stat.mtimeMs, size: stat.size, bytes: cost }
    entries.set(key, entry)
    bytes += cost
    return entry
  }

  /** 并发去重包装：同一个 key 的并发冷读只真正执行一次 `loader`。 */
  const load = async (
    key: string,
    stat: { mtimeMs: number, size: number },
    loader: () => Promise<Buffer | null>,
  ): Promise<CachedEntry | null> => {
    const cached = get(key, stat)
    if (cached) return cached

    const pending = inflight.get(key)
    if (pending) return pending

    const task = (async () => {
      try {
        const body = await loader()
        if (body == null) return null
        return set(key, body, stat)
      } finally {
        inflight.delete(key)
      }
    })()

    inflight.set(key, task)
    return task
  }

  const clear = () => {
    entries.clear()
    inflight.clear()
    bytes = 0
  }

  const stats = (): StaticCacheStats => {
    const total = hits + misses
    return {
      entries: entries.size,
      bytes,
      hits,
      misses,
      evictions,
      invalidations,
      hitRate: total === 0 ? 0 : hits / total,
    }
  }

  return { get, set, load, clear, stats, has: (key: string) => entries.has(key) }
}

export type StaticCache = ReturnType<typeof createStaticCache>

/** 进程级单例。测试请直接 `createStaticCache()` 造独立实例，不要共享它。 */
export const staticCache: StaticCache = createStaticCache()
