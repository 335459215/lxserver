/* 清除旧版播放器遗留缓存与旧 SW（一次性迁移脚本）。
 *
 * 仅清理历史旧版缓存（lx-sync-server-v3、lx-music-web-*），
 * 绝不误杀当前合法 Service Worker。
 */
;(function () {
  if (typeof window === 'undefined') return

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
    /* 隐私模式等场景静默 */
  }
})()
