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

// 构建 base 仍是 /app/（产物落在 public/app/，资源引用写死 /app/assets/…）。
//
// 【v2.24.0 起服务端有两个等价入口，但 base 不能改】
//   `/`      —— 正式入口（http://ip:端口/ 直接出前端）
//   `/app/*` —— 兼容入口（老书签；已安装 PWA 的 scope 是 /app/）
// 之所以不把 base 改成 '/'：那会让已安装的 PWA 与旧书签全部失效
// （它们的 scope/URL 都指向 /app/），而用户明确说过「当然这样也行」。
// 两个入口由 `src/main.tsx` 的**动态 basename** 在运行时适配，产物只有一份。
export default defineConfig({
  base: '/app/',
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
    },
  },
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
