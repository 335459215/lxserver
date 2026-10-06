#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { apiCases } from './cases/api.cases.mjs'
import { uiCases } from './cases/ui.cases.mjs'
import { perfCases } from './cases/perf.cases.mjs'
import { buildFixtureData, FIXTURE_USER, FIXTURE_PASSWORD } from './lib/fixture.mjs'
import { startMock } from './lib/mock.mjs'
import { startServer } from './lib/server.mjs'
import { createClient } from './lib/http.mjs'
import { launchBrowser } from './lib/browser.mjs'
import { Report, compareSurfaces } from './lib/report.mjs'
import { BASELINE_DIR, SMOKE_ROOT } from './lib/paths.mjs'
import { heading, log, sleep, makeTmpDir } from './lib/util.mjs'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const flag = (name) => argv.includes(`--${name}`)

const surface = arg('surface', 'old') // old = 现有前端；new = 阶段 A 之后的 /app 新前端
const only = arg('only', 'all') // all | api | ui | perf
const filter = arg('filter', '')
const headed = flag('headed')
const keep = flag('keep')
const caseTimeout = Number(arg('timeout', 150000))

const SURFACES = {
  old: { playerPath: '/', adminPath: '/admin/', label: '旧前端（当前线上）' },
  new: { playerPath: '/app', adminPath: '/app/admin/', label: '新前端（阶段 A 起）' },
}

async function runSurface(surfaceName) {
  const conf = SURFACES[surfaceName]
  if (!conf) throw new Error(`未知 surface: ${surfaceName}（可用: ${Object.keys(SURFACES).join('/')}）`)

  heading(`冒烟运行 — ${surfaceName} (${conf.label})`)

  const port = Number(arg('port', surfaceName === 'new' ? 19530 : 19527))
  const mockPort = Number(arg('mockPort', surfaceName === 'new' ? 19529 : 19528))
  const workDir = path.join(makeTmpDir('lxsmoke-run-'), 'data')
  const logDir = path.join(makeTmpDir('lxsmoke-log-'))
  const baseUrl = `http://127.0.0.1:${port}`

  buildFixtureData(workDir, { audioBase: `http://127.0.0.1:${mockPort}` })

  const mock = await startMock({ port: mockPort })
  const server = await startServer({ dataPath: workDir, logPath: logDir, port, mockPort })
  const browser = await launchBrowser({ headless: !headed })
  const client = createClient({ baseUrl })

  const ctx = {
    baseUrl,
    port,
    mockPort,
    surface: surfaceName,
    browser,
    http: client,
    client,
    mock,
    server,
    playerUrl: `${baseUrl}${conf.playerPath}`,
    adminUrl: `${baseUrl}${conf.adminPath}`,
    adminPath: conf.adminPath,
    playerPath: conf.playerPath,
    token: null,
    userToken: null,
    dataPath: workDir,
  }

  // 预登录：UI 用例要带真实用户 token 打开播放器，token 走正式登录接口拿（不伪造）
  if (only !== 'api') {
    const login = await client.post('/api/user/login', { json: { username: FIXTURE_USER, password: FIXTURE_PASSWORD } })
    if (!login.json?.token) throw new Error(`预登录失败: ${login.text?.slice(0, 200)}`)
    ctx.token = login.json.token
    ctx.userToken = login.json.token
    client.setToken(login.json.token)
    log('dim', `已用 fixture 用户登录并取得 token`)
  }

  const report = new Report({
    surface: surfaceName,
    baselineDir: BASELINE_DIR,
    env: {
      node: process.version,
      baseUrl,
      dataPath: workDir,
      mockPort,
      headed,
      surface: surfaceName,
    },
  })

  const all = [
    ...(only === 'all' || only === 'api' ? apiCases : []),
    ...(only === 'all' || only === 'ui' ? uiCases : []),
    ...(only === 'all' || only === 'perf' ? perfCases : []),
  ].filter((c) => !filter || c.id.includes(filter))

  // 浏览器类用例：未传 --headed 时逐个串行跑（并发会互相抢焦点/资源，反而更慢也更抖）
  try {
    for (const c of all) {
      const started = Date.now()
      let status = 'pass'
      let error = null
      let detail = null
      try {
        const result = await Promise.race([
          c.run(ctx),
          sleep(caseTimeout).then(() => { throw new Error(`用例超时 (>${caseTimeout}ms)`) }),
        ])
        if (result && typeof result === 'object') detail = JSON.stringify(result)
      } catch (err) {
        status = 'fail'
        error = err?.message || String(err)
      }
      const durationMs = Date.now() - started
      report.add({ id: c.id, group: c.group ?? c.contract ?? '-', title: c.title ?? '', status, durationMs, error, detail })
      log(status === 'pass' ? 'ok' : 'err', `${c.id} (${durationMs}ms)${error ? ` — ${error}` : ''}`)
    }
  } finally {
    await browser.close().catch(() => {})
    await server.close()
    await mock.close()
    if (!keep) {
      fs.rmSync(path.dirname(workDir), { recursive: true, force: true })
      fs.rmSync(logDir, { recursive: true, force: true })
    } else {
      log('dim', `数据目录已保留: ${workDir}`)
      log('dim', `日志目录已保留: ${logDir}`)
    }
  }

  const out = report.save()
  const s = report.summary
  log(s.fail ? 'warn' : 'ok', `${surfaceName} 完成: ${s.pass}/${s.total} 通过`)
  return { report: report.finish(), out }
}

async function main() {
  const targets = surface === 'both' ? ['old', 'new'] : [surface]
  const finished = []
  for (const t of targets) {
    finished.push(await runSurface(t))
  }

  if (finished.length === 2) {
    heading('新旧比对')
    const oldRun = JSON.parse(JSON.stringify(finished[0].report))
    const newRun = JSON.parse(JSON.stringify(finished[1].report))
    compareSurfaces(oldRun, newRun, { outDir: path.join(BASELINE_DIR, 'compare') })
  }

  heading('汇总')
  let failed = 0
  for (const f of finished) {
    const s = f.report.summary
    failed += s.fail
    log(s.fail ? 'err' : 'ok', `${f.report.surface}: ${s.pass}/${s.total} 通过，${s.fail} 失败`)
  }
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  log('err', `运行失败: ${err?.stack || err}`)
  process.exit(2)
})
