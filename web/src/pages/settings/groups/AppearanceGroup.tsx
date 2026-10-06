import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { Stack, useToast } from '@/components/ui'

/** 外观组：客户端偏好（localStorage，不走后端 API）。
 * 当前实现：强调色选择器（改 --accent CSS 变量，全站即时生效）。 */
const ACCENT_COLORS = [
  { name: '靛蓝', value: '#4f46e5', hover: '#4338ca', soft: '#eef2ff' },
  { name: '翡翠', value: '#059669', hover: '#047857', soft: '#ecfdf5' },
  { name: '玫红', value: '#e11d48', hover: '#be123c', soft: '#fff1f2' },
  { name: '琥珀', value: '#d97706', hover: '#b45309', soft: '#fffbeb' },
  { name: '天蓝', value: '#0284c7', hover: '#0369a1', soft: '#f0f9ff' },
  { name: '紫罗兰', value: '#7c3aed', hover: '#6d28d9', soft: '#f5f3ff' },
] as const

const STORAGE_KEY = 'lx.appearance.accent'

function applyAccent(color: typeof ACCENT_COLORS[number]) {
  const root = document.documentElement
  root.style.setProperty('--accent', color.value)
  root.style.setProperty('--accent-hover', color.hover)
  root.style.setProperty('--accent-soft', color.soft)
}

function loadAccent(): string {
  return localStorage.getItem(STORAGE_KEY) || ACCENT_COLORS[0].value
}

export default function AppearanceGroup() {
  const { toast } = useToast()
  const [current, setCurrent] = useState(loadAccent())

  // 初始加载时恢复保存的强调色
  useEffect(() => {
    const saved = ACCENT_COLORS.find((c) => c.value === current)
    if (saved) applyAccent(saved)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (color: typeof ACCENT_COLORS[number]) => {
    setCurrent(color.value)
    applyAccent(color)
    localStorage.setItem(STORAGE_KEY, color.value)
    toast({ title: `强调色已切换`, description: color.name })
  }

  return (
    <Stack gap={5}>
      <section className="rounded-2xl border border-line bg-panel p-5 shadow-card">
        <h3 className="text-sm font-medium text-ink">强调色</h3>
        <p className="mt-0.5 text-xs text-dim">选择管理台的主强调色，即时生效并保存到浏览器。</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {ACCENT_COLORS.map((c) => (
            <button
              key={c.value}
              onClick={() => pick(c)}
              className="group flex flex-col items-center gap-1.5"
              aria-label={c.name}
            >
              <span
                className="flex size-10 items-center justify-center rounded-full border-2 transition-all"
                style={{
                  backgroundColor: c.value,
                  borderColor: current === c.value ? c.value : 'transparent',
                  boxShadow: current === c.value ? `0 0 0 2px var(--panel), 0 0 0 4px ${c.value}` : 'none',
                }}
              >
                {current === c.value && <Check className="size-4 text-white" />}
              </span>
              <span className={`text-xs ${current === c.value ? 'font-medium text-ink' : 'text-faint'}`}>{c.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-dashed border-line bg-panel/60 p-5">
        <h3 className="text-sm font-medium text-faint">更多外观选项</h3>
        <p className="mt-1 text-xs text-faint">紧凑模式、字号、深色主题切换等将在阶段 B 后续切片接入。</p>
      </section>
    </Stack>
  )
}
