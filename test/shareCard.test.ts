/**
 * shareCard.test.ts — 分享卡片纯逻辑（wrapText / buildShareCardData）的回归测试。
 * canvas 渲染部分由 e2e 护栏覆盖（menu-fit「分享卡片」段）。
 *
 * 运行：npx tsx --test test/shareCard.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildShareCardData, wrapText } from '../web/src/lib/shareCard'

// 假 measure：每字宽 10（等宽），与真实中文场景近似
const measure = (t: string): number => [...t].length * 10

test('wrapText：单行放得下 → 一行原样', () => {
  assert.deepEqual(wrapText(measure, '晴天', 100, 2), ['晴天'])
})

test('wrapText：超宽换行', () => {
  assert.deepEqual(wrapText(measure, '一二三四五', 30, 2), ['一二三', '四五'])
})

test('wrapText：超出最大行数 → 末行加省略号', () => {
  // 写错会怎样：第三行直接截断丢弃，歌名显示不全还看不出来被截了
  const out = wrapText(measure, '一二三四五六七八九', 30, 2)
  assert.equal(out.length, 2)
  assert.ok(out[1].endsWith('…'), `末行应以省略号结尾: ${out[1]}`)
})

test('wrapText：省略号行本身不超宽', () => {
  const out = wrapText(measure, 'abcdefghij', 30, 1)
  assert.ok(measure(out[0]) <= 30, `宽=${measure(out[0])} 文本=${out[0]}`)
  assert.ok(out[0].endsWith('…'))
})

test('wrapText：空文本 → 空数组（不画出空行）', () => {
  assert.deepEqual(wrapText(measure, '', 100, 2), [])
})

test('wrapText：maxLines 足够时不加省略号', () => {
  const out = wrapText(measure, '一二三四五', 30, 3)
  assert.deepEqual(out, ['一二三', '四五'])
  assert.ok(!out.some((l) => l.includes('…')))
})

test('buildShareCardData：字段兜底（歌手空/歌名空/歌词空白不上卡）', () => {
  const d = buildShareCardData(
    { name: '', singer: '   ', albumName: null, source: 'kw' },
    '   ',
    '酷我',
    '#6366f1',
  )
  assert.equal(d.name, '未知歌曲')
  assert.equal(d.singer, '未知歌手')
  assert.equal(d.lyricLine, null)
  // 写错会怎样：歌词空串上卡 → 一张只有一对空引号的卡片
})

test('buildShareCardData：正常字段透传、专辑空白当无', () => {
  const d = buildShareCardData(
    { name: '晴天', singer: '周杰伦', albumName: '  ', source: 'kw' },
    '刮风这天 我试过握着你手',
    '酷我',
    '#5b8def',
  )
  assert.equal(d.album, null)
  assert.equal(d.lyricLine, '刮风这天 我试过握着你手')
})

test('buildShareCardData：非法主色回落默认靛蓝（画布渐变不吃坏色值）', () => {
  assert.equal(buildShareCardData({ name: 'n', source: 'kw' }, null, 'x', 'red').accent, '#6366f1')
  assert.equal(buildShareCardData({ name: 'n', source: 'kw' }, null, 'x', '#5b8def').accent, '#5b8def')
})
