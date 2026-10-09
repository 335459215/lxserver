let deferredPrompt;
const installBtn = document.getElementById('pwa-install-btn');

// [v2.20.0] 播放器不再注册 Service Worker，其 sw.js 已删除。
//
// 原因：它注册在**根作用域**，且 fetch 采用 Stale-While-Revalidate，
// 排除清单里只有 /api/ 与几个 config 脚本 —— **没有排除 /app**。
// 于是它会先返回缓存的旧 HTML 再后台更新，而这正是新版 /app 发车后
// 「老用户拿到上一版 index.html → 引用已删除的旧 hash bundle → 白屏」的根因。
// PWA 现由 /app 自己的 SW 承担（scope 天然限定 /app/，与播放器完全隔离）。
//
// 这里主动注销根作用域的历史注册（已装到用户浏览器里的不会自动消失）。
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
        regs.forEach(function (reg) {
            var scopePath = ''
            try { scopePath = new URL(reg.scope).pathname } catch (e) { return }
            if (scopePath === '/') reg.unregister()
        })
    })
}

// 旧 SW 留下的缓存也一并清掉：lx-music-web-vNN（本文件原先的 SW）
// 与 lx-sync-server-vN（更早的同步服务器 SW）。不清就是白占配额，
// 而且里面可能存着会被误用的旧 HTML。
if (window.caches) {
    caches.keys().then(function (keys) {
        keys.forEach(function (k) {
            if (k.indexOf('lx-music-web-') === 0 || k.indexOf('lx-sync-server-') === 0) {
                caches.delete(k)
            }
        })
    })
}

// Handle install prompt
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent Chrome 67 and earlier from automatically showing the prompt
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    // Update UI to notify the user they can add to home screen
    if (installBtn) {
        installBtn.classList.remove('hidden');
        installBtn.classList.add('flex'); // Assuming flex layout
    }
});

if (installBtn) {
    installBtn.addEventListener('click', (e) => {
        // Hide our user interface that shows our A2HS button
        installBtn.classList.add('hidden');
        installBtn.classList.remove('flex');
        // Show the prompt
        if (deferredPrompt) {
            deferredPrompt.prompt();
            // Wait for the user to respond to the prompt
            deferredPrompt.userChoice.then((choiceResult) => {
                if (choiceResult.outcome === 'accepted') {
                    console.log('User accepted the A2HS prompt');
                } else {
                    console.log('User dismissed the A2HS prompt');
                }
                deferredPrompt = null;
            });
        }
    });
}

// Optionally handle appinstalled event
window.addEventListener('appinstalled', (evt) => {
    console.log('Valid PWA installed');
    if (installBtn) {
        installBtn.classList.add('hidden');
        installBtn.classList.remove('flex');
    }
});
