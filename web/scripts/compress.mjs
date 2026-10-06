// 构建后处理：为可压缩产物生成 .gz / .br 兄弟文件（构建期预压缩）。
// 服务端 serveStatic 检测到同名 .gz/.br 且客户端 Accept-Encoding 匹配时直接
// 发预压缩文件，消除"每次请求现压 gzip"在 NAS 弱 CPU 上的 30~80ms/请求。
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'app')
const COMPRESSIBLE = /\.(html|js|mjs|css|json|svg|txt|xml|map|webmanifest|wasm)$/i
const MIN_SIZE = 1024

let gzCount = 0
let brCount = 0
let saved = 0

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full)
      continue
    }
    if (!COMPRESSIBLE.test(entry.name) || /\.gz$|\.br$/i.test(entry.name)) continue
    const content = fs.readFileSync(full)
    if (content.length <= MIN_SIZE) continue
    const gz = zlib.gzipSync(content, { level: 9 })
    if (gz.length < content.length * 0.95) {
      fs.writeFileSync(full + '.gz', gz)
      gzCount++
      saved += content.length - gz.length
    }
    const br = zlib.brotliCompressSync(content, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
    })
    if (br.length < gz.length) {
      fs.writeFileSync(full + '.br', br)
      brCount++
    }
  }
}

try {
  walk(distDir)
  const fmt = (n) => (n / 1024).toFixed(1) + ' KB'
  console.log(`[compress] gzip=${gzCount} brotli=${brCount} 省约 ${fmt(saved)}（相对原始 gzip 前体积）`)
} catch (e) {
  console.warn('[compress] 跳过（产物目录不存在或不可读）:', e.message)
}
