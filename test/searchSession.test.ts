/**
 * searchSession.test.ts — 搜索会话快照的回归测试（2026-10-29 用户报告）。
 *
 * 【真实缺陷】用户实测：搜索结果里点一首歌 → 进全屏播放页 → 返回，
 * 搜索页**整页空白**，必须重新搜一遍。原因是结果全在组件本地 state，
 * 路由切走即销毁。修复用模块级快照在重新挂载时恢复。
 *
 * 这里钉住快照的判定边界（尤其**不要**恢复半截状态）。
 *
 * 运行：npx tsx --test test/searchSession.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  clearSearchSnapshot,
  isRestorable,
  loadSearchSnapshot,
  saveSearchScrollY,
  saveSearchSnapshot,
} from '../web/src/lib/searchSession'

const base = {
  keyword: '晴天',
  searchedFor: '晴天',
  source: 'all',
  kind: 'song' as const,
  phase: 'done' as const,
  results: [{ source: 'wy', songmid: '1', name: '晴天', singer: '周杰伦' }] as any[],
  singers: [],
  error: null,
  hasMore: true,
  scrollY: 0,
}

test('初始状态没有快照', () => {
  clearSearchSnapshot()
  assert.equal(loadSearchSnapshot(), null)
})

test('保存后可原样读回，且带 savedAt 时间戳', () => {
  clearSearchSnapshot()
  const before = Date.now()
  saveSearchSnapshot(base)
  const s = loadSearchSnapshot()
  assert.ok(s)
  assert.equal(s.keyword, '晴天')
  assert.equal(s.results.length, 1)
  assert.equal(s.hasMore, true)
  assert.ok(s.savedAt >= before && s.savedAt <= Date.now())
})

test('重复保存是覆盖，不累加', () => {
  clearSearchSnapshot()
  saveSearchSnapshot(base)
  saveSearchSnapshot({ ...base, keyword: '七里香', searchedFor: '七里香' })
  const s = loadSearchSnapshot()
  assert.equal(s?.keyword, '七里香')
})

test('done 态且有关键词 → 可恢复', () => {
  assert.equal(isRestorable({ ...base, savedAt: 0 }), true)
})

test('done 但结果为空（真的没搜到）→ 也可恢复（用户能看到搜过什么）', () => {
  assert.equal(
    isRestorable({ ...base, results: [], savedAt: 0 }),
    true,
    '无结果也是有效终态，恢复后显示「没有找到 X」比空白好',
  )
})

test('loading 态不恢复 —— 那个请求被 abort 了，恢复只会永远转圈', () => {
  assert.equal(isRestorable({ ...base, phase: 'loading', savedAt: 0 }), false)
})

test('error 态不恢复（避免把一次失败当作当前状态）', () => {
  assert.equal(isRestorable({ ...base, phase: 'error', savedAt: 0 }), false)
})

test('idle 态不恢复', () => {
  assert.equal(isRestorable({ ...base, phase: 'idle', savedAt: 0 }), false)
})

test('没有搜索词的空快照不恢复', () => {
  assert.equal(isRestorable({ ...base, searchedFor: '   ', savedAt: 0 }), false)
})

test('null 快照不恢复', () => {
  assert.equal(isRestorable(null), false)
})

test('滚动位置只在已有快照时更新，不会凭空创建快照', () => {
  clearSearchSnapshot()
  saveSearchScrollY(1200)
  assert.equal(loadSearchSnapshot(), null, '没有快照时写滚动位置不应创建一条空快照')

  saveSearchSnapshot(base)
  saveSearchScrollY(880)
  assert.equal(loadSearchSnapshot()?.scrollY, 880)
})

test('再次 saveSearchSnapshot 不会丢掉已记录的滚动位置（调用方负责带上）', () => {
  clearSearchSnapshot()
  saveSearchSnapshot({ ...base, scrollY: 640 })
  const s = loadSearchSnapshot()
  assert.equal(s?.scrollY, 640)
})

test('clear 之后不可恢复', () => {
  saveSearchSnapshot(base)
  clearSearchSnapshot()
  assert.equal(isRestorable(loadSearchSnapshot()), false)
})
