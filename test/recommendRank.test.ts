/**
 * 今日甄选推荐算法护栏（2026-11-05，v2.48.0）
 *
 * 背景：v2.47 用「同主题词池按天轮换」冒充推荐 —— 那只是编辑挑词，
 * 拿词去搜前 20 首，跟用户口味无关。本文件守住真实推荐的几条底线。
 *
 * 调研依据：
 *  - 网易云「每日推荐」综合听歌记录/收藏/歌单/歌手（官方 FAQ + 算法备案）；
 *  - Spotify Discover Weekly = 协同过滤 + 音频特征 + 内容过滤；
 *  - QQ 音乐「每日30首」= 知识图谱 + 行为序列。
 *  单机场景没有协同过滤的「相似用户」，所以这里走「平台官方推荐流 + 本地行为画像」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeSinger,
  rankByTheme,
  rankRecommended,
  recentlyPlayedKeys,
  seededShuffle,
  singerAffinity,
  songIdentityKey,
  themeScore,
  type RecommendSong,
} from '../src/modules/recommend/rank.ts'
import { buildMixPlaylists, dayKey, MIX_SPECS } from '../src/modules/recommend/service.ts'

const NOW = new Date(2026, 10, 5, 10, 0).getTime() // 2026-11-05 10:00 本地
const DAY = 24 * 60 * 60 * 1000

const songs = (...names: [string, string][]): RecommendSong[] =>
  names.map(([name, singer]) => ({ name, singer, source: 'tx' }))

// ===== 歌手归一 =====

test('歌手归一：多重署名只留主歌手，去掉括号注释', () => {
  assert.equal(normalizeSinger('周杰伦'), '周杰伦')
  assert.equal(normalizeSinger('周杰伦、杨瑞代'), '周杰伦')
  assert.equal(normalizeSinger('周杰伦 / 费玉清'), '周杰伦')
  assert.equal(normalizeSinger('LiSA (织部里沙)'), 'lisa')
  assert.equal(normalizeSinger('许嵩 feat. 黄龄'), '许嵩')
  assert.equal(normalizeSinger('张杰 ft. 某某'), '张杰')
  assert.equal(normalizeSinger('  邓紫棋  '), '邓紫棋')
  assert.equal(normalizeSinger(''), '')
  assert.equal(normalizeSinger(null), '')
})

test('归一后不同写法的同一歌手算一个人（否则亲和度会散掉）', () => {
  const a = normalizeSinger('周杰伦、杨瑞代')
  const b = normalizeSinger('周杰伦')
  assert.equal(a, b)
})

// ===== 歌手亲和度 =====

test('亲和度：听得多的歌手权重更高', () => {
  const hist = [
    { singer: '周杰伦', playCount: 10, playedAt: NOW - DAY },
    { singer: '林俊杰', playCount: 1, playedAt: NOW - DAY },
  ]
  const aff = singerAffinity(hist, null, NOW)
  assert.ok(aff.get('周杰伦')! > aff.get('林俊杰')!, '播放 10 次的应高于 1 次')
})

test('亲和度：时间衰减让「最近常听」压过「很久以前常听」', () => {
  const hist = [
    { singer: '老歌手', playCount: 8, playedAt: NOW - 60 * DAY }, // 两个月前
    { singer: '新欢', playCount: 8, playedAt: NOW - 1 * DAY }, // 昨天
  ]
  const aff = singerAffinity(hist, null, NOW)
  assert.ok(aff.get('新欢')! > aff.get('老歌手')!, '同样次数，最近的权重应更高')
})

test('亲和度：播放次数做对数压缩，不会一次循环就垄断画像', () => {
  const hist = [
    { singer: '单曲循环狂', playCount: 500, playedAt: NOW - DAY },
    { singer: '均衡听', playCount: 20, playedAt: NOW - DAY },
  ]
  const aff = singerAffinity(hist, null, NOW)
  const ratio = aff.get('单曲循环狂')! / aff.get('均衡听')!
  assert.ok(ratio < 3, `压缩后差距应远小于 25 倍，实际 ${ratio.toFixed(2)}`)
})

test('亲和度：收藏的歌手额外加分（收藏是更强的偏好信号）', () => {
  const hist = [{ singer: '听过但没收藏', playCount: 1, playedAt: NOW - DAY }]
  const lib = { singers: [{ name: '收藏的歌手' }] }
  const aff = singerAffinity(hist, lib, NOW)
  assert.ok((aff.get('收藏的歌手') ?? 0) > 0, '收藏歌手即使没播放也要有权重')
})

test('亲和度：空历史 / 空库不抛异常，返回空表', () => {
  assert.equal(singerAffinity([], null, NOW).size, 0)
  assert.equal(singerAffinity(null as unknown as [], undefined, NOW).size, 0)
})

// ===== 最近听过 =====

test('最近听过：只算 7 天内的，超过的不算', () => {
  const hist = [
    { name: '昨天的歌', singer: 'A', playedAt: NOW - 1 * DAY },
    { name: '十天前的歌', singer: 'B', playedAt: NOW - 10 * DAY },
  ]
  const recent = recentlyPlayedKeys(hist, NOW)
  assert.ok(recent.has(songIdentityKey('昨天的歌', 'A')))
  assert.ok(!recent.has(songIdentityKey('十天前的歌', 'B')))
})

// ===== 排序 =====

test('排序：偏好歌手的歌排在前面（个性化真的生效）', () => {
  const cand = songs(['路人歌', '路人'], ['我的最爱', '周杰伦'])
  const aff = new Map([['周杰伦', 5]])
  const { songs: out } = rankRecommended(cand, aff, new Set(), 10)
  assert.equal(out[0].name, '我的最爱', '偏好歌手应排第一')
})

test('排序：刚听过的降权，让每日推荐不重复昨天的', () => {
  const cand = songs(['刚听过的', '周杰伦'], ['没听过的', '周杰伦'])
  const aff = new Map([['周杰伦', 5]])
  const recent = new Set([songIdentityKey('刚听过的', '周杰伦')])
  const { songs: out } = rankRecommended(cand, aff, recent, 10)
  assert.equal(out[0].name, '没听过的')
})

test('排序：同一歌手最多 3 首，防止霸屏', () => {
  const cand: RecommendSong[] = Array.from({ length: 10 }, (_, i) => ({
    name: `周杰伦的歌${i}`, singer: '周杰伦',
  }))
  const { songs: out } = rankRecommended(cand, new Map([['周杰伦', 10]]), new Set(), 10, 3)
  assert.equal(out.length, 3, '单个歌手最多取 3 首')
})

test('排序：同名同歌手去重（跨平台同一首歌只留一条）', () => {
  const cand: RecommendSong[] = [
    { name: '晴天', singer: '周杰伦', source: 'tx' },
    { name: '晴天', singer: '周杰伦', source: 'wy' },
    { name: '晴天', singer: '周杰伦', source: 'kw' },
  ]
  const { songs: out } = rankRecommended(cand, new Map(), new Set(), 10)
  assert.equal(out.length, 1)
})

test('排序：limit 生效，且 limit=0 也不会返回空数组（至少 1 首）', () => {
  const cand = songs(['a', 'A'], ['b', 'B'], ['c', 'C'])
  assert.equal(rankRecommended(cand, new Map(), new Set(), 2).songs.length, 2)
  assert.equal(rankRecommended(cand, new Map(), new Set(), 0).songs.length, 1)
})

test('排序：脏数据（缺 name / null）被跳过，不抛异常', () => {
  const cand = [null, { name: '' }, { name: '好的', singer: 'X' }] as unknown as RecommendSong[]
  const { songs: out } = rankRecommended(cand, new Map(), new Set(), 10)
  assert.equal(out.length, 1)
  assert.equal(out[0].name, '好的')
})

// ===== 主题分区（六张卡的差异化） =====

test('主题打分：命中主题词加分', () => {
  const aff = new Map<string, number>()
  const hit = themeScore({ name: '摇滚现场版', singer: 'X' }, ['摇滚'], aff)
  const miss = themeScore({ name: '安静', singer: 'X' }, ['摇滚'], aff)
  assert.ok(hit > miss)
})

test('按主题切卡：六张卡从同一份池子里拿到不同的歌', () => {
  const pool: RecommendSong[] = [
    { name: '摇滚之歌', singer: 'A' },
    { name: '钢琴练习曲', singer: 'B' },
    { name: '晚安好梦', singer: 'C' },
    { name: '流行热单', singer: 'D' },
    { name: '经典老歌', singer: 'E' },
    { name: '普通一首', singer: 'F' },
  ]
  const aff = new Map<string, number>()
  const recent = new Set<string>()
  const pick = (id: string) => {
    const spec = MIX_SPECS.find((s) => s.id === id)!
    return rankByTheme(pool, spec.keywords, aff, recent, 1).songs[0]?.name
  }
  assert.equal(pick('drive'), '摇滚之歌')
  assert.equal(pick('focus'), '钢琴练习曲')
  assert.equal(pick('night'), '晚安好梦')
  assert.equal(pick('pop'), '流行热单')
  assert.equal(pick('nostalgia'), '经典老歌')
})

test('radar 卡不带主题词 = 纯个性化（空 keywords 时只按亲和度排）', () => {
  const spec = MIX_SPECS.find((s) => s.id === 'radar')!
  assert.equal(spec.keywords.length, 0, 'radar 必须是纯画像，不掺主题')
  const pool = songs(['大众歌', '路人'], ['我的菜', '周杰伦'])
  const aff = new Map([['周杰伦', 9]])
  const out = rankByTheme(pool, spec.keywords, aff, new Set(), 5)
  assert.equal(out.songs[0].name, '我的菜')
})

// ===== 按日轮换 =====

test('日键：凌晨 6:00 为界（与 curatedCovers 一致）', () => {
  assert.notEqual(
    dayKey(new Date(2026, 10, 5, 5, 59).getTime()),
    dayKey(new Date(2026, 10, 5, 6, 0).getTime()),
  )
})

test('洗牌：同一天稳定、跨天变化', () => {
  const pool = Array.from({ length: 20 }, (_, i) => i)
  const a = seededShuffle(pool, '2026-11-05')
  const b = seededShuffle(pool, '2026-11-05')
  const c = seededShuffle(pool, '2026-11-06')
  assert.deepEqual(a, b, '同一天必须一致（否则同一用户刷新就变）')
  assert.notDeepEqual(a, c, '跨天必须变化')
  assert.equal(a.length, pool.length, '洗牌不能丢元素')
})

// ===== 端到端（不打网络） =====

test('buildMixPlaylists：六张卡都能产出歌曲，且互不重复', () => {
  const pool: RecommendSong[] = [
    ...Array.from({ length: 6 }, (_, i) => ({ name: `摇滚${i}`, singer: `R${i}` })),
    ...Array.from({ length: 6 }, (_, i) => ({ name: `钢琴${i}`, singer: `P${i}` })),
    ...Array.from({ length: 6 }, (_, i) => ({ name: `晚安${i}`, singer: `N${i}` })),
    ...Array.from({ length: 6 }, (_, i) => ({ name: `流行${i}`, singer: `Po${i}` })),
    ...Array.from({ length: 6 }, (_, i) => ({ name: `经典${i}`, singer: `C${i}` })),
    ...Array.from({ length: 6 }, (_, i) => ({ name: `杂项${i}`, singer: `M${i}` })),
  ]
  const mixes = buildMixPlaylists({
    userName: 'u', history: [], library: null, pool, now: NOW, limit: 5,
  })
  assert.equal(mixes.length, 6, '必须六张卡都有结果')
  for (const m of mixes) {
    assert.ok(m.songs.length > 0, `卡 ${m.id} 没产出歌曲`)
    assert.ok(m.basis.length > 0, `卡 ${m.id} 缺少推荐依据说明`)
  }
  // 六张卡的首曲不应完全相同（否则又退回「六张卡一样」的老问题）
  const heads = mixes.map((m) => m.songs[0]?.name)
  assert.ok(new Set(heads).size >= 4, `六张卡首曲至少应有 4 种不同，实际 ${heads.join('/')}`)
})

test('buildMixPlaylists：有播放历史时卡会偏向该歌手（真的在个性化）', () => {
  // 池子要足够大：六张卡按主题顺序逐张取歌、彼此不重复，
  // 池子太小的话偏好歌手那首会被前面的主题卡先拿走（那是刻意的卡间去重）。
  const pool: RecommendSong[] = [
    ...Array.from({ length: 30 }, (_, i) => ({ name: `暖场曲${i}`, singer: `暖场${i}` })),
    ...Array.from({ length: 10 }, (_, i) => ({ name: `周杰伦的歌${i}`, singer: '周杰伦' })),
  ]
  const history = [{ singer: '周杰伦', playCount: 12, playedAt: NOW - DAY }]
  const mixes = buildMixPlaylists({
    userName: 'u', history, library: null, pool, now: NOW, limit: 5,
  })
  // 个性化体现在：偏好歌手的歌在多数卡里都排在前面
  const cardsWithJayTop = mixes.filter((m) => m.songs[0]?.singer === '周杰伦').length
  assert.ok(cardsWithJayTop >= 4, `偏好歌手的歌应在多数卡首位，实际 ${cardsWithJayTop}/6`)
  const reported = mixes.some((m) => m.topSingers.includes('周杰伦'))
  assert.ok(reported, `topSingers 应报告命中的偏好歌手，实际 ${JSON.stringify(mixes.map((m) => m.topSingers))}`)
})

test('buildMixPlaylists：六张卡之间不重复（否则又回到「点哪张都一样」）', () => {
  const pool: RecommendSong[] = Array.from({ length: 60 }, (_, i) => ({
    name: `曲目${i}`, singer: `歌手${i % 12}`,
  }))
  const mixes = buildMixPlaylists({ userName: 'u', history: [], library: null, pool, now: NOW, limit: 5 })
  const seen = new Set<string>()
  for (const m of mixes) {
    for (const s of m.songs) {
      const k = `${s.name}::${s.singer}`
      assert.ok(!seen.has(k), `卡 ${m.id} 与之前的卡重复了《${s.name}》`)
      seen.add(k)
    }
  }
  assert.ok(seen.size >= 20, `六张卡合计应有足够多的不同歌曲，实际 ${seen.size}`)
})

test('buildMixPlaylists：空候选池返回六张空卡，不抛异常', () => {
  const mixes = buildMixPlaylists({ userName: 'u', history: [], library: null, pool: [], now: NOW })
  assert.equal(mixes.length, 6)
  for (const m of mixes) assert.equal(m.songs.length, 0)
})
