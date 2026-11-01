/**
 * 「今日甄选」封面获取与缓存（v2.44.0 ②）。
 *
 * 这里守三条承诺：
 *  1. **绝不裂图**：只接受 https / 相对路径；明文 http 一律拒绝（HTTPS 页面会是 Mixed Content）。
 *  2. **缓存能失效**：localStorage 键带版本前缀，并有 TTL 与脏数据清理。
 *  3. **不阻塞、不互相拖累**：单张卡搜不到/抛错只影响这一张；并发有上限。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CURATED_COVER_TTL_MS,
  curatedCoverCacheKey,
  fetchCuratedCovers,
  forgetCuratedCover,
  isUsableCoverUrl,
  pickCoverFromSongs,
  readCuratedCover,
  readCuratedCovers,
  writeCuratedCover,
  type StorageLike,
} from '../web/src/lib/curatedCovers.ts'

function memStore(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

test('缓存键带版本前缀，便于整体失效', () => {
  assert.match(curatedCoverCacheKey('radar'), /^lxserver:curatedCovers:v\d+:radar$/)
})

test('明文 http 封面一律不可用（避免 Mixed Content），https/相对路径可用', () => {
  assert.equal(isUsableCoverUrl('http://p1.music.126.net/a.jpg'), false)
  assert.equal(isUsableCoverUrl('https://p1.music.126.net/a.jpg'), true)
  assert.equal(isUsableCoverUrl('/app/icons/icon-192.png'), true)
  assert.equal(isUsableCoverUrl('data:text/html,<b>x</b>'), false)
  assert.equal(isUsableCoverUrl(''), false)
  assert.equal(isUsableCoverUrl(undefined), false)
})

test('pickCoverFromSongs 取第一张可用封面，并把已知图床升级成 https', () => {
  const songs = [
    { picUrl: '' },
    { picUrl: 'http://p2.music.126.net/cover.jpg' },
    { picUrl: 'https://p3.music.126.net/other.jpg' },
  ]
  assert.equal(pickCoverFromSongs(songs), 'https://p2.music.126.net/cover.jpg')
  assert.equal(pickCoverFromSongs([]), undefined)
  assert.equal(pickCoverFromSongs(null), undefined)
})

test('读写缓存：命中 / 过期 / 脏数据三种情况', () => {
  const store = memStore()
  const now = 1_700_000_000_000
  assert.equal(writeCuratedCover(store, 'radar', 'https://cdn/a.jpg', now), true)
  assert.equal(readCuratedCover(store, 'radar', now + 1000), 'https://cdn/a.jpg')
  // 过期 → 丢弃并让调用方重取
  assert.equal(readCuratedCover(store, 'radar', now + CURATED_COVER_TTL_MS + 1), undefined)
  assert.equal(store.map.has(curatedCoverCacheKey('radar')), false)

  // 脏数据（不是 JSON）被清掉，而不是每次读都抛
  store.setItem(curatedCoverCacheKey('pop'), '{oops')
  assert.equal(readCuratedCover(store, 'pop', now), undefined)
  assert.equal(store.map.has(curatedCoverCacheKey('pop')), false)

  // 不可用地址不写缓存（宁可不缓存，也不缓存一个会裂图的地址）
  assert.equal(writeCuratedCover(store, 'night', 'http://insecure/a.jpg', now), false)
})

test('readCuratedCovers 只返回仍在有效期内的条目', () => {
  const store = memStore()
  const now = Date.now()
  writeCuratedCover(store, 'radar', 'https://cdn/a.jpg', now)
  const got = readCuratedCovers(store, [{ id: 'radar', query: '经典' }, { id: 'pop', query: '流行' }])
  assert.deepEqual(got, { radar: 'https://cdn/a.jpg' })
})

test('fetchCuratedCovers：缓存命中不再搜索，缺失的才搜且单卡失败静默', async () => {
  const store = memStore()
  const now = Date.now()
  writeCuratedCover(store, 'radar', 'https://cdn/cached.jpg', now)

  const searched: string[] = []
  const covers = await fetchCuratedCovers(
    [
      { id: 'radar', query: '经典' },
      { id: 'pop', query: '流行' },
      { id: 'night', query: '晚安' },
    ],
    {
      store,
      now: () => now,
      concurrency: 1,
      staggerMs: 0,
      sleep: async () => {},
      search: async (query) => {
        searched.push(query)
        if (query === '流行') throw new Error('network down')
        if (query === '晚安') return [] // 搜不到 → 回落渐变
        return [{ picUrl: 'http://p1.music.126.net/x.jpg' }]
      },
    },
  )

  assert.deepEqual(searched.sort(), ['晚安', '流行'])
  assert.deepEqual(covers, { radar: 'https://cdn/cached.jpg' })
  // 搜到的那张也只会是 https
  assert.equal(store.map.has(curatedCoverCacheKey('night')), false)
})

test('fetchCuratedCovers：成功时回调 onCover 并写缓存', async () => {
  const store = memStore()
  const seen: string[] = []
  const covers = await fetchCuratedCovers([{ id: 'pop', query: '流行' }], {
    store,
    concurrency: 2,
    staggerMs: 0,
    sleep: async () => {},
    onCover: (id, url) => seen.push(`${id}=${url}`),
    search: async () => [{ picUrl: 'http://p1.music.126.net/y.jpg' }],
  })
  assert.deepEqual(covers, { pop: 'https://p1.music.126.net/y.jpg' })
  assert.deepEqual(seen, ['pop=https://p1.music.126.net/y.jpg'])
  assert.equal(readCuratedCover(store, 'pop'), 'https://p1.music.126.net/y.jpg')

  // 图片加载失败时可以主动丢弃缓存，下次进首页重取
  forgetCuratedCover(store, 'pop')
  assert.equal(readCuratedCover(store, 'pop'), undefined)
})
