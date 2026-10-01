// 清理 localStorage 里残留的非 ASCII 用户名。
//
// lxserver 的前端把用户名放进 x-user-name HTTP header 发送，而浏览器强制
// header 值为 ISO-8859-1。改名后旧的中文用户名仍留在 localStorage 里时，
// 每次 fetch 都会抛
//   Failed to read the 'headers' property from 'RequestInit':
//   String contains non ISO-8859-1 code point
// 于是所有 API 调用失败、页面卡死、点击无反应，且界面仍显示旧用户名。
//
// 必须在 app.js 之前执行。属于一次性自愈，清理后让用户重新登录即可。
(function () {
    try {
        var user = localStorage.getItem('lx_sync_user');
        if (user && /[^\x00-\x7F]/.test(user)) {
            console.warn('[fix-storage] 检测到非 ASCII 用户名，已清除失效的登录状态:', user);
            localStorage.removeItem('lx_sync_user');
            localStorage.removeItem('lx_user_token');
            localStorage.removeItem('lx_sync_pass');
            localStorage.removeItem('lx_admin_password');
            sessionStorage.removeItem('lx_player_auth');
        }
    } catch (e) {
        // 隐私模式下 localStorage 可能抛异常，忽略即可
        console.error('[fix-storage] 清理 localStorage 失败:', e);
    }
})();
