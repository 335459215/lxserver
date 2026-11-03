#!/usr/bin/env node
/**
 * 全站 UI 体检的跨平台入口（CI 与本地共用）。
 *
 * 做的事：
 *   1. 起离线桩服务（scripts/menu-fit/static-fixture-server.mjs，不连外网、不依赖 NAS）
 *   2. 依次跑 audit-ui.py（布局/对比度/触摸目标）与 audit-focus.py（焦点可见性）
 *   3. 关掉服务，把**任一失败**的退出码透出
 *
 * 【为什么要有这个 wrapper，而不是在 workflow 里直接 `&` 起服务】
 * GitHub Actions 的 `run:` 会等 shell 退出；用 `cmd &` 起的子进程继承了 stdout，
 * 步骤会一直挂到超时（本地看不出问题，CI 必翻车）。menu-fit/run.mjs 已经踩过
 * 这个坑并给了正确写法：spawn detached + 显式 kill + 等端口就绪。
 * 这里沿用同一套骨架，避免两处各写一份又各自长歪。
 *
 * 用法：
 *   node scripts/ui-audit/run.mjs [--port 9701] [--python /usr/bin/python3]
 * 退出码非 0 表示有不达标项（可直接当 CI 护栏）。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const args = process.argv.slice(2)
const getArg = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const PORT = Number(getArg('--port', '9701'))
// Linux/macOS 的 python 通常是 python3；Windows 上一般传 python
const PY = getArg('--python', process.platform === 'win32' ? 'python' : 'python3')
const BASE = `http://127.0.0.1:${PORT}`

const fixture = spawn(
  process.execPath,
  [path.join(repoRoot, 'scripts', 'menu-fit', 'static-fixture-server.mjs'), String(PORT)],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FX_BIND: '127.0.0.1' } },
)
let fixtureLog = ''
fixture.stdout.on('data', (d) => (fixtureLog += d.toString()))
fixture.stderr.on('data', (d) => (fixtureLog += d.toString()))

const cleanup = () => {
  if (!fixture.killed) fixture.kill()
}
process.on('exit', cleanup)
process.on('SIGINT', () => {
  cleanup()
  process.exit(130)
})

const waitForPort = async (timeoutMs = 20000) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/user/auth/verify`)
      if (res.ok) return true
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

const runPy = (script) =>
  new Promise((resolve) => {
    const p = spawn(PY, ['-X', 'utf8', path.join(here, script), BASE], {
      stdio: 'inherit',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    })
    p.on('error', (e) => {
      console.error(`[ui-audit] 无法启动 python（${PY}）：${e.message}`)
      resolve(1)
    })
    p.on('exit', (code) => resolve(code ?? 1))
  })

const main = async () => {
  if (!(await waitForPort())) {
    console.error('[ui-audit] 桩服务没起来：\n' + fixtureLog)
    cleanup()
    process.exit(1)
  }
  console.log(`[ui-audit] 桩服务就绪 ${BASE} ，python=${PY}`)

  const uiCode = await runPy('audit-ui.py')
  const focusCode = await runPy('audit-focus.py')

  cleanup()
  const worst = Math.max(uiCode, focusCode)
  if (worst !== 0) {
    console.error(`\n[ui-audit] 有项目不达标（audit-ui=${uiCode} audit-focus=${focusCode}）`)
  } else {
    console.log('\n[ui-audit] 全部通过')
  }
  process.exit(worst)
}

main()
