// 端到端验证：不分平台 + 并发竞速 + 粘滞缓存 + 死源熔断 + 不为原平台白等
//
// 手动运行（需要外网，会真的去搜咪咕/酷狗等平台）：
//     npm run build && node test/music-resolver.e2e.js
//
// 设计：假自定义源全部只注册 mg 平台。
//  A) 歌曲本身就在 mg，且有一个快源 → 必须立刻解析，不能干等跨平台搜索返回
//  B) 歌曲在 wy（没有任何源支持）→ 只能靠跨平台搜到咪咕上的同名曲
//  C) 咪咕上两个源：慢源 2500ms 排在前、快源 60ms 排在后
//     竞速 + 优先级宽限(350ms 总预算) 应当让快源胜出，耗时远小于 2500ms
//  D) 重复解析同一首歌 → 粘滞缓存
//  E) 必失败的源连续失败到阈值后应被熔断剔除
// 所有音频链接都指向本脚本自带的哑元 HTTP 服务(真实 200)，以便通过链接校验。

const fs = require('fs')
const path = require('path')
const os = require('os')
const http = require('http')

const PORT = 19527
const FAKE_PORT = 19528
const BASE = `http://127.0.0.1:${PORT}`
const FAKE = `http://127.0.0.1:${FAKE_PORT}`
const DATA = path.join(os.tmpdir(), `lx-race-test-${Date.now()}`)

const script = (name, { delayMs, fail }) => `
lx.send('inited', { sources: { mg: { name: 'test-mg', qualitys: ['128k'] } } })
lx.on('request', async ({ action, source }) => {
  if (action !== 'musicUrl') return null
  await new Promise(r => setTimeout(r, ${delayMs}))
  ${fail ? "throw new Error('这个源故意失败')" : ''}
  return '${FAKE}/audio.mp3?from=${name}&platform=' + source
})
`

const SOURCES = [
  { id: 'slow-mg', name: '慢源MG', delayMs: 2500, fail: false },
  { id: 'dead-mg', name: '死源MG', delayMs: 30, fail: true },
  { id: 'fast-mg', name: '快源MG', delayMs: 60, fail: false },
]

function setup() {
  const dir = path.join(DATA, 'users', 'source', '_open')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify(
    SOURCES.map(s => ({
      id: s.id, name: s.name, enabled: true, version: '1.0', author: 'test',
      description: '', homepage: '', supportedSources: ['mg'],
    })), null, 2))
  fs.writeFileSync(path.join(dir, 'order.json'), JSON.stringify(SOURCES.map(s => s.id)))
  for (const s of SOURCES) fs.writeFileSync(path.join(dir, s.id), script(s.id, s))
  fs.mkdirSync(path.join(DATA, 'logs'), { recursive: true })
}

function post(body) {
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
    req.on('error', reject)
    req.end(data)
  })
}

const qingtian = { name: '晴天', singer: '周杰伦', interval: '04:30' }
const song = (source, id, extra = {}) => ({ source, songmid: id, id: `${source}_${id}`, ...qingtian, ...extra })

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

const timed = async (label, body) => {
  const t0 = Date.now()
  const r = await post(body)
  return { ms: Date.now() - t0, resolvedSource: r.resolvedSource, sourceName: r.sourceName, error: r.error }
}

async function main() {
  await new Promise(res => http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end('ID3fake') }).listen(FAKE_PORT, '127.0.0.1', res))

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
  // A) 原平台(mg)本身就有源：不该为了跨平台搜索而等待
  results.A_originalPlatformFast = await timed('A', { songInfo: song('mg', 'mg_local_1', { name: '青花瓷', singer: '周杰伦' }), quality: '128k' })

  // B) wy 的歌 → 必须跨平台到 mg。
  //    平台搜索接口本身很不可靠（实测偶发 Socket Hang Up），所以这里重试几次，
  //    验证的是「搜索成功时跨平台确实生效」，而不是上游接口的稳定性。
  let b = null
  for (let i = 0; i < 4 && !(b && !b.error); i++) {
    if (i > 0) console.log(`（咪咕搜索重试 ${i}）`)
    b = await timed('B', { songInfo: song('wy', '186016'), quality: '128k' })
    results.B_crossPlatform = b
  }

  // C) 竞速耗时必须单独测：换一首同名不同 id 的歌，让 60s 的平台匹配缓存命中，
  //    这样测到的就是纯竞速开销，不掺杂波动很大的上游平台搜索。
  results.C_raceOnly = await timed('C', { songInfo: song('wy', '999999'), quality: '128k' })

  // D) 重复解析 → 粘滞缓存
  results.D_sticky = await timed('D', { songInfo: song('wy', '186016'), quality: '128k' })

  // D) 死源熔断：死源MG 必失败。多解析几首不同的歌后，它应被跳过不再参与竞速。
  //    最后一次的响应里 attempts 会带上真实参与过的源，用它断言。
  let lastAttempts = []
  for (let i = 0; i < 6; i++) {
    const r = await post({ songInfo: song('mg', 'mg_breaker_' + i, { name: '青花瓷', singer: '周杰伦' }), quality: '128k' })
    lastAttempts = r.attempts || []
  }
  results.D_breaker = {
    attemptsInLastResolve: lastAttempts.map(a => `${a.name}:${a.status}`),
    deadSourceSkipped: !lastAttempts.some(a => a.name === '死源MG'),
  }

  console.log('\n===== RESULTS =====')
  console.log(JSON.stringify(results, null, 2))

  const ok = []
  const bad = []
  const check = (cond, msg) => (cond ? ok.push(msg) : bad.push(msg))

  check(results.A_originalPlatformFast.resolvedSource === 'mg' && results.A_originalPlatformFast.sourceName === '快源MG'
    && results.A_originalPlatformFast.ms < 1500,
  `A 原平台不白等跨平台：${results.A_originalPlatformFast.ms}ms 由快源MG 直接解析（跨平台搜索本身要好几秒）`)

  check(results.B_crossPlatform.resolvedSource === 'mg' && results.B_crossPlatform.sourceName === '快源MG',
  `B 不分平台：wy 的歌跨到咪咕由快源MG解析成功（${results.B_crossPlatform.ms}ms）`)

check(results.C_raceOnly.sourceName === '快源MG' && results.C_raceOnly.ms < 1500,
    `C 并发竞速（已排除平台搜索耗时）：${results.C_raceOnly.ms}ms 由快源胜出，慢源排更前且需 2500ms，宽限 350ms 后不再等它`)

  check(results.D_sticky.sourceName === '快源MG' && results.D_sticky.ms < 800,
    `D 粘滞缓存：${results.D_sticky.ms}ms 复用上次结果`)

  check(results.D_breaker.deadSourceSkipped,
    `E 死源熔断：连续失败后 死源MG 已从竞速中剔除（最后一次参与: ${results.D_breaker.attemptsInLastResolve.join(', ')}）`)

  console.log('\n===== VERDICT =====')
  ok.forEach(x => console.log('PASS  ' + x))
  bad.forEach(x => console.log('FAIL  ' + x))
  process.exit(bad.length ? 1 : 0)
}

main().catch(e => { console.error('测试异常:', e); process.exit(2) })