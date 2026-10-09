import * as React from 'react'

/** 封面取色：从专辑封面提取一个可读的强调色（SPlayer 式「封面着色」）。
 *
 * 跨域限制：只有带 `Access-Control-Allow-Origin` 的图床才能读像素。
 * 实测 2026-10：酷我 / 网易云 / 酷狗 允许，QQ 音乐 / 咪咕 不允许。
 * 因此这里一律「失败即静默返回 null」，由调用方回落到默认靛蓝 ——
 * 取色只是锦上添花，绝不能因为它失败而影响播放页本身。
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

/** 由主色派生的强调色令牌（accent / hover / soft / glow） */
export interface AccentTokens {
  accent: string
  hover: string
  soft: string
  glow: string
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    // 必须显式请求 CORS，否则即使图床允许也拿不到未污染的画布
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    const done = (ok: boolean) => resolve(ok ? img : null)
    img.onload = () => done(true)
    img.onerror = () => done(false)
    img.src = url
  })
}

/** 提取封面主色。缩到 24×24 采样 → 4bit 量化分桶 → 跳过近灰/过亮/过暗 →
 *  按饱和度加权取最大桶。这样得到的是「有色彩的、适合做强调色的」主色，
 *  而不是整张图平均出来的灰。 */
export async function extractCoverColor(url: string): Promise<Rgb | null> {
  if (typeof document === 'undefined' || !url) return null

  const img = await loadImage(url)
  if (!img) return null

  const size = 24
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  try {
    ctx.drawImage(img, 0, 0, size, size)
  } catch {
    return null
  }

  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, size, size).data
  } catch {
    // 画布被跨域图片污染（图床未给 CORS 头）
    return null
  }

  const buckets = new Map<number, { r: number; g: number; b: number; w: number }>()

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue // 半透明像素不算数
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const lightness = (max + min) / 2
    const chroma = max - min
    // 相对饱和度（HSL 定义），避免把浅灰/深灰当成"主色"
    const denom = 255 - Math.abs(2 * lightness - 255)
    const sat = denom > 0 ? chroma / denom : 0

    if (sat < 0.18) continue // 近灰：没有色彩倾向
    if (lightness < 30 || lightness > 230) continue // 过暗/过亮：做强调色会看不清

    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const weight = 1 + sat * 2 // 越鲜艳越代表"主色"
    const cur = buckets.get(key)
    if (cur) {
      cur.r += r * weight
      cur.g += g * weight
      cur.b += b * weight
      cur.w += weight
    } else {
      buckets.set(key, { r: r * weight, g: g * weight, b: b * weight, w: weight })
    }
  }

  let best: { r: number; g: number; b: number; w: number } | null = null
  for (const bucket of buckets.values()) {
    if (!best || bucket.w > best.w) best = bucket
  }
  if (!best) return null

  return {
    r: Math.round(best.r / best.w),
    g: Math.round(best.g / best.w),
    b: Math.round(best.b / best.w),
  }
}

/** RGB → HSL（h 0–360，s/l 0–1） */
function rgbToHsl({ r, g, b }: Rgb): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min

  if (d === 0) return [0, 0, l]

  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4

  h *= 60
  if (h < 0) h += 360
  return [h, s, l]
}

const hsl = (h: number, s: number, l: number) =>
  `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`

/** 由主色生成强调色令牌。
 *  钳制饱和度与亮度：封面可能是荧光粉/深藏蓝，直接拿来当强调色会导致
 *  白字按钮对比度不足或文字看不清 —— 统一收敛到「浅色底上可读」的区间。 */
export function accentTokens(rgb: Rgb): AccentTokens {
  const [h, s, l] = rgbToHsl(rgb)
  const sAccent = clamp(s, 0.44, 0.8)
  return {
    accent: hsl(h, sAccent, clamp(l, 0.34, 0.46)),
    hover: hsl(h, sAccent, clamp(l - 0.08, 0.26, 0.38)),
    // 选中底：同色相但极浅，保证卡片上的深色文字仍可读
    soft: hsl(h, clamp(s * 0.72, 0.32, 0.68), 0.955),
    glow: `rgb(${rgb.r} ${rgb.g} ${rgb.b} / 0.32)`,
  }
}

/** 监听封面 URL → 提取主色 → 返回令牌；取不到（或换歌）时回落 null。
 *  调用方拿到 null 就什么都不做，继续用默认靛蓝。
 *
 *  结果与「产生它的 URL」一起存：URL 一变，返回值立刻变 null，
 *  无需在 effect 里同步 setState（那会触发级联渲染）。 */
export function useCoverAccent(url: string | undefined): AccentTokens | null {
  const [result, setResult] = React.useState<{ url: string; tokens: AccentTokens } | null>(null)

  React.useEffect(() => {
    if (!url) return
    let alive = true
    void extractCoverColor(url).then((rgb) => {
      if (alive && rgb) setResult({ url, tokens: accentTokens(rgb) })
    })
    return () => {
      alive = false
    }
  }, [url])

  return result && result.url === url ? result.tokens : null
}
