/* lxserver 的 Service Worker —— 「可安装 + 离线 app shell + 静态资源缓存」
 *                                + v2.44.0 新增的「封面图缓存」「排行榜数据缓存」。
 *
 * 作用域：由服务端在 `/sw.js` 与 `/app/sw.js` 投放，
 * 并携带 Service-Worker-Allowed: / 响应头，可接管整站根作用域。
 *
 * 三条不可触碰的红线（音乐应用特有，破坏任何一条都会「播不了歌」）：
 *   1. **绝不缓存 `/api/` 及 `/rest/`、同步握手路由** —— 音源解析、歌词、登录态都是动态的。
 *      唯一例外：排行榜的 boards/list 两个**公开只读**接口（见 CACHEABLE_API_PATHS），
 *      它们没有用户态、内容按榜单维度稳定，缓存后切换榜单不必每次等 1-3 秒。
 *   2. **绝不干预音频请求**（Range / 206 / Content-Range / destination=audio）——
 *      SW 一旦参与分段请求，`<audio>` 的 seek 会失败或整首卡死。直接放行，不碰。
 *   3. **跨域资源默认一律放行** —— 唯一例外是**白名单图床**的封面图（见 IMAGE_HOSTS）。
 *      白名单是精确域名列表，不是「所有跨域」；封面是静态图片，缓存它不会污染任何状态。
 *
 * 【为什么必须 bump VERSION】浏览器只在 sw.js 字节变化时才更新 SW；缓存策略改了却不改
 * 版本号，老客户端会一直跑旧策略（这是 v2.43 及以前封面/榜单「永远不缓存」的直接原因）。
 * 版本号变了以后 activate 会清掉旧缓存，新策略立刻生效。
 */

const VERSION = 'v3'
const CACHE = `lxserver-app-${VERSION}`
const IMAGE_CACHE = `lxserver-img-${VERSION}`
const API_CACHE = `lxserver-api-${VERSION}`
/** 需要保留的缓存（activate 时其余一律清掉） */
const KEEP = [CACHE, IMAGE_CACHE, API_CACHE]

/** 预缓存：app shell 的最小集合。带 hash 的 assets 由运行时缓存兜住。 */
const PRECACHE = [
  '/',
  '/app/',
  '/manifest.webmanifest',
  '/app/manifest.webmanifest',
  '/app/icons/icon-192.png',
  '/app/icons/icon-512.png',
]

/** 允许缓存封面的图床（与 web/src/lib/coverUrl.ts 的 HTTPS_IMAGE_HOSTS 保持一致）。
 *  只认这些域名的子域，别的一律放行不缓存。 */
const IMAGE_HOSTS = [
  'music.126.net', // 网易云
  'musicapp.migu.cn', // 咪咕
  'kugou.com', // 酷狗
  'kuwo.cn', // 酷我
  'gtimg.cn', // QQ 音乐
  'y.qq.com',
]

/** 允许缓存的公开只读接口（不含任何用户态） */
const CACHEABLE_API_PATHS = new Set([
  '/api/music/leaderboard/list',
  '/api/music/leaderboard/boards',
])

/** 排行榜数据的 SW 侧有效期：30 分钟。
 *  服务端自己也发了 Cache-Control（5 分钟）+ 内存短缓存；这里更长是为了
 *  「反复切榜单不重复打上游」，过期后仍会先返回旧数据再后台刷新。 */
const API_TTL_MS = 30 * 60 * 1000

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

/** 导航请求（HTML）：网络优先，失败回落缓存。 */
async function handleNavigation(request) {
  try {
    const fresh = await fetch(request)
    if (fresh && fresh.status === 200) {
      const copy = fresh.clone()
      caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {})
    }
    return fresh
  } catch {
    const cached =
      (await caches.match(request)) ||
      (await caches.match('/')) ||
      (await caches.match('/app/'))
    if (cached) return cached
    return new Response(
      `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>离线 · lxserver</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#18181b;background:#fafafa;text-align:center}
.card{max-width:20rem;padding:1.5rem}h2{font-size:1rem;margin:0 0 .5rem}
p{font-size:.8125rem;color:#71717a;margin:0 0 1rem;line-height:1.6}
button{border:1px solid #e4e4e7;background:#fff;border-radius:.5rem;padding:.5rem 1rem;
font-size:.8125rem;color:#18181b;cursor:pointer}
.dot{display:inline-block;width:.5rem;height:.5rem;border-radius:9999px;background:#4f46e5;margin-right:.4rem}</style>
</head><body><div class="card">
<h2><span class="dot"></span>当前离线</h2>
<p>lxserver 需要连到服务器才能解析并播放音乐。请检查网络后重试。</p>
<button onclick="location.reload()">重新加载</button>
</div></body></html>`,
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
}

/** 静态资源（含 hash 的 assets）：缓存优先。 */
async function handleAsset(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const fresh = await fetch(request)
  if (fresh && fresh.status === 200 && fresh.type === 'basic') {
    const copy = fresh.clone()
    caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {})
  }
  return fresh
}

/** 封面图：缓存优先。命中即返回（封面地址是内容寻址的 CDN 链接，几乎不会变）。 */
async function handleImage(request) {
  const cache = await caches.open(IMAGE_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const fresh = await fetch(request)
  if (fresh && fresh.status === 200) {
    cache.put(request, fresh.clone()).catch(() => {})
  }
  return fresh
}

/** 排行榜数据：stale-while-revalidate。
 *  有缓存就**立刻**返回（切榜单不再等上游），同时后台拉新写回；
 *  没缓存或缓存过期太久则等网络，网络失败时退回旧缓存。 */
async function handleApiData(request) {
  const cache = await caches.open(API_CACHE)
  const cached = await cache.match(request)
  const network = fetch(request).then((fresh) => {
    if (fresh && fresh.status === 200) cache.put(request, fresh.clone()).catch(() => {})
    return fresh
  })

  if (cached && isFresh(cached)) {
    network.catch(() => {}) // 后台刷新失败不影响本次返回
    return cached
  }
  try {
    return await network
  } catch (err) {
    if (cached) return cached
    throw err
  }
}

/** 缓存是否还在有效期（看响应的 Date 头；没有 Date 就当有效，交给下次刷新兜底） */
function isFresh(response) {
  const date = response.headers.get('date')
  if (!date) return true
  const at = Date.parse(date)
  return Number.isFinite(at) ? Date.now() - at < API_TTL_MS : true
}

/** 该跨域 URL 是否属于白名单图床 */
function isAllowedImage(url) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  const host = url.hostname.toLowerCase()
  return IMAGE_HOSTS.some((h) => host === h || host.endsWith('.' + h))
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // 红线 2：音频（Range 请求）绝不干预 —— 跨域同源都先放行
  if (
    request.headers.has('range') ||
    request.destination === 'audio' ||
    request.destination === 'video'
  ) {
    return
  }

  // 跨域：只缓存白名单图床的图片，其余一律放行（红线 3）
  if (url.origin !== self.location.origin) {
    if (isAllowedImage(url)) {
      event.respondWith(handleImage(request).catch(() => new Response('', { status: 504 })))
    }
    return
  }

  // 红线 1：接口默认不缓存；只有排行榜两个公开只读接口例外
  if (url.pathname.startsWith('/api/')) {
    if (CACHEABLE_API_PATHS.has(url.pathname)) {
      event.respondWith(handleApiData(request))
    }
    return
  }

  if (
    url.pathname === '/hello' ||
    url.pathname === '/id' ||
    url.pathname === '/ah' ||
    url.pathname === '/config.json' ||
    url.pathname === '/app/config.json'
  ) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request))
    return
  }

  // 其余同源静态资源按「缓存优先」处理
  event.respondWith(
    handleAsset(request).catch(
      () =>
        new Response('', { status: 504, statusText: 'Offline' }),
    ),
  )
})
