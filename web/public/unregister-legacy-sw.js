/* 清除旧版播放器遗留的根 Service Worker 注册（一次性迁移脚本）。
 *
 * 背景：v2.20.0 之前，旧版播放器（`/`）在根作用域注册了 `sw.js`，
 * 它的 fetch 只排除了 `/api/` 与 `/music/`，**会连 `/app` 的 HTML 一起缓存**。
 * 新版发车后老用户可能拿到上一版 index.html → 引用已删除的旧 hash bundle → 白屏。
 *
 * 现在旧 SW 的文件与注册代码都已删除，但**已经注册到用户浏览器里的那些不会自动消失**——
 * 必须由页面主动注销。这个脚本是唯一能做到的时机：它是普通 <script>（非 module），
 * 写在 /app/index.html 的 <head> 里，**早于 Vite 打包的 bundle 执行**。
 * 若改用 import 写进 main.tsx，bundle 是 type="module" 会被 defer 到文档解析之后，
 * 第一次访问就清不掉了（要等下次刷新），等于留了一个窗口期。
 *
 * 判定方式刻意放宽（踩过坑）：
 *   最初写成 `scope === '/' && reg.active.scriptURL 匹配 sw.js`，
 *   实测**清不掉**——`reg.active` 在 SW 处于 waiting/installing 或刚被接管时可能是 null，
 *   条件短路后就无声跳过了。现在改为「只看 scope 是不是根」：
 *   `/app/sw.js` 的 scope 是 `/app/`，绝不会被误伤，所以直接按 scope 判定既简单又可靠。
 *   另外补 `reg.waiting / reg.installing` 一起 unregister，避免边缘态残留。
 *
 * 缓存也一并清：旧 SW 写的是 `lx-sync-server-v3`，旧播放器另有 `lx-music-web-*`，
 * 不清就是白占配额（而且里面可能存着会被误用的旧 HTML）。
 */
;(function () {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  if (!window.isSecureContext) return

  function isLegacyRegistration(reg) {
    var scopePath = ''
    try {
      scopePath = new URL(reg.scope).pathname
    } catch (e) {
      return false
    }
    // 根作用域就是旧 SW；/app/ 是我们自己的，不动
    return scopePath === '/'
  }

  try {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (reg) {
        if (!isLegacyRegistration(reg)) return
        reg.unregister().catch(function () {})
        // 边缘态：正在装/等待中的 worker 也要点名终止
        try {
          if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' })
          if (reg.installing) reg.installing.postMessage({ type: 'SKIP_WAITING' })
        } catch (e) {
          /* ignore */
        }
      })
    }).catch(function () {})
  } catch (e) {
    /* 隐私模式等场景静默 */
  }

  try {
    if (window.caches) {
      caches.keys().then(function (keys) {
        keys.forEach(function (k) {
          if (k === 'lx-sync-server-v3' || k.indexOf('lx-music-web-') === 0) {
            caches.delete(k).catch(function () {})
          }
        })
      }).catch(function () {})
    }
  } catch (e) {
    /* 同上 */
  }
})()
