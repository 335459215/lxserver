/**
 * 今日甄选「每日轮换」护栏（2026-11-05）
 *
 * 背景：v2.45 给甄选卡加了「按天作废封面缓存」，但卡片内容来源是**固定关键词**，
 * 作废缓存后重新搜出来还是同一批歌、同一张封面 —— 用户反馈「今日甄选一直没变过」。
 * 修法是把固定词换成词池 + 按刷新日轮换（lib/curatedMixes.ts）。
 *
 * 三条不可回退的承诺：
 *   1. 同一天内恒定（纯函数，无随机、无副作用）—— 否则每次渲染都换词；
 *   2. 跨天必变（池子 >1 时）—— 否则「今日」名不副实；
 *   3. 与 curatedCovers 的刷新日**同一个日键**（凌晨 6:00 为界）——
 *      否则会出现「歌单按新词搜、封面还是昨天那张」的错位。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickDailyKeyword } from '../web/src/lib/curatedMixes.ts'
import { curatedRefreshDayKey } from '../web/src/lib/curatedCovers.ts'

const POOL = ['经典', '老歌', '怀旧金曲', '华语经典', '岁月', '回忆', '金曲', '传唱']

test('同一天多次调用结果恒定', () => {
  const a = pickDailyKeyword(POOL, '2026-11-05')
  const b = pickDailyKeyword(POOL, '2026-11-05')
  const c = pickDailyKeyword(POOL, '2026-11-05')
  assert.equal(a, b)
  assert.equal(b, c)
  assert.ok(POOL.includes(a), `必须是池子里的词：${a}`)
})

test('连续两天用的是相邻两个词（跨天必变）', () => {
  const today = pickDailyKeyword(POOL, '2026-11-05')
  const tomorrow = pickDailyKeyword(POOL, '2026-11-06')
  assert.notEqual(today, tomorrow, '跨天关键词必须变化，否则「今日」甄选等于没换')
})

test('走完一轮（池长 8 天）回到起点，且 8 天内不重复', () => {
  const seen = new Set<string>()
  for (let i = 0; i < POOL.length; i++) {
    const day = `2026-11-${String(5 + i).padStart(2, '0')}`
    const kw = pickDailyKeyword(POOL, day)
    assert.ok(!seen.has(kw), `第 ${i + 1} 天出现了重复词：${kw}`)
    seen.add(kw)
  }
  assert.equal(seen.size, POOL.length, '8 天应覆盖池子里全部 8 个词')
  assert.equal(pickDailyKeyword(POOL, '2026-11-13'), pickDailyKeyword(POOL, '2026-11-05'),
    '第 9 天应回到第 1 天的词')
})

test('空池 / 全是空白的池返回空串（调用方按「没搜到」处理）', () => {
  assert.equal(pickDailyKeyword([], '2026-11-05'), '')
  assert.equal(pickDailyKeyword(['', '   '], '2026-11-05'), '')
  assert.equal(pickDailyKeyword(null as unknown as string[], '2026-11-05'), '')
})

test('单元素池恒定返回那一个词（不会越界）', () => {
  assert.equal(pickDailyKeyword(['摇滚'], '2026-11-05'), '摇滚')
  assert.equal(pickDailyKeyword(['摇滚'], '2030-01-01'), '摇滚')
})

test('畸形 dayKey 退化成池子第一项，不抛异常', () => {
  for (const bad of ['', '   ', 'abc', '2026-11', '2026/11/05']) {
    assert.equal(pickDailyKeyword(POOL, bad), POOL[0], `dayKey=${JSON.stringify(bad)}`)
  }
})

test('与 curatedCovers 的刷新日同一个日键：凌晨 6:00 前后分属两天、关键词必须不同', () => {
  // 5:59 仍算「前一天」，6:00 起算「当天」——与 CURATED_REFRESH_HOUR 对齐
  const before = curatedRefreshDayKey(new Date(2026, 10, 5, 5, 59).getTime())
  const after = curatedRefreshDayKey(new Date(2026, 10, 5, 6, 0).getTime())
  assert.notEqual(before, after, '刷新日键必须在 6:00 处翻页')
  assert.notEqual(
    pickDailyKeyword(POOL, before),
    pickDailyKeyword(POOL, after),
    '跨过刷新点后关键词必须变化（否则歌单换了封面不换，或反之）',
  )
})

test('同一天内的不同时刻用同一个词（0 点 / 5 点 / 23 点）', () => {
  // 11-05 00:30 与 05:59 都属于「11-04」这个刷新日；06:00 与 23:00 都属于「11-05」
  const lateNight = curatedRefreshDayKey(new Date(2026, 10, 5, 0, 30).getTime())
  const dawn = curatedRefreshDayKey(new Date(2026, 10, 5, 5, 59).getTime())
  const morning = curatedRefreshDayKey(new Date(2026, 10, 5, 6, 0).getTime())
  const evening = curatedRefreshDayKey(new Date(2026, 10, 5, 23, 0).getTime())
  assert.equal(pickDailyKeyword(POOL, lateNight), pickDailyKeyword(POOL, dawn))
  assert.equal(pickDailyKeyword(POOL, morning), pickDailyKeyword(POOL, evening))
})

test('六个真实词池当天取到的词都非空且各不相同（卡片之间不撞）', () => {
  // 与 Dashboard.tsx 的 CURATED_MIXES 保持一致的六个池（改池请同步这里）
  const POOLS = [
    ['经典', '老歌', '怀旧金曲', '华语经典', '岁月', '回忆', '金曲', '传唱'],
    ['流行', '热歌', '新歌', '华语流行', '热门', '潮流', '榜单', '情歌'],
    ['时光', '千禧', '港台经典', '粤语经典', '老唱片', '怀旧', '八零年代', '九零年代'],
    ['纯音乐', '轻音乐', '钢琴曲', '器乐', '环境音', '吉他', '治愈钢琴', '白噪音'],
    ['晚安', '助眠', '治愈', '温柔', '民谣', '慢歌', '夜色', '轻声'],
    ['摇滚', '电音', '节奏', '热血', '乐队', '舞曲', '鼓点', '燃'],
  ]
  // 连续 8 天检查：每天的 6 个词都非空，且当天六张卡互不相同
  for (let i = 0; i < 8; i++) {
    const day = `2026-11-${String(5 + i).padStart(2, '0')}`
    const ofDay = POOLS.map((p) => pickDailyKeyword(p, day))
    for (const kw of ofDay) assert.ok(kw, `${day} 出现了空关键词`)
    assert.equal(new Set(ofDay).size, POOLS.length,
      `${day} 有两张卡用了同一个词：${ofDay.join(' / ')}`)
  }
})
