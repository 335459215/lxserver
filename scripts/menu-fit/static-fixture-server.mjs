/**
 * 离线测试服务器：只服务构建产物 + 桩接口，**不连任何外部服务**。
 *
 * 为什么需要它（而不是复用 serve-dev.mjs）：
 *   serve-dev 把 /api 反向代理到 NAS —— CI 里没有 NAS，也没有外网音乐平台，
 *   那样写出来的"护栏"在 CI 里只会超时，等于没有护栏。
 *   这里把前端依赖的少数接口**桩掉**，让 UI 能在完全离线的 CI 里跑起来。
 *
 * 桩的接口只有三个（都是登录门 + 音质菜单所必需的）：
 *   POST /api/login            → 返回固定 token，让登录门放行
 *   GET  /api/user/auth/verify → 返回 admin，避免被踢回登录页
 *   GET  /api/music/search     → 返回带 types 的固定曲目（音质菜单靠它显示"本曲 xx MB"）
 *
 * 只读、只监听回环。绝不修改任何远端状态。
 *
 *   node .playwright/static-fixture-server.mjs [port]
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
// 本文件在 <repo>/scripts/menu-fit/ 下，构建产物在 <repo>/public/app/
const PUBLIC_DIR = path.resolve(here, '..', '..', 'public')
const PORT = Number(process.argv[2] || 9701)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

/** 桩曲目：故意让「晴天」申报 flac（对应"本曲 52.83 MB"），
 *  「只有 320k 的歌」只申报 320k —— 两种形态都要在菜单里可区分。 */
const FIXTURE_SONGS = [
  {
    name: '晴天',
    singer: '周杰伦',
    source: 'kw',
    songmid: '228908',
    albumName: '叶惠美',
    interval: '04:29',
    img: '',
    types: [
      { type: '128k', size: '4.12Mb' },
      { type: '320k', size: '10.29Mb' },
      { type: 'flac', size: '52.83Mb' },
    ],
  },
  {
    name: '只有高品位的歌',
    singer: '测试歌手',
    source: 'kw',
    songmid: '999001',
    albumName: '测试专辑',
    interval: '03:00',
    img: '',
    types: [
      { type: '128k', size: '3.00Mb' },
      { type: '320k', size: '7.50Mb' },
    ],
  },
]

const send = (res, code, type, body) => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}
const json = (res, code, obj) => send(res, code, MIME['.json'], JSON.stringify(obj))

/** 生成一段**真实可播放**的静音 WAV（16bit 单声道 8kHz）。
 *
 *  【为什么必须是真音频】
 *  降级断言的链路是「解析返回低档位 → UI 点亮红点」。如果 audio.src 放不出声，
 *  浏览器会触发 error 事件 → 播放内核走「自动换源」→ 重新解析 → 状态被覆盖，
 *  红点时有时无，测试变成随机失败。给一段合规 WAV 才能让状态稳定停在"已播放"。
 *
 *  8kHz 单声道是为了体积小（0.6s ≈ 9.6KB），不影响任何断言 ——
 *  这里不验音质，只验 UI 读了哪个字段。 */
function makeWav(seconds = 0.6, sampleRate = 8000) {
  const n = Math.floor(sampleRate * seconds)
  const dataSize = n * 2 // 16bit
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16) // fmt chunk size
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28) // byte rate
  buf.writeUInt16LE(2, 32) // block align
  buf.writeUInt16LE(16, 34) // bits per sample
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  // 全 0 = 静音；不需要填充，Buffer.alloc 已是 0
  return buf
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0])

  // ---- 桩接口 ----
  if (urlPath === '/api/login' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => json(res, 200, { success: true, username: 'tester', isAdmin: true, token: 'stub-token' }))
    return
  }
  if (urlPath === '/api/user/auth/verify') {
    // 字段名必须是 valid（见 web/src/lib/auth.tsx 的 userVerify）。
    // 写成 ok 会被当成「token 无效」→ 页面停在登录门，症状是"搜索 0 行"。
    json(res, 200, { valid: true, username: 'tester', isAdmin: true })
    return
  }
  if (urlPath === '/api/music/search') {
    json(res, 200, FIXTURE_SONGS)
    return
  }

  // ---- 【播放历史】分桶与统计 ----
  //
  // 刻意造出**四个分组都有数据**的时间分布，且带 playCount 与多歌手串，
  // 这样「今天/昨天/最近一周/更早」四段与统计卡才会被真正渲染到。
  // 时间用「相对现在」算，不写死时间戳 —— 否则过几天这份 fixture 就过期了。
  if (urlPath === '/api/music/history/list') {
    const now = Date.now()
    const H = 3600_000
    const D = 24 * H
    const mk = (i, name, singer, agoMs, playCount) => ({
      key: `kw|stub-${i}`,
      source: 'kw',
      songmid: `stub-${i}`,
      name,
      singer,
      interval: '03:30',
      albumName: '桩专辑',
      img: null,
      playedAt: now - agoMs,
      playCount,
    })
    const list = [
      // 今天：2 首
      mk(1, '今天听的歌', '周杰伦、费玉清', 2 * H, 3),
      mk(2, '今天第二首', '林俊杰', 5 * H, 1),
      // 昨天：1 首（用「昨天此刻」而不是固定 24h，跨零点也仍然算昨天）
      mk(3, '昨天听的歌', '周杰伦', D + H, 2),
      // 最近一周：2 首
      mk(4, '三天前的歌', '五月天', 3 * D, 1),
      mk(5, '五天前的歌', '五月天', 5 * D, 4),
      // 更早：1 首
      mk(6, '很久以前的歌', '陈奕迅', 30 * D, 1),
    ]
    json(res, 200, {
      success: true,
      list,
      total: list.length,
      page: 1,
      pageSize: 50,
      hasMore: false,
    })
    return
  }

  // ---- 【降级 / 升级场景】播放地址解析 ----
  //
  // 真实环境里「降级」极难在端到端复现：线上音源基本都能给出 flac，
  // 于是 resolvedQuality === preferredQuality，红点分支永远走不到
  // （verify-quality.py 里那条断言长期走的是 [INFO] 跳过分支）。
  //
  // 两种可控场景，靠曲目区分（songInfo.name）：
  //   ① 「晴天」          → 降级：请求 flac/hires/flac24bit 一律回 320k
  //   ② 「只有高品位的歌」 → **升级**：请求 flac 时回 flac24bit
  //
  // ② 是 D-012 的关键：旧实现 `resolved !== preferred` 会把 flac→flac24bit
  // 这种**升级**也标成降级。只测「同档」（320k vs 320k）抓不到这个 bug ——
  // 同档时旧实现也因 `resolved === preferred` 提前返回 false（假绿）。
  if (urlPath === '/api/music/url' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let requested = '320k'
      let songName = ''
      try {
        const parsed = JSON.parse(body || '{}')
        requested = parsed.quality || '320k'
        songName = parsed.songInfo?.name || ''
      } catch {
        // 按默认处理
      }
      const high = ['flac', 'flac24bit', 'hires']
      let actual
      if (songName.includes('高品位')) {
        // 升级场景：请求 flac 给 flac24bit（更高一档）
        actual = requested === 'flac' ? 'flac24bit' : requested
      } else {
        // 降级场景：请求高档一律只给 320k
        actual = high.includes(requested) ? '320k' : requested
      }
      json(res, 200, {
        url: `/api/stub-audio.wav?q=${encodeURIComponent(actual)}`,
        type: actual,
        sourceName: '桩音源',
        sourceId: 'stub',
        requestedSource: 'kw',
        resolvedSource: 'kw',
        attempts: [],
        hasMoreSources: false,
        fromCache: false,
      })
    })
    return
  }

  // 真实可播放的 WAV（否则音频 error 会触发「自动换源」，
  // 把刚判定的降级状态覆盖掉，测试就测不到红点了）
  if (urlPath === '/api/stub-audio.wav') {
    // 【时长必须足够长】第一版只生成 0.6 秒，结果音频很快播完 →
    // 播放器按「列表循环」自动切到下一首 → 按钮档位与菜单文案对不上，
    // 表现为"同一首歌按钮显示 24bit、菜单却说是 320k 降级"这种灵异现象。
    // 30 秒（8kHz 单声道 16bit ≈ 480KB）足够任何断言序列跑完。
    const wav = makeWav(30)
    res.writeHead(200, {
      'Content-Type': 'audio/wav',
      'Content-Length': wav.length,
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes',
    })
    res.end(wav)
    return
  }
  if (urlPath === '/config.json') {
    json(res, 200, { version: 'stub', playerPath: '/' })
    return
  }
  // Service Worker：构建产物里有 /app/sw.js，但根路径 /sw.js 没有。
  // 不桩它会有一条 404 的 console error（页面本身能用，但会污染"零 error"断言）。
  if (urlPath === '/app/sw.js') {
    send(res, 200, MIME['.js'], '// stub service worker (offline fixture)\n')
    return
  }
  if (urlPath === '/sw.js') {
    send(res, 200, MIME['.js'], '// stub service worker (offline fixture)\n')
    return
  }
  // 其它接口一律给空数据，避免页面卡在 loading 上
  if (urlPath.startsWith('/api/')) {
    json(res, 200, { success: true, list: [], data: [], total: 0 })
    return
  }

  // ---- 静态文件 ----
  const rel = urlPath.replace(/^\/+/, '')
  const file = path.join(PUBLIC_DIR, rel)
  if (file.startsWith(PUBLIC_DIR) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    send(res, 200, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', fs.readFileSync(file))
    return
  }

  // ---- SPA 回退（只对前端路由，别把未知路径也吞掉）----
  const isApp = urlPath === '/app' || urlPath.startsWith('/app/')
  const rootSpa = (() => {
    if (urlPath === '/' || urlPath === '/index.html') return true
    const seg = urlPath.split('/').filter(Boolean)
    if (seg.length === 0 || seg.length > 2) return false
    const [a, b] = seg
    const two = ['playlist', 'artist', 'artist-name', 'album', 'settings']
    const one = ['search', 'leaderboard', 'favorites', 'local', 'history', 'now-playing', 'dev']
    if (one.includes(a)) return seg.length === 1
    if (two.includes(a)) return seg.length === 1 || !!b
    return false
  })()
  if (isApp || rootSpa) {
    const index = path.join(PUBLIC_DIR, 'app', 'index.html')
    if (fs.existsSync(index)) {
      send(res, 200, MIME['.html'], fs.readFileSync(index))
      return
    }
  }

  send(res, 404, MIME['.txt'], 'not found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[static-fixture] http://127.0.0.1:${PORT}/  (离线，无外部依赖)`)
  console.log(`[static-fixture] static=${PUBLIC_DIR}`)
})
