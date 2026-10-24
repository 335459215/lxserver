/** 分享卡片（v2.38.0）：canvas 生成竖版分享图。
 *
 *  本模块刻意**零 import**（类型用本地 interface）—— 单测直接跑在 node 上
 *  不需要 DOM 桩，与 sleepTimer / playlistTransfer 同一架构套路。
 *
 *  卡片 1080×1440（3:4 竖版，网易云歌词卡片的比例）：
 *  渐变底（封面主色深化）→ 圆角封面 → 歌名 → 歌手·专辑 → 一句当前歌词
 *  （带引号）→ 底部品牌与来源。
 *
 *  【封面 CORS 双保险】封面来自平台 CDN，没有 CORS 头时画进 canvas 会把
 *  整块画布「污染」，toBlob 直接抛 SecurityError。两层防护：
 *  ① <img crossOrigin='anonymous'> 加载 —— 服务器给了 CORS 头就没事；
 *  ② toBlob 抛 SecurityError 时**去掉封面重绘**（渐变占位），导出永有机会成功。
 */

export interface ShareSongMeta {
  name: string
  singer?: string
  albumName?: string | null
  source: string
}

export interface ShareCardData {
  /** 歌名（最多 2 行） */
  name: string
  /** 歌手（空回落「未知歌手」） */
  singer: string
  /** 专辑名（可空，空则不显示） */
  album: string | null
  /** 当前歌词行（可空 —— 空则卡片不画歌词区） */
  lyricLine: string | null
  /** 来源中文名（如「酷我」） */
  sourceLabel: string
  /** 封面主色 hex（背景渐变基底） */
  accent: string
}

/** 文本按宽度换行，超出行数截断加省略号。
 *
 *  纯函数：measure 由调用方注入（canvas 的 measureText / 测试里的假实现），
 *  greedy 逐字累加（中文没有空格分词，逐词 greedy 是唯一通用解）。 */
export function wrapText(
  measure: (text: string) => number,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const chars = [...text]
  const lines: string[] = []
  let cur = ''
  for (let i = 0; i < chars.length; i++) {
    const next = cur + chars[i]
    if (measure(next) <= maxWidth || cur === '') {
      cur = next
    } else {
      lines.push(cur)
      cur = chars[i]
      if (lines.length === maxLines) {
        // 已满：最后一行换成「能放下的前缀 + …」
        lines.pop()
        let tail = ''
        for (let j = 0; j < chars.length; j++) {
          const candidate = tail + chars[j] + '…'
          if (measure(candidate) > maxWidth) break
          tail += chars[j]
        }
        lines.push(tail + '…')
        return lines
      }
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/** 组装卡片数据：字段兜底（歌手空、歌词空串/纯空白都不上卡片 ——
 *  一张只有一对空引号的卡片比没有歌词区更怪）。 */
export function buildShareCardData(
  song: ShareSongMeta,
  lyricLine: string | null | undefined,
  sourceLabel: string,
  accent: string,
): ShareCardData {
  const lyric = (lyricLine ?? '').trim()
  return {
    name: song.name || '未知歌曲',
    singer: song.singer?.trim() || '未知歌手',
    album: song.albumName?.trim() ? song.albumName.trim() : null,
    lyricLine: lyric ? lyric : null,
    sourceLabel,
    accent: /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#6366f1',
  }
}

// ===== 以下为 DOM/canvas 部分（node 单测不覆盖，e2e 护栏覆盖）=====

const W = 1080
const H = 1440
const FONT = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif"

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** 深化到适合当背景的亮度（文字要压得住） */
function darken(hex: string, k: number): string {
  const [r, g, b] = hexToRgb(hex).map((v) => Math.round(v * k))
  return `rgb(${r},${g},${b})`
}

function loadCover(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const timer = window.setTimeout(() => resolve(null), 4000)
    img.onload = () => {
      window.clearTimeout(timer)
      resolve(img)
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      resolve(null)
    }
    img.src = url
  })
}

function roundedPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawCard(ctx: CanvasRenderingContext2D, data: ShareCardData, cover: HTMLImageElement | null): void {
  // 背景：主色深化 → 近黑的纵向渐变
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, darken(data.accent, 0.55))
  grad.addColorStop(1, '#0b0d14')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // 封面：880×880 居中圆角；无封面画音符占位
  const S = 880
  const cx = (W - S) / 2
  const cy = 90
  ctx.save()
  roundedPath(ctx, cx, cy, S, S, 36)
  ctx.clip()
  if (cover) {
    ctx.drawImage(cover, cx, cy, S, S)
  } else {
    ctx.fillStyle = darken(data.accent, 0.35)
    ctx.fillRect(cx, cy, S, S)
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.font = `340px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('♪', cx + S / 2, cy + S / 2 + 20)
  }
  ctx.restore()

  // 文本区
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const left = 90
  let y = cy + S + 118

  ctx.fillStyle = '#ffffff'
  ctx.font = `bold 62px ${FONT}`
  for (const line of wrapText((t) => ctx.measureText(t).width, data.name, W - left * 2, 2)) {
    ctx.fillText(line, left, y)
    y += 76
  }

  ctx.fillStyle = 'rgba(255,255,255,0.72)'
  ctx.font = `38px ${FONT}`
  const meta = data.album ? `${data.singer} · ${data.album}` : data.singer
  ctx.fillText(meta, left, y + 18)
  y += 118

  if (data.lyricLine) {
    ctx.fillStyle = 'rgba(255,255,255,0.86)'
    ctx.font = `44px ${FONT}`
    for (const line of wrapText((t) => ctx.measureText(t).width, `“${data.lyricLine}”`, W - left * 2, 2)) {
      ctx.fillText(line, left, y)
      y += 62
    }
  }

  // 底部品牌条
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.font = `32px ${FONT}`
  ctx.fillText('LX Music', left, H - 72)
  ctx.textAlign = 'right'
  ctx.fillText(data.sourceLabel, W - left, H - 72)
  ctx.textAlign = 'left'
}

/** 渲染并导出 PNG。封面加载失败 → 占位；画布被 CORS 污染 → 去封面重绘。 */
export async function renderShareCard(data: ShareCardData, coverUrl?: string): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 canvas 2d')

  const cover = coverUrl ? await loadCover(coverUrl) : null
  drawCard(ctx, data, cover)
  try {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (blob) return blob
    throw new Error('导出 PNG 失败')
  } catch {
    // toBlob 抛 SecurityError = 画布被污染（封面 CDN 没给 CORS 头）
    // → 去掉封面重绘再试一次；再失败才是真失败
    drawCard(ctx, data, null)
    const retry = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (retry) return retry
    throw new Error('分享卡片导出失败（封面被跨域限制污染）')
  }
}
