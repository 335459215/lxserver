// fix-storage.js — Auto-clear stale non-ASCII usernames from localStorage
// Prevents ISO-8859-1 header errors when old Chinese username is cached
(function () {
    try {
        var user = localStorage.getItem('lx_sync_user');
        if (user && /[^\x00-\x7F]/.test(user)) {
            console.log('[Fix] Detected non-ASCII username in localStorage, clearing stale data:', user);
            localStorage.removeItem('lx_sync_user');
            localStorage.removeItem('lx_user_token');
            localStorage.removeItem('lx_sync_pass');
            localStorage.removeItem('lx_admin_password');
            sessionStorage.removeItem('lx_player_auth');
        }
    } catch (e) {
        console.error('[Fix] Error clearing localStorage:', e);
    }
})();
