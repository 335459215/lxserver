/** 播放缓存（v2.39.0）：听过的歌缓存进 CacheStorage，重播零解析零下载、断网可放。
 *
 *  【定位】这是**透明缓存**，不是下载管理 —— 不产生文件、不上磁盘目录，
 *  有容量上限（LRU 淘汰最久没听的），设置里一个开关 + 一键清空。
 *  「下载本曲」按钮保持原样（用户有自己的下载整理方案）。
 *
 *  【键设计】缓存键 = 歌曲 songKey + 音质档位（缓存的字节就是那个档位的）。
 *  真实音频 URL 带过期签名、不能当键 —— 用合成请求路径 `/__lxcache__/<key>`
 *  存取，CacheStorage 只当「按键存 Blob 的仓库」用。
 *
 *  【存储抽象】store 注入（真实实现包 caches.open；单测用内存 Map），
 *  LRU/容量策略是纯逻辑 —— 与 sleepTimer / playlistTransfer 同一架构套路。
 *  meta（size/lastUsed/曲目信息）作为一条 JSON Blob 存在同一个仓库里，
 *  淏汰与占用统计都靠它；CacheStorage 自身不提供这些。
 */

/** 注入的键值存储（put 覆盖同键） */
export interface AudioCacheStore {
  put(url: string, blob: Blob): Promise<void>
  match(url: string): Promise<Blob | null>
  delete(url: string): Promise<void>
}

export interface CacheEntryInfo {
  size: number
  /** 上次使用（命中读取也算使用）—— LRU 依据 */
  lastUsed: number
  tier: string
  name: string
  singer: string
}

export interface CacheMeta {
  entries: Record<string, CacheEntryInfo>
}

export const CACHE_STORE_NAME = 'lx-audio-v1'
export const DEFAULT_CAP = 2 * 1024 * 1024 * 1024 // 2GB：无损单曲 30~60MB，够放几十张专辑

const META_URL = '/__lxcache__/__meta__'

export function cacheKey(songKey: string, tier: string): string {
  return `audio|${songKey}|${tier}`
}

function reqUrlOf(key: string): string {
  return `/__lxcache__/${encodeURIComponent(key)}`
}

export interface CacheHit {
  blob: Blob
  tier: string
  name: string
}

export class AudioCache {
  private meta: CacheMeta = { entries: {} }
  private loaded = false

  constructor(
    private readonly store: AudioCacheStore,
    private readonly cap: number = DEFAULT_CAP,
    private readonly now: () => number = Date.now,
  ) {}

  private async loadMeta(): Promise<void> {
    if (this.loaded) return
    const raw = await this.store.match(META_URL)
    if (raw) {
      try {
        const parsed = JSON.parse(await raw.text()) as CacheMeta
        if (parsed && typeof parsed.entries === 'object') this.meta = { entries: parsed.entries }
      } catch {
        this.meta = { entries: {} } // meta 损坏不值得炸 —— 从空开始重建
      }
    }
    this.loaded = true
  }

  private async saveMeta(): Promise<void> {
    await this.store.put(META_URL, new Blob([JSON.stringify(this.meta)], { type: 'application/json' }))
  }

  /** 命中返回 blob 并刷新 lastUsed；未命中返回 null */
  async get(key: string): Promise<CacheHit | null> {
    await this.loadMeta()
    const info = this.meta.entries[key]
    if (!info) return null
    const blob = await this.store.match(reqUrlOf(key))
    if (!blob) {
      // 数据丢了 meta 还在（被浏览器清了部分）—— 清掉这条 meta
      delete this.meta.entries[key]
      await this.saveMeta()
      return null
    }
    info.lastUsed = this.now()
    await this.saveMeta()
    return { blob, tier: info.tier, name: info.name }
  }

  /** 写入并执行容量策略：超出 cap 按 lastUsed 从旧到新淘汰；单条放不下就放弃这条 */
  async put(key: string, blob: Blob, brief: { tier: string; name: string; singer: string }): Promise<void> {
    await this.loadMeta()
    if (blob.size > this.cap) return // 单条超过总上限：存了也立刻挤掉别人，不存
    const info: CacheEntryInfo = {
      size: blob.size,
      lastUsed: this.now(),
      tier: brief.tier,
      name: brief.name,
      singer: brief.singer,
    }
    // 同键覆盖时先按旧 size 结账
    const prev = this.meta.entries[key]
    let total = this.totalSize() - (prev?.size ?? 0) + blob.size
    if (total > this.cap) {
      const ordered = Object.entries(this.meta.entries)
        .filter(([k]) => k !== key)
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed)
      for (const [k, v] of ordered) {
        if (total <= this.cap) break
        // 正在写入的这条不能被自己挤掉
        total -= v.size
        await this.store.delete(reqUrlOf(k))
        delete this.meta.entries[k]
      }
    }
    await this.store.put(reqUrlOf(key), blob)
    this.meta.entries[key] = info
    await this.saveMeta()
  }

  /** 兜底：这首歌任意已缓存档位里最近用过的（全部音源都失败时用） */
  async newestFor(songKey: string): Promise<CacheHit | null> {
    await this.loadMeta()
    const prefix = `audio|${songKey}|`
    const hits = Object.entries(this.meta.entries)
      .filter(([k]) => k.startsWith(prefix))
      .sort((a, b) => b[1].lastUsed - a[1].lastUsed)
    for (const [k] of hits) {
      const hit = await this.get(k)
      if (hit) return hit
    }
    return null
  }

  /** 仅重置 meta；**不删**存储里的音频条目 —— 存储层没有「枚举删除」原语，
   *  浏览器实现（createBrowserAudioCache）会用 cache.keys() 覆写成真清空。 */
  async clear(): Promise<void> {
    this.meta = { entries: {} }
    this.loaded = true
    await this.saveMeta()
  }

  async usage(): Promise<{ total: number; count: number }> {
    await this.loadMeta()
    return { total: this.totalSize(), count: Object.keys(this.meta.entries).length }
  }

  private totalSize(): number {
    return Object.values(this.meta.entries).reduce((a, e) => a + e.size, 0)
  }
}

/** 浏览器实现：包一层 CacheStorage（清空用 cache.keys() 逐条删） */
export function createBrowserAudioCache(): AudioCache | null {
  if (typeof caches === 'undefined') return null
  let handle: Cache | null = null
  const open = async (): Promise<Cache> => {
    if (!handle) handle = await caches.open(CACHE_STORE_NAME)
    return handle
  }
  const store: AudioCacheStore & { keys(): Promise<string[]> } = {
    async put(url, blob) {
      ;(await open()).put(url, new Response(blob, { headers: { 'Content-Type': blob.type || 'application/octet-stream' } }))
    },
    async match(url) {
      const res = await (await open()).match(url)
      return res ? await res.blob() : null
    },
    async delete(url) {
      await (await open()).delete(url)
    },
    async keys() {
      return (await open()).keys().then((rs) => rs.map((r) => r.url))
    },
  }
  const cache = new AudioCache(store)
  // 覆写 clear：先枚举删除存储里的音频条目，再重置 meta（基类只重置 meta）
  cache.clear = async (): Promise<void> => {
    for (const url of await store.keys()) {
      if (url.includes('/__lxcache__/')) await store.delete(url)
    }
    await AudioCache.prototype.clear.call(cache)
  }
  return cache
}

/** 内存实现（单测用） */
export function createMemoryStore(): AudioCacheStore & { map: Map<string, Blob> } {
  const map = new Map<string, Blob>()
  return {
    map,
    async put(url, blob) {
      map.set(url, blob)
    },
    async match(url) {
      return map.get(url) ?? null
    },
    async delete(url) {
      map.delete(url)
    },
  }
}
