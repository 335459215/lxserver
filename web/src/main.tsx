import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

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
