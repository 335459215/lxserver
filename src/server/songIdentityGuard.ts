/**
 * 解析结果的「同一首歌」校验（v2.44.0 ⑦）。
 *
 * 【要解决的问题｜线上实测】
 * 用户报告「今日甄选点进去，界面显示 A、耳朵听到 B」。实测证据：
 * 分别解析 `吻别/张学友(kw:157908)` 与 `时光/许巍(kw:27811583)`，
 * 服务端返回了**同一个音频 URL**（`car-er.kuwo.cn/.../M800001ziKgJ3o5Ipp.mp3`）。
 * 也就是说第三方聚合音源脚本按「歌名+歌手」去它自己的聚合接口拿链接，
 * 拿错了也照样返回 200 + 一个能播的直链 —— 播放器无从分辨。
 *
 * 服务端能做的两件事：
 *   1. **同一 URL 不得服务两个不同的歌曲身份**（同一进程内即可发现并拒绝）；
 *   2. 解析结果若自带曲目元信息，必须与请求对得上（歌手/歌名）。
 *
 * 【为什么用「进程内近期使用表」而不是只依赖响应字段】
 * 自定义源返回的就是一条裸 URL，没有任何元数据可比。可观测的强信号是
 * 「两个不同的歌被解析成同一个链接」—— 这在真实使用里只可能是错映射
 * （同一首歌被不同 id 请求的情况，身份键会相同，不会误报）。
 *
 * 【为什么是「近期」而不是永久】
 * 酷我的签名直链本身会过期/轮换；同一首歌隔很久再解析拿到同一个 URL 是正常的。
 * 窗口取 STICKY 信任期同量级（10 分钟），足够覆盖用户连续点歌的窗口，
 * 又不会把正常的链接复用误判成错歌。
 */

/** 一个歌曲的身份键：平台 + 唯一 id。缺 id 时返回 null（无法判定，不做拦截）。 */
export function songIdentityKey(song: {
  source?: unknown
  songmid?: unknown
  id?: unknown
  hash?: unknown
  meta?: { songId?: unknown } | null
} | null | undefined): string | null {
  if (!song) return null
  const source = String(song.source ?? '').trim().toLowerCase()
  const candidates = [song.songmid, song.id, song.hash, song.meta?.songId]
  for (const raw of candidates) {
    if (raw === undefined || raw === null) continue
    const id = String(raw).trim()
    // 空串、占位符都当没有 id
    if (!id || id === 'undefined' || id === 'null' || id === '0') continue
    return source ? `${source}:${id}` : id
  }
  return null
}

/** 从 URL 里取一个稳定的比较键（去掉签名/时间戳类查询串）。
 *
 *  酷我/酷狗等直链的 path 部分就是资源标识，query 里全是签名与过期时间；
 *  只比 host+path 才不会因为签名刷新而判成「不同 URL」。
 */
export function urlIdentityKey(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const raw = url.trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    return `${u.host.toLowerCase()}${u.pathname}`
  } catch {
    // 不是合法 URL（比如相对路径）：退化成去掉 query 的原文
    return raw.split('?')[0].toLowerCase() || null
  }
}

export interface UrlOwnerEntry {
  songKey: string
  /** 记录时间（毫秒） */
  at: number
}

export interface CollisionCheck {
  /** 是否判为错歌 */
  collision: boolean
  /** 这个 URL 之前属于哪首歌（诊断用） */
  owner?: string
  /** 给日志/接口用的一句话说明 */
  reason?: string
}

export interface UrlOwnerRegistryOptions {
  /** 条目有效期，默认 10 分钟 */
  ttlMs?: number
  /** 最多记多少条，默认 500（与粘滞缓存同量级） */
  maxEntries?: number
  /** 可注入时钟（测试用） */
  now?: () => number
}

/** 「近期哪个 URL 是哪个歌」的登记表。 */
export class UrlOwnerRegistry {
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly now: () => number
  private readonly map = new Map<string, UrlOwnerEntry>()

  constructor(options: UrlOwnerRegistryOptions = {}) {
    const ttl = Number(options.ttlMs)
    const max = Number(options.maxEntries)
    this.ttlMs = Number.isFinite(ttl) && ttl > 0 ? ttl : 10 * 60 * 1000
    this.maxEntries = Number.isFinite(max) && max > 0 ? Math.floor(max) : 500
    this.now = options.now ?? Date.now
  }

  get size(): number {
    this.prune()
    return this.map.size
  }

  private prune(): void {
    const now = this.now()
    for (const [key, entry] of this.map) {
      if (entry.at + this.ttlMs <= now) this.map.delete(key)
    }
  }

  /** 解析成功、准备返回给播放器时登记。**先 check 再 remember。** */
  remember(url: string, songKey: string | null): void {
    const key = urlIdentityKey(url)
    if (!key || !songKey) return
    this.prune()
    this.map.set(key, { songKey, at: this.now() })
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }

  /** 这个 URL 是不是已经属于**另一首**歌？ */
  check(url: string, songKey: string | null): CollisionCheck {
    const key = urlIdentityKey(url)
    if (!key || !songKey) return { collision: false }
    const hit = this.map.get(key)
    if (!hit) return { collision: false }
    if (hit.at + this.ttlMs <= this.now()) {
      this.map.delete(key)
      return { collision: false }
    }
    if (hit.songKey === songKey) return { collision: false }
    return {
      collision: true,
      owner: hit.songKey,
      reason: `解析出的音频地址已属于另一首歌（${hit.songKey}），判定为音源错映射`,
    }
  }

  clear(): void {
    this.map.clear()
  }
}

/** 解析结果里可能带回的曲目元信息，是否与请求指向同一首。
 *  只有**两边都拿得到**时才判定，缺字段一律放行（不误杀）。 */
export function matchesRequestedSong(
  requested: { name?: unknown; singer?: unknown } | null | undefined,
  resolved: { name?: unknown; singer?: unknown } | null | undefined,
): { ok: boolean; reason?: string } {
  if (!requested || !resolved) return { ok: true }
  const reqName = normalizeForCompare(requested.name)
  const resName = normalizeForCompare(resolved.name)
  if (reqName && resName && reqName !== resName) {
    return { ok: false, reason: `歌名不一致（请求 ${String(requested.name)}，实得 ${String(resolved.name)}）` }
  }
  const reqSinger = normalizeForCompare(firstSinger(requested.singer))
  const resSinger = normalizeForCompare(firstSinger(resolved.singer))
  if (reqSinger && resSinger && reqSinger !== resSinger) {
    return {
      ok: false,
      reason: `歌手不一致（请求 ${String(requested.singer)}，实得 ${String(resolved.singer)}）`,
    }
  }
  return { ok: true }
}

/** 只取第一段歌手：跨平台替身的合唱者写法差异极大，比全文会大量误杀。
 *  分隔符覆盖各平台实际用到的几种（、 / , & 与全角版本）。 */
function firstSinger(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return text.split(/[、/,&;｜|]|feat\.?|ft\.?/i)[0] ?? text
}

function normalizeForCompare(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    // 全角 → 半角
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    // 去掉括号内容（(Live) / [伴奏] 等版本差异留给 url 碰撞检测）
    .replace(/[([（【].*?[)\]）】]/g, '')
    // 去掉空白与常见标点
    .replace(/[\s\p{P}\p{S}]/gu, '')
}

export function createUrlOwnerRegistry(options: UrlOwnerRegistryOptions = {}): UrlOwnerRegistry {
  return new UrlOwnerRegistry(options)
}
