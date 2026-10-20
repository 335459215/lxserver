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
