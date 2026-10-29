/**
 * substituteMatch.test.ts — 跨平台替身匹配的回归测试（2026-10-29 用户报告）。
 *
 * 【真实缺陷】用户实测：歌单播放时「显示的是 A，播出来的不是 A」。
 * 只在把音质调到最高 + 打开「自动选最高档」后必然复现；直接搜索播放不复现。
 *
 * 机制：高音质档（flac/hires）原平台拿不到链接 → 服务端用跨平台替身兜底
 * （按歌名+歌手在其它平台搜）→ 旧匹配规则太松：
 *   ① 歌名只做「包含」判断：`晴天` 与 `晴天 (Live)` 通过；
 *   ② 任一侧时长为 0 就跳过时长校验：自定义源搜出来的条目常没有 interval。
 * 于是同名的现场版/伴奏版被当成同一首，用户听到的是另一个录音。
 * 低音质时原平台大多直接命中，替身几乎不参与 —— 与「只有高音质才复现」吻合。
 *
 * 运行：npx tsx --test test/substituteMatch.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { getSongMatchScore, versionTags } from '../src/server/musicMatch'

const target = (over: Record<string, unknown> = {}) => ({
  name: '晴天',
  singer: '周杰伦',
  interval: '04:29',
  albumName: '叶惠美',
  ...over,
})

const cand = (over: Record<string, unknown> = {}) => ({
  name: '晴天',
  singer: '周杰伦',
  interval: '04:29',
  albumName: '叶惠美',
  ...over,
})

// ===== 版本词抽取 =====

test('versionTags：中文全角括号的 Live 也能识别', () => {
  assert.equal(versionTags('晴天（Live）'), 'live')
  assert.equal(versionTags('晴天 (live)'), 'live')
  assert.equal(versionTags('晴天 - Live'), 'live')
})

test('versionTags：全角字母也能识别（ＬＩＶＥ / ＲＥＭＩＸ）', () => {
  // 全角拉丁字母必须靠「全角 ASCII → 半角」那一步才能匹配 \blive\b。
  // 这一条是真正的护栏：去掉归一化后此处会变红（普通全角括号不会 ——
  // \blive\b 本身就能匹配（Live）里的 live）。
  assert.equal(versionTags('晴天（ＬＩＶＥ）'), 'live')
  assert.equal(versionTags('晴天（ＲＥＭＩＸ）'), 'remix')
})

test('versionTags：无版本词返回空串', () => {
  assert.equal(versionTags('晴天'), '')
  assert.equal(versionTags('晴天 (feat. 某人)'), '')
})

test('versionTags：伴奏与纯音乐都归到 instrumental', () => {
  assert.equal(versionTags('晴天 (伴奏)'), 'instrumental')
  assert.equal(versionTags('晴天 (Instrumental)'), 'instrumental')
})

test('versionTags：多版本词排序稳定（书写顺序不同也判等）', () => {
  assert.equal(versionTags('晴天 (Live Remix)'), versionTags('晴天 (Remix Live)'))
})

// ===== 核心：替身匹配必须拒绝「同名不同录音」 =====

test('原曲与同名同歌手同专辑同时长：正常匹配（不得误杀）', () => {
  assert.ok(getSongMatchScore(cand(), target()) >= 0, '正常的同曲匹配不能被拒')
})

test('同名同歌手，但候选是 Live 版 → 必须拒绝', () => {
  assert.equal(
    getSongMatchScore(cand({ name: '晴天 (Live)', interval: '04:31' }), target()),
    -1,
    'Live 版是另一个录音，绝不能当替身',
  )
})

test('同名同歌手，但候选是伴奏版 → 必须拒绝', () => {
  assert.equal(
    getSongMatchScore(cand({ name: '晴天 (伴奏)' }), target()),
    -1,
  )
})

test('目标本身是 Live 版、候选是录音室版 → 同样拒绝（反向）', () => {
  assert.equal(
    getSongMatchScore(
      cand({ name: '晴天', interval: '04:29' }),
      target({ name: '晴天 (Live)', interval: '04:29' }),
    ),
    -1,
  )
})

test('候选缺时长、目标有时长 → 必须拒绝（旧实现放行）', () => {
  assert.equal(
    getSongMatchScore(cand({ interval: null }), target()),
    -1,
    '缺失时长是最容易混进错歌的一类，不能放行',
  )
})

test('目标缺时长、候选有时长 → 仍可匹配（目标信息不足是平台问题）', () => {
  assert.ok(getSongMatchScore(cand(), target({ interval: null })) >= 0)
})

test('时长差超过 8 秒 → 拒绝', () => {
  assert.equal(
    getSongMatchScore(cand({ interval: '04:40' }), target({ interval: '04:29' })),
    -1,
  )
})

test('歌手完全不匹配 → 拒绝', () => {
  assert.equal(
    getSongMatchScore(cand({ singer: '某翻唱歌手' }), target()),
    -1,
  )
})

test('歌名完全不同 → 拒绝', () => {
  assert.equal(getSongMatchScore(cand({ name: '七里香' }), target()), -1)
})

test('同名但歌名带可忽略的合作署名 → 仍匹配', () => {
  assert.ok(
    getSongMatchScore(cand({ name: '晴天 (feat. 杨瑞代)' }), target()) >= 0,
    'feat 署名不改变录音本体，不应被拒',
  )
})

test('Live 版对 Live 版：版本词一致则允许（同版本换平台）', () => {
  assert.ok(
    getSongMatchScore(
      cand({ name: '晴天 (Live)', interval: '04:31' }),
      target({ name: '晴天 (Live)', interval: '04:31' }),
    ) >= 0,
    '同为 Live 版、时长接近，应视为同一录音',
  )
})
