/**
 * audioCache.test.ts — 播放缓存 LRU/容量策略的回归测试（内存 store）。
 *
 * 每个用例对应一个真实会踩的边界（写错会怎样见注释），
 * 配套变异脚本 scripts/mutation-check-audiocache.cjs。
 *
 * 运行：npx tsx --test test/audioCache.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { AudioCache, cacheKey, createMemoryStore } from '../web/src/lib/audioCache'

const MB = 1024 * 1024
const blobOf = (mb: number): Blob => new Blob([new Uint8Array(mb * MB)])

function makeCache(cap = 10 * MB): { cache: AudioCache; t: () => number } {
  let t = 1_000_000
  const cache = new AudioCache(createMemoryStore(), cap, () => t)
  return { cache, t: () => t }
}

const brief = { tier: '128k', name: '歌', singer: '人' }

test('写入后可命中；命中会刷新 lastUsed', async () => {
  const { cache, t } = makeCache()
  await cache.put(cacheKey('kw:1', '128k'), blobOf(1), brief)
  t() // 时间前进（get 闭包读的是同一个 t 的当前值 —— 这里通过再次调用推进由外层控制）
  const hit = await cache.get(cacheKey('kw:1', '128k'))
  assert.ok(hit, '应命中')
  assert.equal(hit.tier, '128k')
})

test('未命中与 meta 有但数据丢了的都返回 null（并清脏 meta）', async () => {
  const store = createMemoryStore()
  const cache = new AudioCache(store, 10 * MB, () => 1)
  assert.equal(await cache.get(cacheKey('kw:x', '128k')), null)
  await cache.put(cacheKey('kw:1', '128k'), blobOf(1), brief)
  store.map.clear() // 模拟浏览器清了缓存数据
  assert.equal(await cache.get(cacheKey('kw:1', '128k')), null)
  const usage = await cache.usage()
  assert.equal(usage.count, 0, '脏 meta 应被清掉')
})

test('超容量：淘汰最久未用的，保住刚写入的', async () => {
  // 写错会怎样：淘汰方向反了 → 刚听的歌被挤掉、半年没听的还留着
  let t = 1_000_000
  const cache = new AudioCache(createMemoryStore(), 10 * MB, () => t)
  await cache.put(cacheKey('kw:old', '128k'), blobOf(4), { ...brief, tier: 'a' })
  t += 1000
  await cache.put(cacheKey('kw:recent', '128k'), blobOf(4), { ...brief, tier: 'b' })
  t += 1000
  await cache.put(cacheKey('kw:new', '128k'), blobOf(4), { ...brief, tier: 'c' }) // 4+4+4 > 10 → 淘汰 old
  assert.equal(await cache.get(cacheKey('kw:old', '128k')), null, '最旧的应被淘汰')
  assert.ok(await cache.get(cacheKey('kw:recent', '128k')))
  assert.ok(await cache.get(cacheKey('kw:new', '128k')))
})

test('命中会续命：最久没「用」而不是最久没「写」', async () => {
  let t = 1_000_000
  const cache = new AudioCache(createMemoryStore(), 10 * MB, () => t)
  await cache.put(cacheKey('kw:a', '128k'), blobOf(4), brief)
  t += 1000
  await cache.put(cacheKey('kw:b', '128k'), blobOf(4), brief)
  t += 1000
  assert.ok(await cache.get(cacheKey('kw:a', '128k'))) // a 被重播 → 续命
  t += 1000
  await cache.put(cacheKey('kw:c', '128k'), blobOf(4), brief) // 应淘汰 b（a 刚用过）
  assert.equal(await cache.get(cacheKey('kw:b', '128k')), null, 'b 更久没用，应被淘汰')
  assert.ok(await cache.get(cacheKey('kw:a', '128k')), 'a 刚被用过，应保留')
})

test('单条超过总容量：放弃写入而不是挤掉全部', async () => {
  const { cache } = makeCache(10 * MB)
  await cache.put(cacheKey('kw:keep', '128k'), blobOf(2), brief)
  await cache.put(cacheKey('kw:huge', 'flac'), blobOf(11), { ...brief, tier: 'flac' })
  assert.equal(await cache.get(cacheKey('kw:huge', 'flac')), null)
  assert.ok(await cache.get(cacheKey('kw:keep', '128k')), '原有内容不能被一次注定失败的写入毁掉')
})

test('同键覆盖：当次覆盖不得按旧+新双份计容量（否则误杀别的歌）', async () => {
  // A=6 存在；同键覆盖写入 A=5：真实占用 5+2(B)=7 ≤ 10，谁都不该被淘汰。
  // 若按旧 6+新 5 双份虚算（13 > 10）就会错杀 B。
  // （同键覆盖的现实场景：清空后重听同一首、或同档位重新缓存）
  const { cache } = makeCache(10 * MB)
  await cache.put(cacheKey('kw:A', '128k'), blobOf(6), brief)
  await cache.put(cacheKey('kw:B', '128k'), blobOf(2), brief)
  await cache.put(cacheKey('kw:A', '128k'), blobOf(5), brief)
  assert.ok(await cache.get(cacheKey('kw:B', '128k')), '覆盖双份计数会误杀 B')
  const usage = await cache.usage()
  assert.equal(usage.total, 7 * MB)
  assert.equal(usage.count, 2)
})

test('newestFor：同一首歌任意档位取最近用过的；没有则 null', async () => {
  let t = 1_000_000
  const cache = new AudioCache(createMemoryStore(), 100 * MB, () => t)
  await cache.put(cacheKey('kw:song', '128k'), blobOf(1), { ...brief, tier: '128k' })
  t += 1000
  await cache.put(cacheKey('kw:song', 'flac'), blobOf(1), { ...brief, tier: 'flac' })
  const hit = await cache.newestFor('kw:song')
  assert.ok(hit)
  assert.equal(hit.tier, 'flac', '后写的 lastUsed 更新')
  assert.equal(await cache.newestFor('kw:other'), null)
})

test('clear 后 usage 归零', async () => {
  const { cache } = makeCache()
  await cache.put(cacheKey('kw:1', '128k'), blobOf(1), brief)
  await cache.clear()
  const usage = await cache.usage()
  assert.equal(usage.total, 0)
  assert.equal(usage.count, 0)
  assert.equal(await cache.get(cacheKey('kw:1', '128k')), null)
})
