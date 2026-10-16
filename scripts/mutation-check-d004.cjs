/** 变异测试：把 D-004 的修复退回旧行为，确认测试会失败。 */
const fs = require('fs')
const { execSync } = require('child_process')

const P = 'src/modules/utils/musicSdk/kw/musicSearch.js'
const original = fs.readFileSync(P, 'utf8')

const mutations = [
  {
    name: '退回「越界页重试后抛 try max num」（D-004 原缺陷）',
    from: `      if (!result || result.TOTAL === '0' || result.SHOW === '0') {`,
    to: `      if (!result || (result.TOTAL !== '0' && result.SHOW === '0')) {
        if (retryNum > 2) return Promise.reject(new Error('try max num'))
        return this.search(str, page, limit, ++retryNum)
      }
      if (false) {`,
    expectFail: ['越界页'],
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
    out = execSync('npx tsx --test test/d004KwEmptyPage.test.ts 2>&1', { encoding: 'utf8', timeout: 120000 })
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '')
  }
  const failed = /ℹ fail (\d+)/.exec(out)
  const nFail = failed ? Number(failed[1]) : -1
  const caught = m.expectFail.some((k) => out.includes(k))
  console.log(`  ${nFail > 0 && caught ? '✓' : '✗'} ${m.name} → fail=${nFail}${caught ? '（命中预期用例）' : '（未命中！）'}`)
  if (!(nFail > 0 && caught)) allGood = false
}

fs.writeFileSync(P, original)
console.log(`\n恢复原文件完成。变异测试${allGood ? '全部通过 —— 测试有真实验证力' : '存在问题'}`)
process.exit(allGood ? 0 : 1)
