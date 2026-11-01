/**
 * 错歌护栏（v2.44.0 ⑦）。
 *
 * 线上证据（务必保留）：分别解析 `吻别/张学友(kw:157908)` 与
 * `时光/许巍(kw:27811583)`，第三方聚合音源返回了**同一条** kuwo 直链
 * `car-er.kuwo.cn/.../M800001ziKgJ3o5Ipp.mp3` —— 界面显示 A、耳朵听到 B。
 *
 * 这里钉住三条：
 *  1. 两首不同的歌拿到同一 URL → 必须判为错歌；
 *  2. **同一首**歌反复解析拿到同一 URL（签名不同也算）→ 绝不能误杀；
 *  3. 结果自带元信息但歌名/歌手对不上 → 判为错歌；缺字段时放行（不误杀）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  UrlOwnerRegistry,
  matchesRequestedSong,
  songIdentityKey,
  urlIdentityKey,
} from '../src/server/songIdentityGuard.ts'

test('songIdentityKey：平台 + id，缺 id 返回 null', () => {
  assert.equal(songIdentityKey({ source: 'kw', songmid: '157908' }), 'kw:157908')
  assert.equal(songIdentityKey({ source: 'kw', id: 157908 }), 'kw:157908')
  assert.equal(songIdentityKey({ source: 'kg', hash: 'ABC' }), 'kg:ABC')
  assert.equal(songIdentityKey({ source: 'wy', meta: { songId: 493735159 } }), 'wy:493735159')
  // 无 id → 无法判定
  assert.equal(songIdentityKey({ source: 'kw', name: '没有 id' }), null)
  assert.equal(songIdentityKey({ source: 'kw', songmid: '0' }), null)
  assert.equal(songIdentityKey(null), null)
})

test('urlIdentityKey：忽略签名 query，只比 host+path', () => {
  const a = 'http://car-er.kuwo.cn/abc/M800001ziKgJ3o5Ipp.mp3?token=1&expires=111'
  const b = 'http://car-er.kuwo.cn/abc/M800001ziKgJ3o5Ipp.mp3?token=2&expires=999'
  assert.equal(urlIdentityKey(a), urlIdentityKey(b))
  assert.notEqual(
    urlIdentityKey(a),
    urlIdentityKey('http://car-er.kuwo.cn/abc/M800002WYrkV3TrVnK.mp3'),
  )
  assert.equal(urlIdentityKey(''), null)
})

test('真实复现：两首歌解析到同一 URL → 判定错歌', () => {
  const reg = new UrlOwnerRegistry({ ttlMs: 600_000 })
  const kiss = 'kw:157908' // 吻别/张学友
  const time = 'kw:27811583' // 时光/许巍
  const url = 'http://car-er.kuwo.cn/0ebe/resource/30106/trackmedia/M800001ziKgJ3o5Ipp.mp3'

  // 第一次解析：没人占用，放行并登记
  assert.equal(reg.check(url, kiss).collision, false)
  reg.remember(url, kiss)

  // 第二首不同的歌拿到同一链接 → 必须拦截
  const hit = reg.check(url, time)
  assert.equal(hit.collision, true)
  assert.equal(hit.owner, kiss)
  assert.match(String(hit.reason), /另一首歌/)
})

test('同一首歌重复解析（签名变化）不能误杀', () => {
  const reg = new UrlOwnerRegistry({ ttlMs: 600_000 })
  const key = 'kw:157908'
  reg.remember('http://car-er.kuwo.cn/a/M800001.mp3?sign=aaa', key)
  // 签名刷新后 path 相同
  assert.equal(reg.check('http://car-er.kuwo.cn/a/M800001.mp3?sign=bbb', key).collision, false)
})

test('登记过期后不再拦截（酷我直链会轮换）', () => {
  let now = 1_000_000
  const reg = new UrlOwnerRegistry({ ttlMs: 1000, now: () => now })
  const url = 'http://x/a.mp3'
  reg.remember(url, 'kw:1')
  assert.equal(reg.check(url, 'kw:2').collision, true)
  now += 1001
  assert.equal(reg.check(url, 'kw:2').collision, false)
})

test('容量上限：登记过多时淘汰最老的', () => {
  const reg = new UrlOwnerRegistry({ ttlMs: 600_000, maxEntries: 2 })
  reg.remember('http://x/1.mp3', 'kw:1')
  reg.remember('http://x/2.mp3', 'kw:2')
  reg.remember('http://x/3.mp3', 'kw:3')
  assert.ok(reg.size <= 2)
  assert.equal(reg.check('http://x/1.mp3', 'kw:9').collision, false)
})

test('matchesRequestedSong：元信息对不上判错歌，缺字段放行', () => {
  // 对得上
  assert.equal(
    matchesRequestedSong({ name: '吻别', singer: '张学友' }, { name: '吻别', singer: '张学友' }).ok,
    true,
  )
  // 括号/版本差异不算不同
  assert.equal(
    matchesRequestedSong({ name: '晴天', singer: '周杰伦' }, { name: '晴天 (Live)', singer: '周杰伦' }).ok,
    true,
  )
  // 歌名不同 → 错
  const nameBad = matchesRequestedSong({ name: '吻别', singer: '张学友' }, { name: '时光', singer: '许巍' })
  assert.equal(nameBad.ok, false)
  assert.match(String(nameBad.reason), /歌名不一致/)
  // 只有伴奏/翻唱等版本词差异：歌手仍是同一人 → 放行（版本差异由 URL 碰撞兜底）
  assert.equal(
    matchesRequestedSong({ name: '晴天', singer: '周杰伦' }, { name: '晴天', singer: '周杰伦、某合唱' }).ok,
    true,
  )
  // 缺字段 → 放行
  assert.equal(matchesRequestedSong({ name: '吻别' }, {}).ok, true)
  assert.equal(matchesRequestedSong(null, { name: 'x' }).ok, true)
})
