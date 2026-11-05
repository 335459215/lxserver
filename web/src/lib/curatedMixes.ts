/** 「今日甄选」的每日轮换（2026-11-05）。
 *
 * 【要解决的问题｜线上实测】
 * v2.45.0 给甄选卡加了「按天刷新」——`refreshDay` 跨过凌晨 6:00 就把封面缓存整批作废。
 * 但那张卡的内容来源是**固定的关键词**（`query: '经典'` 之类），作废缓存后
 * 拿固定词重新搜一遍，返回的当然是**同一批歌、同一张封面** —— 用户看到的
 * 就是「今日甄选一直没变过」。机制有了，可变的内容源没有。
 *
 * 实测证据（2026-11-05，线上账号）：6 张卡各自的关键词首曲确实互不相同
 * （爱如潮水 / 甲乙丙丁 / 时光 / The truth that you leave / 晚安 / 杀死那个石家庄人），
 * 说明卡片之间不重复；但同词连续调用首曲完全一致 —— 每天当然也一样。
 *
 * 【修法：把「一个固定词」升级成「一组同主题的词池 + 按刷新日轮换」】
 *   - 每张卡配 8 个**同主题**关键词（全部实测能搜到 20 首，见 HANDOFF-v247）；
 *   - 用「刷新日」决定今天用池子里的哪一个 → 同一天所有客户端拿到同一份歌单
 *     （可缓存、可复现，符合「编辑精选」的产品语义，不做个性化）；
 *   - 跨天自动换词 → 歌单与封面一起变，用户点开就是新内容。
 *
 * 【为什么用「刷新日」而不是「当前小时」】
 * 与 curatedCovers.ts 的 CURATED_REFRESH_HOUR（凌晨 6:00）对齐：深夜刷首页的人
 * 看到的仍是「今天」那一批，不会被凌晨悄悄换掉。两处必须用同一个日键，
 * 否则会出现「歌单换了、封面还是昨天那张」的错位。
 */

/** 从「刷新日」键取池子里的关键词。
 *
 *  @param pool   该卡的关键词池（空池返回空串，调用方按「没搜到」处理）
 *  @param dayKey `curatedRefreshDayKey()` 产出的 `YYYY-MM-DD`
 *
 *  取模用「自纪元起的天数」，所以：
 *    - 同一天多次调用结果恒定（纯函数，无副作用）；
 *    - 连续两天必然相邻两个词，走完一轮（8 天）回到起点；
 *    - 不依赖时区（按 UTC 天数算，日键本身已经是本地日历日）。
 */
export function pickDailyKeyword(pool: readonly string[], dayKey: string): string {
  const list = (pool ?? []).filter((k) => typeof k === 'string' && k.trim())
  if (list.length === 0) return ''
  const idx = dayIndex(dayKey)
  const wrapped = ((idx % list.length) + list.length) % list.length
  return list[wrapped]
}

/** `YYYY-MM-DD` → 自 1970-01-01 起的第几天。格式不合法时返回 0（退化成池子第一项）。 */
function dayIndex(dayKey: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dayKey ?? '').trim())
  if (!m) return 0
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (!Number.isFinite(ms)) return 0
  return Math.floor(ms / 86_400_000)
}
