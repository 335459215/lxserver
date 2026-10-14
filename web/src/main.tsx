import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { initAccent } from '@/lib/accent'
import './index.css'

// 恢复用户保存的强调色（localStorage）。必须在首帧前执行，否则会先闪一下默认靛蓝。
initAccent()

// ===== PWA =====
// 注册 Service Worker。
//
// 【为什么固定用根路径 /sw.js 而不是就近的 /app/sw.js】
// Chrome 判定「可安装」时会检查 SW 的 scope 是否覆盖 manifest 的 start_url。
// manifest 的 start_url / scope 都是 `/`，若从 /app/sw.js 注册，脚本路径会把 scope
// 天然压到 /app/（即便服务端发了 Service-Worker-Allowed: /，也依赖响应头严格生效），
// scope 盖不住 start_url → beforeinstallprompt 永不触发 → 装不上。
// 服务端在 /sw.js 与 /app/sw.js 上都投放同一份脚本并带 Service-Worker-Allowed: /，
// 这里优先根路径，scope 天然是 /，与 start_url 对齐。
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch(() => navigator.serviceWorker.register('/app/sw.js').catch(() => {}))
  })
}

// ===== 动态 basename（v2.24.0）=====
// 服务端现在有两个等价入口：
//   `/`      —— 正式入口（`http://ip:端口/` 直接出前端）
//   `/app/*` —— 兼容入口（老书签、已安装的 PWA 其 scope 是 /app/）
// 两者投放的是同一份产物，但 Vite 构建时 base 固定为 '/app/'（资源引用写死 /app/assets/…），
// 所以不能靠改 base 来适配。改为运行时识别当前挂在哪个前缀下，交给 BrowserRouter 当 basename：
//   - 路径以 /app 开头 → basename '/app'（与旧行为完全一致）
//   - 否则（根路径入口）→ basename '/'，路由就是 /search、/playlist/:id …
// 这样 `/` 与 `/app/` 下的所有链接、NavLink 选中态、刷新回退都各自自洽。
const basename = window.location.pathname.startsWith('/app/') || window.location.pathname === '/app'
  ? '/app'
  : '/'

// 【音频内核约束二】这里刻意不用 <StrictMode>：
// StrictMode 在开发模式会双调用 effect，而播放器内核把 <audio> 元素的所有权
// 放在 PlayerProvider 的 ref 上（约束一）。双调用会创建两个 audio 元素、
// 重复绑定 MediaSession action handler，表现为「点一次播放出两声」、
// 暂停后又被另一个元素的 play 拉回来之类的竞态。故整棵播放器树禁用 StrictMode。
createRoot(document.getElementById('root')!).render(
  <BrowserRouter basename={basename}>
    <App />
  </BrowserRouter>,
)
