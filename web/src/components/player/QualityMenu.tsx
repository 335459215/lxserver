import { AudioLines, Check, Sparkles } from 'lucide-react'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui'
import { QUALITY_TIERS, qualityShort } from '@/lib/quality'
import { isDegraded, pickStartTier, sizeLabel, songHasTier, songTiers } from '@/lib/qualityOptions'
import { usePlayer } from '@/lib/player'
import { cn } from '@/lib/utils'

/** 音质切换器（下拉）。
 *
 *  为什么放两个入口：
 *  - 设置 → 播放：适合「一次定好，之后不管」的用户。
 *  - 播放栏 / 全屏播放页：改音质通常发生在**听歌的当下**（这歌糊了/太占流量），
 *    此时跑到设置页去改是打断流程的。主流播放器（网易云、QQ音乐、Apple Music）
 *    都把音质入口放在播放界面就近处。
 *
 *  显示规则（关键，别改成只显示首选）：
 *  标的是**实得档位**（resolvedQuality），不是首选档位。用户选「无损」但该曲只有 320k 时，
 *  解析器会降级成功 —— 此时必须如实显示 320k，否则等于对用户撒谎。
 *  首选档位与实得不同时，在菜单里额外标注一条提示。
 *
 *  【每曲可用档位】（v2.28.0）
 *  各平台搜索/歌单结果里本来就带 `types` / `meta.qualitys`，标注了**这首歌**申报了
 *  哪些档位与体积。以前菜单平铺 6 档，用户点「无损」只能靠事后的红点知道自己猜错。
 *  现在逐档标出「本曲提供 + 体积」，未申报的档位**不做禁用**（只做弱化）：
 *  跨平台替身与自定义音源的实际能力常高于平台申报值，禁用等于替解析器做决定。 */
export default function QualityMenu({
  className,
  showLabel = false,
}: {
  className?: string
  /** 是否显示文字标签（窄位置只显示图标） */
  showLabel?: boolean
}) {
  const { preferredQuality, resolvedQuality, setQuality, current, autoBestQuality, setAutoBestQuality } =
    usePlayer()

  // 有曲目在播 → 显示实得档位；否则显示首选档位（此时还没有「实得」概念）
  const shown = current ? resolvedQuality ?? preferredQuality : preferredQuality
  // 降级判定用序号比较（flac24bit → flac 才是降级，反向是升级）
  const degraded = isDegraded(resolvedQuality, preferredQuality)

  const tiers = songTiers(current)
  const hasDeclared = tiers.length > 0
  // 本曲实际起手档位：开了自动最高档时会高于首选，菜单要如实反映「即将请求哪一档」
  const startTier = pickStartTier(tiers, preferredQuality, autoBestQuality)

  return (
    <Menu>
      <MenuTrigger
        aria-label={`音质：${qualityShort(shown)}${degraded ? '（已降级）' : ''}`}
        title={
          current
            ? `当前音质 ${qualityShort(shown)}${
                degraded ? `，首选 ${qualityShort(preferredQuality)} 该曲不可得` : ''
              }`
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

      {/* 高度上限：菜单已从「6 行单行」长成「7 项双行」（约 512px）。
          _实测_（.playwright/_verify-quality-menu-fit.py，5 种视口）：
          390×844 与 360×640 下 Radix 翻转朝上后仍放不下，菜单顶部跑到 y=-73 ——
          标题与「自动最高档」开关被裁在视口外，而元素还在 DOM 里、
          `is_visible()` 为 true，**普通断言抓不到这类裁切**。

          ⚠️ 别用 `80dvh` 这类「猜一个够小的值」：可用空间取决于触发器位置，
          同一个 80dvh 在 844 高下是 675px（比可用空间大），在 640 高下是 512px。
          正解是用 Radix 自己算出来的 `--radix-dropdown-menu-content-available-height`
          —— 它就是「当前展开方向还剩多少空间」，配合内部滚动，任何视口都装得下。

          ⚠️ 用 `overflow-auto` 而不是 `overflow-y-auto`：MenuContent 基类里是
          `overflow-hidden`（同属 tailwind-merge 的 `overflow` 组），只有同组的
          `overflow-auto` 才能把它顶掉；写 `overflow-y-auto` 两者并存，
          谁生效取决于 CSS 生成顺序 —— 那时限高等于白设。 */}
      <MenuContent
        align="end"
        collisionPadding={8}
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-72 overflow-auto overscroll-contain"
      >
        <MenuLabel className="px-2 py-1.5 text-[11px] font-medium tracking-wide text-faint">
          播放音质
        </MenuLabel>
        <MenuSeparator />

        {/* 自动最高档开关：放在档位列表**之上**，因为它是「整列怎么用」的总策略 */}
        <MenuItem
          onSelect={() => setAutoBestQuality(!autoBestQuality)}
          className="items-start gap-2.5 py-2"
        >
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
            {autoBestQuality ? (
              <Check className="size-4 text-accent" />
            ) : (
              <span className="size-1.5 rounded-full bg-line-strong" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="text-sm text-ink">按曲目自动选最高档</span>
              <Sparkles className="size-3 text-accent" />
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-faint">
              本曲提供更高档位时自动用它；低于你的首选时仍按首选（默认关）
            </span>
          </span>
        </MenuItem>

        <MenuSeparator />

        {QUALITY_TIERS.map((t) => {
          const active = t.value === preferredQuality
          // 当前曲目下该档位是否是「实得」那一档 —— 单独打个标，让用户看清实际拿到什么
          const isCurrent = !!current && resolvedQuality === t.value
          const declared = songHasTier(tiers, t.value)
          const tierInfo = tiers.find((x) => x.type === t.value)
          const size = sizeLabel(tierInfo?.size)
          // 「自动最高档」会从这一档起手（且它不是首选时）—— 标出来免得用户以为设置没生效
          const isStart = !!current && autoBestQuality && startTier === t.value && !active
          // 本曲没申报这一档：弱化但仍可点（见文件头说明）
          const unknown = !!current && hasDeclared && !declared

          return (
            <MenuItem
              key={t.value}
              onSelect={() => setQuality(t.value)}
              className={cn('items-start gap-2.5 py-2', unknown && 'opacity-70')}
            >
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                {active ? (
                  <Check className="size-4 text-accent" />
                ) : (
                  <span className="size-1.5 rounded-full bg-line-strong" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className={cn('text-sm', active ? 'font-medium text-ink' : 'text-ink')}>
                    {t.label}
                  </span>
                  <span className="font-mono text-[10px] text-faint">{t.short}</span>
                  {isCurrent && (
                    <span className="rounded bg-accent-soft px-1 py-0.5 text-[10px] leading-none text-accent">
                      正在使用
                    </span>
                  )}
                  {isStart && (
                    <span className="rounded bg-panel2 px-1 py-0.5 text-[10px] leading-none text-dim">
                      将按此档请求
                    </span>
                  )}
                  {/* 本曲申报情况：体积是用户能直接感知的「这歌有多大」 */}
                  {declared && (
                    <span className="rounded border border-line px-1 py-0.5 text-[10px] leading-none text-dim">
                      {size ? `本曲 ${size}` : '本曲提供'}
                    </span>
                  )}
                  {unknown && (
                    <span className="text-[10px] leading-none text-faint">本曲未标注</span>
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
            ? `首选「${qualityShort(preferredQuality)}」在这首歌上不可得，已自动降级到「${qualityShort(
                resolvedQuality,
              )}」。`
            : hasDeclared
              ? '「本曲 …」来自平台申报的可用档位，仅供参考；未标注的档位也可能由跨平台替身或自定义源解析出来。'
              : '选不到该档位时会自动向下兼容，不会播放失败。'}
        </p>
      </MenuContent>
    </Menu>
  )
}
