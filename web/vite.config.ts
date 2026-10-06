import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// 版本号来自仓库根的 version 文件（单一来源，与镜像 tag 同源）。
// 构建期注入 __APP_VERSION__，运行时不再依赖任何正则抠文件。
let appVersion = 'unknown'
try {
  appVersion = fs.readFileSync(path.join(here, '..', 'version'), 'utf8').trim()
} catch { /* 独立开发时仓库外运行则回退 */ }

// 新前端挂在 /app，旧版播放器继续占 /（阶段 A 决策，配置开关切回见阶段 B）
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    outDir: '../public/app',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
  },
  server: {
    port: 5173,
    // 开发期直连本机跑的后端（npm run dev / dev1），不走 CI
    proxy: {
      '/api': 'http://127.0.0.1:9527',
      '/js/config.js': 'http://127.0.0.1:9527',
      '/app/config.json': 'http://127.0.0.1:9527',
    },
  },
})
