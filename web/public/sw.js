/* lxserver 的 Service Worker —— 只做「可安装 + 离线 app shell + 静态资源缓存」。
 *
 * 作用域：由服务端在 `/sw.js` 与 `/app/sw.js` 投放，
 * 并携带 Service-Worker-Allowed: / 响应头，可接管整站根作用域。
 *
 * 三条不可触碰的红线（音乐应用特有，破坏任何一条都会「播不了歌」）：
 *   1. **绝不缓存 `/api/` 及 `/rest/`、同步握手路由** —— 音源解析、歌词、登录态都是动态的。
 *   2. **绝不干预音频请求**（Range / 206 / Content-Range / destination=audio）——
 *      SW 一旦参与分段请求，`<audio>` 的 seek 会失败或整首卡死。直接放行，不碰。
 *   3. **绝不缓存跨域资源** —— 封面来自各平台 CDN（kuwo/163/kugou 等）。
 */

const VERSION = 'v2'
const CACHE = `lxserver-app-${VERSION}`

/** 预缓存：app shell 的最小集合。带 hash 的 assets 由运行时缓存兜住。 */
const PRECACHE = [
  '/',
  '/app/',
  '/manifest.webmanifest',
  '/app/manifest.webmanifest',
  '/app/icons/icon-192.png',
  '/app/icons/icon-512.png',
]

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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
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

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // 红线 3：跨域（封面 CDN 等）一律放行
  if (url.origin !== self.location.origin) return

  // 红线 1：接口、Subsonic、同步握手协议、动态配置绝不缓存
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/rest/') ||
    url.pathname === '/hello' ||
    url.pathname === '/id' ||
    url.pathname === '/ah' ||
    url.pathname === '/config.json' ||
    url.pathname === '/app/config.json'
  ) {
    return
  }

  // 红线 2：音频（Range 请求）绝不干预
  if (
    request.headers.has('range') ||
    request.destination === 'audio' ||
    request.destination === 'video'
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
