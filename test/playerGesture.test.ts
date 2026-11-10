/** 播放页手势判定（v2.49.9）。
 *
 *  这些断言的价值在于：阈值一旦被后人改动，这里会立刻红，
 *  而不会等到「用户发现上下滚歌词会误切 Tab」才知道。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decideSwipe,
  SWIPE_AXIS_RATIO,
  SWIPE_MAX_MS,
  SWIPE_X_MIN,
  SWIPE_Y_MIN,
} from '../web/src/lib/playerGesture.ts'

const base = { durationMs: 200, lyricsExpanded: false }

test('decideSwipe：向左滑切到播放队列', () => {
  assert.equal(decideSwipe({ ...base, dx: -200, dy: 0 }), 'queue')
})

test('decideSwipe：向右滑回歌词', () => {
  assert.equal(decideSwipe({ ...base, dx: 200, dy: 0 }), 'lyric')
})

test('decideSwipe：位移不足不触发', () => {
  assert.equal(decideSwipe({ ...base, dx: -SWIPE_X_MIN + 1, dy: 0 }), null)
})

test('decideSwipe：恰好到达阈值即触发', () => {
  assert.equal(decideSwipe({ ...base, dx: -SWIPE_X_MIN, dy: 0 }), 'queue')
})

test('decideSwipe：斜向滑动（次轴过大）不触发，交给原生滚动', () => {
  assert.equal(decideSwipe({ ...base, dx: -100, dy: 100 }), null)
})

test('decideSwipe：主轴刚过比例线就触发', () => {
  const dy = 40
  const dx = -(dy * SWIPE_AXIS_RATIO + 1)
  assert.equal(decideSwipe({ ...base, dx, dy }), 'queue')
})

test('decideSwipe：太慢的手势不算滑动（用户是在拖）', () => {
  assert.equal(decideSwipe({ ...base, dx: -300, dy: 0, durationMs: SWIPE_MAX_MS + 1 }), null)
})

test('decideSwipe：未展开时下滑不做任何事（避免和下拉返回打架）', () => {
  assert.equal(decideSwipe({ ...base, dx: 0, dy: 200, lyricsExpanded: false }), null)
})

test('decideSwipe：展开时下滑收起', () => {
  assert.equal(decideSwipe({ ...base, dx: 0, dy: 200, lyricsExpanded: true }), 'collapse')
})

test('decideSwipe：展开时上滑不收起（上滑要留给歌词滚动）', () => {
  assert.equal(decideSwipe({ ...base, dx: 0, dy: -200, lyricsExpanded: true }), null)
})

test('decideSwipe：垂直位移不足不收起', () => {
  assert.equal(decideSwipe({ ...base, dx: 0, dy: SWIPE_Y_MIN - 1, lyricsExpanded: true }), null)
})

test('decideSwipe：水平位移优先于垂直收起（斜着往右下也不收起）', () => {
  assert.equal(decideSwipe({ ...base, dx: -200, dy: 80, lyricsExpanded: true }), 'queue')
})

test('decideSwipe：原地不动不触发', () => {
  assert.equal(decideSwipe({ ...base, dx: 0, dy: 0, lyricsExpanded: true }), null)
})
