/** 每首曲目的**可用音质档位**（零依赖纯模块，便于单测直接 import）。
 *
 *  数据从哪来 —— 两个字段名不一致，必须都认：
 *    - 搜索结果（`/api/music/search`）：`song.types = [{ type:'320k', size:'10.29Mb' }]`
 *    - 歌单曲目（`/api/user/list`）：`song.meta.qualitys = [{ type:'320k', size:'10.29 MB' }]`
 *  另外两者都附带一个 `_types` / `_qualitys` 的**对象映射**（各平台原始形态），
 *  只有数组缺失时才回落用它 —— 数组已带 size，且顺序稳定。
 *
 *  【为什么不能只用「请求档位」决定菜单】
 *  同一份曲库里，有的歌只有 128k/320k，有的到 FLAC 甚至 24bit。
 *  菜单如果永远平铺 6 档，用户点「无损」时根本不知道这首歌到底有没有无损，
 *  只能靠「点了之后变红点」事后发现 —— 把可预知的信息藏起来了。
 *  这里负责把「本曲申报了哪些档位」变成可直接展示的数据。
 *
 *  ⚠️ **这只是平台申报值，不是承诺**：跨平台替身与自定义音源都可能给出更高的档位。
 *  所以 UI 用「本曲提供」标注，而不是把未申报的档位禁掉 —— 禁掉等于替解析器做决定，
 *  而解析器的实际能力比这份申报表更大。
 */
/** 服务端音质全集（低 → 高）。用于「最高可用档位」判定。
 *
 *  【为什么这里自己写一份，而不是 import lib/quality 的 QUALITY_TIERS】
 *  本模块要能被 Node 单测**直接 import**（`npx tsx --test test/*.test.ts`，
 *  走仓库根的 tsconfig），而根 tsconfig 的 `@/*` 只映射到 `./src/*`，
 *  解析不到 `@/lib/quality` —— 引用它会让单测在加载阶段就 MODULE_NOT_FOUND。
 *  songIdentity.ts / searchPaging.ts 同理，都是零依赖纯模块。
 *  两份顺序必须保持一致（test/qualityOptions.test.ts 有断言钉住这一点）。
 *
 *  刻意只收前端可选档位：atmos/master 等服务端认识但前端没有入口，
 *  把它们算进「最高可用」会得到一个不可选的 auto 目标。 */
const TIER_ORDER: readonly string[] = ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires']

export interface SongTier {
  /** 档位标识，如 `128k` / `flac` / `flac24bit` */
  type: string
  /** 原始体积串（各平台格式不统一，见 sizeLabel） */
  size?: string | null
}

/** 档位序号；未知档位返回 -1（排序时排到最后，绝不当作「最高」） */
export function tierRank(tier: string | null | undefined): number {
  if (!tier) return -1
  return TIER_ORDER.indexOf(tier)
}

const asTierList = (v: unknown): SongTier[] => {
  if (!Array.isArray(v)) return []
  const out: SongTier[] = []
  for (const x of v) {
    if (!x || typeof x !== 'object') continue
    const o = x as { type?: unknown; size?: unknown }
    const type = typeof o.type === 'string' ? o.type.trim() : ''
    if (!type) continue
    const size = typeof o.size === 'string' && o.size.trim() ? o.size.trim() : null
    out.push({ type, size })
  }
  return out
}

const asTierMap = (v: unknown): SongTier[] => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return []
  const out: SongTier[] = []
  for (const [type, meta] of Object.entries(v as Record<string, unknown>)) {
    if (!type) continue
    const size =
      meta && typeof meta === 'object' && typeof (meta as { size?: unknown }).size === 'string'
        ? (meta as { size: string }).size.trim() || null
        : null
    out.push({ type, size })
  }
  return out
}

/** 归一化一首歌的可用档位（去重、按档位由低到高排序）。
 *
 *  去重规则：同一档位出现两次时保留**带 size** 的那条（体积是用户能直接感知的信息）。 */
export function songTiers(song?: {
  types?: unknown
  _types?: unknown
  meta?: { qualitys?: unknown; _qualitys?: unknown } | null
} | null): SongTier[] {
  if (!song) return []
  // 顺序即优先级：数组形态（搜索结果 / 歌单曲目）优先，对象映射只在数组缺失时回落。
  const candidates = [
    song.types,
    song.meta?.qualitys,
    song._types,
    song.meta?._qualitys,
  ]
  let raw: SongTier[] = []
  for (const c of candidates) {
    raw = Array.isArray(c) ? asTierList(c) : asTierMap(c)
    if (raw.length > 0) break
  }

  const byType = new Map<string, SongTier>()
  for (const t of raw) {
    const prev = byType.get(t.type)
    if (!prev) {
      byType.set(t.type, t)
      continue
    }
    if (!prev.size && t.size) byType.set(t.type, t)
  }

  // 已选档位（TIER_ORDER 内）按序在前，未申报的原始档位（如 atmos）排在后面；
  // 两者各自按体积升序兜底，保证同一份数据每次渲染顺序一致（否则菜单会跳）。
  return [...byType.values()].sort((a, b) => {
    const ra = tierRank(a.type)
    const rb = tierRank(b.type)
    if (ra !== rb) {
      if (ra < 0 && rb < 0) return a.type.localeCompare(b.type)
      return ra < 0 ? 1 : rb < 0 ? -1 : ra - rb
    }
    return 0
  })
}

/** 本曲是否申报了该档位 */
export function songHasTier(tiers: SongTier[], tier: string): boolean {
  return tiers.some((t) => t.type === tier)
}

/** 本曲**申报的**最高可选档位；未知档位（atmos/master 等前端没有入口的）不参与，
 *  一个都没申报时返回 null（调用方应回落到用户偏好）。 */
export function bestTier(tiers: SongTier[]): string | null {
  let best: string | null = null
  let rank = -1
  for (const t of tiers) {
    const r = tierRank(t.type)
    if (r > rank) {
      rank = r
      best = t.type
    }
  }
  return best
}

/** 本次解析该从哪个档位起手。
 *
 *  - 关闭 `autoBest`（默认）：直接用用户首选 —— 用户选什么就解析什么。
 *  - 开启 `autoBest`：若本曲申报了**更高**的档位就从最高可用起手；申报的最高档
 *    低于首选时**仍按首选**（否则会反向覆盖用户偏好，把「无损」悄悄降成 320k）。
 *
 *  任一档位未知（来源自定义档位）时同样不替换 —— 无法比较大小就不猜。 */
export function pickStartTier(
  declared: SongTier[],
  preferred: string,
  autoBest: boolean,
): string {
  if (!autoBest) return preferred
  const best = bestTier(declared)
  if (!best) return preferred
  const rb = tierRank(best)
  const rp = tierRank(preferred)
  if (rb < 0 || rp < 0) return preferred
  return rb > rp ? best : preferred
}

/** 体积串归一：平台回包格式极不统一（`10.29Mb` / `10.29 MB` / `1024KB`），
 *  统一成「数值 + 单位」再补空格，避免菜单里一行一个样。
 *  解析不出数值的串原样返回（宁可不美化，也不要显示成 `NaN MB`）。 */
export function sizeLabel(size?: string | null): string {
  if (!size) return ''
  const m = /^\s*([0-9]+(?:\.[0-9]+)?)\s*([kKmMgG]?[bB])\s*$/.exec(size)
  if (!m) return size.trim()
  return `${m[1]} ${m[2].toUpperCase()}`
}

/** 实得档位是否**低于**首选（真正的降级）。
 *
 *  ⚠️ 不能写成 `resolved !== preferred`：`flac` 与 `flac24bit` 都「不相等」，
 *  但只有后者高于前者。用序号比较才不会把升级/同档误标成降级
 *  （启用「按曲目自动选最高档」后，实得**高于**首选是正常情况）。
 *  任一侧未知（音源自定义档位）时退回不等判断 —— 未知值没法比大小。 */
export function isDegraded(
  resolved: string | null | undefined,
  preferred: string | null | undefined,
): boolean {
  if (!resolved || !preferred) return false
  if (resolved === preferred) return false
  const r = tierRank(resolved)
  const p = tierRank(preferred)
  if (r < 0 || p < 0) return true
  return r < p
}

/** 「直链后缀」与实得档位是否矛盾 —— 只用于下载文件的扩展名。
 *
 *  实测有源把 320k 的 mp3 放在 `.flac` 路径下（或反过来）：单看任一信号都会错命名，
 *  播放器/资源管理器按扩展名解码就出问题。**有扩展名时以它为准** ——
 *  那才是真实字节的容器格式；档位只是「请求/申报」的语义标签。
 *
 *  ⚠️ 返回值是**容器类型**而不是档位：`wav` / `m4a` / `ogg` 与「音质档位」是两个维度
 *  （wav 可以是低码率转来的，m4a 也可以是 320k）。旧实现有 `.wav` 分支，
 *  重写时曾漏掉 —— 补回来并在此注明，别再以为「档位就代表容器」。 */
export function resolveExtensionTier(quality?: string | null, url?: string | null): string {
  const q = (quality ?? '').toLowerCase()
  const path = (url ?? '').split('?')[0].toLowerCase()
  const urlSays: string | null = path.endsWith('.flac')
    ? 'flac'
    : path.endsWith('.mp3')
      ? 'mp3'
      : path.endsWith('.m4a')
        ? 'm4a'
        : path.endsWith('.ogg')
          ? 'ogg'
          : path.endsWith('.wav')
            ? 'wav'
            : null
  // 无扩展名的流（多数解析直链）只能按档位推断
  if (!urlSays) {
    return q.includes('flac') || q.includes('hires') || q.includes('24bit') ? 'flac' : 'mp3'
  }
  return urlSays
}
