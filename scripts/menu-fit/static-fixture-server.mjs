/**
 * 离线测试服务器：只服务构建产物 + 桩接口，**不连任何外部服务**。
 *
 * 为什么需要它（而不是复用 serve-dev.mjs）：
 *   serve-dev 把 /api 反向代理到 NAS —— CI 里没有 NAS，也没有外网音乐平台，
 *   那样写出来的"护栏"在 CI 里只会超时，等于没有护栏。
 *   这里把前端依赖的少数接口**桩掉**，让 UI 能在完全离线的 CI 里跑起来。
 *
 * 桩的接口（登录门 + 音质菜单 + 播放历史 + 歌词回退所必需的）：
 *   POST /api/login            → 返回固定 token，让登录门放行
 *   GET  /api/user/auth/verify → 返回 admin，避免被踢回登录页
 *   GET  /api/music/search     → 返回带 types 的固定曲目（音质菜单靠它显示"本曲 xx MB"）
 *   GET  /api/music/history/*  → 有状态的历史（分桶统计 + 删除/撤销）
 *   GET  /api/music/lyric      → kg 有歌词、其它源一律 500（专测「无歌词自动换源」）
 *   GET  /api/__fixture__/*    → 调试端点：removed-log / lyric-log / reset
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
//
// 【FX_PUBLIC_DIR 覆盖】只给本地调试/沙箱用：有些环境（如挂载出来的只读
// fuse 目录）无法原地 `vite build` 覆盖 public/app，可以构建到临时目录后
// 用 `FX_PUBLIC_DIR=/tmp/lxroot node static-fixture-server.mjs` 指过去。
// CI 不设这个变量 → 行为与之前完全一致。
const PUBLIC_DIR = process.env.FX_PUBLIC_DIR
  ? path.resolve(process.env.FX_PUBLIC_DIR)
  : path.resolve(here, '..', '..', 'public')
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
    // 【前缀污染对照曲】搜索形态 songmid 干净；歌单形态见 defaultList 桩（wy_777002）。
    // 修复前两者缓存键不同（缓存分裂+歌单形态播错曲），修复后同键命中。
    name: '同曲异源歌',
    singer: '测试',
    source: 'wy',
    songmid: '777002',
    albumName: '测试专辑',
    interval: '03:00',
    img: '',
    types: [{ type: '128k', size: '3.00Mb' }],
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

/** 播放历史桩数据：**可变**（删除/撤销会真的改动它）。
 *  时间锚定「本地日界」生成，不写死时间戳（过几天也不过期）。
 *
 *  【为什么不能「now 减固定小时」—— 2026-10-24 CI 实测翻车】
 *  v2.29.0 最初用 `now - 2h / now - 5h` 当「今天」。CI 是 UTC 机器，
 *  一次 01:39 UTC 的运行里 now-2h 落到昨天 23:39 —— 两首「今天」的歌
 *  全掉进「昨天」组，分桶/统计/删除用例全红。同一份代码在 09:30 UTC 跑
 *  却是绿的：**护栏按一天中的时刻随机红**。这与 v2.29.0 钉时区是同一家族
 *  的问题 —— 凡涉及「自然日」的数据与断言，都必须锚定本地日界。
 *  正解：先取本地零点，再在零点上加减整天 + 当天时刻；
 *  「今天」的条目还要与 now 取 min（凌晨 1 点跑时 08:00 在未来），
 *  并兜底不早于零点后 30 秒（刚过零点的第 1 分钟里 now-Δ 会掉回昨天）。 */
function buildHistory() {
  const now = Date.now()
  const H = 3600_000
  const D = 24 * H
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const M0 = midnight.getTime()
  /** 今天的某个时刻：目标时刻若在未来（凌晨跑）就退回 now */
  const todayAt = (h) => Math.max(M0 + 30_000, Math.min(M0 + h * H, now))
  /** N 天前的某个时刻（整天偏移，夏令时 ±1h 由分桶的 Math.round 吸收） */
  const daysAgoAt = (n, h) => M0 - n * D + h * H
  const mk = (i, name, singer, playedAt, playCount) => ({
    key: `kw|stub-${i}`,
    source: 'kw',
    songmid: `stub-${i}`,
    name,
    singer,
    interval: '03:30',
    albumName: '桩专辑',
    img: null,
    playedAt,
    playCount,
  })
  return [
    // 今天：2 首
    mk(1, '今天听的歌', '周杰伦、费玉清', todayAt(8), 3),
    mk(2, '今天第二首', '林俊杰', todayAt(11), 1),
    // 昨天：1 首（零点减 1h = 昨天 23:00，任何时刻跑都必然是昨天）
    mk(3, '昨天听的歌', '周杰伦', M0 - H, 2),
    // 最近一周：2 首
    mk(4, '三天前的歌', '五月天', daysAgoAt(3, 5), 1),
    mk(5, '五天前的歌', '五月天', daysAgoAt(5, 9), 4),
    // 更早：1 首
    mk(6, '很久以前的歌', '陈奕迅', daysAgoAt(30, 7), 1),
  ]
}
let historyStore = buildHistory()
/** 记录被删过的 key（调试端点用），确认「删除真的发到了服务端」 */
let removedLog = []
/** 记录歌词接口被查询的 source 序列（调试端点用），确认「回退链的请求顺序」 */
let lyricLog = []
/** 收藏列表桩（有状态）：L 键的「收藏/取消收藏」会真的改动它 */
let loveStore = []
/** 用户歌单桩（有状态）：导入/导出的「全量恢复」会真的改动它 */
let userListsStore = [
  {
    id: 'user_seed',
    name: '导入前的歌单',
    list: [
      {
        id: 'kw_228908',
        name: '晴天',
        singer: '周杰伦',
        source: 'kw',
        songmid: '228908',
        interval: '04:29',
      },
    ],
  },
]
/** 记录音频中转请求（缓存后台抓取走 /api/music/download） */
let proxyLog = []

/** 记录音频解析请求 —— 播放缓存护栏断言「重播零解析」的依据 */
let urlBodies = []
let urlResolveLog = []

/** 记录整份写回（restore）操作 —— 确认「导入真的发到了服务端」 */
let transferLog = []
/** 记录收藏增删操作（调试端点用），确认「L 键真的发到了服务端」 */
let loveLog = []

/** 歌词桩：只有 kg 有歌词，其它源一律 500（= 真实服务端「无歌词」的信号）。
 *  这样「本源无歌词 → 自动回退 kg」的整条链在离线环境里就能真正跑起来。 */
const FALLBACK_LRC = [
  '[00:00.50]回退歌词第一行',
  '[00:03.00]回退歌词第二行',
  '[00:06.50]回退歌词第三行',
].join('\n')

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

  // ---- 【歌词多平台回退】----
  //
  // 真实环境里「本源无歌词」的歌极难稳定复现（要看平台版权），但在桩里
  // 把 kw 一律判无歌词（500）就立刻可测：前端必须回退 kg 才能拿到歌词。
  // lyricLog 记录请求顺序 —— 断言「先打本源、再打 kg」，防止回退链被
  // 改成「跳过本源直取 kg」（那会让所有歌都走回退，本源歌词反而没人用了）。
  if (urlPath === '/api/music/lyric' && req.method === 'GET') {
    const src = new URL(req.url || '/', 'http://localhost').searchParams.get('source') || ''
    lyricLog.push(src)
    if (src !== 'kg') {
      // 与真实服务端一致：无歌词 = 500 + text/plain
      send(res, 500, MIME['.txt'], 'no lyric')
      return
    }
    json(res, 200, { lyric: FALLBACK_LRC, tlyric: '', rlyric: '', lxlyric: '' })
    return
  }

  if (urlPath === '/api/__fixture__/lyric-log') {
    json(res, 200, { success: true, sources: lyricLog.slice() })
    return
  }

  // ---- 【收藏（L 键）】----
  //
  // 【必须是有状态的】与历史删除同理：收藏是有副作用的操作，固定列表会让
  // 「请求没发出去」看起来也对。add/remove 真的改动 loveStore，并记进 loveLog。
  if (urlPath === '/api/user/list' && req.method === 'GET') {
    json(res, 200, {
      defaultList: [
        // 【前缀污染形态】歌单条目 songmid 带平台前缀（落雪桌面同步的真实形态）
        { id: 'wy_777002', name: '同曲异源歌', singer: '测试', source: 'wy', songmid: 'wy_777002', interval: '03:00' },
      ],
      loveList: loveStore,
      userList: userListsStore,
    })
    return
  }

  // 整份写回（导入的最后一跳）。语义与真实服务端一致：全量替换 + 记日志
  if (urlPath === '/api/user/list' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}') || {}
        loveStore = Array.isArray(data.loveList) ? data.loveList : loveStore
        userListsStore = Array.isArray(data.userList) ? data.userList : userListsStore
        transferLog.push({ op: 'restore', lists: userListsStore.length, songs: userListsStore.reduce((a, l) => a + (l.list || []).length, 0) + loveStore.length })
        json(res, 200, { success: true })
      } catch {
        send(res, 400, MIME['.txt'], 'bad json')
      }
    })
    return
  }

  if (urlPath === '/api/music/download' && req.method === 'GET') {
    const target = new URL(req.url || '/', 'http://localhost').searchParams.get('url') || ''
    proxyLog.push(target.slice(0, 60))
    // 桩环境里目标地址就是本机的 /api/stub-audio.wav —— 必须回**同样的 30 秒音频**。
    // 【真实教训（2026-10-25）】这里曾偷懒回 makeWav()（0.6 秒），被后台缓存原样
    // 固化 → 重播缓存命中 0.6 秒就 ended → advance 跳下一首 → 「显示 A 实际播 B」
    // 的完整假象，护栏成片红。中转的字节 = 未来缓存回放的字节，必须与直链一致。
    send(res, 200, 'audio/wav', makeWav(30))
    return
  }

  if (urlPath === '/api/__fixture__/proxy-log') {
    json(res, 200, { success: true, fetches: proxyLog.slice() })
    return
  }

  if (urlPath === '/api/__fixture__/url-bodies') {
    json(res, 200, { success: true, bodies: urlBodies.slice() })
    return
  }

  if (urlPath === '/api/__fixture__/url-log') {
    json(res, 200, { success: true, resolves: urlResolveLog.slice() })
    return
  }

  if (urlPath === '/api/__fixture__/transfer-log') {
    json(res, 200, {
      success: true,
      ops: transferLog.slice(),
      userLists: userListsStore.map((l) => ({ id: l.id, name: l.name, count: (l.list || []).length })),
    })
    return
  }

  if (urlPath === '/api/music/user/list/add' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let infos = []
      try {
        infos = JSON.parse(body || '{}').musicInfos || []
      } catch {
        /* 空数组走正常路径 */
      }
      for (const it of infos) {
        if (!loveStore.some((x) => x.id === it.id)) loveStore.push(it)
      }
      loveLog.push({ op: 'add', ids: infos.map((x) => x.id), songmid: infos.map((x) => x.songmid) })
      send(res, 200, MIME['.txt'], '添加成功')
    })
    return
  }

  if (urlPath === '/api/music/user/list/remove' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let ids = []
      try {
        ids = JSON.parse(body || '{}').songIds || []
      } catch {
        /* 空数组走正常路径 */
      }
      loveStore = loveStore.filter((x) => !ids.includes(x.id))
      loveLog.push({ op: 'remove', ids })
      send(res, 200, MIME['.txt'], 'ok')
    })
    return
  }

  if (urlPath === '/api/__fixture__/love-log') {
    json(res, 200, { success: true, ops: loveLog.slice(), love: loveStore.slice() })
    return
  }

  // ---- 【播放历史】分桶 + 统计 + 单条删除 ----
  //
  // 刻意造出**四个分组都有数据**的时间分布，且带 playCount 与多歌手串，
  // 这样「今天/昨天/最近一周/更早」四段与统计卡才会被真正渲染到。
  // 时间用「相对现在」算，不写死时间戳 —— 否则过几天这份 fixture 就过期了。
  //
  // 【必须是有状态的】删除/撤销是有副作用的操作，若每次都返回固定列表，
  // 前端「乐观移除」后即使服务端没删成功，界面看起来也是对的 —— 假绿。
  // 这里维护一份内存中的 historyStore，remove/report 真的改动它。
  if (urlPath === '/api/music/history/list') {
    const list = historyStore.slice()
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

  if (urlPath === '/api/music/history/remove' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let key = ''
      try {
        key = String(JSON.parse(body || '{}').key || '')
      } catch {
        /* 空 key 会走下面的 400 */
      }
      if (!key) {
        json(res, 400, { success: false, message: '缺少 key' })
        return
      }
      const before = historyStore.length
      historyStore = historyStore.filter((x) => x.key !== key)
      removedLog.push(key)
      json(res, 200, { success: true, removed: historyStore.length < before })
    })
    return
  }

  // 撤销 = 重新上报（与真实服务端语义一致：按 key 归并 + 置顶 + playCount+1）
  if (urlPath === '/api/music/history/report' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let p = {}
      try {
        p = JSON.parse(body || '{}')
      } catch {
        /* 忽略 */
      }
      const key = `${p.source}|${p.songmid}`
      historyStore = historyStore.filter((x) => x.key !== key)
      historyStore.unshift({
        key,
        source: p.source,
        songmid: p.songmid,
        name: p.name,
        singer: p.singer ?? '',
        interval: p.interval ?? null,
        albumName: p.albumName,
        img: p.img ?? null,
        playedAt: Date.now(),
        playCount: 1,
      })
      json(res, 200, { success: true })
    })
    return
  }

  // 调试端点：返回被删过的 key 序列，供护栏断言「删除真的发到了服务端」
  if (urlPath === '/api/__fixture__/removed-log') {
    json(res, 200, { success: true, removed: removedLog.slice() })
    return
  }

  // 重置桩状态。
  //
  // 【为什么必须有】historyStore 是**进程内**状态：一次 run 里删了条目，
  // 下一次 run 若复用同一个桩进程（本地调试、或同一 job 里跑多遍），
  // 就会带着上一次的残留。实测踩过：手动删了一条后再跑护栏，
  // 统计变成「8 首 / 14 次」（6 条数据 + 撤销时又上报的条目），
  // 分组变成 4/1/2/1 —— 断言全错，但错误信息指向的是业务逻辑，极难排查。
  // 护栏在开跑前调用它，保证每次从干净状态开始。
  if (urlPath === '/api/__fixture__/reset') {
    historyStore = buildHistory()
    removedLog = []
    lyricLog = []
    loveStore = []
    loveLog = []
    userListsStore = [
      {
        id: 'user_seed',
        name: '导入前的歌单',
        list: [
          { id: 'kw_228908', name: '晴天', singer: '周杰伦', source: 'kw', songmid: '228908', interval: '04:29' },
        ],
      },
    ]
    transferLog = []
    urlResolveLog = []
    urlBodies = []
    proxyLog = []
    json(res, 200, { success: true, total: historyStore.length })
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
      let reqSongmid = ''
      try { reqSongmid = String(JSON.parse(body || '{}').songInfo?.songmid || '') } catch { /* 保留空 */ }
      urlResolveLog.push({ name: songName, quality: requested, songmid: reqSongmid })
      urlBodies.push(body.slice(0, 300))
            console.log('[url-stub] body=' + body.slice(0, 300))
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
