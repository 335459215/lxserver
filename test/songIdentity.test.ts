/**
 * songIdentity.test.ts — 跨平台去重的回归测试。
 *
 * 每个用例都对应一个**实测复现过**的缺陷，注释里保留复现输入，
 * 避免以后有人「简化」规则时又把它们放回来。
 *
 * 运行：npx tsx --test test/songIdentity.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dedupeSongs } from '../web/src/lib/songIdentity'

const song = (name: string, singer: string, over: Record<string, unknown> = {}) =>
  ({ source: 'wy', songmid: `${name}|${singer}`, name, singer, ...over }) as any

const names = (list: any[]) => list.map((s) => `${s.name}/${s.singer}`)

test('feat 子句的括号写法要合并（全角与半角）', () => {
  const out = dedupeSongs([
    song('圣诞星（feat. 杨瑞代）', '周杰伦'),
    song('圣诞星 (feat. 杨瑞代)', '周杰伦'),
    song('圣诞星', '周杰伦'),
  ])
  assert.equal(out.length, 1, `应合并为一条，实际 ${JSON.stringify(names(out))}`)
})

test('结尾裸写 feat 也要抹掉', () => {
  const out = dedupeSongs([
    song('圣诞星 feat. 杨瑞代', '周杰伦'),
    song('圣诞星', '周杰伦'),
  ])
  assert.equal(out.length, 1)
})

test('词内的 ft / feat 不能被当署名标记（Afterglow / Afterlife 回归）', () => {
  // 旧实现先去掉所有空白再匹配 /(?:feat|ft)\.?.*$/，三个标题都从单词内部的
  // ft 处被截成 `a`，于是三首不同的歌塌成一条。
  const out = dedupeSongs([
    song('Afterglow', 'Ed Sheeran'),
    song('Afterglow (Live)', 'Ed Sheeran'),
    song('Afterlife', 'Ed Sheeran'),
  ])
  assert.deepEqual(names(out), [
    'Afterglow/Ed Sheeran',
    'Afterglow (Live)/Ed Sheeran',
    'Afterlife/Ed Sheeran',
  ])
})

test('不同录音版本（Live/Remix）各自保留', () => {
  const out = dedupeSongs([
    song('刀马旦', '李玟'),
    song('刀马旦 (Live)', '李玟'),
    song('刀马旦 (Remix)', '李玟'),
  ])
  assert.equal(out.length, 3, `版本后缀不应被抹掉，实际 ${JSON.stringify(names(out))}`)
})

test('歌手写法别名要合并（CoCo李玟 / 李玟）', () => {
  const out = dedupeSongs([
    song('月光爱人', '李玟'),
    song('月光爱人', 'CoCo李玟、马毓芬、谢文德'),
  ])
  assert.equal(out.length, 1)
})

test('未知的拉丁前缀不能被当成别名（MC张三 / DJ张三 / 张三）', () => {
  // 旧实现用 /^[A-Za-z0-9.\-'\s]+([\u4e00-\u9fff].*)$/ 无差别剥离，
  // 三个不同艺人的同名曲被静默合成一条。
  const out = dedupeSongs([
    song('同名曲', 'MC张三', { songmid: 'a' }),
    song('同名曲', 'DJ张三', { songmid: 'b' }),
    song('同名曲', '张三', { songmid: 'c' }),
  ])
  assert.equal(out.length, 3, `不同艺人不应合并，实际 ${JSON.stringify(names(out))}`)
})

test('空歌手不能当通配符吞掉有署名的条目', () => {
  const out = dedupeSongs([
    song('Home', '', { songmid: 'u' }),
    song('Home', 'Alice', { songmid: 'a' }),
    song('Home', 'Bob', { songmid: 'b' }),
  ])
  assert.equal(out.length, 3, `未知歌手不应吞并已知，实际 ${JSON.stringify(names(out))}`)
})

test('空歌手的结果与输入顺序无关', () => {
  const forward = dedupeSongs([song('Home', '', { songmid: 'u' }), song('Home', 'Alice', { songmid: 'a' })])
  const backward = dedupeSongs([song('Home', 'Alice', { songmid: 'a' }), song('Home', '', { songmid: 'u' })])
  assert.equal(forward.length, backward.length, '顺序不同不应改变条目数')
})

test('空歌名不参与模糊合并', () => {
  const out = dedupeSongs([
    song('', 'Alice', { songmid: 'x' }),
    song('', 'Bob', { songmid: 'y' }),
  ])
  assert.equal(out.length, 2, '空标题的不同歌手不应合并')
})

test('同 source+id 即使歌名歌手缺失也判重', () => {
  const out = dedupeSongs([
    song('', '', { songmid: 'same-id' }),
    song('', '', { songmid: 'same-id' }),
  ])
  assert.equal(out.length, 1, '完全相同的 source+id 是同一实体')
})

test('去重必须幂等（交集链不得因代表替换而漂移）', () => {
  // 旧实现只跟「当前代表」比，且会用歌手更少的条目替换代表：
  // A/B/C、D/E、B/D → 输出 [B/D, D/E]，再去重只剩 [B/D]。
  const input = [
    song('链式', 'A、B、C', { songmid: '1' }),
    song('链式', 'D、E', { songmid: '2' }),
    song('链式', 'B、D', { songmid: '3' }),
  ]
  const once = dedupeSongs(input)
  const twice = dedupeSongs(once)
  assert.equal(twice.length, once.length,
    `二次去重不应再缩短：一次 ${JSON.stringify(names(once))} → 二次 ${JSON.stringify(names(twice))}`)
})

test('去重保留最先出现的代表（source/id 稳定，不因歌手长短替换）', () => {
  const out = dedupeSongs([
    song('月光爱人', 'CoCo李玟、马毓芬、谢文德、Dan Warner', { source: 'kw', songmid: 'kw-1' }),
    song('月光爱人', '李玟', { source: 'wy', songmid: 'wy-1' }),
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].source, 'kw', '应保留最先出现的那条，避免队列高亮错位')
})

test('不同歌手翻唱不合并', () => {
  const out = dedupeSongs([
    song('同一首歌', '萨顶顶', { songmid: 's' }),
    song('同一首歌', '李玟', { songmid: 'c' }),
  ])
  assert.equal(out.length, 2, '无共同歌手不应合并')
})

test('增量追加：新歌不能被当成旧条目的重复而丢掉', () => {
  const first = dedupeSongs([
    song('链式', 'A、B、C', { songmid: '1' }),
    song('链式', 'D、E', { songmid: '2' }),
    song('链式', 'B、D', { songmid: '3' }),
  ])
  const merged = dedupeSongs([...first, song('全新的歌', 'Z', { songmid: 'z' })])
  assert.ok(merged.some((s) => s.name === '全新的歌'), '追加的新歌必须保留')
})

test('真实场景：李玟《月光爱人》三平台写法收敛为一条', () => {
  const out = dedupeSongs([
    song('月光爱人', '李玟', { source: 'wy', songmid: 'w1' }),
    song('月光爱人', '李玟、张志', { source: 'wy', songmid: 'w2' }),
    song('月光爱人', 'CoCo李玟、马毓芬、谢文德、Dan Warner、马友友', { source: 'kw', songmid: 'k1' }),
  ])
  assert.equal(out.length, 1)
})
