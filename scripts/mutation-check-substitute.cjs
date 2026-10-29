/** 变异测试：替身匹配 / 搜索快照的护栏退回错误实现，确认单测会失败。
 *
 * 对应真实缺陷（2026-10-29 用户报告）：
 *   ① 歌单播放「显示 A、播的是 B」—— 高音质档下跨平台替身按歌名接管，
 *      同名的 Live/伴奏版被当成同一首（版本词缺失 + 时长缺失放行）。
 *   ② 搜索结果页点歌播放后返回 → 整页空白（本地 state 随组件销毁）。
 *
 * 每个变异都必须让**指定用例**变红，否则说明测试没有真实验证力。
 */
const fs = require('fs')
const { execSync } = require('child_process')

const TESTS = {
  substitute: 'npx tsx --test test/substituteMatch.test.ts',
  session: 'npx tsx --test test/searchSession.test.ts',
}

const mutations = [
  {
    group: 'substitute',
    name: '版本词护栏被删（Live/伴奏版重新被当成同一首）',
    file: 'src/server/musicMatch.ts',
    from: "  if (candidateVersion !== targetVersion) return -1",
    to: '  void candidateVersion; void targetVersion',
    expectFail: ['同名同歌手，但候选是 Live 版 → 必须拒绝'],
  },
  {
    group: 'substitute',
    name: '时长必填护栏被删（缺时长的替身重新放行）',
    file: 'src/server/musicMatch.ts',
    from: '  if (targetDuration > 0 && candidateDuration <= 0) return -1',
    to: '  void targetDuration; void candidateDuration',
    expectFail: ['候选缺时长、目标有时长 → 必须拒绝（旧实现放行）'],
  },
  {
    group: 'substitute',
    name: '版本词识别失效（全角括号不归一 → 漏掉一半标记）',
    file: 'src/server/musicMatch.ts',
    // 用正则匹配而不是字面串：这段代码里含全角字符（！～ 与全角空格），
    // 字面量在源码里容易被编辑器/换行风格改写，导致「变异点已失效」误报。
    fromRe: /const text = String\(rawName \|\| ''\)([\s\S]*?)\.toLowerCase\(\)/,
    to: (m) => `const text = String(rawName || '').toLowerCase()`,
    expectFail: ['versionTags：全角字母也能识别（ＬＩＶＥ / ＲＥＭＩＸ）'],
  },
  {
    group: 'session',
    name: '恢复判定放行 loading 态（返回后永远转圈）',
    file: 'web/src/lib/searchSession.ts',
    from: "  if (s.phase !== 'done') return false",
    to: '  void s.phase',
    expectFail: ['loading 态不恢复 —— 那个请求被 abort 了，恢复只会永远转圈'],
  },
  {
    group: 'session',
    name: '恢复判定放行空搜索词（恢复到无意义空白）',
    file: 'web/src/lib/searchSession.ts',
    from: "  if (!s.searchedFor.trim()) return false",
    to: '  void s.searchedFor',
    expectFail: ['没有搜索词的空快照不恢复'],
  },
  {
    group: 'session',
    name: '滚动位置写入不校验快照存在（凭空造出空快照）',
    file: 'web/src/lib/searchSession.ts',
    from: '  if (snapshot) snapshot.scrollY = y',
    to: '  snapshot = { ...(snapshot ?? {}), scrollY: y } as SearchSnapshot',
    expectFail: ['滚动位置只在已有快照时更新，不会凭空创建快照'],
  },
]

let failed = 0
for (const m of mutations) {
  const original = fs.readFileSync(m.file, 'utf8')
  // 两种写法：字面串 from/to（多数），或正则 fromRe/to(match)（含全角字符这类
  // 难以内联成字面量的场景）。
  let mutated = null
  if (m.fromRe) {
    const hit = m.fromRe.exec(original)
    if (hit) mutated = original.slice(0, hit.index) + m.to(hit[0]) + original.slice(hit.index + hit[0].length)
  } else if (original.includes(m.from)) {
    mutated = original.replace(m.from, m.to)
  }
  if (mutated == null) {
    console.error(`✗ 变异点已失效（实现改了？请同步更新脚本）: ${m.name}`)
    failed++
    continue
  }
  fs.writeFileSync(m.file, mutated)
  let out = ''
  try {
    out = execSync(TESTS[m.group], { encoding: 'utf8' })
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '')
  }
  // node:test 的 TAP 输出把失败用例写成 `not ok N - <名称>`；
  // 某些运行器会渲染成 `✖ <名称>`。两种都要认，否则脚本会对
  // 「测试其实红了」误报成「没红」（本次实测踩过）。
  const misses = m.expectFail.filter((name) => {
    const tapped = out.includes(`not ok`) && out.includes(name)
    const pretty = out.includes(`✖ ${name}`) || out.includes(`✗ ${name}`)
    return !(tapped || pretty)
  })
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
