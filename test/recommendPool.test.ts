/**
 * 今日甄选候选池与配额护栏（v2.48.1）
 *
 * v2.48.0 线上实测暴露两个问题，本文件防止它们复发：
 *   1. **画像无效**：候选池只有平台新专辑约 20 首，与用户播放历史里的 24 位歌手
 *      交集为 0 —— 个性化打分根本没有作用空间。修法是双源池（推荐流 + 口味回响）。
 *   2. **配额极不均**：drive 拿到 20 首，radar/pop/nostalgia 各只有 3 首。
 *      修法是两轮分配。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCandidatePool,
  mergePools,
  pickSeedSingers,
  poolKey,
} from '../src/modules/recommend/pool.ts'
import { buildMixPlaylists, MIX_SPECS } from '../src/modules/recommend/service.ts'
import type { RecommendSong } from '../src/modules/recommend/rank.ts'

const NOW = new Date(2026, 10, 5, 10, 0).getTime()
const mk = (name: string, singer: string): RecommendSong => ({ name, singer })

// ===== 候选池合并 =====

test('poolKey：跨平台同名同歌手视为同一首', () => {
  assert.equal(poolKey(mk('晴天', '周杰伦')), poolKey(mk('晴天', '周杰伦、杨瑞代')))
  assert.notEqual(poolKey(mk('晴天', '周杰伦')), poolKey(mk('晴天', '孙燕姿')))
  assert.equal(poolKey({ name: '' } as RecommendSong), '')
})

test('mergePools：去重且保持先到优先（口味源排前面）', () => {
  const taste = [mk('A', 'x'), mk('B', 'y')]
  const discover = [mk('B', 'y'), mk('C', 'z')]
  const merged = mergePools(taste, discover)
  assert.equal(merged.length, 3)
  assert.equal(merged[0].name, 'A', '先到的源应排前面')
  assert.deepEqual(merged.map((s) => s.name), ['A', 'B', 'C'])
})

test('mergePools：脏数据被过滤，不抛异常', () => {
  const merged = mergePools(
    [null, { name: '' }, { name: 'ok', singer: 'a' }] as unknown as RecommendSong[],
    undefined,
    null,
  )
  assert.equal(merged.length, 1)
})

// ===== 种子歌手选择 =====

test('pickSeedSingers：按权重降序取前几位', () => {
  const aff = new Map([['周杰伦', 5], ['林俊杰', 9], ['陈奕迅', 1]])
  assert.deepEqual(pickSeedSingers(aff, 2), ['林俊杰', '周杰伦'])
})

test('pickSeedSingers：过滤纯符号与单字符（搜索噪音大），保留中英文真实名', () => {
  const aff = new Map([
    ['-', 9],          // 纯符号：过滤
    ['·', 8],          // 纯符号：过滤
    ['x', 7],          // 单字符：过滤
    ['周杰伦', 6],      // 保留
    ['LiSA', 5],       // 保留（英文名常见）
  ])
  const picked = pickSeedSingers(aff, 10)
  assert.ok(picked.includes('周杰伦'))
  assert.ok(picked.includes('LiSA'), '英文歌手名应保留')
  assert.ok(!picked.includes('x'), '单字符不该作为种子')
  assert.ok(!picked.includes('-'), '纯符号不该作为种子')
  assert.ok(!picked.includes('·'), '纯符号不该作为种子')
})

test('pickSeedSingers：空画像返回空数组', () => {
  assert.deepEqual(pickSeedSingers(new Map(), 5), [])
})

// ===== 双源池（核心修复） =====

test('buildCandidatePool：两个源都进池子，且口味源优先', async () => {
  const res = await buildCandidatePool({
    fetchDiscover: async () => [mk('新人歌', '陌生歌手')],
    searchSongs: async () => [mk('周杰伦的歌', '周杰伦')],
    affinity: new Map([['周杰伦', 9]]),
  })
  assert.equal(res.pool.length, 2)
  assert.equal(res.pool[0].name, '周杰伦的歌', '口味源应排在前面')
  assert.equal(res.stats.taste, 1)
  assert.equal(res.stats.discover, 1)
})

test('buildCandidatePool：只保留确实是该歌手的搜索结果（不被搜索噪音污染）', async () => {
  const res = await buildCandidatePool({
    fetchDiscover: async () => [],
    searchSongs: async () => [
      mk('对的结果', '周杰伦'),
      mk('别人的歌', '某个翻唱歌手'), // 搜索常见噪音
    ],
    affinity: new Map([['周杰伦', 9]]),
  })
  assert.equal(res.pool.length, 1)
  assert.equal(res.pool[0].name, '对的结果')
})

test('buildCandidatePool：推荐流挂掉也能出推荐（降级不空窗）', async () => {
  const res = await buildCandidatePool({
    fetchDiscover: async () => { throw new Error('上游 502') },
    searchSongs: async () => [mk('口味歌', '周杰伦')],
    affinity: new Map([['周杰伦', 9]]),
  })
  assert.equal(res.pool.length, 1, '源 A 失败不该让整体为空')
})

test('buildCandidatePool：某个种子歌手搜索失败不影响其他歌手', async () => {
  let call = 0
  const res = await buildCandidatePool({
    fetchDiscover: async () => [],
    searchSongs: async () => {
      call += 1
      if (call === 1) throw new Error('限流')
      return [mk('第二位的歌', '林俊杰')]
    },
    affinity: new Map([['周杰伦', 9], ['林俊杰', 5]]),
  })
  assert.equal(res.pool.length, 1)
  assert.equal(res.pool[0].name, '第二位的歌')
})

test('buildCandidatePool：无画像时只走推荐流（冷启动仍给内容）', async () => {
  const res = await buildCandidatePool({
    fetchDiscover: async () => [mk('新歌', '新歌手')],
    searchSongs: async () => { throw new Error('不该被调用') },
    affinity: new Map(),
  })
  assert.equal(res.pool.length, 1)
  assert.deepEqual(res.seedSingers, [])
})

// ===== 配额均衡（第二个修复） =====

test('buildMixPlaylists：六张卡配额均衡，不再出现「一张 20 首、一张 3 首」', () => {
  const pool: RecommendSong[] = Array.from({ length: 60 }, (_, i) => mk(`曲${i}`, `歌手${i % 15}`))
  const mixes = buildMixPlaylists({
    userName: 'u', history: [], library: null, pool, now: NOW, limit: 20,
  })
  const counts = mixes.map((m) => m.songs.length)
  const min = Math.min(...counts)
  const max = Math.max(...counts)
  assert.ok(min >= 3, `每张卡至少 3 首，实际 ${counts.join('/')}`)
  assert.ok(max - min <= 12, `配额外差不应过大，实际 ${counts.join('/')}`)
})

test('buildMixPlaylists：池子很大时每张卡都能填满 limit', () => {
  const pool: RecommendSong[] = Array.from({ length: 200 }, (_, i) => mk(`曲${i}`, `歌手${i % 40}`))
  const mixes = buildMixPlaylists({
    userName: 'u', history: [], library: null, pool, now: NOW, limit: 10,
  })
  for (const m of mixes) {
    assert.ok(m.songs.length >= 5, `卡 ${m.id} 只有 ${m.songs.length} 首`)
  }
})

test('buildMixPlaylists：回填也不会破坏卡间去重', () => {
  const pool: RecommendSong[] = Array.from({ length: 120 }, (_, i) => mk(`曲${i}`, `歌手${i % 30}`))
  const mixes = buildMixPlaylists({
    userName: 'u', history: [], library: null, pool, now: NOW, limit: 15,
  })
  const seen = new Set<string>()
  for (const m of mixes) {
    for (const s of m.songs) {
      const k = `${s.name}::${s.singer}`
      assert.ok(!seen.has(k), `重复歌曲《${s.name}》出现在卡 ${m.id}`)
      seen.add(k)
    }
  }
})

test('buildMixPlaylists：单歌手仍最多 3 首（回填时也守住）', () => {
  const pool: RecommendSong[] = Array.from({ length: 60 }, (_, i) => mk(`同一歌手的歌${i}`, '霸屏歌手'))
  const mixes = buildMixPlaylists({
    userName: 'u', history: [], library: null, pool, now: NOW, limit: 20,
  })
  for (const m of mixes) {
    assert.ok(m.songs.length <= 3, `卡 ${m.id} 出现 ${m.songs.length} 首同歌手（应 ≤3）`)
  }
})

test('六张卡的 id 与服务端 MIX_SPECS 完全对齐（前端靠 id 取数据）', () => {
  assert.deepEqual(
    MIX_SPECS.map((s) => s.id),
    ['radar', 'pop', 'nostalgia', 'focus', 'night', 'drive'],
  )
})
