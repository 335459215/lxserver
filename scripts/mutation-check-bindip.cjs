/** 变异测试：把 bindIP 修复退回"死配置"，确认端到端验证会失败。 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// 本脚本在 lxserver-src 下运行；验证脚本在仓库外的 G:\project\lxmusic\.playwright。
// cwd 必须显式算出来，不能用 '..'（那会指到 G:\project）。
const SRC_DIR = process.cwd()
const REPO_ROOT = path.resolve(SRC_DIR, '..')
const VERIFY = path.join(REPO_ROOT, '.playwright', '_verify-bindip.py')

const P = path.join(SRC_DIR, 'src/index.ts')
const original = fs.readFileSync(P, 'utf8')

const mutations = [
  {
    name: '退回硬编码 0.0.0.0（bindIP 死配置，原缺陷）',
    from: `const configuredBindIP = String(global.lx.config.bindIP ?? '').trim()
const listenIP = configuredBindIP || '0.0.0.0'`,
    to: `const configuredBindIP = String(global.lx.config.bindIP ?? '').trim()
const listenIP = '0.0.0.0'`,
    // 失败时该断言会以 "[FAIL] 日志显示监听 127.0.0.1…" 出现
    expectFail: ['日志显示监听 127.0.0.1'],
  },
  {
    name: '空 bindIP 不回落（会启动失败）',
    from: `const listenIP = configuredBindIP || '0.0.0.0'`,
    to: `const listenIP = configuredBindIP`,
    expectFail: ['空 bindIP 不应导致启动失败'],
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
    // 变异后必须重新构建，因为验证脚本跑的是构建产物
    execSync('npm run build', { encoding: 'utf8', timeout: 300000, stdio: 'pipe', cwd: SRC_DIR })
    out = execSync(`python "${VERIFY}"`, {
      encoding: 'utf8', timeout: 300000, cwd: REPO_ROOT,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
  } catch (e) {
    // execSync 在非零退出时抛错，真实输出在 stdout/stderr 上
    out = String(e.stdout || '') + String(e.stderr || '')
  }
  // 【Windows 中文环境的坑】子进程输出默认按 cp936/GBK 解码，中文会变成乱码，
  // 于是 includes('日志显示监听') 永远匹配不上 —— 表现为"变异明明被捕获了
  // （FAIL=3）却判定未命中"。必须强制 PYTHONIOENCODING=utf-8 并显式按 utf8 解码。
  if (!/[\u4e00-\u9fa5]/.test(out)) {
    // 兜底：按二进制重读一次，避免编码问题掩盖真实结果
    try {
      const buf = execSync(`python "${VERIFY}"`, { timeout: 300000, cwd: REPO_ROOT, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
      out = Buffer.from(buf).toString('utf8')
    } catch (e2) {
      const buf = e2.stdout ? Buffer.from(e2.stdout) : Buffer.alloc(0)
      out = buf.toString('utf8')
    }
  }
  const failed = /FAIL=(\d+)/.exec(out)
  const nFail = failed ? Number(failed[1]) : -1
  // 失败时那行是 "[FAIL] xxx"，所以匹配时不能带 [PASS] 前缀；
  // 只要求"预期的那条断言确实出现在输出里"且整体确有失败。
  const caught = m.expectFail.some((k) => out.includes(k)) && nFail > 0
  console.log(`  ${caught ? '✓' : '✗'} ${m.name} → FAIL=${nFail}${caught ? '（命中预期用例）' : '（未命中！）'}`)
  if (!caught) allGood = false
}

fs.writeFileSync(P, original)
// 恢复后重建，别把变异产物留在磁盘上
try { execSync('npm run build', { encoding: 'utf8', timeout: 300000, stdio: 'pipe', cwd: SRC_DIR }) } catch { }
console.log(`\n恢复原文件并重建完成。变异测试${allGood ? '全部通过 —— 测试有真实验证力' : '存在问题'}`)
process.exit(allGood ? 0 : 1)
