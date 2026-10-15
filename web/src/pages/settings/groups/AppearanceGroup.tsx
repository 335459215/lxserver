import { useState } from 'react'
import { Check } from 'lucide-react'
import { Stack, useToast } from '@/components/ui'
import { ACCENT_COLORS, applyAccent, saveAccent, savedAccent, type AccentColor } from '@/lib/accent'

/** 外观组：客户端偏好（localStorage，不走后端 API）。
 *  - 强调色选择器（改 --accent / --accent-rgb，全站即时生效）
 *  调色板与应用逻辑在 lib/accent.ts —— 应用入口也读它。
 *
 *  【播放音质已于本次搬去「播放」组】
 *  它原先挂在这里，理由是「和强调色一样属于这台设备的个人偏好」。那是按
 *  **存储位置** 归类，而不是按 **用户会去哪里找它** 归类：想调音质的人第一反应
 *  是点「播放」，不会想到翻「外观」。存储位置是内部实现，不该决定菜单位置。 */

export default function AppearanceGroup() {
  const { toast } = useToast()
  const [current, setCurrent] = useState(() => savedAccent()?.value ?? ACCENT_COLORS[0].value)

  const pick = (color: AccentColor) => {
    setCurrent(color.value)
    applyAccent(color)
    saveAccent(color)
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
    </Stack>
  )
}
