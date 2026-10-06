import http from 'node:http'
import { deflateSync } from 'node:zlib'
import iconv from 'iconv-lite'
import { log, makeWav } from './util.mjs'

// 45 首：默认一页 20 首，第 1/2/3 页都有数据，能真正验证服务端分页透传。
// （kw SDK 在「本页 0 条」时会自动重试并最终抛 try max num，所以只给 12 首测不了翻页）
// 前 5 首的时长与 fixture 歌单严格一致：跨平台换源按「歌名+歌手+时长±8s」匹配
// （musicMatch.getSongMatchScore），时长对不上就被判成"不是同一首歌"。
const ARTISTS = ['测试歌手', '另一位歌手', '合唱团', '新歌手', '对唱组合', '乐队']
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
const FIXTURE_INTERVALS = [210, 252, 178, 300, 183]
const KW_SONGS = Array.from({ length: 45 }, (_, i) => [
  `smoke${1001 + i}`,
  `冒烟测试曲${CN_NUM[i % 10]}${i >= 10 ? `之${Math.floor(i / 10) + 1}` : ''}`,
  ARTISTS[i % ARTISTS.length],
  `冒烟专辑${(i % 6) + 1}`,
  `smokealb${(i % 6) + 1}`,
  i < FIXTURE_INTERVALS.length ? FIXTURE_INTERVALS[i] : 180 + (i % 7) * 15,
])

const HOT_WORDS = ['冒烟热搜一', '冒烟热搜二', '冒烟热搜三', '测试歌手', '冒烟专辑', '死链测试', '聚合搜索', '分页测试', '本地音乐', '歌词卡片']

function kwSearchResponse(page, limit) {
  const start = (page - 1) * limit
  // 越界页返回「0 条结果」而不是「有总数但本页 0 条」。
  // kw SDK 把 TOTAL!=='0' && SHOW==='0' 当成需要重试的失败（musicSearch.js:103），
  // 连续 3 次后抛 try max num，整个搜索 500 —— 那是要单独排期的缺陷，
  // 不该让冒烟套件每次翻页预取都撞上它（见 docs/stage0/defect-ledger.md）。
  const rows = KW_SONGS.slice(start, start + limit)
  if (!rows.length) return { abslist: [], TOTAL: '0', SHOW: '0' }
  const total = start + rows.length < KW_SONGS.length ? String(start + rows.length) : String(KW_SONGS.length)
  return {
    abslist: rows.map(([id, name, artist, album, albumId, duration]) => ({
    MUSICRID: `MUSIC_${id}`,
    SONGNAME: name,
    ARTIST: artist,
    ALBUM: album,
    ALBUMID: albumId,
    DURATION: String(duration),
    N_MINFO: 'level:standard,bitrate:128,format:mp3,size:3.5MB;level:standard,bitrate:320,format:mp3,size:8.8MB;level:standard,bitrate:2000,format:flac,size:24.1MB',
    prob_albumpic: `https://img.example.invalid/cover/${id}.jpg`,
    web_albumpic_short: `/cover/${id}.jpg`,
    })),
    TOTAL: total,
    SHOW: String(rows.length),
  }
}

/**
 * kw 歌词应答。
 *
 * 协议与 src/modules/utils/musicSdk/kw/{lyric,util}.js 严格对齐，逐层反向构造：
 *   URL 参数 = base64( XOR(paramsJson, 'yeelion') )
 *   响应体   = base64( 'tp=content\r\n\r\n' + deflate( base64( XOR(lrc_gb18030, 'yeelion') ) ) )
 * 解码端依次做 base64→查 tp=content→inflate→base64→XOR→gb18030（decodeLyricInternal），
 * 所以这里必须按同样顺序编码，否则歌词接口只会返回 500。
 */
const LRC_KEY = Buffer.from('yeelion')
const xorWithKey = (buf) => {
  const out = Buffer.alloc(buf.length)
  for (let i = 0, j = 0; i < buf.length; i++, j = (j + 1) % LRC_KEY.length) out[i] = buf[i] ^ LRC_KEY[j]
  return out
}

function decodeKwParams(encrypted) {
  try {
    return xorWithKey(Buffer.from(encrypted, 'base64')).toString('utf8')
  } catch {
    return ''
  }
}

function buildLrc(song, artist) {
  const lines = [
    `[ti:${song}]`,
    `[ar:${artist}]`,
    '[al:冒烟专辑]',
    '[by:smoke-fixture]',
    '[00:00.00]冒烟测试歌词 · 第一行',
    '[00:04.00]冒烟测试歌词 · 第二行',
    '[00:08.00]冒烟测试歌词 · 第三行',
    '[00:12.00]冒烟测试歌词 · 第四行',
    '[00:16.00]冒烟测试歌词 · 第五行',
    '[00:20.00]冒烟测试歌词 · 第六行',
  ]
  return lines.join('\r\n')
}

function kwLyricResponse(encryptedParams) {
  const plain = decodeKwParams(encryptedParams)
  if (!plain.includes('rid=MUSIC_')) return null
  const rid = new URLSearchParams(plain).get('rid').replace('MUSIC_', '')
  const song = KW_SONGS.find((s) => s[0] === rid)
  const name = song ? song[1] : '冒烟测试曲目'
  const artist = song ? song[2] : '测试歌手'
  const inner = xorWithKey(iconv.encode(buildLrc(name, artist), 'gb18030')).toString('base64')
  // 注意：响应体是二进制，不能再套一层 base64 —— SDK 自己会 raw.toString('base64')
  // 交给 decodeLyric（kw/lyric.js getLyric）。双层 base64 会让 decodeLyricInternal
  // 的 'tp=content' 前缀检查失败，返回空串，最终报 Get lyric failed。
  return Buffer.concat([
    Buffer.from('tp=content\r\n\r\n', 'utf8'),
    deflateSync(Buffer.from(inner, 'utf8')),
  ])
}

/**
 * mock 音乐平台。
 *
 * 两个用途，同一个端口：
 *  1. 作为 HTTP 代理被服务端出站请求使用（配置 PROXY_MUSIC_ENABLED=true 时，
 *     内置音乐平台 SDK 的请求全部打到这）—— 这样测试完全不碰真实平台。
 *  2. 直接给浏览器/服务端提供 mock 音频文件（自定义源返回的播放地址指向这里）。
 *
 * 对 https 一律回 502：不做 TLS 中间人，也不隧道到真实互联网 ——
 * 测试既不会限流，也不会意外发出真实请求。
 */
export function startMock({ port = 19528 } = {}) {
  const requests = []
  const wav = makeWav(1)

  function sendAudio(res, name) {
    const range = res.req?.headers?.range
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range)
      const start = m && m[1] ? parseInt(m[1], 10) : 0
      const end = m && m[2] ? Math.min(parseInt(m[2], 10), wav.length - 1) : wav.length - 1
      res.writeHead(206, {
        'Content-Type': 'audio/wav',
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${wav.length}`,
        'Content-Length': String(end - start + 1),
      })
      res.end(wav.subarray(start, end + 1))
      return
    }
    res.writeHead(200, {
      'Content-Type': 'audio/wav',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(wav.length),
    })
    res.end(wav)
  }

  /**
 * 目标主机白名单：只有这些域名会被 mock 应答，其余一律 502。
 * 目的是「测试流量永不出网」—— mock 不会做 DNS 解析，也不会连接真实平台。
 */
const ALLOWED_HOSTS = new Set([
  'search.kuwo.cn',
  'hotword.kuwo.cn',
  'newlyric.kuwo.cn',
  'www.kuwo.cn',
  '127.0.0.1',
  'localhost',
])

function normalizeTarget(req) {
  // 两种形态都要认：
  //  1) 普通 HTTP 代理形态：req.url 是绝对 URI（GET http://search.kuwo.cn/r.s?...）
  //  2) CONNECT 隧道形态：req.url 是路径，目标主机在 Host 头里
  const raw = req.url || ''
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const u = new URL(raw)
      return { scheme: u.protocol, host: u.hostname, port: u.port, path: `${u.pathname}${u.search}` }
    } catch { /* fallthrough */ }
  }
  const hostHeader = String(req.headers.host || '')
  const [hostname, port] = hostHeader.split(':')
  return {
    scheme: `http:`, // 隧道被 mock 终止，客户端与服务端之间永远是明文
    host: hostname,
    port: port || '80',
    path: raw,
  }
}

function route(target, res) {
  if (target.scheme === 'https:') {
    res.writeHead(502, { 'Content-Type': 'text/plain' })
    res.end('mock: https is not intercepted (no MITM, no real traffic)')
    return
  }
  if (!ALLOWED_HOSTS.has(target.host)) {
    res.writeHead(502, { 'Content-Type': 'text/plain' })
    res.end(`mock: host not allowed: ${target.host}`)
    return
  }
  if (target.host === 'search.kuwo.cn' && target.path.startsWith('/r.s')) {
    const params = new URLSearchParams(target.path.split('?')[1] || '')
    const page = Math.max(1, parseInt(params.get('pn') || '0', 10) + 1)
    const limit = parseInt(params.get('rn') || '20', 10)
    const body = kwSearchResponse(page, limit)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
    return
  }
  if (target.host === 'hotword.kuwo.cn' && target.path.startsWith('/hotword.s')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', tagvalue: HOT_WORDS.map((key) => ({ key })) }))
    return
  }
  if (target.host === 'newlyric.kuwo.cn' && target.path.startsWith('/newlyric.lrc')) {
    const body = kwLyricResponse(target.path.split('?')[1] || '')
    if (!body) {
      res.writeHead(502, { 'Content-Type': 'text/plain' })
      res.end('mock: undecodable lyric request')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end(body)
    return
  }
  // 音频走两种形态都认：隧道/代理形态走 Host 头，直连形态走常规路径
  if (target.path.startsWith('/audio/')) {
    sendAudio(res, target.path.split('/').pop())
    return
  }
  res.writeHead(502, { 'Content-Type': 'text/plain' })
  res.end(`mock: unmocked path ${target.host}${target.path}`)
}

const server = http.createServer((req, res) => {
  const target = normalizeTarget(req)
  requests.push({ kind: /^https?:/.test(req.url || '') ? 'proxy' : 'direct', host: target.host, path: target.path })
  route(target, res)
})

/**
 * CONNECT 隧道：tunnel（服务端代理库）对任何目标都先发 CONNECT，明文目标也一样。
 * mock 直接终止隧道并把 socket 交回同一个 HTTP 服务器解析，于是
 「隧道里的明文 HTTP 请求」和「绝对 URI 的普通代理请求」走到同一套应答逻辑。
 * 注意：mock 始终不解析 DNS、不外连，隧道只可能连到白名单内的应答。
 */
server.on('connect', (req, clientSocket) => {
  const [host] = String(req.url || '').split(':')
  requests.push({ kind: 'connect', host })
  if (!ALLOWED_HOSTS.has(host)) {
    clientSocket.end('HTTP/1.1 502 Not Intercepted\r\nConnection: close\r\n\r\n')
    return
  }
  clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
  // 把已建立的 socket 当作新连接塞回服务器，Node 会继续在上面跑 HTTP 解析
  server.emit('connection', clientSocket)
})

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      log('dim', `mock 音乐平台/音频服务已启动 http://127.0.0.1:${port}`)
      resolve({
        port,
        close: () => new Promise((r) => server.close(r)),
        requests,
        countWhere: (fn) => requests.filter(fn).length,
      })
    })
  })
}
