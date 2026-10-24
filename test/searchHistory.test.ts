/**
 * searchHistory.test.ts — 最近搜索的纯逻辑回归测试。
 *
 * 每个用例对应一个真实会踩的边界（写错会怎样见各行注释）。
 * mergeSearchHistory 是纯函数，直接测；localStorage 的读写包装
 * （load 的容错 / save 的静默）用一个最小桩覆盖。
 *
 * 运行：npx tsx --test test/searchHistory.test.ts
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  mergeSearchHistory,
  loadSearchHistory,
  pushSearchHistory,
  removeSearchHistory,
  clearSearchHistory,
} from '../web/src/lib/searchHistory'

// ---- 最小 localStorage 桩（node 没有 DOM）----
const store = new Map<string, string>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}

beforeEach(() => {
  store.clear()
})

test('新词记录到最前', () => {
  assert.deepEqual(mergeSearchHistory(['b', 'a'], 'c'), ['c', 'b', 'a'])
})

test('重复搜索把旧条目挪到最前（不是保留原位置）', () => {
  // 写错会怎样：搜过的词沉在列表中后段，用户要再点它得找半天
  assert.deepEqual(mergeSearchHistory(['a', 'b', 'c'], 'b'), ['b', 'a', 'c'])
})

test('重复搜索不会产生第二条（去重）', () => {
  const once = mergeSearchHistory([], '周杰伦')
  const twice = mergeSearchHistory(once, '周杰伦')
  assert.equal(twice.length, 1)
  assert.deepEqual(twice, ['周杰伦'])
})

test('超过上限丢弃最旧的（cap=10，列表是新→旧序，最旧在末尾）', () => {
  const base = Array.from({ length: 10 }, (_, i) => `词${i}`) // 词0 最新 … 词9 最旧
  const next = mergeSearchHistory(base, '新词')
  assert.equal(next.length, 10)
  assert.equal(next[0], '新词')
  // 最旧的「词9」被挤出（从末尾丢），其余保序
  assert.ok(!next.includes('词9'), `词9 不应还在列表里: ${JSON.stringify(next)}`)
  assert.deepEqual(next.slice(1), base.slice(0, 9))
})

test('空白词不记录（首尾空格也不算新词）', () => {
  assert.deepEqual(mergeSearchHistory(['a'], '   '), ['a'])
  // '  b  ' trim 后等于 'b'：应当视作重复搜索 b
  assert.deepEqual(mergeSearchHistory(['a', 'b'], '  b  '), ['b', 'a'])
})

test('push 后能 load 回来（持久化）', () => {
  pushSearchHistory('晴天')
  pushSearchHistory('七里香')
  assert.deepEqual(loadSearchHistory(), ['七里香', '晴天'])
})

test('remove 只删指定条目', () => {
  pushSearchHistory('a')
  pushSearchHistory('b')
  const next = removeSearchHistory('a')
  assert.deepEqual(next, ['b'])
  assert.deepEqual(loadSearchHistory(), ['b'])
})

test('clear 之后为空', () => {
  pushSearchHistory('a')
  clearSearchHistory()
  assert.deepEqual(loadSearchHistory(), [])
})

test('存储里是损坏 JSON 时当作空历史（不抛错）', () => {
  store.set('lx.search.history', '{oops')
  assert.deepEqual(loadSearchHistory(), [])
})

test('存储里被塞了非字符串时只保留字符串项', () => {
  store.set('lx.search.history', JSON.stringify(['a', 123, null, 'b']))
  assert.deepEqual(loadSearchHistory(), ['a', 'b'])
})
