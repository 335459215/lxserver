import { useState } from 'react'
import { Check } from 'lucide-react'
import { Stack, useToast } from '@/components/ui'
import { ACCENT_COLORS, applyAccent, saveAccent, savedAccent, type AccentColor } from '@/lib/accent'
import { QUALITY_TIERS, qualityLabel } from '@/lib/quality'
import { usePlayer } from '@/lib/player'
import { cn } from '@/lib/utils'

/** 外观组：客户端偏好（localStorage，不走后端 API）。
 *  - 强调色选择器（改 --accent / --accent-rgb，全站即时生效）
 *  - 播放音质选择（解析首选档位，失败自动向下兼容）
 *  调色板与应用逻辑在 lib/accent.ts、lib/quality.ts —— 应用入口/播放内核也读它们。 */

/** 音质选择：放在外观组是因为它和强调色一样属于「这台设备上的个人偏好」，
 *  不进服务端配置。播放界面（播放栏 / 全屏页）也有同一个切换器，
 *  这里提供的是「坐下来一次性设好」的入口。 */
function QualitySection() {
  const { preferredQuality, setQuality } = usePlayer()
  const { toast } = useToast()

  return (
    <section className="rounded-2xl border border-line bg-panel p-5 shadow-card">
      <h3 className="text-sm font-medium text-ink">播放音质</h3>
      <p className="mt-0.5 text-xs text-dim">
        解析时优先请求该档位；该档位不可得时自动向下兼容，不会因此播放失败。
        {preferredQuality ? ` 当前首选「${qualityLabel(preferredQuality)}」。` : ''}
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {QUALITY_TIERS.map((t) => {
          const active = t.value === preferredQuality
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => {
                setQuality(t.value)
                toast({ title: `音质已切换为「${t.label}」` })
              }}
              aria-pressed={active}
              className={cn(
                'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                active
                  ? 'border-accent/40 bg-accent-soft'
                  : 'border-line bg-panel hover:border-line-strong hover:bg-panel2',
              )}
            >
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                {active ? (
                  <Check className="size-4 text-accent" />
                ) : (
                  <span className="size-1.5 rounded-full bg-line-strong" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="text-sm font-medium text-ink">{t.label}</span>
                  <span className="font-mono text-[10px] text-faint">{t.short}</span>
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-dim">
                  {t.desc} · {t.approx}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

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

      <QualitySection />

      <section className="rounded-2xl border border-dashed border-line bg-panel/60 p-5">
        <h3 className="text-sm font-medium text-faint">更多外观选项</h3>
        <p className="mt-1 text-xs text-faint">紧凑模式、字号、深色主题切换等将在阶段 B 后续切片接入。</p>
      </section>
    </Stack>
  )
}
