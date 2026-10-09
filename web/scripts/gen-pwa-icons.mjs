/**
 * 生成 /app 的 PWA 图标（192 / 512 / maskable 512）。
 *
 * 设计语言直接取自项目既有品牌标识：`App.tsx` 顶栏与 `Login.tsx` 都是
 * 「靛蓝实心圆点 + lxserver 字标」。既然 UI 里没有别的主视觉，
 * 就把它做成图标：圆角方块底 + 一条同心圆环「声波」+ 中心实心圆点。
 * 底色用 --accent #4f46e5，与全站唯一强调色一致。
 *
 * maskable 版本把主体缩到安全区（60%）内 —— Android 会按自己的形状裁剪，
 * 内容超出 80% 半径就会被切掉边缘。
 *
 *   node scripts/gen-pwa-icons.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(here, '..', 'public', 'icons')

const ACCENT = '#4f46e5'
const ACCENT_DARK = '#4338ca'

/** size: 画布边长；safe: 主体占画布的比例（maskable 用 0.6 留出裁切余量） */
function svg(size, safe = 0.82) {
  const c = size / 2
  const r = c * safe
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${ACCENT}"/>
      <stop offset="1" stop-color="${ACCENT_DARK}"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${size * 0.22}" fill="url(#g)"/>
  <g fill="none" stroke="#ffffff" stroke-linecap="round">
    <circle cx="${c}" cy="${c}" r="${r * 0.72}" stroke-width="${size * 0.035}" opacity="0.32"/>
    <circle cx="${c}" cy="${c}" r="${r * 0.50}" stroke-width="${size * 0.042}" opacity="0.55"/>
  </g>
  <circle cx="${c}" cy="${c}" r="${r * 0.255}" fill="#ffffff"/>
</svg>`
}

await mkdir(OUT, { recursive: true })

const targets = [
  ['icon-192.png', 192, 0.82],
  ['icon-512.png', 512, 0.82],
  ['icon-maskable-512.png', 512, 0.6],
]

for (const [name, size, safe] of targets) {
  const buf = await sharp(Buffer.from(svg(size, safe))).png({ compressionLevel: 9 }).toBuffer()
  await writeFile(path.join(OUT, name), buf)
  console.log(`${name}  ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`)
}

// apple-touch-icon：iOS 自己会加圆角，故给满幅（无圆角）版本，用 180×180 是 iOS 约定
const apple = await sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${ACCENT}"/><stop offset="1" stop-color="${ACCENT_DARK}"/>
      </linearGradient></defs>
      <rect width="180" height="180" fill="url(#g)"/>
      <g fill="none" stroke="#ffffff" stroke-linecap="round">
        <circle cx="90" cy="90" r="53" stroke-width="6.3" opacity="0.32"/>
        <circle cx="90" cy="90" r="37" stroke-width="7.6" opacity="0.55"/>
      </g>
      <circle cx="90" cy="90" r="19" fill="#ffffff"/>
    </svg>`,
  ),
)
  .png({ compressionLevel: 9 })
  .toBuffer()
await writeFile(path.join(OUT, 'apple-touch-icon.png'), apple)
console.log(`apple-touch-icon.png  180x180  ${(apple.length / 1024).toFixed(1)} KB`)
