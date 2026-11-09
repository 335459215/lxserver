/** 播放预加载的纯决策逻辑（v2.49.4）。
 *
 *  这里钉的都是「**不该预取**」的场景 —— 预取写错方向的代价比不预取更糟：
 *  随机播放里瞎抓会白耗流量、3G 下抢带宽会让当前曲更卡、
 *  替身歌被抓进来会固化错歌。所以每条护栏都要有测试。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hasEnoughTimeLeft,
  nextSongForPrefetch,
  shouldPrefetch,
  type PrefetchEnv,
} from '../web/src/lib/prefetch.ts'
import type { Song } from '../web/src/lib/music.ts'

const song = (id: string): Song => ({ id, name: `歌${id}`, singer: 'x', source: 'kw' }) as Song

const baseEnv: PrefetchEnv = {
  cacheEnabled: true,
  saveData: false,
  effectiveType: '4g',
  queueLength: 5,
  index: 0,
  shuffle: false,
  repeat: 'all',
  busy: false,
  online: true,
}

test('nextSongForPrefetch：顺序播取下一条', () => {
  const q = [song('a'), song('b'), song('c')]
  assert.equal(nextSongForPrefetch(q, 0, { shuffle: false, repeat: 'all' })?.id, 'b')
  assert.equal(nextSongForPrefetch(q, 1, { shuffle: false, repeat: 'all' })?.id, 'c')
})

test('nextSongForPrefetch：末尾时列表循环回到第一首，不循环则没有下一首', () => {
  const q = [song('a'), song('b')]
  assert.equal(nextSongForPrefetch(q, 1, { shuffle: false, repeat: 'all' })?.id, 'a')
  assert.equal(nextSongForPrefetch(q, 1, { shuffle: false, repeat: 'off' }), null)
})

test('nextSongForPrefetch：随机播放与单曲循环都不预测', () => {
  const q = [song('a'), song('b')]
  assert.equal(nextSongForPrefetch(q, 0, { shuffle: true, repeat: 'all' }), null,
    '随机播放选下一首用的是 Math.random()，预取大概率抓错歌，白耗流量')
  assert.equal(nextSongForPrefetch(q, 0, { shuffle: false, repeat: 'one' }), null,
    '单曲循环的下一首还是自己，已经缓存过，无需预取')
})

test('nextSongForPrefetch：空队列/越界下标返回 null（不抛错）', () => {
  assert.equal(nextSongForPrefetch([], 0, { shuffle: false, repeat: 'all' }), null)
  assert.equal(nextSongForPrefetch([song('a')], 5, { shuffle: false, repeat: 'all' }), null)
  assert.equal(nextSongForPrefetch([song('a')], -1, { shuffle: false, repeat: 'all' }), null)
})

test('shouldPrefetch：正常 4G 顺序播放 → 允许', () => {
  assert.equal(shouldPrefetch(baseEnv), true)
})

test('shouldPrefetch：关缓存开关 → 不预取', () => {
  assert.equal(shouldPrefetch({ ...baseEnv, cacheEnabled: false }), false)
})

test('shouldPrefetch：省流模式 / 2G / 3G → 不预取（抢带宽会让当前曲更卡）', () => {
  assert.equal(shouldPrefetch({ ...baseEnv, saveData: true }), false)
  assert.equal(shouldPrefetch({ ...baseEnv, effectiveType: '2g' }), false)
  assert.equal(shouldPrefetch({ ...baseEnv, effectiveType: 'slow-2g' }), false)
  assert.equal(shouldPrefetch({ ...baseEnv, effectiveType: '3g' }), false)
  // 4g 与未知（浏览器不报）都放行
  assert.equal(shouldPrefetch({ ...baseEnv, effectiveType: '4g' }), true)
  assert.equal(shouldPrefetch({ ...baseEnv, effectiveType: undefined }), true)
})

test('shouldPrefetch：离线 / 已有任务在跑 / 队列只有一首 → 不预取', () => {
  assert.equal(shouldPrefetch({ ...baseEnv, online: false }), false)
  assert.equal(shouldPrefetch({ ...baseEnv, busy: true }), false,
    '并发两个预取会均分带宽，结果谁都下不完')
  assert.equal(shouldPrefetch({ ...baseEnv, queueLength: 1 }), false)
})

test('shouldPrefetch：随机 / 单曲循环 → 不预取', () => {
  assert.equal(shouldPrefetch({ ...baseEnv, shuffle: true }), false)
  assert.equal(shouldPrefetch({ ...baseEnv, repeat: 'one' }), false)
})

test('hasEnoughTimeLeft：剩余时间不足时不再启动新任务', () => {
  assert.equal(hasEnoughTimeLeft(200, 10), true)     // 还剩 190s，够
  assert.equal(hasEnoughTimeLeft(200, 185), false)   // 只剩 15s，下不完
  assert.equal(hasEnoughTimeLeft(200, 180), true)    // 正好 20s，边界放行
  // 时长未知（还没 loadedmetadata）时不预取 —— 否则可能刚开抓就切歌
  assert.equal(hasEnoughTimeLeft(0, 0), false)
  assert.equal(hasEnoughTimeLeft(NaN, 0), false)
})
