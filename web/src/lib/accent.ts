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
  { name: '靛蓝', value: '#4f46e5', hover: '#4338ca', soft: '#eef2ff' },
  { name: '翡翠', value: '#059669', hover: '#047857', soft: '#ecfdf5' },
  { name: '玫红', value: '#e11d48', hover: '#be123c', soft: '#fff1f2' },
  { name: '琥珀', value: '#d97706', hover: '#b45309', soft: '#fffbeb' },
  { name: '天蓝', value: '#0284c7', hover: '#0369a1', soft: '#f0f9ff' },
  { name: '紫罗兰', value: '#7c3aed', hover: '#6d28d9', soft: '#f5f3ff' },
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
