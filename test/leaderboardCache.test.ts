/**
 * 排行榜服务端短缓存（v2.44.0 ⑤）。
 *
 * 缓存最容易在四处悄悄失效，测试逐条钉住：
 *  1. key 少了维度 → 切榜单拿到上一个榜单的歌（比不缓存更糟）
 *  2. 不过期 → 榜单永远停在第一次的结果
 *  3. 无界 → 内存被不同的 bangid/page 撑爆
 *  4. 并发不去重 → 首屏同时请求多个榜单时等于没缓存
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLeaderboardCache, leaderboardCacheKey } from '../src/server/leaderboardCache.ts'

test('缓存键必须同时包含 source / bangid / page', () => {
  const a = leaderboardCacheKey('kg', '6666', 1)
  assert.notEqual(a, leaderboardCacheKey('wy', '6666', 1))
  assert.notEqual(a, leaderboardCacheKey('kg', '8888', 1))
  assert.notEqual(a, leaderboardCacheKey('kg', '6666', 2))
  assert.equal(a, leaderboardCacheKey('kg', '6666', 1))
})

test('TTL 到期后必须重新加载', async () => {
  let now = 1000
  const cache = createLeaderboardCache<{ n: number }>({ ttlMs: 100, now: () => now })
  let loads = 0
  const load = async () => ({ n: ++loads })

  assert.deepEqual(await cache.getOrLoad('k', load), { n: 1 })
  assert.deepEqual(await cache.getOrLoad('k', load), { n: 1 })
  now += 101
  assert.deepEqual(await cache.getOrLoad('k', load), { n: 2 })
})

test('容量上限按 LRU 淘汰', () => {
  let now = 0
  const cache = createLeaderboardCache<number>({ ttlMs: 60_000, maxEntries: 2, now: () => now })
  cache.set('a', 1)
  cache.set('b', 2)
  assert.equal(cache.get('a'), 1) // 访问 a → a 变成最近使用
  cache.set('c', 3) // 应淘汰 b
  assert.equal(cache.get('b'), undefined)
  assert.equal(cache.get('a'), 1)
  assert.equal(cache.get('c'), 3)
  assert.equal(cache.size, 2)
})

test('并发请求同一 key 只打一次上游（in-flight 去重）', async () => {
  const cache = createLeaderboardCache<number>({ ttlMs: 60_000 })
  let calls = 0
  let release!: (v: number) => void
  const loader = () =>
    new Promise<number>((resolve) => {
      calls++
      release = resolve
    })

  const p1 = cache.getOrLoad('same', loader)
  const p2 = cache.getOrLoad('same', loader)
  const p3 = cache.getOrLoad('same', loader)
  await Promise.resolve()
  assert.equal(calls, 1)
  release(42)
  assert.deepEqual(await Promise.all([p1, p2, p3]), [42, 42, 42])
})

test('加载失败不写缓存：下一次仍会重试', async () => {
  const cache = createLeaderboardCache<number>({ ttlMs: 60_000 })
  let calls = 0
  await assert.rejects(
    cache.getOrLoad('k', async () => {
      calls++
      throw new Error('upstream 500')
    }),
  )
  assert.equal(calls, 1)
  assert.equal(await cache.getOrLoad('k', async () => {
    calls++
    return 7
  }), 7)
  assert.equal(calls, 2)
})

test('refresh 无视 TTL 强制打上游，并用新值替换缓存（force=1 专用）', async () => {
  let now = 1000
  const cache = createLeaderboardCache<{ n: number }>({ ttlMs: 100, now: () => now })
  let loads = 0
  const load = async () => ({ n: ++loads })

  assert.deepEqual(await cache.getOrLoad('k', load), { n: 1 })
  // TTL 内的普通请求仍走缓存
  assert.deepEqual(await cache.getOrLoad('k', load), { n: 1 })
  // 强刷：即使没过期也打上游，且新值写回缓存
  assert.deepEqual(await cache.refresh('k', load), { n: 2 })
  assert.deepEqual(await cache.getOrLoad('k', load), { n: 2 })
  assert.equal(loads, 2)
})

test('refresh 失败时不污染缓存：旧值仍在，下次普通请求还能命中', async () => {
  let now = 1000
  const cache = createLeaderboardCache<{ n: number }>({ ttlMs: 100, now: () => now })
  let loads = 0
  const load = async () => ({ n: ++loads })

  assert.deepEqual(await cache.getOrLoad('k', load), { n: 1 })
  await assert.rejects(
    cache.refresh('k', async () => {
      throw new Error('upstream 500')
    }),
  )
  // 强刷失败不能把旧条目删掉 —— 否则用户连旧榜都没得看
  assert.deepEqual(await cache.getOrLoad('k', load), { n: 1 })
})
