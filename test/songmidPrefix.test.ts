/**
 * songmidPrefix.test.ts — 平台前缀污染（歌单 songmid 带 wy_/kw_ 前缀）的回归测试。
 *
 * 【真实缺陷】落雪桌面同步来的歌单条目 songmid = "wy_493735159"（id 格式）。
 * 带前缀的 id 对平台 SDK 无效 → 替身源按歌名接管 → 播同名别的歌。
 * 服务端 normalizeSongInfo 必须无条件剥；前端 songKey 必须剥（缓存键统一 + 旧错曲缓存失效）。
 *
 * 运行：npx tsx --test test/songmidPrefix.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeSongInfo } from '../src/server/musicMatch'
import { songKey, stripSourcePrefix } from '../web/src/lib/songIdentity'

// ===== 服务端：normalizeSongInfo =====

test('服务端：songmid 带平台前缀时无条件剥掉', () => {
  // 旧逻辑只在 songmid 缺失时才从 id 转换并剥前缀 —— songmid 已存在时直接放行
  const s = normalizeSongInfo({ source: 'wy', songmid: 'wy_493735159', name: '歌', singer: '人' })
  assert.equal(s.songmid, '493735159')
})

test('服务端：id 带前缀同样剥（存量行为保持）', () => {
  const s = normalizeSongInfo({ source: 'kw', id: 'kw_228908', name: '歌', singer: '人' })
  assert.equal(s.songmid, '228908')
})

test('服务端：干净的 songmid 原样保留', () => {
  const s = normalizeSongInfo({ source: 'wy', songmid: '493735159', name: '歌', singer: '人' })
  assert.equal(s.songmid, '493735159')
})

test('服务端：kg 内部含下划线的 songmid（数字_哈希）不被误剥', () => {
  // 前缀必须完整匹配 `${source}_` 才剥；"abc_def" 这种内部下划线不是前缀
  const s = normalizeSongInfo({ source: 'kg', songmid: 'abc_def123', hash: 'h', name: '歌', singer: '人' })
  assert.equal(s.songmid, 'abc_def123')
})

test('服务端：tx 的 strMediaMid 等补全不受影响', () => {
  const s = normalizeSongInfo({
    source: 'tx', songmid: 'tx_0039MnYb0qxJhV', name: '歌', singer: '人',
    meta: { strMediaMid: '0039MnYb0qxJhV' },
  })
  assert.equal(s.songmid, '0039MnYb0qxJhV')
  assert.equal(s.strMediaMid, '0039MnYb0qxJhV')
})

test('服务端：songmid 缺失时仍走 id→songmid 转换（剥后）', () => {
  const s = normalizeSongInfo({ source: 'wy', id: 'wy_493735159', name: '歌', singer: '人' })
  assert.equal(s.songmid, '493735159')
})

// ===== 前端：songKey =====

test('前端：songKey 剥前缀（歌单条目与搜索结果同键）', () => {
  // 同一首歌：歌单里 songmid 带前缀，搜索结果干净 —— 必须同键，
  // 否则缓存/换源排除清单分裂、错曲固化在旧键下
  const fromPlaylist = songKey({ source: 'wy', songmid: 'wy_493735159', name: '歌', singer: '人' })
  const fromSearch = songKey({ source: 'wy', songmid: '493735159', name: '歌', singer: '人' })
  assert.equal(fromPlaylist, fromSearch)
  assert.equal(fromSearch, 'wy:493735159')
})

test('前端：非字符串 id（数字）照常工作', () => {
  assert.equal(songKey({ source: 'kw', songmid: 228908, name: '歌', singer: '人' }), 'kw:228908')
})

test('前端：id 缺失回落 名|歌手', () => {
  assert.equal(songKey({ source: 'kw', name: '晴天', singer: '周杰伦' }), 'kw:晴天|周杰伦')
})
test('前端：kg 内部含下划线的 songmid 不被误剥', () => {
  // 宽松匹配（含 _ 就剥）会把 abc_def123 剥成 def123 —— kg 的 数字_哈希 格式
  assert.equal(songKey({ source: 'kg', songmid: 'abc_def123', name: '歌', singer: '人' }), 'kg:abc_def123')
})
