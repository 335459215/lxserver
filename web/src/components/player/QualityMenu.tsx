import { AudioLines, Check } from 'lucide-react'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui'
import { QUALITY_TIERS, qualityShort } from '@/lib/quality'
import { usePlayer } from '@/lib/player'
import { cn } from '@/lib/utils'

/** 音质切换器（下拉）。
 *
 *  为什么放两个入口：
 *  - 设置 → 外观：适合「一次定好，之后不管」的用户（与强调色同一处，都是客户端偏好）。
 *  - 播放栏 / 全屏播放页：改音质通常发生在**听歌的当下**（这歌糊了/太占流量），
 *    此时跑到设置页去改是打断流程的。主流播放器（网易云、QQ音乐、Apple Music）
 *    都把音质入口放在播放界面就近处。
 *
 *  显示规则（关键，别改成只显示首选）：
 *  标的是**实得档位**（resolvedQuality），不是首选档位。用户选「无损」但该曲只有 320k 时，
 *  解析器会降级成功 —— 此时必须如实显示 320k，否则等于对用户撒谎。
 *  首选档位与实得不同时，在菜单里额外标注一条提示。 */
export default function QualityMenu({
  className,
  showLabel = false,
}: {
  className?: string
  /** 是否显示文字标签（窄位置只显示图标） */
  showLabel?: boolean
}) {
  const { preferredQuality, resolvedQuality, setQuality, current } = usePlayer()

  // 有曲目在播 → 显示实得档位；否则显示首选档位（此时还没有「实得」概念）
  const shown = current ? resolvedQuality ?? preferredQuality : preferredQuality
  const degraded = !!current && !!resolvedQuality && resolvedQuality !== preferredQuality

  return (
    <Menu>
      <MenuTrigger
        aria-label={`音质：${qualityShort(shown)}${degraded ? '（已降级）' : ''}`}
        title={
          current
            ? `当前音质 ${qualityShort(shown)}${degraded ? `，首选 ${qualityShort(preferredQuality)} 该曲不可得` : ''}`
            : '选择音质'
        }
        className={cn(
          'flex h-8 items-center gap-1 rounded-lg px-1.5 text-dim transition-colors hover:bg-panel2 hover:text-ink',
          className,
        )}
      >
        <AudioLines className="size-4" />
        {showLabel && (
          <span className="font-mono text-[11px] tabular-nums">{qualityShort(shown)}</span>
        )}
        {degraded && (
          <span
            className="size-1.5 rounded-full bg-danger"
            aria-hidden
            title="实际音质低于首选"
          />
        )}
      </MenuTrigger>

      <MenuContent align="end" className="w-64">
        <MenuLabel className="px-2 py-1.5 text-[11px] font-medium tracking-wide text-faint">
          播放音质
        </MenuLabel>
        <MenuSeparator />
        {QUALITY_TIERS.map((t) => {
          const active = t.value === preferredQuality
          // 当前曲目下该档位是否是「实得」那一档 —— 单独打个标，让用户看清实际拿到什么
          const isCurrent = !!current && resolvedQuality === t.value
          return (
            <MenuItem
              key={t.value}
              onSelect={() => setQuality(t.value)}
              className="items-start gap-2.5 py-2"
            >
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                {active ? (
                  <Check className="size-4 text-accent" />
                ) : (
                  <span className="size-1.5 rounded-full bg-line-strong" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className={cn('text-sm', active ? 'font-medium text-ink' : 'text-ink')}>
                    {t.label}
                  </span>
                  <span className="font-mono text-[10px] text-faint">{t.short}</span>
                  {isCurrent && (
                    <span className="rounded bg-accent-soft px-1 py-0.5 text-[10px] leading-none text-accent">
                      正在使用
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-faint">
                  {t.desc} · {t.approx}
                </span>
              </span>
            </MenuItem>
          )
        })}
        <MenuSeparator />
        <p className="px-2 py-1.5 text-[11px] leading-relaxed text-faint">
          {degraded
            ? `首选「${qualityShort(preferredQuality)}」在这首歌上不可得，已自动降级到「${qualityShort(resolvedQuality)}」。`
            : '选不到该档位时会自动向下兼容，不会播放失败。'}
        </p>
      </MenuContent>
    </Menu>
  )
}
