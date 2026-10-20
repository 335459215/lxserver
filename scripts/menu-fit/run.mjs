#!/usr/bin/env node
/**
 * 音质菜单视口护栏的跨平台入口（CI 与本地共用）。
 *
 * 做的事：
 *   1. 起离线桩服务（static-fixture-server.mjs，不连外网、不依赖 NAS）
 *   2. 用 python3 跑 _verify-quality-menu-fit.py
 *   3. 关掉服务并把退出码原样透出
 *
 * 【为什么要这个包装而不是直接写进 workflow】
 *   - CI 是 Linux、本地是 Windows，路径与 python 命令名都不同；
 *   - 起/停服务、等端口就绪、清理子进程这些样板写在 YAML 里很难看且容易漏；
 *   - 本地想复现 CI 结果时只要 `node .playwright/run-menu-fit.mjs` 一条命令。
 *
 * 用法：
 *   node .playwright/run-menu-fit.mjs [--port 9701] [--python /usr/bin/python3]
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const getArg = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const PORT = Number(getArg('--port', '9701'))
// Linux/macOS 的 python 通常是 python3；Windows 上开发者一般显式传进来
const PY = getArg('--python', process.platform === 'win32' ? 'python' : 'python3')

const server = spawn(process.execPath, [path.join(here, 'static-fixture-server.mjs'), String(PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d.toString()))
server.stderr.on('data', (d) => (serverLog += d.toString()))

const cleanup = () => {
  if (!server.killed) server.kill()
}
process.on('exit', cleanup)
process.on('SIGINT', () => {
  cleanup()
  process.exit(130)
})

const waitForPort = async (timeoutMs = 15000) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/app/`)
      if (res.ok) return true
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

const main = async () => {
  if (!(await waitForPort())) {
    console.error('[menu-fit] 桩服务没起来：\n' + serverLog)
    cleanup()
    process.exit(1)
  }
  console.log(`[menu-fit] 桩服务就绪 http://127.0.0.1:${PORT} ，python=${PY}`)

  const py = spawn(
    PY,
    ['-X', 'utf8', path.join(here, 'verify-menu-fit.py'), `http://127.0.0.1:${PORT}`],
    { stdio: 'inherit', env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } },
  )

  py.on('error', (e) => {
    console.error(`[menu-fit] 无法启动 python（${PY}）：${e.message}`)
    cleanup()
    process.exit(1)
  })

  py.on('exit', (code) => {
    cleanup()
    process.exit(code ?? 1)
  })
}

main()
