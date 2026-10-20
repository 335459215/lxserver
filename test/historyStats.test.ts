/**
 * historyStats.test.ts — 播放历史分桶与统计的回归测试。
 *
 * 每个用例都对应一个**真实会踩**的边界，注释里写明「写错会怎样」，
 * 避免以后有人把边界判断"简化"回去。
 *
 * 运行：npx tsx --test test/historyStats.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bucketHistory,
  historyStats,
  localDayDiff,
  relativeTime,
  splitSingers,
  startOfLocalDay,
} from '../web/src/lib/historyStats'

/** 构造本地时间戳（避免 UTC 字面量导致的时区歧义） */
const at = (y: number, mo: number, d: number, h = 12, mi = 0) =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

const item = (playedAt: number, extra: Record<string, unknown> = {}) => ({ playedAt, ...extra })

test('startOfLocalDay：返回本地 0 点，且不跨日', () => {
  const t = at(2026, 10, 20, 23, 59)
  const s = startOfLocalDay(t)
  const d = new Date(s)
  assert.equal(d.getHours(), 0)
  assert.equal(d.getMinutes(), 0)
  assert.equal(d.getDate(), 20)
})

test('localDayDiff：0=今天 1=昨天，且**不看小时差**', () => {
  const now = at(2026, 10, 20, 1, 0) // 凌晨 1 点
  // 昨晚 23 点：只差 2 小时，但跨了自然日 → 必须算「昨天」
  assert.equal(localDayDiff(at(2026, 10, 19, 23, 0), now), 1)
  // 今天 0 点：差 1 小时，仍是今天
  assert.equal(localDayDiff(at(2026, 10, 20, 0, 0), now), 0)
})

test('localDayDiff：**不能用「距今 24 小时」代替**（跨零点必错）', () => {
  const now = at(2026, 10, 20, 1, 0)
  const lastNight = at(2026, 10, 19, 23, 0)
  const elapsed = now - lastNight // 2 小时
  // 若实现成 elapsed < 86400000 就归「今天」，这里会暴露
  assert.ok(elapsed < 86_400_000, '前提：确实不到 24 小时')
  assert.equal(localDayDiff(lastNight, now), 1, '但自然日已经是昨天')
})

test('localDayDiff：跨月与跨年都正确（不能用 getDate() 相减）', () => {
  // 10-01 与 09-30：getDate() 分别是 1 和 30，相减会得到 -29 这种荒谬值
  assert.equal(localDayDiff(at(2026, 9, 30, 12), at(2026, 10, 1, 12)), 1)
  // 跨年
  assert.equal(localDayDiff(at(2025, 12, 31, 12), at(2026, 1, 1, 12)), 1)
  assert.equal(localDayDiff(at(2025, 12, 25, 12), at(2026, 1, 1, 12)), 7)
})

test('bucketHistory：四组边界正确', () => {
  const now = at(2026, 10, 20, 15, 0)
  const items = [
    item(at(2026, 10, 20, 14, 0)), // 今天
    item(at(2026, 10, 19, 23, 0)), // 昨天（只差 16h，但跨日）
    item(at(2026, 10, 18, 12, 0)), // 2 天前 → 最近一周
    item(at(2026, 10, 14, 12, 0)), // 6 天前 → 最近一周
    item(at(2026, 10, 13, 12, 0)), // 7 天前 → 更早
  ]
  const buckets = bucketHistory(items, now)
  assert.deepEqual(
    buckets.map((b) => [b.key, b.items.length]),
    [
      ['today', 1],
      ['yesterday', 1],
      ['week', 2],
      ['earlier', 1],
    ],
  )
})

test('bucketHistory：空分组不输出（不能渲染空标题）', () => {
  const now = at(2026, 10, 20, 15, 0)
  const buckets = bucketHistory([item(at(2026, 10, 20, 9, 0))], now)
  assert.equal(buckets.length, 1)
  assert.equal(buckets[0].key, 'today')
})

test('bucketHistory：未来时间归入「今天」，不单列也不丢弃', () => {
  const now = at(2026, 10, 20, 15, 0)
  const future = item(at(2026, 10, 21, 9, 0)) // 客户端时钟偏快
  const buckets = bucketHistory([future], now)
  assert.equal(buckets.length, 1)
  assert.equal(buckets[0].key, 'today')
  assert.equal(buckets[0].items.length, 1, '未来时间不能丢')
})

test('bucketHistory：保持输入顺序（不重排）', () => {
  const now = at(2026, 10, 20, 15, 0)
  const a = item(at(2026, 10, 20, 14, 0), { name: 'A' })
  const b = item(at(2026, 10, 20, 13, 0), { name: 'B' })
  const buckets = bucketHistory([a, b], now)
  assert.deepEqual(
    buckets[0].items.map((x) => (x as unknown as { name: string }).name),
    ['A', 'B'],
  )
})

test('splitSingers：各平台分隔符都要认', () => {
  assert.deepEqual(splitSingers('周杰伦、费玉清'), ['周杰伦', '费玉清'])
  assert.deepEqual(splitSingers('A,B'), ['A', 'B'])
  assert.deepEqual(splitSingers('A，B'), ['A', 'B'])
  assert.deepEqual(splitSingers('A/B'), ['A', 'B'])
  assert.deepEqual(splitSingers('A & B'), ['A', 'B'])
  assert.deepEqual(splitSingers('A;B'), ['A', 'B'])
  // 空串与多余分隔符
  assert.deepEqual(splitSingers('A、、B'), ['A', 'B'])
  assert.deepEqual(splitSingers(''), [])
  assert.deepEqual(splitSingers(null), [])
  // 去重
  assert.deepEqual(splitSingers('A、A'), ['A'])
})

test('historyStats：空数据不炸', () => {
  assert.deepEqual(historyStats([]), { songs: 0, plays: 0, days: 0, topSinger: null })
})

test('historyStats：plays 用 playCount 之和，不是条目数', () => {
  const now = at(2026, 10, 20, 15, 0)
  const stats = historyStats([
    item(at(2026, 10, 20, 14, 0), { playCount: 5 }),
    item(at(2026, 10, 20, 13, 0), { playCount: 3 }),
  ])
  assert.equal(stats.songs, 2)
  assert.equal(stats.plays, 8)
  void now
})

test('historyStats：playCount 缺失/非法时按 1 计（不能变成 NaN 或 0）', () => {
  const s = historyStats([
    item(at(2026, 10, 20, 14, 0), {}),
    item(at(2026, 10, 20, 13, 0), { playCount: Number.NaN }),
    item(at(2026, 10, 20, 12, 0), { playCount: 0 }),
    item(at(2026, 10, 20, 11, 0), { playCount: -3 }),
  ])
  // NaN→1、0→1、-3→1、缺失→1
  assert.equal(s.plays, 4)
})

test('historyStats：days 是**去重后的自然日数**', () => {
  const s = historyStats([
    item(at(2026, 10, 20, 14, 0)),
    item(at(2026, 10, 20, 9, 0)),
    item(at(2026, 10, 19, 20, 0)),
  ])
  assert.equal(s.days, 2)
})

test('historyStats：多歌手串按每个歌手各记一次', () => {
  const s = historyStats([
    item(at(2026, 10, 20, 14, 0), { singer: '周杰伦、费玉清', playCount: 1 }),
  ])
  assert.equal(s.topSinger?.name, '周杰伦')
  assert.equal(s.topSinger?.count, 1)
})

test('historyStats：topSinger 按播放次数加权，并列取先出现的', () => {
  const s = historyStats([
    item(at(2026, 10, 20, 14, 0), { singer: 'A', playCount: 1 }),
    item(at(2026, 10, 20, 13, 0), { singer: 'B', playCount: 5 }),
  ])
  assert.deepEqual(s.topSinger, { name: 'B', count: 5 })

  // 并列 → 先出现的 A
  const tie = historyStats([
    item(at(2026, 10, 20, 14, 0), { singer: 'A', playCount: 3 }),
    item(at(2026, 10, 20, 13, 0), { singer: 'B', playCount: 3 }),
  ])
  assert.deepEqual(tie.topSinger, { name: 'A', count: 3 })
})

test('relativeTime：刚刚 / 分钟 / 小时 / 昨天 / 天 / 日期', () => {
  const now = at(2026, 10, 20, 15, 0)
  assert.equal(relativeTime(now - 30_000, now), '刚刚')
  assert.equal(relativeTime(now - 5 * 60_000, now), '5 分钟前')
  assert.equal(relativeTime(at(2026, 10, 20, 13, 0), now), '2 小时前')
  assert.equal(relativeTime(at(2026, 10, 19, 23, 0), now), '昨天')
  assert.equal(relativeTime(at(2026, 10, 17, 12, 0), now), '3 天前')
  // 同年更早 → MM-DD；跨年 → YYYY-MM-DD
  assert.equal(relativeTime(at(2026, 8, 1, 12, 0), now), '08-01')
  assert.equal(relativeTime(at(2025, 8, 1, 12, 0), now), '2025-08-01')
})

test('relativeTime：未来时间显示「刚刚」，不出现负数', () => {
  const now = at(2026, 10, 20, 15, 0)
  assert.equal(relativeTime(now + 60_000, now), '刚刚')
})
