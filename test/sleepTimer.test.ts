/**
 * sleepTimer.test.ts — 睡眠定时器状态机的回归测试。
 *
 * 每个用例对应一个真实会踩的语义边界（写错会怎样见注释），
 * 配套变异脚本 scripts/mutation-check-sleeptimer.cjs 证明这些用例真有区分力。
 *
 * 运行：npx tsx --test test/sleepTimer.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  applySleepAction,
  formatRemaining,
  remainingMs,
  SLEEP_OFF,
  type SleepTimerState,
} from '../web/src/lib/sleepTimer'

const T0 = 1_700_000_000_000

test('设定 N 分钟：endsAt = now + N 分钟', () => {
  const s = applySleepAction(SLEEP_OFF, { type: 'set', mode: 'after', minutes: 30, now: T0 })
  assert.equal(s.mode, 'after')
  assert.equal(s.endsAt, T0 + 30 * 60_000)
  assert.equal(s.minutes, 30)
})

test('设定「播完当前这首」：endsAt 必须为空（不能残留上一个定时）', () => {
  // 写错会怎样：UI 会为「播完即停」显示出不存在的倒计时
  const timed = applySleepAction(SLEEP_OFF, { type: 'set', mode: 'after', minutes: 30, now: T0 })
  const s = applySleepAction(timed, { type: 'set', mode: 'endOfSong', now: T0 + 1000 })
  assert.equal(s.mode, 'endOfSong')
  assert.equal(s.endsAt, null)
  assert.equal(s.minutes, 0)
})

test('播完一首：endOfSong 被消费 → off', () => {
  const s = applySleepAction(
    { mode: 'endOfSong', endsAt: null, minutes: 0 },
    { type: 'songEnded' },
  )
  assert.deepEqual(s, SLEEP_OFF)
})

test('播完一首：after 模式继续计时（跨歌不重置）', () => {
  // 写错会怎样：定了 30 分钟，听到第 3 首就悄悄失效 —— 用户被吵醒
  const timed = applySleepAction(SLEEP_OFF, { type: 'set', mode: 'after', minutes: 30, now: T0 })
  const s = applySleepAction(timed, { type: 'songEnded' })
  assert.equal(s.mode, 'after')
  assert.equal(s.endsAt, timed.endsAt)
})

test('播完一首：off 保持 off', () => {
  assert.deepEqual(applySleepAction(SLEEP_OFF, { type: 'songEnded' }), SLEEP_OFF)
})

test('cancel / expire 都回到 off', () => {
  const timed = applySleepAction(SLEEP_OFF, { type: 'set', mode: 'after', minutes: 15, now: T0 })
  assert.deepEqual(applySleepAction(timed, { type: 'cancel' }), SLEEP_OFF)
  assert.deepEqual(applySleepAction(timed, { type: 'expire' }), SLEEP_OFF)
})

test('非法分钟数按 1 分钟兜底（不能静默当 off）', () => {
  // 写错会怎样：调用方传 0/undefined 时定时悄悄失效，用户以为定了时
  const s = applySleepAction(SLEEP_OFF, { type: 'set', mode: 'after', minutes: 0, now: T0 })
  assert.equal(s.mode, 'after')
  assert.equal(s.endsAt, T0 + 60_000)
})

test('remainingMs：正常递减；到期夹到 0（不出负数）', () => {
  const timed = applySleepAction(SLEEP_OFF, { type: 'set', mode: 'after', minutes: 10, now: T0 })
  assert.equal(remainingMs(timed, T0 + 60_000), 9 * 60_000)
  assert.equal(remainingMs(timed, T0 + 11 * 60_000), 0, '过期后应为 0 而不是负数')
})

test('remainingMs：endOfSong / off 模式为 0', () => {
  const eos: SleepTimerState = { mode: 'endOfSong', endsAt: null, minutes: 0 }
  assert.equal(remainingMs(eos, T0), 0)
  assert.equal(remainingMs(SLEEP_OFF, T0), 0)
})

test('formatRemaining：MM:SS，向上取整秒（59.4s 显示 01:00 不是 00:59）', () => {
  assert.equal(formatRemaining(0), '00:00')
  assert.equal(formatRemaining(59_400), '01:00')
  assert.equal(formatRemaining(30 * 60_000), '30:00')
  assert.equal(formatRemaining(61 * 60_000), '1:01:00')
})
