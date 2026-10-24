import * as React from 'react'
import { MoonStar } from 'lucide-react'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, useToast } from '@/components/ui'
import { formatRemaining } from '@/lib/sleepTimer'
import { usePlayer } from '@/lib/player'
import { cn } from '@/lib/utils'

const MINUTE_OPTIONS = [15, 30, 60] as const

/** 倒计时文本：活跃时每秒重算（组件自己的 1s interval，不进播放内核） */
function useSleepCountdown(endsAt: number | null): string | null {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (endsAt == null) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [endsAt])
  return endsAt == null ? null : formatRemaining(Math.max(0, endsAt - now))
}

/** 睡眠定时器（v2.35.0）：播完当前这首 / N 分钟后（到点前 4s 淡出）停止。
 *
 *  入口两处（与音质切换器同一逻辑 —— 改的是「听歌的当下」的设置，
 *  要就近）：播放栏右簇 + 全屏播放页元信息行。
 *  定时器状态在播放内核（会话级，不持久化 —— 重启后不该有幽灵定时）。 */
export default function SleepTimerMenu({ className }: { className?: string }) {
  const { sleep, setSleep } = usePlayer()
  const { toast } = useToast()

  // Hook 必须无条件调用：非 after 模式传 null（内部不启 interval）
  const countdown = useSleepCountdown(sleep.mode === 'after' ? sleep.endsAt : null)
  const active = sleep.mode !== 'off'

  const choose = (mode: 'off' | 'endOfSong' | 'after', minutes?: number) => {
    setSleep(mode, minutes)
    const title =
      mode === 'off'
        ? '已关闭睡眠定时'
        : mode === 'endOfSong'
          ? '睡眠定时：播完当前这首'
          : `睡眠定时：${minutes} 分钟后停止`
    toast({ title })
  }

  return (
    <Menu>
      <MenuTrigger
        aria-label={active ? (countdown ? `睡眠定时（剩余 ${countdown}）` : '睡眠定时（播完当前这首）') : '睡眠定时'}
        title={active ? '睡眠定时进行中' : '睡眠定时'}
        className={cn(
          'flex h-8 items-center gap-1 rounded-lg px-1.5 text-dim transition-colors hover:bg-panel2 hover:text-ink',
          active && 'text-accent',
          className,
        )}
      >
        <MoonStar className="size-4" aria-hidden />
        {countdown && (
          <span className="font-mono text-[11px] tabular-nums">{countdown}</span>
        )}
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>睡眠定时</MenuLabel>
        <MenuItem
          disabled={sleep.mode === 'endOfSong'}
          onSelect={() => choose('endOfSong')}
        >
          播完当前这首{sleep.mode === 'endOfSong' ? '（进行中）' : ''}
        </MenuItem>
        <MenuSeparator />
        {MINUTE_OPTIONS.map((m) => (
          <MenuItem
            key={m}
            disabled={sleep.mode === 'after' && sleep.minutes === m}
            onSelect={() => choose('after', m)}
          >
            {m} 分钟{sleep.mode === 'after' && sleep.minutes === m ? '（进行中）' : ''}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem disabled={!active} onSelect={() => choose('off')}>
          关闭睡眠定时
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
