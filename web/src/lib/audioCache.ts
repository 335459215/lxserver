/** 播放缓存（v2.39.0）：听过的歌缓存进 CacheStorage，重播零解析零下载、断网可放。
 *
 *  【定位】这是**透明缓存**（IndexedDB），不是下载管理 —— 不产生文件、不上磁盘目录，
 *  有容量上限（LRU 淘汰最久没听的），设置里一个开关 + 一键清空。
 *  「下载本曲」按钮保持原样（用户有自己的下载整理方案）。
 *
 *  【键设计】缓存键 = 歌曲 songKey + 音质档位（缓存的字节就是那个档位的）。
 *  真实音频 URL 带过期签名、不能当键；存储就是「按键存 Blob 的仓库」（IDB）。
 *
 *  【存储抽象】store 注入（真实实现包 caches.open；单测用内存 Map），
 *  LRU/容量策略是纯逻辑 —— 与 sleepTimer / playlistTransfer 同一架构套路。
 *  meta（size/lastUsed/曲目信息）作为一条 JSON Blob 存在同一个仓库里，
 *  淘汰与占用统计都靠它；底层存储自身不提供这些。
 */

/** 注入的键值存储（put 覆盖同键） */
export interface AudioCacheStore {
  put(key: string, blob: Blob): Promise<void>
  match(key: string): Promise<Blob | null>
  delete(key: string): Promise<void>
}

export interface CacheEntryInfo {
  size: number
  /** 上次使用（命中读取也算使用）—— LRU 依据 */
  lastUsed: number
  tier: string
  name: string
  singer: string
  /** 解析时**实际命中的曲目 key**（跨平台替身时与请求的 songKey 不同）。
   *
   *  【为什么要记这个（2026-10-29 用户报告）】服务端跨平台替身按歌名搜到的
   *  可能是同名的另一个录音；那批字节被缓存在**原歌**的键下 —— 一旦写进去，
   *  之后每次都命中缓存直接播错歌，且不再经过解析器（连换源都救不回来）。
   *  记录真实来源 key 后：命中时用户可见地知道「这是替身」，
   *  且旧缓存被识别为可疑（见 isForeignSubstitute）。
   *
   *  旧条目没有此字段 → 视为「与请求 key 相同」（保守：不误杀历史缓存）。 */
  resolvedKey?: string
  /** 实际命中的平台（跨平台替身时与请求源不同），供诊断与 UI 说明 */
  resolvedSource?: string
}

export interface CacheMeta {
  entries: Record<string, CacheEntryInfo>
}

export const CACHE_STORE_NAME = 'lx-audio-v1'
export const DEFAULT_CAP = 2 * 1024 * 1024 * 1024 // 2GB：无损单曲 30~60MB，够放几十张专辑

const META_KEY = '__meta__'

export function cacheKey(songKey: string, tier: string): string {
  return `audio|${songKey}|${tier}`
}

export interface CacheHit {
  blob: Blob
  tier: string
  name: string
  /** 实际来源 key（旧条目 undefined = 与请求 key 相同） */
  resolvedKey?: string
  resolvedSource?: string
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
    const raw = await this.store.match(META_KEY)
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
    await this.store.put(META_KEY, new Blob([JSON.stringify(this.meta)], { type: 'application/json' }))
  }

  // ===== 公开方法的统一防御 =====
  // 【契约】缓存层任何错误（隐私模式阻断 IDB / 磁盘满 / 打开失败）都**不得拖垮播放**：
  // 第一版没包这层，IDB 一抛错 loadAndPlay 就成了 unhandled rejection，
  // 播放器永远卡在 loading —— 缓存坏了的最坏结果应该是「退化成无缓存」。
  // 内存态与存储态可能因此不同步（如 saveMeta 失败），自愈路径：
  // get 发现 store.match miss 会清掉脏 meta 条目（见下）。

  /** 命中返回 blob 并刷新 lastUsed；未命中或缓存层故障返回 null */
  async get(key: string): Promise<CacheHit | null> {
    try {
      return await this.getInner(key)
    } catch {
      return null
    }
  }

  private async getInner(key: string): Promise<CacheHit | null> {
    await this.loadMeta()
    const info = this.meta.entries[key]
    if (!info) return null
    const blob = await this.store.match(key)
    if (!blob) {
      // 数据丢了 meta 还在（被浏览器清了部分）—— 清掉这条 meta
      delete this.meta.entries[key]
      await this.saveMeta()
      return null
    }
    info.lastUsed = this.now()
    await this.saveMeta()
    return {
      blob,
      tier: info.tier,
      name: info.name,
      resolvedKey: info.resolvedKey,
      resolvedSource: info.resolvedSource,
    }
  }

  /** 写入并执行容量策略；缓存层故障静默放弃（调用方无需 try/catch） */
  async put(key: string, blob: Blob, brief: { tier: string; name: string; singer: string; resolvedKey?: string; resolvedSource?: string }): Promise<void> {
    try {
      await this.putInner(key, blob, brief)
    } catch {
      /* 放弃这次写入 */
    }
  }

  private async putInner(key: string, blob: Blob, brief: { tier: string; name: string; singer: string; resolvedKey?: string; resolvedSource?: string }): Promise<void> {
    await this.loadMeta()
    if (blob.size > this.cap) return // 单条超过总上限：存了也立刻挤掉别人，不存
    const info: CacheEntryInfo = {
      size: blob.size,
      lastUsed: this.now(),
      tier: brief.tier,
      name: brief.name,
      singer: brief.singer,
      resolvedKey: brief.resolvedKey,
      resolvedSource: brief.resolvedSource,
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
        await this.store.delete(k)
        delete this.meta.entries[k]
      }
    }
    await this.store.put(key, blob)
    this.meta.entries[key] = info
    await this.saveMeta()
  }

  /** 兜底：这首歌任意已缓存档位里最近用过的（全部音源都失败时用）；故障返回 null */
  async newestFor(songKey: string): Promise<CacheHit | null> {
    try {
      return await this.newestForInner(songKey)
    } catch {
      return null
    }
  }

  /** 删除单条（含 meta 记账）；故障静默 —— 调用方是「发现脏数据就清掉」的修复路径，
   *  清理失败不应影响播放本身。 */
  async delete(key: string): Promise<void> {
    try {
      await this.loadMeta()
      await this.store.delete(key)
      if (this.meta.entries[key]) {
        delete this.meta.entries[key]
        await this.saveMeta()
      }
    } catch {
      /* 清理失败不影响播放 */
    }
  }

  private async newestForInner(songKey: string): Promise<CacheHit | null> {
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
    try {
      this.meta = { entries: {} }
      this.loaded = true
      await this.saveMeta()
    } catch {
      /* 同上：清空失败不拖垮调用方（设置页按钮） */
    }
  }

  async usage(): Promise<{ total: number; count: number }> {
    try {
      await this.loadMeta()
      return { total: this.totalSize(), count: Object.keys(this.meta.entries).length }
    } catch {
      return { total: 0, count: 0 }
    }
  }

  private totalSize(): number {
    return Object.values(this.meta.entries).reduce((a, e) => a + e.size, 0)
  }
}

/** 浏览器实现：IndexedDB 当「按键存 Blob 的仓库」。
 *
 *  【为什么不是 CacheStorage —— 线上实测踩的坑（2026-10-24）】
 *  NAS 以 http://192.168.1.x 直连，是**非安全上下文**，浏览器根本不提供
 *  caches API（typeof caches === 'undefined'，与 navigator.serviceWorker
 *  被跳过是同一族限制）。第一版用 CacheStorage，在真实部署上整层静默失效
 *  —— 线上实测当场抓到。IndexedDB 在 HTTP 下同样可用、存 Blob 无压力，
 *  还省掉了「合成请求路径」的 hack：键就是键，不再伪装成 URL。
 *  （保留键里的 /__lxcache__/ 前缀改无所谓 —— 现在键直接用 cacheKey。）
 */
export function createBrowserAudioCache(): AudioCache | null {
  if (typeof indexedDB === 'undefined') return null
  let dbPromise: Promise<IDBDatabase> | null = null
  const open = (): Promise<IDBDatabase> => {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(CACHE_STORE_NAME, 1)
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv')
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'))
      })
    }
    return dbPromise
  }
  const tx = async (mode: IDBTransactionMode): Promise<IDBObjectStore> => {
    const db = await open()
    return db.transaction('kv', mode).objectStore('kv')
  }
  const wrap = <T>(req: IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })

  const store: AudioCacheStore & { keys(): Promise<string[]> } = {
    async put(key, blob) {
      ;(await tx('readwrite')).put(blob, key)
    },
    async match(key) {
      const v = await wrap((await tx('readonly')).get(key))
      return v instanceof Blob ? v : null
    },
    async delete(key) {
      ;(await tx('readwrite')).delete(key)
    },
    async keys() {
      const keys = (await wrap((await tx('readonly')).getAllKeys())) as string[]
      return keys.filter((k) => typeof k === 'string')
    },
  }
  const cache = new AudioCache(store)
  // 覆写 clear：先枚举删除存储条目，再重置 meta（基类只重置 meta）
  cache.clear = async (): Promise<void> => {
    for (const key of await store.keys()) {
      if (key === '__meta__') continue
      await store.delete(key)
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
    async put(key, blob) {
      map.set(key, blob)
    },
    async match(key) {
      return map.get(key) ?? null
    },
    async delete(key) {
      map.delete(key)
    },
  }
}
