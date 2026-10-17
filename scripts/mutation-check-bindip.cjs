/**
 * mutation-check-bindip.cjs — bindIP 的变异测试。
 *
 * 【为什么不用 .playwright/_verify-bindip.py】
 * 那是仓库外的本地验证脚本（G:\project\lxmusic\.playwright，不进 git），
 * CI 里不存在。第一版直接调它，CI 报
 * "can't open file '/home/runner/work/lxserver/.playwright/_verify-bindip.py'" 而失败。
 * 变异测试必须在**仓库内自包含**，所以这里用纯 Node 起真实服务验证。
 *
 * 验证的是「配置里的 bindIP 有没有真正传到 listen()」——这是单测无法覆盖的
 * 启动流程接线，也是 D-010 缺陷的本质。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const http = require('http')
const { execSync, spawn } = require('child_process')

const SRC_DIR = process.cwd()
const P = path.join(SRC_DIR, 'src/index.ts')
const original = fs.readFileSync(P, 'utf8')

/** 起一次真实服务（构建产物），返回日志文本与进程。 */
function runServer(bindIP, port, dataRoot) {
  const cfg = {
    serverName: 'bindip-mutation',
    port,
    bindIP,
    'user.enablePath': true,
    'user.enableRoot': true,
    'proxy.enabled': false,
    users: [{ name: 'admin', password: 'admin', isAdmin: true }],
  }
  fs.writeFileSync(path.join(dataRoot, 'config.js'), `module.exports = ${JSON.stringify(cfg, null, 2)}`)
  const logPath = path.join(dataRoot, 'out.log')
  const out = fs.openSync(logPath, 'w')
  const proc = spawn('node', ['index.js'], {
    cwd: SRC_DIR,
    env: { ...process.env, DATA_PATH: dataRoot, PORT: String(port) },
    stdio: ['ignore', out, out],
  })

  return new Promise((resolve) => {
    const deadline = Date.now() + 40_000
    const tick = () => {
      const text = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : ''
      const line = text.split('\n').find((l) => l.includes('Listening on'))
      if (line) return resolve({ proc, log: text, listenLine: line.trim() })
      if (Date.now() > deadline) return resolve({ proc, log: text, listenLine: '' })
      setTimeout(tick, 300)
    }
    tick()
  })
}

function kill(proc) {
  try { proc.kill('SIGKILL') } catch { }
}

async function verify() {
  const results = []
  const mkRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lx-bindip-mut-'))

  // A: bindIP=127.0.0.1 → 必须监听 127.0.0.1，且不能是 0.0.0.0
  {
    const root = mkRoot()
    const { proc, listenLine } = await runServer('127.0.0.1', 9621, root)
    kill(proc)
    results.push({
      name: 'bindIP=127.0.0.1 时应监听 127.0.0.1',
      ok: listenLine.includes('127.0.0.1') && !listenLine.includes('0.0.0.0'),
      detail: listenLine || '(服务未起来)',
    })
    fs.rmSync(root, { recursive: true, force: true })
  }

  // B: bindIP 为空 → 回落 0.0.0.0（不能起不来）
  {
    const root = mkRoot()
    const { proc, listenLine } = await runServer('', 9622, root)
    kill(proc)
    results.push({
      name: 'bindIP 为空时应回落 0.0.0.0 且能启动',
      ok: listenLine.includes('0.0.0.0'),
      detail: listenLine || '(服务未起来)',
    })
    fs.rmSync(root, { recursive: true, force: true })
  }

  return results
}

const mutations = [
  {
    name: '退回硬编码 0.0.0.0（bindIP 死配置，原缺陷）',
    from: `const listenIP = configuredBindIP || '0.0.0.0'`,
    to: `const listenIP = '0.0.0.0'`,
    expectFail: ['bindIP=127.0.0.1 时应监听 127.0.0.1'],
  },
  {
    name: '空 bindIP 不回落（会启动失败）',
    from: `const listenIP = configuredBindIP || '0.0.0.0'`,
    to: `const listenIP = configuredBindIP`,
    expectFail: ['bindIP 为空时应回落 0.0.0.0 且能启动'],
  },
]

;(async () => {
  let allGood = true
  for (const m of mutations) {
    if (!original.includes(m.from)) {
      console.log(`  ✗ 变异点未找到: ${m.name}`)
      allGood = false
      continue
    }
    fs.writeFileSync(P, original.replace(m.from, m.to))
    let results = []
    try {
      // 变异后必须重新构建，验证跑的是构建产物
      execSync('npm run build', { encoding: 'utf8', timeout: 300000, stdio: 'pipe', cwd: SRC_DIR })
      results = await verify()
    } catch (e) {
      console.log(`  ✗ ${m.name} 执行失败: ${e.message}`)
      allGood = false
    }
    const failed = results.filter((r) => !r.ok)
    const caught = failed.length > 0 && m.expectFail.some((k) => failed.some((f) => f.name === k))
    console.log(`  ${caught ? '✓' : '✗'} ${m.name} → 失败断言 ${failed.length} 条${caught ? '（命中预期用例）' : '（未命中！）'}`)
    if (failed.length && !caught) {
      failed.forEach((f) => console.log(`      失败: ${f.name} | ${f.detail}`))
    }
    if (!caught) allGood = false
  }

  fs.writeFileSync(P, original)
  try { execSync('npm run build', { encoding: 'utf8', timeout: 300000, stdio: 'pipe', cwd: SRC_DIR }) } catch { }
  console.log(`\n恢复原文件并重建完成。变异测试${allGood ? '全部通过 —— 测试有真实验证力' : '存在问题'}`)
  process.exit(allGood ? 0 : 1)
})()
