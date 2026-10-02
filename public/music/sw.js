const CACHE_NAME = 'lx-music-web-v28';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './login.html',
    './app.js',
    // CSS
    './css/theme_variables.css',
    './assets/fontawesome/css/all.min.css',
    // 核心 JS
    './js/lyric-parser.js',
    './js/lyric-utils.js',
    './js/lyric-card.js',
    './js/quality.js',
    './js/idb_store.js',
    './js/user_sync.js',
    './js/batch_pagination.js',
    './js/single_song_ops.js',
    './js/songlist_manager.js',
    './js/list_search.js',
    './js/leaderboard_manager.js',
    './js/dislike_manager.js',
    './js/local_music.js',
    './js/download_manager.js',
    './js/common_ui.js',
    // 下面两个在 index.html 里被引用，原先漏在预缓存外，首屏总要等一次网络
    './js/customDir.js',
    './js/sync_download.js',
    './js/pwa.js',
    './js/theme_manager.js',
    './js/tailwind_setup.js',
    './js/log_viewer.js',
    './js/ios-background-audio.js',
    // 第三方库
    './assets/tailwindcss.js',
    './js/crypto-js.min.js',
    './js/NoSleep.min.js',
    './js/Sortable.min.js',
    './js/marked.min.js',
    // 音频效果
    './js/sound-effects.js',
    './js/visualizer.js',
    './js/wave.js',
    // 变调器
    './js/pitch-shifter/fft.js',
    './js/pitch-shifter/ola-processor.js',
    './js/pitch-shifter/phase-vocoder.js',
    // 静态资源
    './assets/logo.svg',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 1. 过滤非 http(s) 协议 (如 chrome-extension://)，避免 cache.put 报错
    if (!url.protocol.startsWith('http')) return;

    // 2. 忽略所有音频请求、下载请求、API 请求以及动态配置接口，让浏览器直接处理
    // 拦截下载会导致大文件占用 Cache 且单个失败可能引起 SW state 不良
    const isApiOrAudio = url.pathname.includes('/api/') ||
        url.pathname === '/js/config.js' ||
        url.pathname === '/js/fix-storage.js' ||
        url.pathname === '/js/perf-optimizer.js' ||
        url.pathname.endsWith('/manifest.json') ||
        url.href.match(/\.(mp3|flac|m4a|ogg|aac)(\?.*)?$/i);

    if (isApiOrAudio) {
        return; // 直接 return 就不走 event.respondWith，相当于不拦截
    }

    if (event.request.method !== 'GET') return;

    // 3. 静态资源改为 Stale-While-Revalidate。
    //    原来的 Network First 对局域网服务也不划算：每次打开页面都要为每个
    //    资源付一次网络往返（首屏约 30 个 JS/CSS）。这里先返回缓存立即渲染，
    //    同时后台静默更新；只有首次访问才真的走网络。
    event.respondWith(
        caches.open(CACHE_NAME).then((cache) =>
            cache.match(event.request).then((cached) => {
                const network = fetch(event.request)
                    .then((response) => {
                        if (response && response.status === 200 && response.type === 'basic') {
                            const toCache = response.clone();
                            cache.put(event.request, toCache).catch(err => {
                                console.error('[SW] Cache put error:', err);
                            });
                        }
                        return response;
                    })
                    .catch(() => cached || Response.error());

                // 有缓存就用缓存立刻返回，网络在后台更新；没有则等待网络
                return cached || network;
            })
        )
    );
});

const KNOWN_CACHES = [CACHE_NAME];

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (!KNOWN_CACHES.includes(cacheName)) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});
