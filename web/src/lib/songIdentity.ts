/** 跨平台歌曲身份判定（纯函数，**不依赖任何 import**）。
 *
 *  【为什么单独成文件】
 *  这些规则需要被单测直接 import。放在 music.ts 里会因为
 *  `import { userAuthHeaders } from '@/lib/auth'` 把 React 一起拉进来，
 *  在 node:test 环境下无法解析 `@` 别名。这里保持零依赖，
 *  既能被前端引用，也能被测试直接跑。
 *
 *  规则本身刻意保守：**宁可少合并几条，也不要把不相干的歌合成一首**。
 *  每一条规则都对应一个实测复现过的缺陷，注释里保留了复现输入。
 */

/** 各平台搜索结果的最小结构（只声明本文件用到的字段） */
export interface IdentifiableSong {
  source?: string
  id?: string | number
  songmid?: string
  name?: string
  singer?: string
  meta?: { songId?: string | number, [key: string]: unknown }
  [key: string]: unknown
}

/** 归一化但**保留空格**：全角转半角、小写、空白折叠。
 *
 *  【为什么必须保留空格】
 *  feat 子句的识别依赖词边界。若先去掉空白，`Afterglow` 里的 `ft`
 *  就会被当成 `ft.` 署名标记，歌名被截成 `a`，于是
 *  `Afterglow` / `Afterglow (Live)` / `Afterlife` 全塌成同一首。 */
export function normalizeKeepSpaces(s: string): string {
  return String(s || '')
    .toLowerCase()
    // 全角 ASCII（！-～）整体平移到半角，顺手覆盖 （） ： 、 等常见标点
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 归一化到「可比较」形式：在保留空格的基础上再去掉所有空白。 */
export function normalizeForMatch(s: string): string {
  return normalizeKeepSpaces(s).replace(/\s+/g, '')
}

/** 抹掉「合作演唱」信息：`(feat. X)` / `[ft. X]` / 结尾的 ` feat. X`。
 *  各平台对同一首歌的合作者写法极不统一（有的写进歌名、有的只写进歌手字段），
 *  不抹掉就会出现「圣诞星（feat. 杨瑞代）」与「圣诞星 (feat. 杨瑞代)」两条。
 *
 *  【调用顺序】必须先 normalizeKeepSpaces（转半角、**保留空格**）再调用本函数：
 *  平台会写全角括号 `（feat. …）`，而这里只认半角 `(`；词边界判断也需要空格。
 *
 *  【结尾署名必须要求词边界】
 *  第三行只匹配「前面是行首或空白」的 feat/ft。早期写成 `/(?:feat|ft)\.?.*$/`
 *  且作用在**已去空白**的串上，等于把任何位置的 `ft` 当署名起点。
 *  版本后缀（Live/Remix）刻意保留，让不同录音各占一条。 */
export function stripFeatClauses(s: string): string {
  return String(s || '')
    .replace(/\((?:feat|ft)\.?[^)]*\)/g, '')
    .replace(/\[(?:feat|ft)\.?[^\]]*\]/g, '')
    .replace(/(?:^|\s)(?:feat|ft)\.?(?:\s.*)?$/g, '')
    .replace(/\(\s*\)/g, '')
}

/** 歌名归一化：保空格归一 → 抹 feat 子句 → 去空白。 */
export function titleKey(raw: string): string {
  return normalizeForMatch(stripFeatClauses(normalizeKeepSpaces(raw)))
}

/** 已确认的「同一歌手的两种写法」。**必须逐条列举，不做规则化剥离**。
 *
 *  【为什么不能用「剥掉中文名前的拉丁前缀」这类通用规则】
 *  那样会把 `MC张三` / `DJ张三` / `张三` 全部归一到 `张三`，
 *  把三个不同艺人的同名歌曲静默合并成一条（已实测复现）。
 *
 *  【收录标准】只放实测确认过、且跨平台真实存在的等价写法。 */
export const SINGER_ALIASES: Record<string, string> = {
  'coco李玟': '李玟',
  'g.e.m.邓紫棋': '邓紫棋',
  'gem邓紫棋': '邓紫棋',
}

/** 歌手集合：把 singer 字段拆成归一化后的歌手名集合。
 *
 *  【为什么要处理别名】同一歌手在各平台写法不一致 —— 腾讯/酷我/酷狗写
 *  `CoCo李玟`，网易/咪咕写 `李玟`。不归一就会算出两个不同的歌手，去重失效。 */
export function singerSet(raw: string): Set<string> {
  const parts = String(raw || '')
    .split(/[、,，/&]|\sfeat\.?\s*/i)
    .map((x) => {
      const n = normalizeForMatch(x)
      return SINGER_ALIASES[n] ?? n
    })
    .filter(Boolean)
  return new Set(parts)
}

/** 两个集合是否有交集（遍历较小的一侧，通常只有 1~2 个元素）。 */
export function intersects(a: Set<string>, b: Set<string>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  for (const x of small) if (large.has(x)) return true
  return false
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
 *  【三条保守规则】
 *  1. 歌名或歌手缺失时不参与模糊合并（只认 source+id 相同）——
 *     早期把空歌手当通配符，`Home/''` 会吞掉 `Home/Alice` 和 `Home/Bob`，
 *     而且结果依赖输入顺序（未知项在前就只剩未知项）。
 *  2. 每个标题桶保存**见过的全部**歌手集合（只增不减），新条目与其中任意一个
 *     有交集即判重 —— 只跟「代表」比会因为代表被替换而漏判，同一批数据
 *     去重两次结果不同（非幂等）。
 *  3. 代表固定为**最先出现**的那条，不替换。替换会改掉 source/id，
 *     导致播放队列里已在高亮的条目对不上（SongList 按 source+id 精确比对）。
 *
 *  【不同录音版本为什么仍然分开】
 *  `刀马旦` 与 `刀马旦 (Live)` 的 titleKey 不同（版本后缀没被 feat 规则抹掉），
 *  分属不同标题桶，永远不会被合到一起。 */
export function dedupeSongs<T extends IdentifiableSong>(songs: T[]): T[] {
  const out: T[] = []
  const buckets = new Map<string, Set<string>[]>()   // titleKey -> 见过的全部歌手集合
  const seenIds = new Map<string, Set<string>>()     // titleKey -> 见过的 source:id

  for (const song of songs) {
    const tk = titleKey(String(song?.name || ''))
    const ss = singerSet(String(song?.singer || ''))
    const rawId = song?.songmid ?? song?.id ?? song?.meta?.songId
    const hasId = rawId != null && String(rawId) !== ''
    const idKey = `${song?.source}:${String(rawId ?? '')}`

    const sets = buckets.get(tk) ?? []
    const ids = seenIds.get(tk) ?? new Set<string>()

    // 歌名或歌手缺失时不做模糊匹配：空标题会把所有歌归成一个桶，
    // 空歌手会变成通配符吞掉有署名的条目。
    const fuzzyOk = tk.length > 0 && ss.size > 0
    const dup =
      (fuzzyOk && sets.some((o) => o.size > 0 && intersects(ss, o))) ||
      (hasId && ids.has(idKey))

    if (dup) {
      // 只增不减：把新见的歌手集合并进桶里，保证后续条目也能匹配到它
      if (ss.size > 0) sets.push(ss)
      if (hasId) ids.add(idKey)
      continue
    }

    buckets.set(tk, [...sets, ss])
    seenIds.set(tk, new Set(hasId ? [...ids, idKey] : ids))
    out.push(song)
  }
  return out
}

/** 剥 songmid/id 上的平台前缀（wy_493735159 -> 493735159）。
 *
 *  【真实缺陷（2026-10-25 用户报告）】落雪桌面同步来的歌单条目，songmid 字段
 *  被写成了桌面端的 id 格式（带 "wy_" 前缀）。带前缀的 id 对各平台 SDK 都是
 *  **无效 id**：官方 API 查不到 → 自定义源竞速里按歌名搜的替身源接管 →
 *  播的是**同名别的歌** —— 用户感知为「歌单里显示 A 播的是 B」。
 *  搜索结果的 songmid 原生干净，所以只有歌单/收藏才错位。
 *  前端 songKey 剥它（缓存键/排除清单与搜索歌统一，旧错曲缓存自然失效）；
 *  服务端 normalizeSongInfo 也剥（src/server/musicMatch.ts 有对称实现 ——
 *  两侧各自内联 8 行，避免服务端构建跨包引入 web 模块）。
 *  kg 的 songmid 内部可能含下划线（数字_哈希），前缀必须完整匹配才剥。 */
export function stripSourcePrefix(source: string, id: string): string {
  const prefix = `${source}_`
  return id.startsWith(prefix) ? id.slice(prefix.length) : id
}

/** 歌曲稳定键：source + 剥前缀后的 songmid（缺失回落 名|歌手）。
 *  从 music.ts 搬来（v2.39.5）：它要被缓存键/换源排除清单/歌词键共用，
 *  且必须可直接单测 —— 与 dedupeSongs 同一搬家理由（music.ts 同名转发，线上跑的就是这份）。 */
export function songKey(song: IdentifiableSong | null): string {
  if (!song) return ''
  const raw = song.songmid ?? song.id ?? song.meta?.songId
  const src = String(song.source ?? '')
  if (raw == null) return `${src}:${song.name}|${song.singer}`
  const id = stripSourcePrefix(src, String(raw))
  return `${src}:${id}`
}
