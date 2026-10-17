/**
 * mutation-check-dockerfile.cjs — 守住「镜像不预设 BIND_IP」这条部署契约。
 *
 * 真实踩坑：Dockerfile 里 `ENV BIND_IP='0.0.0.0'` 的优先级高于 config.js，
 * 导致用户改 bindIP 永远无效，且界面/日志全显示 0.0.0.0，极难定位。
 */
const fs = require('fs')
const { execSync } = require('child_process')

const P = 'Dockerfile'
const original = fs.readFileSync(P, 'utf8')

const mutations = [
  {
    name: '把 ENV BIND_IP 加回去（config.js 的 bindIP 将永远失效）',
    from: `# ENV BIND_IP='0.0.0.0'`,
    to: `ENV BIND_IP='0.0.0.0'`,
    expectFail: ['Dockerfile 不得预设 BIND_IP'],
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
    out = execSync('npx tsx --test test/dockerfileEnv.test.ts 2>&1', { encoding: 'utf8', timeout: 120000 })
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '')
  }
  const failed = /ℹ fail (\d+)/.exec(out)
  const nFail = failed ? Number(failed[1]) : -1
  const caught = m.expectFail.some((k) => out.includes(k)) && nFail > 0
  console.log(`  ${caught ? '✓' : '✗'} ${m.name} → fail=${nFail}${caught ? '（命中预期用例）' : '（未命中！）'}`)
  if (!caught) allGood = false
}

fs.writeFileSync(P, original)
console.log(`\n恢复原文件完成。变异测试${allGood ? '全部通过 —— 测试有真实验证力' : '存在问题'}`)
process.exit(allGood ? 0 : 1)
