import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { initAccent } from '@/lib/accent'
import './index.css'

// 恢复用户保存的强调色（localStorage）。必须在首帧前执行，否则会先闪一下默认靛蓝。
initAccent()

// ===== PWA =====
// 只注册 /app 自己的 SW（由服务端在 /app/sw.js 投放 → scope 天然是 /app/）。
// 未登录时服务端不会挡静态资源，所以这里不需要鉴权。
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/app/sw.js').catch(() => {
      // 注册失败（如非 https/localhost、浏览器禁用）不影响正常使用，静默即可
    })
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
