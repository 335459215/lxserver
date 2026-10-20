/** 播放历史的分桶与统计（零依赖纯模块，便于 Node 单测直接 import）。
 *
 *  【为什么单独抽出来】
 *  「今天 / 昨天 / 更早」看着是纯展示，但它的边界判断全是坑，且都不报错：
 *    - 用「距今 < 24 小时」当「今天」→ 凌晨 1 点看昨晚 23 点听的歌会被算成今天；
 *    - 用 UTC 日期 → 东八区用户在 08:00 之前，「今天」会显示成昨天；
 *    - 用 `new Date(ts).getDate()` 比日 → 跨月/跨年时 1 号与 31 号会相等。
 *  这些在单测里能钉死，写在组件里就只能靠肉眼。与 songIdentity / searchPaging /
 *  qualityOptions 同一套路。
 *
 *  【为什么不 import 任何东西】
 *  根 tsconfig 的 `@/*` 只映射到 `./src/*`，前端别名 `@/lib/...` 在
 *  `tsx --test test/*.test.ts` 下解析不到，会在加载阶段 MODULE_NOT_FOUND。
 *  所以本模块必须零依赖（只用标准库）。
 */

/** 一天的分桶 */
export interface HistoryBucket<T> {
  /** 稳定 key，可直接做 React key */
  key: 'today' | 'yesterday' | 'week' | 'earlier'
  /** 展示标题 */
  label: string
  items: T[]
}

export interface HistoryItemLike {
  playedAt: number
}

/** 本地日历日的 0 点（毫秒）。
 *
 *  用 `setHours(0,0,0,0)` 而不是 `ts - (ts % 86400000)`：
 *  后者算的是 UTC 日界，东八区会整体偏移 8 小时。
 *  也不用 `toISOString().slice(0,10)` 再解析 —— 那同样是 UTC。
 */
export function startOfLocalDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 相对 `now` 的自然日差：0 = 今天，1 = 昨天，-1 = 明天。 */
export function localDayDiff(ts: number, now: number): number {
  const a = startOfLocalDay(ts)
  const b = startOfLocalDay(now)
  // 用 Math.round 吸收夏令时导致的 ±1 小时偏移：
  // 有的时区一天是 23 或 25 小时，直接相除会得到 0.958/1.042 这种值。
  return Math.round((b - a) / 86_400_000)
}

/** 分桶：今天 / 昨天 / 本周内（2~6 天前）/ 更早。
 *
 *  【为什么「本周」用「2~6 天前」而不是「本周一起」】
 *  周一是「本周」还是「上周」取决于今天是周几 —— 周一那天看，昨天（周日）
 *  会落进「更早」，用户会觉得丢了一天。用相对天数（2~6 天）则永远连续。
 *
 *  保持输入顺序（调用方传的是倒序历史），不排序 —— 排序是服务端的事，
 *  这里再排一次会在数据本身乱序时掩盖问题。
 */
export function bucketHistory<T extends HistoryItemLike>(
  items: readonly T[],
  now: number,
): HistoryBucket<T>[] {
  const today: T[] = []
  const yesterday: T[] = []
  const week: T[] = []
  const earlier: T[] = []
  // 未来时间（客户端时钟偏快 / 服务端时钟偏慢）算今天，不单列一组：
  // 「明天」这个分组对用户没有意义，而且会让刚听的歌跑到列表最前面一组之外。
  const future: T[] = []

  for (const it of items) {
    const diff = localDayDiff(it.playedAt, now)
    if (diff <= 0) {
      // diff < 0 是未来时间，归到今天
      if (diff < 0) future.push(it)
      else today.push(it)
    } else if (diff === 1) yesterday.push(it)
    else if (diff <= 6) week.push(it)
    else earlier.push(it)
  }

  const out: HistoryBucket<T>[] = []
  // 未来时间的条目合并到「今天」组尾 —— 保持「今天」只有一个分组标题
  const todayAll = [...today, ...future]
  if (todayAll.length) out.push({ key: 'today', label: '今天', items: todayAll })
  if (yesterday.length) out.push({ key: 'yesterday', label: '昨天', items: yesterday })
  if (week.length) out.push({ key: 'week', label: '最近一周', items: week })
  if (earlier.length) out.push({ key: 'earlier', label: '更早', items: earlier })
  return out
}

export interface HistoryStats {
  /** 条目数（去重后 = 不同歌曲数） */
  songs: number
  /** 累计播放次数（服务端 playCount 之和） */
  plays: number
  /** 覆盖的自然日数（至少 1；无数据为 0） */
  days: number
  /** 出现最多的歌手；无数据为 null。并列时取**先出现**的那个（保持稳定） */
  topSinger: { name: string; count: number } | null
}

/** 统计概览。
 *
 *  `playCount` 的语义见服务端 historyDataManage：它统计「换曲/点播重新开始」的次数，
 *  **不含单曲循环的自动重播**。所以这里展示成「累计播放」而不是「听了多久」——
 *  后者需要每首歌的播放时长，而历史只存了 interval（总时长），不能相减。
 */
export function historyStats(
  items: readonly (HistoryItemLike & { singer?: string; playCount?: number })[],
): HistoryStats {
  if (items.length === 0) {
    return { songs: 0, plays: 0, days: 0, topSinger: null }
  }
  const days = new Set<number>()
  const singerCount = new Map<string, number>()
  let plays = 0

  for (const it of items) {
    days.add(startOfLocalDay(it.playedAt))
    const n = Number.isFinite(it.playCount) ? Math.max(1, Number(it.playCount)) : 1
    plays += n
    // 歌手可能是「A、B、C」这种多歌手串：按**每个**歌手各记一次，
    // 否则「周杰伦、费玉清」整串只会算一个，统计就没有意义了。
    for (const name of splitSingers(it.singer)) {
      singerCount.set(name, (singerCount.get(name) ?? 0) + n)
    }
  }

  let topSinger: { name: string; count: number } | null = null
  for (const [name, count] of singerCount) {
    // 严格大于：并列时保留先出现的（Map 保持插入序），结果稳定可测
    if (!topSinger || count > topSinger.count) topSinger = { name, count }
  }

  return { songs: items.length, plays, days: days.size, topSinger }
}

/** 多歌手串拆分。分隔符各平台不统一：`、` `,` `/` `&` `;` 都出现过。
 *
 *  只做「拆 + 去空 + 去重」，不做任何归一（比如剥掉「CoCo」前缀）——
 *  归一规则收在 songIdentity.ts 里，那是**判重**用的，与统计口径不同：
 *  统计要如实反映"谁出现了"，过度归一会把不同艺人并成一个。
 */
export function splitSingers(singer?: string | null): string[] {
  if (!singer) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of singer.split(/[、,，/&;；]+/)) {
    const name = raw.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 具体日期。
 *
 *  【为什么不用 dayjs / date-fns】
 *  只需这一个函数，引入一个库（几十 KB）不划算；且各库对「今天」的定义
 *  未必与我们的分桶一致，反而容易出现「显示昨天 23:00，却分在『今天』组」。
 */
export function relativeTime(ts: number, now: number): string {
  const diff = now - ts
  if (!Number.isFinite(diff)) return ''
  if (diff < 0) return '刚刚' // 未来时间：时钟偏差，不显示"负几分钟前"
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const dayDiff = localDayDiff(ts, now)
  if (dayDiff === 0) return `${Math.floor(min / 60)} 小时前`
  if (dayDiff === 1) return '昨天'
  if (dayDiff <= 6) return `${dayDiff} 天前`
  const d = new Date(ts)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return sameYear ? `${mm}-${dd}` : `${d.getFullYear()}-${mm}-${dd}`
}
