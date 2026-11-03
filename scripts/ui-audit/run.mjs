#!/usr/bin/env node
/**
 * 全站 UI 体检入口 —— 离线桩（CI）与线上真机两条通道。
 *
 * 用法：
 *   # 离线（默认，CI 用这条）：自带桩服务，不依赖 NAS / 外网
 *   node scripts/ui-audit/run.mjs
 *   node scripts/ui-audit/run.mjs --port 9701 --python python3
 *
 *   # 线上（真机验收）：直接打已部署站点，走真实登录
 *   AUDIT_USER=xxx AUDIT_PASS=yyy node scripts/ui-audit/run.mjs --live https://host:port
 *   …也可以把凭据写进 --user/--pass，或只给 --live 让它读环境变量
 *
 * 做的事：
 *   1. 离线模式：起离线桩服务（scripts/menu-fit/static-fixture-server.mjs）
 *      线上模式：跳过桩服务，直接打目标站
 *   2. 依次跑 audit-ui.py（布局/对比度/触摸目标）与 audit-focus.py（焦点可见性）
 *   3. 离线模式关掉桩服务；把**任一失败**的退出码透出
 *
 * 【为什么要有这个 wrapper，而不是在 workflow 里直接 `&` 起服务】
 * GitHub Actions 的 `run:` 会等 shell 退出；用 `cmd &` 起的子进程继承了 stdout，
 * 步骤会一直挂到超时（本地看不出，CI 必翻车）。menu-fit/run.mjs 已经踩过
 * 这个坑并给了正确写法：spawn + 显式 kill + 等端口就绪。这里沿用同一套骨架。
 *
 * 【为什么线上模式必须先验证登录】
 * 线上未登录会被弹回登录门，于是 24 条路由渲染的全是登录页 —— 对比度、
 * 触摸目标、名称全都是 0，报告长得像"完美通过"，实际什么都没验。
 * 这就是本文件里 `preflight()` 存在的理由：先换 token，失败就直接退出。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

// ---------- 参数解析 ----------
// 【必须整体消费选项值】第一版写成 `elif not a.startsWith('--')`，于是
// `--out D:\shots` 的路径值被当成 BASE，playwright 报 Protocol "d:" not
// supported，24 条路由全渲染失败，而汇总只剩"渲染报错"，其余计数为 0。
// 见 audit-ui.py 里同名注释。
const argv = process.argv.slice(2)
const opts = { port: 9701, python: null, live: null, user: null, pass: null, out: null, app: null }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  const take = () => argv[++i]
  if (a === '--port') opts.port = Number(take())
  else if (a === '--python') opts.python = take()
  else if (a === '--live') opts.live = take()
  else if (a === '--user') opts.user = take()
  else if (a === '--pass') opts.pass = take()
  else if (a === '--out') opts.out = take()
  else if (a === '--app') opts.app = take()
  else if (!a.startsWith('--')) opts.live = a // 位置参数 = 线上地址
}

// Linux/macOS 的 python 通常是 python3；Windows 上一般传 python
const PY = opts.python || (process.platform === 'win32' ? 'python' : 'python3')

// 凭据优先命令行，其次环境变量
const USER = opts.user || process.env.AUDIT_USER || ''
const PASS = opts.pass || process.env.AUDIT_PASS || ''

const isLive = Boolean(opts.live)
const BASE = isLive ? opts.live.replace(/\/+$/, '') : `http://127.0.0.1:${opts.port}`

if (isLive && !/^https?:\/\//.test(BASE)) {
  console.error(`[ui-audit] --live 需要一个 http(s) 地址，收到 ${JSON.stringify(BASE)}`)
  process.exit(2)
}

// ---------- 离线：桩服务 ----------
let fixture = null
let fixtureLog = ''
const startFixture = () => {
  fixture = spawn(
    process.execPath,
    [path.join(repoRoot, 'scripts', 'menu-fit', 'static-fixture-server.mjs'), String(opts.port)],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FX_BIND: '127.0.0.1' } },
  )
  fixture.stdout.on('data', (d) => (fixtureLog += d.toString()))
  fixture.stderr.on('data', (d) => (fixtureLog += d.toString()))
}
const cleanup = () => {
  if (fixture && !fixture.killed) fixture.kill()
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

// ---------- 线上：预检登录 ----------
// 线上必须拿到真 token。拿不到就直接退出 —— 继续跑只会得到一份
// 「全员 0，看起来完美」的假绿报告。
const preflight = async () => {
  if (!USER || !PASS) {
    console.error('[ui-audit] 线上模式需要凭据：--user/--pass 或 AUDIT_USER/AUDIT_PASS')
    process.exit(2)
  }
  const origin = new URL(BASE).origin
  try {
    // 【必须是 JSON body】服务端 `/api/login` 直接 `JSON.parse(body)` 取
    // username/password；发 form-urlencoded 会 parse 失败 → 400 Missing username。
    // （Playwright 的 ctx.request.post(data=...) 默认发 JSON，所以 python 侧没错；
    //  这里是 Node 的 fetch，得自己设 Content-Type。）
    const res = await fetch(`${origin}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASS }),
    })
    const json = await res.json().catch(() => ({}))
    if (!json.token) {
      console.error(`[ui-audit] 登录失败 status=${res.status} —— 中止（否则报告会是假绿）`)
      process.exit(2)
    }
    console.log(`[ui-audit] 登录成功 user=${USER} admin=${Boolean(json.isAdmin)}`)
  } catch (e) {
    console.error(`[ui-audit] 登录请求异常：${e.message} —— 中止`)
    process.exit(2)
  }
}

const runPy = (script) => {
  const args = ['-X', 'utf8', path.join(here, script), BASE]
  if (opts.out) args.push('--out', opts.out)
  if (opts.app) args.push('--app', opts.app)
  return new Promise((resolve) => {
    const p = spawn(PY, args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        // 凭据通过环境变量下发给 python（不写进命令行，避免出现在进程列表里）
        AUDIT_USER: USER,
        AUDIT_PASS: PASS,
      },
    })
    p.on('error', (e) => {
      console.error(`[ui-audit] 无法启动 python（${PY}）：${e.message}`)
      resolve(1)
    })
    p.on('exit', (code) => resolve(code ?? 1))
  })
}

const main = async () => {
  if (isLive) {
    console.log(`[ui-audit] 线上模式 ${BASE}`)
    await preflight()
  } else {
    startFixture()
    if (!(await waitForPort())) {
      console.error('[ui-audit] 桩服务没起来：\n' + fixtureLog)
      cleanup()
      process.exit(1)
    }
    console.log(`[ui-audit] 离线桩就绪 ${BASE} ，python=${PY}`)
  }

  const uiCode = await runPy('audit-ui.py')
  const focusCode = await runPy('audit-focus.py')

  cleanup()
  const worst = Math.max(uiCode, focusCode)
  if (worst !== 0) {
    console.error(`\n[ui-audit] 有项目不达标（audit-ui=${uiCode} audit-focus=${focusCode}）`)
  } else {
    console.log(`\n[ui-audit] 全部通过（${isLive ? '线上' : '离线'}）`)
  }
  process.exit(worst)
}

main()
