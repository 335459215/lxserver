/**
 * 排行榜列表的服务端内存短缓存（v2.44.0 ⑤）。
 *
 * 【要解决的问题｜线上实测】切换排行榜每次要等 1-3 秒。反代不开缓存是用户的要求，
 * 而 `/api/music/leaderboard/list` 以前既没有 `Cache-Control`，服务端也没有任何缓存，
 * 于是**每次切换都原样重打上游**。
 *
 * 【为什么单独成文件】`server.ts` 是近 9000 行的入口，import 即起服务，单测没法直接
 * import 它。缓存真正会出错的地方（TTL 判定、容量淘汰、并发去重）抽成纯逻辑后，
 * 就能用 `npx tsx --test` 直接对拍；server.ts 里只剩「取 key → 查缓存 → 回填」。
 *
 * 【为什么还做 in-flight 去重】首屏会同时请求多个榜单（boards + 多个 list），
 * 同一 key 并发打进来时若不去重，等于没缓存 —— 这是缓存最容易被悄悄破掉的地方。
 */

export interface LeaderboardCacheOptions {
  /** 条目有效期（毫秒），默认 5 分钟：与响应头 Cache-Control 的 max-age 对齐 */
  ttlMs?: number
  /** 最多保留多少条（LRU 淘汰），默认 300：source×bangid×page 的合理上限 */
  maxEntries?: number
  /** 可注入时钟（测试用） */
  now?: () => number
}

interface Entry<T> {
  value: T
  expiresAt: number
}

/** 缓存键：必须同时含 source + bangid + page。
 *  少任何一维都会「切了榜单却拿到上一个榜单的歌」——比不缓存更糟。 */
export function leaderboardCacheKey(source: string, bangid: string, page: number): string {
  return `${source}\u0000${bangid}\u0000${page}`
}

export class LeaderboardCache<T = unknown> {
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly now: () => number
  private readonly map = new Map<string, Entry<T>>()
  private readonly inflight = new Map<string, Promise<T>>()

  constructor(options: LeaderboardCacheOptions = {}) {
    const ttlMs = options.ttlMs ?? 5 * 60 * 1000
    const maxEntries = options.maxEntries ?? 300
    this.ttlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 5 * 60 * 1000
    this.maxEntries = Number.isFinite(maxEntries) && maxEntries > 0 ? Math.floor(maxEntries) : 300
    this.now = options.now ?? Date.now
  }

  /** 当前有效条目数（过期条目不算） */
  get size(): number {
    const now = this.now()
    for (const [key, entry] of this.map) {
      if (entry.expiresAt <= now) this.map.delete(key)
    }
    return this.map.size
  }

  get(key: string): T | undefined {
    const hit = this.map.get(key)
    if (!hit) return undefined
    if (hit.expiresAt <= this.now()) {
      this.map.delete(key)
      return undefined
    }
    // 命中即视为「最近使用」：删了再插，Map 的插入顺序就是 LRU 顺序
    this.map.delete(key)
    this.map.set(key, hit)
    return hit.value
  }

  set(key: string, value: T): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, { value, expiresAt: this.now() + this.ttlMs })
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }

  /** 命中直接返回；未命中才调用 loader，并合并同一 key 的并发请求。 */
  async getOrLoad(key: string, loader: () => Promise<T>): Promise<T> {
    const hit = this.get(key)
    if (hit !== undefined) return hit

    const running = this.inflight.get(key)
    if (running) return running

    const task = loader()
      .then((value) => {
        this.set(key, value)
        return value
      })
      .finally(() => {
        // 只清理自己：更晚的请求可能已经替换了同 key 的 in-flight 项
        if (this.inflight.get(key) === task) this.inflight.delete(key)
      })

    this.inflight.set(key, task)
    return task
  }

  /** 强制刷新：无视 TTL 直接打 loader，并用新值替换缓存条目。
   *
   *  【用在哪】首页「刷新」按钮 / 数据陈旧度刷新带了 `force=1` 过来 ——
   *  不绕过的话，5 分钟内的重复刷新拿到的还是旧数据，用户会以为刷新坏了。
   *  刷新成功后顺手 `set`，让后续普通请求立刻吃到新值（TTL 窗口重新计）。 */
  async refresh(key: string, loader: () => Promise<T>): Promise<T> {
    const value = await loader()
    this.set(key, value)
    return value
  }

  clear(): void {
    this.map.clear()
    this.inflight.clear()
  }
}

export function createLeaderboardCache<T = unknown>(
  options: LeaderboardCacheOptions = {},
): LeaderboardCache<T> {
  return new LeaderboardCache<T>(options)
}
