import { Gauge } from 'lucide-react'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, useToast } from '@/components/ui'
import { usePlayer } from '@/lib/player'
import { cn } from '@/lib/utils'

export const RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

export function rateLabel(rate: number): string {
  // 1 → "1x"，1.5 → "1.5x"（整数不带小数点，和 YouTube Music 一致）
  return `${Number.isInteger(rate) ? rate : rate.toFixed(2).replace(/0$/, '')}x`
}

/** 播放倍速（v2.36.0）。变速不变调（preservesPitch，见 player.tsx）。
 *
 *  【为什么只放全屏播放页不放播放栏】倍速是低频调节（听书/练歌才用），
 *  播放栏右簇已有音质/下载/音量/睡眠/队列五个控件，再塞会挤；
 *  YouTube Music 也把倍速放在播放页里而不是常驻栏。
 *  【换歌保持】换 src 会把 <audio> 速率重置为 1 —— 内核在每次设完
 *  src 后重挂（loadAndPlay 里两处 applyPlaybackRate），这里不用管。 */
export default function PlaybackRateMenu({ className }: { className?: string }) {
  const { rate, setRate } = usePlayer()
  const { toast } = useToast()

  return (
    <Menu>
      <MenuTrigger
        aria-label={`倍速：${rateLabel(rate)}`}
        title="播放倍速"
        className={cn(
          'flex h-6 items-center gap-1 rounded-md border border-line bg-panel-2/80 px-2 text-dim transition-colors hover:border-accent/30 hover:text-ink',
          rate !== 1 && 'text-accent border-accent/25',
          className,
        )}
      >
        <Gauge className="size-3.5" aria-hidden />
        <span className="font-mono text-[11px] tabular-nums">{rateLabel(rate)}</span>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>播放倍速</MenuLabel>
        {RATE_OPTIONS.map((r) => (
          <MenuItem key={r} disabled={rate === r} onSelect={() => {
            setRate(r)
            if (r !== rate) toast({ title: `倍速：${rateLabel(r)}` })
          }}>
            {rateLabel(r)}{rate === r ? '（当前）' : ''}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}
