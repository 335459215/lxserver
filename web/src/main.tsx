import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { initAccent } from '@/lib/accent'
import './index.css'

// 恢复用户保存的强调色（localStorage）。必须在首帧前执行，否则会先闪一下默认靛蓝。
initAccent()

// ===== PWA =====
// 只注册 /app 自己的 SW（由服务端在 /app/sw.js 投放 → scope 天然是 /app/）。
//
// 【不要在这里注销旧 SW】：旧版的根 sw.js 已经从代码与磁盘上彻底移除（v2.20.0），
// 清除残留注册由 `public/app/unregister-legacy-sw.js` 完成 —— 它写在 /app/index.html 的
// <head> 里、早于本模块执行，且必须留在生成产物里（不能用 Vite 打包，
// 那样它会在 JS bundle 之后才跑，第一次访问清不掉）。
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/app/sw.js').catch(() => {
      // 注册失败（如非 https/localhost、浏览器禁用）不影响正常使用，静默即可
    })
  })
}

// 新前端挂在 /app（服务端 SPA 回退已就绪），basename 与之一致。
//
// 【音频内核约束二】这里刻意不用 <StrictMode>：
// StrictMode 在开发模式会双调用 effect，而播放器内核把 <audio> 元素的所有权
// 放在 PlayerProvider 的 ref 上（约束一）。双调用会创建两个 audio 元素、
// 重复绑定 MediaSession action handler，表现为「点一次播放出两声」、
// 暂停后又被另一个元素的 play 拉回来之类的竞态。故整棵播放器树禁用 StrictMode。
createRoot(document.getElementById('root')!).render(
  <BrowserRouter basename="/app">
    <App />
  </BrowserRouter>,
)
