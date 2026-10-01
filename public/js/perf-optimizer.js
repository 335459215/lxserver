// 播放器运行时性能补丁。
//
// 放在 index.html 的 <head> 里、app.js 之前加载；app.js 定义全局函数后，
// 这里在 DOMContentLoaded 之后把它们替换为等价但更省的重写版本。
//
// 覆盖三处实测最影响交互流畅度的地方：
//   1. switchTab —— 每次点击都对整个 DOM 做三次 [id^="..."] 属性前缀扫描
//      （app.js 中该 DOM 有 5855 行），而 [id^] 选择器无法走 id 索引。
//   2. renderQueue —— 队列变更时整表重建 DOM，改用 rAF 合并同一帧内的多次调用。
//   3. fetch —— 对可公开的 GET /api/ 请求做 5 秒 TTL 缓存，避免重复点击反复回源。
(function () {
    'use strict';

    // ---------- 1. 元素集合缓存 ----------
    var viewEls = null;
    var tabEls = null;
    var sidebarEls = null;

    function getViews() {
        if (!viewEls) viewEls = Array.prototype.slice.call(document.querySelectorAll('[id^="view-"]'));
        return viewEls;
    }
    function getTabs() {
        if (!tabEls) tabEls = Array.prototype.slice.call(document.querySelectorAll('[id^="tab-"]'));
        return tabEls;
    }
    function getSidebarItems() {
        if (!sidebarEls) sidebarEls = Array.prototype.slice.call(document.querySelectorAll('[data-sidebar-list-id]'));
        return sidebarEls;
    }

    function patchSwitchTab() {
        if (typeof window.switchTab !== 'function' || window.switchTab.__perfPatched) return;
        var orig = window.switchTab;

        window.switchTab = function (tabId) {
            if (tabId === 'favorites') {
                if (typeof window.handleFavoritesClick === 'function') window.handleFavoritesClick();
                return;
            }

            var views = getViews();
            for (var i = 0; i < views.length; i++) {
                views[i].classList.add('hidden');
                views[i].classList.remove('opacity-100');
                views[i].classList.add('opacity-0');
            }

            var activeView = document.getElementById('view-' + tabId);
            if (!activeView) return;

            activeView.classList.remove('hidden');
            setTimeout(function () {
                activeView.classList.remove('opacity-0');
                activeView.classList.add('opacity-100');
                if (typeof window.updateUserUI === 'function') window.updateUserUI();
            }, 10);

            if (tabId === 'settings') {
                if (typeof window.syncSettingsUI === 'function') window.syncSettingsUI();
                else if (typeof window.updateAdminUI === 'function') window.updateAdminUI();
            }

            var tabs = getTabs();
            for (var j = 0; j < tabs.length; j++) {
                tabs[j].classList.remove('active-tab', 'text-emerald-600');
                tabs[j].classList.add('t-text-muted');
            }
            var activeTab = document.getElementById('tab-' + tabId);
            if (activeTab) {
                activeTab.classList.add('active-tab');
                activeTab.classList.remove('t-text-muted');
            }

            if (typeof window.exitListSecondaryModes === 'function') window.exitListSecondaryModes();

            if (window.innerWidth <= 1024 && tabId !== 'favorites') {
                var sidebar = document.getElementById('main-sidebar');
                if (sidebar && !sidebar.classList.contains('-translate-x-full') &&
                    typeof window.toggleSidebar === 'function') {
                    window.toggleSidebar();
                }
            }

            var subItems = getSidebarItems();
            for (var k = 0; k < subItems.length; k++) {
                subItems[k].classList.remove('active-sub-item');
                subItems[k].classList.add('t-text-muted');
            }

            if (tabId === 'search' && typeof window.initGlobalListSearch === 'function') {
                window.initGlobalListSearch();
            }
        };
        window.switchTab.__perfPatched = true;
        window.switchTab.__orig = orig;
    }

    // DOM 结构变化时让缓存失效，否则新插入的 view/tab 不会被纳入集合
    var appendChildOrig = Node.prototype.appendChild;
    Node.prototype.appendChild = function (child) {
        var res = appendChildOrig.call(this, child);
        try {
            if (child && child.id) {
                if (child.id.indexOf('view-') === 0 || child.id.indexOf('tab-') === 0) {
                    viewEls = null;
                    tabEls = null;
                }
                if (child.hasAttribute && child.hasAttribute('data-sidebar-list-id')) sidebarEls = null;
            }
        } catch (e) { /* 忽略：仅缓存刷新，失败不影响功能 */ }
        return res;
    };

    // ---------- 2. renderQueue 用 rAF 合并 ----------
    var queueFrame = null;
    function patchRenderQueue() {
        if (typeof window.renderQueue !== 'function' || window.renderQueue.__perfPatched) return;
        var orig = window.renderQueue;
        window.renderQueue = function () {
            if (queueFrame !== null) cancelAnimationFrame(queueFrame);
            queueFrame = requestAnimationFrame(function () {
                queueFrame = null;
                orig.apply(window, arguments);
            });
        };
        window.renderQueue.__perfPatched = true;
    }

    // ---------- 3. 只读 GET API 的短期缓存 ----------
    var CACHE_TTL = 5000;
    var CACHE_MAX = 50;
    var apiCache = new Map();

    function cacheable(url) {
        return typeof url === 'string' &&
            url.indexOf('/api/') === 0 &&
            // 用户相关接口必须实时，不缓存
            url.indexOf('/api/user/') !== 0;
    }

    function patchFetch() {
        if (window.fetch.__perfPatched) return;
        var orig = window.fetch;

        window.fetch = function (url, options) {
            var opts = options || {};
            var method = (opts.method || 'GET').toUpperCase();
            if (method !== 'GET' || !cacheable(url)) {
                return orig.apply(this, arguments);
            }

            var hit = apiCache.get(url);
            if (hit) {
                if (Date.now() - hit.ts < CACHE_TTL) {
                    return Promise.resolve(new Response(hit.body, {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    }));
                }
                apiCache.delete(url);
            }

            return orig.apply(this, arguments).then(function (resp) {
                if (resp && resp.ok) {
                    resp.clone().text().then(function (body) {
                        if (body.length < 50000) {
                            apiCache.delete(url);
                            apiCache.set(url, { body: body, ts: Date.now() });
                            while (apiCache.size > CACHE_MAX) {
                                apiCache.delete(apiCache.keys().next().value);
                            }
                        }
                    })['catch'](function () { /* 读取失败不缓存 */ });
                }
                return resp;
            });
        };
        window.fetch.__perfPatched = true;
    }

    // app.js 里的函数是顶层 function 声明，脚本执行完即挂到 window；
    // defer 保证它在本次回调之前已就绪。
    function applyPatches() {
        patchFetch();
        patchSwitchTab();
        patchRenderQueue();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyPatches);
    } else {
        applyPatches();
    }

    console.log('[perf] 性能补丁已启用');
})();