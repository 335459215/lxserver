/** 音乐接口层：聚合搜索 + 播放地址解析。
 *
 * 接口面与鉴权见 docs/stage0/api-and-state-map.md：
 *  - `GET  /api/music/search`  无鉴权，返回**裸数组**（不是 { list } 包裹）
 *  - `POST /api/music/url`     混合鉴权：具名用户须带 token（见 userAuthHeaders），
 *                              否则按公开用户 `open` 处理。解析器内部带粘滞缓存 +
 *                              跨平台竞速 + 源级熔断
 */
import { userAuthHeaders } from '@/lib/auth'

/** 各平台搜索结果字段名不统一，这里只声明公共字段，其余透传。
 *  歌单里的曲目（LX.Music.MusicInfo）也能被这个类型覆盖：它把封面/专辑放在
 *  `meta` 下，故 coverUrl() 会一并兜底 meta.picUrl。 */
export interface Song {
  /** 平台标识：kw / wy / tx / kg / mg / local */
  source: string
  id?: string | number
  songmid?: string
  name: string
  singer: string
  albumName?: string
  albumId?: string | number
  /** 时长，形如 "03:30"；歌单里可能是 null */
  interval?: string | null
  img?: string
  picUrl?: string
  /** 歌单曲目：服务端 meta（songId/picUrl/qualitys…） */
  meta?: {
    songId?: string | number
    albumName?: string
    picUrl?: string | null
    qualitys?: Array<{ type?: string; size?: string | null }>
    [key: string]: unknown
  }
  /** 该曲可用的音质档位 */
  types?: Array<{ type?: string; size?: string | null }>
  /** 直链播放地址。**仅本地音乐（source=local）用**：解析器只认在线平台，
   *  有 url 时播放内核跳过解析直接播（见 lib/player.tsx）。 */
  url?: string
  [key: string]: unknown
}

export interface ResolveAttempt {
  name?: string
  sourceName?: string
  status?: string
  message?: string
}

export interface ResolveResult {
  url: string
  /** **实得**音质档位。注意服务端返回的字段名是 `type` 而不是 `quality`
   *  （实测：请求 flac 时响应里 `type:"flac"` 而 `quality` 为 undefined）。
   *  这里同时声明两者并做归一化，避免再次读错字段导致 UI 谎报档位。 */
  type?: string
  quality?: string
  sourceName?: string
  resolvedSource?: string
  requestedSource?: string
  downloadSource?: string
  attempts?: ResolveAttempt[]
}

/** 解析失败：带上逐源 attempts，便于 UI 展示"试过哪些源" */
export class MusicApiError extends Error {
  attempts?: ResolveAttempt[]
  constructor(message: string, attempts?: ResolveAttempt[]) {
    super(message)
    this.name = 'MusicApiError'
    this.attempts = attempts
  }
}

export const MUSIC_SOURCES = [
  { key: 'all', label: '聚合搜索' },
  { key: 'kw', label: '酷我' },
  { key: 'wy', label: '网易云' },
  { key: 'tx', label: 'QQ音乐' },
  { key: 'kg', label: '酷狗' },
  { key: 'mg', label: '咪咕' },
] as const

export const SOURCE_LABEL: Record<string, string> = {
  all: '全网聚合',
  kw: '酷我',
  wy: '网易云',
  tx: 'QQ音乐',
  kg: '酷狗',
  mg: '咪咕',
}

/** 音质降级序列：首选 320k，失败退 128k（服务端解析器内部还会再按可用档位调整） */
export const QUALITY_FALLBACK = ['320k', '128k'] as const

/** 聚合搜索。服务端支持一次拉多页（pages），返回裸数组。 */
export async function searchMusic(params: {
  name: string
  singer?: string
  source?: string
  page?: number
  pages?: number
  signal?: AbortSignal
}): Promise<Song[]> {
  const qs = new URLSearchParams({
    name: params.name,
    source: params.source ?? 'kw',
    type: 'song',
    page: String(params.page ?? 1),
    pages: String(params.pages ?? 1),
  })
  if (params.singer) qs.set('singer', params.singer)

  const res = await fetch(`/api/music/search?${qs.toString()}`, { signal: params.signal })
  const data: unknown = await res.json().catch(() => null)

  if (!res.ok) {
    const msg =
      (data as { error?: string } | null)?.error ?? `搜索失败（HTTP ${res.status}）`
    throw new MusicApiError(msg)
  }
  if (!Array.isArray(data)) throw new MusicApiError('搜索返回格式异常')
  return data as Song[]
}

/** 多平台并发聚合搜索：同时从酷我、网易云、QQ音乐、咪咕等拉取并交织合并 */
export async function searchMusicAggregate(params: {
  name: string
  singer?: string
  sources?: string[]
  page?: number
  signal?: AbortSignal
}): Promise<Song[]> {
  const targetSources =
    params.sources && params.sources.length > 0
      ? params.sources
      : ['kw', 'wy', 'tx', 'mg', 'kg']

  const results = await Promise.allSettled(
    targetSources.map((src) =>
      searchMusic({
        name: params.name,
        singer: params.singer,
        source: src,
        page: params.page ?? 1,
        signal: params.signal,
      }),
    ),
  )

  const lists: Song[][] = []
  for (const r of results) {
    if (r.status === 'fulfilled' && Array.isArray(r.value) && r.value.length > 0) {
      lists.push(r.value)
    }
  }

  if (lists.length === 0) {
    const firstErr = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
    if (firstErr) {
      throw firstErr.reason
    }
    return []
  }

  // 交织合并（Round-Robin）：每个平台各出第 0 首，再出第 1 首，保证不同平台的热门曲目都能展现。
  // 去重见 dedupeSongs —— 按「歌名 + 歌手集合有交集」跨平台判定。
  // 此前用 `${source}_${id}` 做键，等于**只去掉同平台内的重复**，
  // 同一个作品在五个平台各留一条，用户看到的就是「结果里全是同一首歌」。
  const interleaved: Song[] = []
  const maxLen = Math.max(...lists.map((l) => l.length))
  for (let i = 0; i < maxLen; i++) {
    for (const list of lists) {
      if (i < list.length) interleaved.push(list[i])
    }
  }

  return dedupeSongs(interleaved)
}

/** 解析播放地址；失败抛 MusicApiError（带 attempts 明细）。
 *
 *  注意：必须带上用户鉴权头。自定义音源按用户归属落盘，服务端据此挑选可用的源；
 *  不带就退化成公开用户 open（`_open` 目录通常没有源），点歌会一律失败。 */
export async function resolveMusicUrl(params: {
  songInfo: Song
  quality?: string
  excludeApiSources?: string[]
  signal?: AbortSignal
}): Promise<ResolveResult> {
  const res = await fetch('/api/music/url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...userAuthHeaders() },
    signal: params.signal,
    body: JSON.stringify({
      songInfo: params.songInfo,
      quality: params.quality ?? QUALITY_FALLBACK[0],
      enableAutoSwitchApiSource: true,
      excludeApiSources: params.excludeApiSources ?? [],
    }),
  })
  const data = (await res.json().catch(() => null)) as
    | (ResolveResult & { error?: string })
    | null

  if (!res.ok || !data?.url) {
    throw new MusicApiError(data?.error ?? `解析失败（HTTP ${res.status}）`, data?.attempts)
  }
  // 服务端把实得档位放在 `type`（`quality` 恒为 undefined）。这里归一化到 `quality`，
  // 让上层只认一个字段；两侧都留是为了兼容以后服务端可能补上 quality 的情况。
  return { ...data, quality: data.type ?? data.quality }
}

/** 秒 → m:ss（负数/NaN 一律显示 0:00）。用于单曲时长。 */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00'
  const total = Math.floor(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 列表总时长：不足 1 小时用 m:ss，超过则给「4 小时 20 分」这种可读形式
 *  （69 首的试听列表显示成 "260:04" 没人愿意换算）。 */
export function formatTotalDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00'
  const total = Math.floor(sec)
  if (total < 3600) return formatTime(total)
  const h = Math.floor(total / 3600)
  const m = Math.round((total % 3600) / 60)
  return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`
}

/** "03:30" → 210（解析不出来返回 0） */
export function intervalToSeconds(interval?: string | null): number {
  if (!interval) return 0
  const parts = interval.split(':').map((n) => Number.parseInt(n, 10))
  if (parts.some((n) => Number.isNaN(n))) return 0
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

/** 同一首歌的判定：同平台 + 同 songmid/id。
 *  歌单曲目（meta.songId）与搜索结果（songmid）要能对上，故三级兜底。 */
export function sameSong(a: Song | null, b: Song | null): boolean {
  if (!a || !b) return false
  if (a.source !== b.source) return false
  const idA = a.songmid ?? a.id ?? a.meta?.songId
  const idB = b.songmid ?? b.id ?? b.meta?.songId
  return idA != null && idB != null && String(idA) === String(idB)
}

/** 曲目去重键：平台 + songmid/id，缺失时回落「歌名|歌手」。
 *  用于搜索分页追加时去重（各平台翻页结果常出现重复条目），
 *  播放内核也用它记忆「哪些源已经试过且失败」。无曲目时返回空串。 */
export function songKey(song: Song | null): string {
  if (!song) return ''
  const id = song.songmid ?? song.id ?? song.meta?.songId
  return id != null ? `${song.source}:${id}` : `${song.source}:${song.name}|${song.singer}`
}

/** 归一化到「可比较」形式：全角标点转半角、去大小写、去所有空白。
 *  平台之间的写法差异大多在这三处：`（feat. 杨瑞代）` 与 `(feat. 杨瑞代)`、
 *  `圣诞星（feat. 杨瑞代）` 与 `圣诞星 (feat. 杨瑞代)`、以及多余空格。 */
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    // 全角 ASCII（！-～）整体平移到半角，顺手覆盖 （） ： 、 等常见标点
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, '')
}

/** 抹掉「合作演唱」信息：`(feat. X)` / `[ft. X]` / 结尾的 `feat. X`。
 *  各平台对同一首歌的合作者写法极不统一（有的写进歌名、有的只写进歌手字段），
 *  不抹掉就会出现「圣诞星（feat. 杨瑞代）」与「圣诞星 (feat. 杨瑞代)」两条。
 *
 *  【顺序很关键】必须先 normalizeForMatch 再调用本函数：平台会写全角括号
 *  `（feat. …）`，而这里只认半角 `(`。顺序反了就会漏掉全角那一条 ——
 *  这正是第一版实现里「圣诞星」仍然重复的原因。 */
function stripFeatClauses(s: string): string {
  return s
    .replace(/\((?:feat|ft)\.?[^)]*\)/g, '')
    .replace(/\[(?:feat|ft)\.?[^\]]*\]/g, '')
    .replace(/(?:feat|ft)\.?.*$/g, '')
    .replace(/\(\)/g, '')
}

/** 歌名归一化：先抹平全角/空白，再抹 feat 子句，最后再去一次空白（抹完会留空括号）。 */
function titleKey(raw: string): string {
  return normalizeForMatch(stripFeatClauses(normalizeForMatch(raw)))
}

/** 剥掉中文名前的纯拉丁前缀：`CoCo李玟` → `李玟`、`G.E.M.邓紫棋` → `邓紫棋`。
 *
 *  【为什么需要】同一歌手在不同平台写法不一致 —— 腾讯/酷我/酷狗写 `CoCo李玟`，
 *  网易/咪咕写 `李玟`。不剥前缀的话，同一首合唱曲在 tx 与 wy 上会算出不同的
 *  歌手键，去重直接失效（实测《刀马旦》就是这样漏掉了两组）。
 *
 *  【为什么整名都是 ASCII 时不动】
 *  `A-Lin`、`G.E.M.` 这类名字本身就是纯英文，剥完会变成空串，
 *  于是所有英文歌手会塌缩成同一个键 —— 那会把不相干的歌误合并成一条。 */
function stripLatinPrefix(name: string): string {
  const m = /^[A-Za-z0-9.\-'\s]+([\u4e00-\u9fff].*)$/.exec(name)
  return m ? m[1] : name
}

/** 歌手集合：把 singer 字段拆成归一化后的歌手名集合。
 *
 *  【为什么要剥拉丁前缀】同一歌手在各平台写法不一致 —— 腾讯/酷我/酷狗写
 *  `CoCo李玟`，网易/咪咕写 `李玟`。不剥就会算出两个不同的歌手，去重失效。 */
function singerSet(raw: string): Set<string> {
  const parts = String(raw || '')
    .split(/[、,，/&]|\sfeat\.?\s*/i)
    .map((x) => normalizeForMatch(stripLatinPrefix(x.trim())))
    .filter(Boolean)
  return new Set(parts)
}

/** 跨平台去重：把同一首歌的多个平台条目收敛成一条。
 *
 *  【为什么不能用「键相等」而必须用「歌手集合有交集」】
 *  实测数据（搜索「李玟」时的《月光爱人》），同一个录音在各平台的 singer 是：
 *      wy  `李玟`
 *      wy  `李玟、张志`
 *      kw  `CoCo李玟、马毓芬、谢文德、Dan Warner、…、马友友`
 *  酷我把一长串**伴奏/和声人员**也塞进了 singer。任何「整串相等」的键都会把
 *  这三条判成三首歌。只有「集合有交集」才能识别出它们唱的是同一首。
 *
 *  【为什么歌手顺序不影响】
 *  比较的是集合交集，`李玟、周杰伦` 与 `周杰伦、李玟` 天然命中。
 *
 *  【为什么不误合并翻唱】
 *  萨顶顶版与李玟版没有共同歌手，交集为空 → 各占一条。
 *
 *  【为什么不同录音版本仍然分开】
 *  `刀马旦` 与 `刀马旦 (Live)` 的 titleKey 不同（后缀没被 feat 规则抹掉），
 *  分属不同标题桶，永远不会被合到一起。
 *
 *  【保留哪一条】
 *  同组里选**署名歌手最少**的那条 —— 用户想看的是「李玟」，
 *  而不是「CoCo李玟、马毓芬、谢文德、Dan Warner、Julio Hernández、Archie Pena、马友友」。
 *  平手时保留先出现的（各平台按轮转合并，先出现的通常更热门）。 */
export function dedupeSongs<T extends Song>(songs: T[]): T[] {
  const out: T[] = []
  const groups = new Map<string, number[]>()   // titleKey -> out 下标数组
  const singerSets: Set<string>[] = []

  for (const song of songs) {
    const tk = titleKey(song?.name || '')
    const ss = singerSet(song?.singer || '')
    const candidates = groups.get(tk) || []
    let hit = -1
    for (const idx of candidates) {
      const other = singerSets[idx]
      // 任一方歌手为空时无法判断，按同标题合并（宁可少给一条，不要重复）
      if (ss.size === 0 || other.size === 0 || intersects(ss, other)) { hit = idx; break }
    }
    if (hit === -1) {
      groups.set(tk, [...candidates, out.length])
      singerSets.push(ss)
      out.push(song)
    } else if (ss.size > 0 && singerSets[hit].size > 0 && ss.size < singerSets[hit].size) {
      // 用署名更干净的替换掉冗长的那条，但保持原有位置（不改变列表顺序）
      out[hit] = song
      singerSets[hit] = ss
    }
  }
  return out
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  // 遍历较小的一侧，通常只有 1~2 个元素
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  for (const x of small) if (large.has(x)) return true
  return false
}

/** 跨平台「同一首歌」判定键：**歌名 + 全部歌手（排序）**，刻意不含平台。
 *
 *  【为什么不能用 songKey 来做跨平台去重】
 *  songKey 里带平台前缀，而同一个作品在酷我/网易/QQ/咪咕各有各的 id，
 *  于是 `wy:123` 与 `tx:456` 被判为两首歌 —— 这正是「搜一首歌出来好几条
 *  一模一样的」的根因。要跨平台去重就必须把平台从键里拿掉。
 *
 *  【仅用于需要单值键的场合（Set / Map）】
 *  批量过滤请用 dedupeSongs —— 本函数是「键相等」语义，无法处理
 *  「歌手集合有交集但整串不等」的情况（`李玟` vs `CoCo李玟、马毓芬…`）。 */
export function songIdentityKey(song: Song | null): string {
  if (!song) return ''
  const name = titleKey(song.name || '')
  const singers = Array.from(singerSet(song.singer || '')).sort().join(',')
  return `${name}|${singers}`
}

/** 封面地址：各平台字段名不统一，统一兜底（歌单曲目把封面放在 meta.picUrl） */
export function coverUrl(song?: Song | null): string | undefined {
  if (!song) return undefined
  const candidates = [
    song.img,
    song.picUrl,
    song.meta?.picUrl,
    (song.album as { cover?: string } | undefined)?.cover,
  ]
  return candidates.find((u): u is string => typeof u === 'string' && u.length > 0)
}

/** 平台中文名（未知平台回落原标识） */
export function sourceLabel(source?: string): string {
  if (!source) return ''
  // 本地音乐不是在线平台，不在 MUSIC_SOURCES 里，单独给个名字
  if (source === 'local') return '本地'
  return SOURCE_LABEL[source] ?? source.toUpperCase()
}
