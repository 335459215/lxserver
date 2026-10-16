/** 变异测试：把修复逐个退回旧实现，确认测试确实会失败。
 *  一个测试如果在旧代码上也全绿，它就没有验证力。
 */
const fs = require('fs')
const { execSync } = require('child_process')

const P = 'web/src/lib/songIdentity.ts'
const original = fs.readFileSync(P, 'utf8')

const mutations = [
  {
    name: 'ft 规则退回无边界尾匹配（Afterglow 塌缩）',
    from: String.raw`(?:^|\s)(?:feat|ft)\.?(?:\s.*)?$`,
    to: String.raw`(?:feat|ft)\.?.*$`,
    expectFail: ['Afterglow'],
  },
  {
    name: '歌手归一退回「任意剥拉丁前缀」（MC张三 塌缩）',
    from: String.raw`      const n = normalizeForMatch(x)
      return SINGER_ALIASES[n] ?? n`,
    to: String.raw`      const n0 = normalizeForMatch(x)
      const m = /^[a-z0-9.\-'\s]+([\u4e00-\u9fff].*)$/.exec(n0)
      const n = m ? m[1] : n0
      return SINGER_ALIASES[n] ?? n`,
    expectFail: ['MC张三'],
  },
  {
    // 旧实现：`if (ss.size === 0 || other.size === 0 || intersects(...)) hit`
    // 空歌手即命中。必须把两道守卫（fuzzyOk 里的 ss.size>0、some 里的 o.size>0）
    // 一起退回，否则只是等价改写、测不出东西来。
    name: '空歌手退回通配符（Home 吞并）',
    from: String.raw`    const fuzzyOk = tk.length > 0 && ss.size > 0
    const dup =
      (fuzzyOk && sets.some((o) => o.size > 0 && intersects(ss, o))) ||
      (hasId && ids.has(idKey))`,
    to: String.raw`    const fuzzyOk = tk.length > 0
    const dup =
      (fuzzyOk && sets.some((o) => ss.size === 0 || o.size === 0 || intersects(ss, o))) ||
      (hasId && ids.has(idKey))`,
    expectFail: ['空歌手'],
  },
]

let allGood = true
for (const m of mutations) {
  if (!original.includes(m.from)) {
    console.log(`  ✗ 变异点未找到: ${m.name}`)
    allGood = false
    continue
  }
  fs.writeFileSync(P, original.replace(m.from, m.to))
  let out = ''
  try {
    out = execSync('npx tsx --test test/songIdentity.test.ts 2>&1', { encoding: 'utf8' })
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '')
  }
  const failed = /ℹ fail (\d+)/.exec(out)
  const nFail = failed ? Number(failed[1]) : -1
  const caught = m.expectFail.some((k) => out.includes(k))
  console.log(`  ${nFail > 0 && caught ? '✓' : '✗'} ${m.name} → fail=${nFail}${caught ? '（命中了预期用例）' : '（未命中预期用例！）'}`)
  if (!(nFail > 0 && caught)) allGood = false
}

fs.writeFileSync(P, original)
console.log(`\n恢复原文件完成。变异测试${allGood ? '全部通过 —— 测试有真实验证力' : '存在问题'}`)
process.exit(allGood ? 0 : 1)
