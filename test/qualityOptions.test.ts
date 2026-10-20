/**
 * qualityOptions.test.ts — 每曲可用音质档位的回归测试。
 *
 * 每个用例都对应一个**真实的接口形状或踩过的坑**，注释里保留原始数据，
 * 避免以后有人「简化」规则时把缺陷放回来。
 *
 * 运行：npx tsx --test test/qualityOptions.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bestTier,
  isDegraded,
  pickStartTier,
  resolveExtensionTier,
  sizeLabel,
  songHasTier,
  songTiers,
  tierRank,
} from '../web/src/lib/qualityOptions'

/** 实测的搜索结果形状（酷我，`/api/music/search` 原样） */
const kwSong = {
  name: '晴天',
  singer: '周杰伦',
  source: 'kw',
  songmid: '228908',
  types: [
    { type: '128k', size: '4.12Mb' },
    { type: '320k', size: '10.29Mb' },
    { type: 'flac', size: '52.83Mb' },
  ],
  _types: {
    flac: { size: '52.83MB' },
    '320k': { size: '10.29MB' },
    '128k': { size: '4.12MB' },
  },
}

/** 实测的歌单曲目形状（网易云，`/api/user/list`）：档位在 meta.qualitys 下 */
const wySong = {
  id: 'wy_493735159',
  name: 'DAN DAN 心魅かれてく(Cinema Version)',
  singer: 'Field Of View',
  source: 'wy',
  meta: {
    songId: 493735159,
    qualitys: [
      { type: '128k', size: '1.69 MB' },
      { type: '320k', size: '4.22 MB' },
      { type: 'flac', size: '13.78 MB' },
    ],
  },
}

test('搜索结果：读 types，按档位由低到高排序', () => {
  assert.deepEqual(
    songTiers(kwSong).map((t) => t.type),
    ['128k', '320k', 'flac'],
  )
})

test('歌单曲目：types 缺失时读 meta.qualitys（两个字段名都要认）', () => {
  const tiers = songTiers(wySong)
  assert.deepEqual(tiers.map((t) => t.type), ['128k', '320k', 'flac'])
  assert.equal(tiers[1].size, '4.22 MB')
})

test('types 为空数组时回落 meta.qualitys（不能因空数组就当作「无数据」）', () => {
  const tiers = songTiers({ ...wySong, types: [] })
  assert.equal(tiers.length, 3)
})

test('只有 _types 对象映射时也能读（各平台原始形态）', () => {
  const tiers = songTiers({ source: 'kw', _types: { '320k': { size: '10.29MB' }, '128k': { size: '4 MB' } } })
  assert.deepEqual(tiers.map((t) => t.type), ['128k', '320k'])
})

test('重复档位保留带 size 的那条（体积是用户能感知的信息）', () => {
  const tiers = songTiers({
    types: [
      { type: 'flac' },
      { type: 'flac', size: '52.83Mb' },
    ],
  })
  assert.equal(tiers.length, 1)
  assert.equal(tiers[0].size, '52.83Mb')
})

test('未知档位（前端没有入口的）排在已知档位之后，且不冒充最高档', () => {
  const tiers = songTiers({
    types: [
      { type: 'atmos' },
      { type: '320k' },
      { type: 'master' },
    ],
  })
  assert.deepEqual(tiers.map((t) => t.type), ['320k', 'atmos', 'master'])
  // bestTier 只在前端可选档位里挑，否则会给出一个选不了的目标
  assert.equal(bestTier(tiers), '320k')
})

test('脏数据不炸：非数组/缺 type/非对象一律忽略', () => {
  assert.deepEqual(songTiers(null), [])
  assert.deepEqual(songTiers({ types: 'oops' as unknown }), [])
  assert.deepEqual(songTiers({ types: [null, 1, 'x', { size: '1 MB' }] as unknown }), [])
})

test('体积串归一：Mb / MB / 无空格 统一成「数值 单位」', () => {
  assert.equal(sizeLabel('10.29Mb'), '10.29 MB')
  assert.equal(sizeLabel('10.29 MB'), '10.29 MB')
  assert.equal(sizeLabel(' 4.12 mb '), '4.12 MB')
  assert.equal(sizeLabel('1024KB'), '1024 KB')
  // 解析不出的原样返回（绝不能出现 NaN）
  assert.equal(sizeLabel('约 10 兆'), '约 10 兆')
  assert.equal(sizeLabel(null), '')
})

test('bestTier：申报的最高可选档位；无申报返回 null', () => {
  assert.equal(bestTier(songTiers(kwSong)), 'flac')
  assert.equal(bestTier(songTiers({ types: [{ type: '320k' }, { type: 'flac24bit' }] })), 'flac24bit')
  assert.equal(bestTier([]), null)
  assert.equal(bestTier(songTiers({ types: [{ type: 'atmos' }] })), null)
})

test('tierRank：已知档位有序，未知返回 -1', () => {
  assert.ok(tierRank('128k') < tierRank('320k'))
  assert.ok(tierRank('320k') < tierRank('flac'))
  assert.ok(tierRank('flac') < tierRank('flac24bit'))
  assert.equal(tierRank('atmos'), -1)
  assert.equal(tierRank(null), -1)
})

test('档位顺序与前端 QUALITY_TIERS 完全一致（两份定义不能漂移）', () => {
  // qualityOptions.ts 刻意不 import '@/lib/quality'（否则 Node 单测解析不到路径），
  // 于是顺序有两份来源。这条断言就是防漂移的那把锁。
  const expected = ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires']
  expected.forEach((tier, i) => assert.equal(tierRank(tier), i, `档位 ${tier} 顺序不一致`))
  // 反向也钉住：不能多出/少掉某档（rank 恰好是 0..5）
  assert.deepEqual(
    expected.map((t) => tierRank(t)),
    [0, 1, 2, 3, 4, 5],
  )
})

test('songHasTier 精确匹配（不做大小写/别名归一）', () => {
  const tiers = songTiers(kwSong)
  assert.equal(songHasTier(tiers, 'flac'), true)
  assert.equal(songHasTier(tiers, 'flac24bit'), false)
})

test('pickStartTier：默认关 → 永远用用户首选（哪怕本曲能到更高）', () => {
  const tiers = songTiers(kwSong)
  assert.equal(pickStartTier(tiers, '320k', false), '320k')
  assert.equal(pickStartTier(tiers, '128k', false), '128k')
})

test('pickStartTier：开启后抬到本曲最高可用', () => {
  assert.equal(pickStartTier(songTiers(kwSong), '320k', true), 'flac')
})

test('pickStartTier：本曲最高档**低于**首选时仍按首选（不能被反向降级）', () => {
  // 用户要无损，但这首只有 320k：起点必须还是 flac，交给解析器决定降到哪
  const lowOnly = songTiers({ types: [{ type: '128k' }, { type: '320k' }] })
  assert.equal(pickStartTier(lowOnly, 'flac', true), 'flac')
})

test('pickStartTier：本曲无申报 / 档位未知时一律不猜', () => {
  assert.equal(pickStartTier([], 'flac', true), 'flac')
  assert.equal(pickStartTier(songTiers({ types: [{ type: 'atmos' }] }), '320k', true), '320k')
  // 用户首选是未知档位（音源自定义）时也不替换
  assert.equal(pickStartTier(songTiers(kwSong), 'custom-hi', true), 'custom-hi')
})

test('isDegraded：降级只认「更低」，升级与同档都不算', () => {
  assert.equal(isDegraded('320k', 'flac'), true) // 真降级
  assert.equal(isDegraded('flac', 'flac'), false) // 同档
  assert.equal(isDegraded('flac24bit', 'flac'), false) // 升级（开启自动最高档后常见）
  assert.equal(isDegraded(null, 'flac'), false)
  assert.equal(isDegraded('flac', null), false)
  // 未知档位无法比大小，退回「不等即降级」的保守判断
  assert.equal(isDegraded('custom-lo', 'flac'), true)
  assert.equal(isDegraded('custom-lo', 'custom-lo'), false)
})

test('resolveExtensionTier：档位与直链后缀矛盾时信 URL（真实字节的容器格式）', () => {
  // 声称 flac、实际直链是 mp3 —— 命名按 mp3，否则播放器按 flac 解码会失败
  assert.equal(resolveExtensionTier('flac', 'https://a.test/x/y.mp3?token=1'), 'mp3')
  // 反过来同理
  assert.equal(resolveExtensionTier('320k', 'https://a.test/x/y.flac'), 'flac')
  // 一致时按档位
  assert.equal(resolveExtensionTier('flac', 'https://a.test/x/y.flac'), 'flac')
  assert.equal(resolveExtensionTier('320k', 'https://a.test/x/y.mp3'), 'mp3')
  // URL 没有可识别后缀时不推翻档位判断
  assert.equal(resolveExtensionTier('flac', 'https://a.test/stream/123'), 'flac')
  assert.equal(resolveExtensionTier('hires', 'https://a.test/stream/123'), 'flac')
  assert.equal(resolveExtensionTier('320k', 'https://a.test/stream/123'), 'mp3')
})

test('resolveExtensionTier：wav/m4a/ogg 这些容器后缀不丢失（旧实现有，重写曾漏）', () => {
  // 回归：v2.28.0 第一版把 .wav 分支写丢了，下载的 wav 会被命名成 .mp3
  assert.equal(resolveExtensionTier('320k', 'https://a.test/x/y.wav'), 'wav')
  assert.equal(resolveExtensionTier('flac', 'https://a.test/x/y.m4a'), 'm4a')
  assert.equal(resolveExtensionTier(undefined, 'https://a.test/x/y.ogg'), 'ogg')
  // 三者都不能被误判成 flac/mp3
  for (const [q, u, want] of [
    ['flac', 'https://a.test/x/y.wav', 'wav'],
    ['320k', 'https://a.test/x/y.m4a', 'm4a'],
    ['hires', 'https://a.test/x/y.ogg', 'ogg'],
  ] as const) {
    assert.equal(resolveExtensionTier(q, u), want, `quality=${q} url=${u}`)
  }
})
