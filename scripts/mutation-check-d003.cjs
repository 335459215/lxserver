/** 变异测试：把 D-003 的修复退回旧行为，确认测试会失败。 */
const fs = require('fs')
const { execSync } = require('child_process')

const P = 'src/server/userApi.ts'
const original = fs.readFileSync(P, 'utf8')

const mutations = [
  {
    name: '退回「不做 sourcesDeclared 检查」（D-003 原缺陷：清空已存列表）',
    from: `                    if (!result.sourcesDeclared) {
                        console.warn(
                            \`[自定义源] [\${owner}] \${source.name} 本次未声明 sources，\` +
                            \`保留已保存的支持平台列表（\${JSON.stringify(source.supportedSources || [])}）不做修改\`
                        )
                    } else {`,
    to: `                    if (false) {`,
    expectFail: ['漏带 sources 时'],
  },
  {
    name: '退回「三参静默忽略」（无可见警告）',
    from: `            if (extraArgs.length > 0 && eventName === 'inited') {`,
    to: `            if (false) {`,
    expectFail: ['三参写法要给出可见警告'],
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
    out = execSync('npx tsx --test test/d003SelfHeal.test.ts test/d003SelfHeal2.test.ts 2>&1', {
      encoding: 'utf8', timeout: 120000,
    })
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
