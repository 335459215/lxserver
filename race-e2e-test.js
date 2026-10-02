// 端到端验证：不分平台 + 并发竞速 + 粘滞缓存 + 死源熔断 + 调度完备性
//
// 手动运行（先 npm run build）：
//     node race-e2e-test.js
//
// 平台搜索被桩掉了（同一模块实例直接改写 musicSdk[x].musicSearch.search），
// 所以这个用例不依赖外网，结果稳定可复现——上一版靠真实搜索，既慢又偶发失败，
// 恰恰因此漏掉了「候选平台 ≥4」这条路径上的挂死。
//
// 桩音源全部注册在 kw/wy/tx/mg 四个平台上，用来把候选平台数推到 4 个以上。

const fs = require('fs')
const path = require('path')
const os = require('os')
const http = require('http')

const PORT = 19527
const FAKE_PORT = 19528
const BASE = `http://127.0.0.1:${PORT}`
const FAKE = `http://127.0.0.1:${FAKE_PORT}`
const DATA = path.join(os.tmpdir(), `lx-race-test-${Date.now()}`)

// ---- 平台搜索桩：在 require('./server') 之前改写，同一模块实例生效 ----
const PLATFORMS = ['kw', 'wy', 'tx', 'mg']
const stubSearch = () => {
  const sdk = require('./server/modules/utils/musicSdk/index.js').default
  for (const p of PLATFORMS) {
    sdk[p].musicSearch.search = async (keyword) => ({
      list: [{
        id: `STUB_${p}_1`,
        songmid: `STUB_${p}_1`,
        name: '测试曲目',
        singer: '测试歌手',
        albumName: '测试专辑',
        interval: '03:30',
        source: p,
      }],
      total: 1,
    })
  }
  return sdk
}

const script = (name, { delayMs, fail, platforms }) => `
lx.send('inited', {
  sources: {
${platforms.map(p => `    ${p}: { name: 'test-${p}', qualitys: ['128k'] },`).join('\n')}
  }
})
lx.on('request', async ({ action, source }) => {
  if (action !== 'musicUrl') return null
  await new Promise(r => setTimeout(r, ${delayMs}))
  ${fail ? "throw new Error('这个源故意失败')" : ''}
  return '${FAKE}/audio.mp3?from=${name}&platform=' + source
})
`

// kw 上的源全部失败 → 原平台必然落空，必须靠跨平台候选兜底。
// wy/tx 的源也失败，只有 mg 的快源能成：候选队列会排到第 4 个才出结果。
const SOURCES = [
  { id: 'kw-slow', name: '酷我慢源', delayMs: 1200, fail: true, platforms: ['kw'] },
  { id: 'wy-src', name: '网易源', delayMs: 200, fail: true, platforms: ['wy'] },
  { id: 'tx-src', name: 'QQ源', delayMs: 200, fail: true, platforms: ['tx'] },
  { id: 'mg-fast', name: '咪咕快源', delayMs: 50, fail: false, platforms: ['mg'] },
  { id: 'mg-dead', name: '咪咕死源', delayMs: 20, fail: true, platforms: ['mg'] },
]

function setup() {
  const dir = path.join(DATA, 'users', 'source', '_open')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify(
    SOURCES.map(s => ({
      id: s.id, name: s.name, enabled: true, version: '1.0', author: 'test',
      description: '', homepage: '', supportedSources: s.platforms,
    })), null, 2))
  // order.json 决定优先级：酷我慢源排第一，用来验证「宽限有上限，不会被慢源拖满」
  fs.writeFileSync(path.join(dir, 'order.json'), JSON.stringify(SOURCES.map(s => s.id)))
  for (const s of SOURCES) fs.writeFileSync(path.join(dir, s.id), script(s.id, s))
  fs.mkdirSync(path.join(DATA, 'logs'), { recursive: true })
}

function post(body, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = http.request(`${BASE}/api/music/url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => { try { resolve(JSON.parse(buf)) } catch (e) { reject(new Error(buf)) } })
    })
    req.setTimeout(timeoutMs, () => { req.destroy(new Error(`请求超过 ${timeoutMs}ms 未返回`)) })
    req.on('error', reject)
    req.end(data)
  })
}

const song = (source, id, extra = {}) => ({
  source, songmid: id, id: `${source}_${id}`,
  name: '测试曲目', singer: '测试歌手', interval: '03:30', ...extra,
})

async function waitReady(timeoutMs = 40000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const code = await new Promise(res => {
      const req = http.get(`${BASE}/`, r => { r.resume(); r.on('end', () => res(r.statusCode)) })
      req.on('error', () => res(0)); req.setTimeout(1500, () => { req.destroy(); res(0) })
    })
    if (code > 0) return true
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('服务未在超时内就绪')
}

const timed = async (body, timeoutMs) => {
  const t0 = Date.now()
  try {
    const r = await post(body, timeoutMs)
    return { ms: Date.now() - t0, resolvedSource: r.resolvedSource, sourceName: r.sourceName, error: r.error, attempts: r.attempts }
  } catch (e) {
    return { ms: Date.now() - t0, resolvedSource: undefined, sourceName: undefined, error: `请求异常: ${e.message}` }
  }
}

async function main() {
  await new Promise(res => http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end('ID3fake') }).listen(FAKE_PORT, '127.0.0.1', res))

  stubSearch()
  setup()
  process.env.DATA_PATH = DATA
  process.env.LOG_PATH = path.join(DATA, 'logs')
  process.env.PORT = String(PORT)
  process.env.NODE_ENV = 'development'
  process.env.CONFIG_PATH = path.join(DATA, 'config.js')

  require('./server')
  await waitReady()
  await new Promise(r => setTimeout(r, 4000))

  const results = {}
  const ok = []
  const bad = []
  const check = (cond, msg) => (cond ? ok.push(msg) : bad.push(msg))

  // A) 回归重点：候选平台 4 个以上，且前几个都失败。
  //    maxParallelPlatforms=3，第 4 个候选必须在前一个跑完后被重新拉起，
  //    否则请求会永久挂死（这正是首版漏掉的 P0）。
  results.A_fourCandidates = await timed(
    { songInfo: song('kw', 'hang_case_1'), quality: '128k' }, 25000)
  check(results.A_fourCandidates.resolvedSource === 'mg' && results.A_fourCandidates.sourceName === '咪咕快源',
    `A 候选平台≥4 不挂死：${results.A_fourCandidates.ms}ms 由第 4 个候选(mg)胜出`)

  // B) 回归重点：缺少歌名/歌手时必须快速报错，而不是永久等待跨平台搜索。
  results.B_noNameSinger = await timed(
    { songInfo: { source: 'kw', songmid: 'x1', id: 'kw_x1' }, quality: '128k' }, 20000)
  check(results.B_noNameSinger.error && results.B_noNameSinger.ms < 15000,
    `B 缺歌名/歌手快速失败：${results.B_noNameSinger.ms}ms 返回错误而非挂死`)

  // C) 原平台本身可用时，不应被跨平台搜索拖慢（原平台立刻开跑）
  results.C_originalFast = await timed(
    { songInfo: song('mg', 'mg_direct_1'), quality: '128k' }, 25000)
  check(results.C_originalFast.sourceName === '咪咕快源' && results.C_originalFast.ms < 3000,
    `C 原平台不白等跨平台：${results.C_originalFast.ms}ms 直接由咪咕快源解析`)

  // D) 粘滞缓存
  const before = await timed({ songInfo: song('mg', 'mg_direct_1'), quality: '128k' }, 25000)
  results.D_sticky = before
  check(before.sourceName === '咪咕快源' && before.ms < 3000,
    `D 粘滞缓存：${before.ms}ms 复用上次结果`)

  // E) 响应里必须带逐源 attempts 明细（诊断用）
  results.E_attempts = await timed(
    { songInfo: song('mg', 'mg_attempt_' + Date.now(), { name: '另一首' + Date.now() }), quality: '128k' }, 25000)
  check(Array.isArray(results.E_attempts.attempts) && results.E_attempts.attempts.length > 0,
    `E attempts 明细非空：${JSON.stringify((results.E_attempts.attempts || []).map(a => a.name + ':' + a.status)).slice(0, 120)}`)

  // F) 死源熔断：咪咕死源连续失败到阈值后应被剔除
  let lastAttempts = []
  for (let i = 0; i < 6; i++) {
    const r = await timed({ songInfo: song('mg', `mg_brk_${i}`, { name: '熔断' + i }), quality: '128k' }, 25000)
    lastAttempts = r.attempts || []
  }
  results.F_breaker = { names: lastAttempts.map(a => `${a.name}:${a.status}`) }
  check(!lastAttempts.some(a => a.name === '咪咕死源'),
    `F 死源熔断：连续失败后「咪咕死源」已从竞速中剔除（最后一次参与: ${results.F_breaker.names.join(', ')}）`)

  console.log('\n===== RESULTS =====')
  console.log(JSON.stringify(results, null, 2))
  console.log('\n===== VERDICT =====')
  ok.forEach(x => console.log('PASS  ' + x))
  bad.forEach(x => console.log('FAIL  ' + x))
  process.exit(bad.length ? 1 : 0)
}

main().catch(e => { console.error('测试异常:', e); process.exit(2) })