import { hexToRgbTriplet } from '@/lib/coverColor'

/** 强调色偏好（localStorage，不走后端）。
 *
 *  这里同时写入颜色的两种形式：
 *  - `--accent*`：`<color>`，@property 已注册，可做渐变
 *  - `--accent*-rgb`：「R G B」三元组，Tailwind 的 `bg-accent/60` / `ring-accent/40`
 *    等带 alpha 的类名靠它合成透明度。只写前者会让这些半透明类不跟随。
 */
export interface AccentColor {
  name: string
  value: string
  hover: string
  soft: string
}

export const ACCENT_COLORS: readonly AccentColor[] = [
  // 每个 `value` 都必须在白底上 >= 4.5:1（WCAG AA 正文）—— 强调色会被用在
  // 文字、图标、链接上，不只是装饰。2026-10-27 实测修正三个不达标的：
  //   翡翠 #059669 3.77 → #047857 5.48
  //   琥珀 #d97706 3.19 → #b45309 5.02
  //   天蓝 #0284c7 4.10 → #0369a1 5.93
  // hover 相应加深一档，保持「悬停更深」的既有语义。
  { name: '靛蓝', value: '#4f46e5', hover: '#4338ca', soft: '#eef2ff' },   // 6.29
  { name: '翡翠', value: '#047857', hover: '#046c4e', soft: '#ecfdf5' },   // 5.48
  { name: '玫红', value: '#e11d48', hover: '#be123c', soft: '#fff1f2' },   // 4.70
  { name: '琥珀', value: '#b45309', hover: '#92400e', soft: '#fffbeb' },   // 5.02
  { name: '天蓝', value: '#0369a1', hover: '#075985', soft: '#f0f9ff' },   // 5.93
  { name: '紫罗兰', value: '#7c3aed', hover: '#6d28d9', soft: '#f5f3ff' }, // 5.70
]

const STORAGE_KEY = 'lx.appearance.accent'

export function applyAccent(color: AccentColor) {
  const root = document.documentElement
  const pairs: Array<[string, string]> = [
    ['--accent', color.value],
    ['--accent-hover', color.hover],
    ['--accent-soft', color.soft],
  ]
  for (const [name, hex] of pairs) {
    root.style.setProperty(name, hex)
    const triplet = hexToRgbTriplet(hex)
    if (triplet) root.style.setProperty(`${name}-rgb`, triplet)
  }
}

/** 读取已保存的强调色；没有保存过则返回 null（保持 index.css 的默认靛蓝）。 */
export function savedAccent(): AccentColor | null {
  const v = localStorage.getItem(STORAGE_KEY)
  return v ? ACCENT_COLORS.find((c) => c.value === v) ?? null : null
}

export function saveAccent(color: AccentColor) {
  localStorage.setItem(STORAGE_KEY, color.value)
}

/** 应用启动时恢复已保存的强调色。
 *
 *  此前该偏好只在「设置 → 外观」页挂载时才被读回，导致**刷新后用户选的强调色丢失**
 *  （除非再进一次外观设置页）。这里在应用入口调用一次，偏好才真正全局持久。 */
export function initAccent() {
  const saved = savedAccent()
  if (saved) applyAccent(saved)
}
