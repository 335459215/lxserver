/** 变异测试：前缀剥离退回错误实现，确认单测会失败。
 *
 * 对应真实缺陷（2026-10-25 用户报告「歌单播的歌和显示的不是同一首」）：
 * 歌单条目 songmid 带 wy_ 前缀 → SDK 无效 id → 替身源按歌名接管 → 播错曲。
 */
const fs = require('fs')
const { execSync } = require('child_process')

const tests = 'npx tsx --test test/songmidPrefix.test.ts'

const mutations = [
  {
    name: '服务端回退：只处理 id、不处理 songmid（正是漏掉的情况）',
    file: 'src/server/musicMatch.ts',
    from: "  for (const field of ['songmid', 'id'] as const) {",
    to: "  for (const field of ['id'] as const) {",
    expectFail: ['服务端：songmid 带平台前缀时无条件剥掉'],
  },
  {
    name: '服务端回退：songmid 缺失才处理（原始实现的缺陷形态）',
    file: 'src/server/musicMatch.ts',
    from: "  for (const field of ['songmid', 'id'] as const) {\n    const v = songInfo[field]",
    to: "  for (const field of (songInfo.songmid ? [] : ['songmid', 'id']) as const) {\n    const v = songInfo[field]",
    expectFail: ['服务端：songmid 带平台前缀时无条件剥掉'],
  },
  {
    name: '前端回退：songKey 不剥前缀（缓存键分裂、错曲固化）',
    file: 'web/src/lib/songIdentity.ts',
    from: '  const id = stripSourcePrefix(src, String(raw))\n  return `${src}:${id}`',
    to: '  const id = String(raw)\n  return `${src}:${id}`',
    expectFail: ['前端：songKey 剥前缀（歌单条目与搜索结果同键）'],
  },
  {
    name: '两侧回退：前缀匹配放宽成「含下划线就剥」（误伤 kg 的 数字_哈希）',
    file: 'web/src/lib/songIdentity.ts',
    from: "export function stripSourcePrefix(source: string, id: string): string {\n  const prefix = `${source}_`\n  return id.startsWith(prefix) ? id.slice(prefix.length) : id\n}",
    to: "export function stripSourcePrefix(source: string, id: string): string {\n  const i = id.indexOf('_')\n  return i >= 0 ? id.slice(i + 1) : id\n}",
    expectFail: ['前端：kg 内部含下划线的 songmid 不被误剥'],
  },
]

let failed = 0
for (const m of mutations) {
  const original = fs.readFileSync(m.file, 'utf8')
  if (!original.includes(m.from)) {
    console.error(`✗ 变异点已失效（实现改了？请同步更新脚本）: ${m.name}`)
    failed++
    continue
  }
  fs.writeFileSync(m.file, original.replace(m.from, m.to))
  let out = ''
  try {
    out = execSync(tests, { encoding: 'utf8' })
  } catch (e) {
    out = e.stdout + e.stderr
  }
  const misses = m.expectFail.filter((name) => !out.includes(`✖ ${name}`) && !out.includes(`✗ ${name}`))
  if (misses.length) {
    failed++
    console.log(`✗ ${m.name} → 预期失败的用例没红: ${misses.join('、')}`)
  } else {
    console.log(`  ✓ ${m.name} → fail=${m.expectFail.length}（命中预期用例）`)
  }
  fs.writeFileSync(m.file, original)
}

if (failed) {
  console.error(`\n${failed} 个变异未被单测捕获，请补测试`)
  process.exit(1)
}
console.log('恢复原文件完成。变异测试全部通过 —— 测试有真实验证力')
