import * as React from 'react'
import { Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from 'lucide-react'
import { cn } from '@/lib/utils'
import { REPEAT_LABEL, usePlayer } from '@/lib/player'
import { formatTime } from '@/lib/music'

/** 可拖动进度条：点击/拖动皆可 seek；直播流（时长非有限）自动禁用 */
function ProgressBar({
  value,
  max,
  onSeek,
  disabled,
  className,
  ariaLabel = '播放进度',
}: {
  value: number
  max: number
  onSeek: (v: number) => void
  disabled?: boolean
  className?: string
  ariaLabel?: string
}) {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const [hoverRatio, setHoverRatio] = React.useState<number | null>(null)

  const ratioFromEvent = (clientX: number): number => {
    const el = ref.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }

  const commit = (ratio: number) => {
    if (disabled || max <= 0) return
    onSeek(ratio * max)
  }

  const playable = !disabled && max > 0
  const pct = playable ? Math.min(100, (value / max) * 100) : 0
  const hoverPct = hoverRatio != null ? hoverRatio * 100 : null

  return (
    <div
      ref={ref}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={Math.round(max) || 0}
      aria-valuenow={Math.round(value) || 0}
      aria-disabled={!playable}
      tabIndex={playable ? 0 : -1}
      className={cn(
        'group relative flex h-4 cursor-pointer items-center',
        !playable && 'cursor-default',
        className,
      )}
      onPointerDown={(e) => {
        if (!playable) return
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging(true)
        commit(ratioFromEvent(e.clientX))
      }}
      onPointerMove={(e) => {
        if (!playable) return
        const r = ratioFromEvent(e.clientX)
        setHoverRatio(r)
        if (dragging) commit(r)
      }}
      onPointerUp={(e) => {
        if (!playable) return
        e.currentTarget.releasePointerCapture(e.pointerId)
        setDragging(false)
        commit(ratioFromEvent(e.clientX))
      }}
      onPointerLeave={() => setHoverRatio(null)}
      onKeyDown={(e) => {
        if (!playable) return
        if (e.key === 'ArrowRight') onSeek(Math.min(value + 5, max))
        else if (e.key === 'ArrowLeft') onSeek(Math.max(value - 5, 0))
      }}
    >
      {/* 轨道 */}
      <span className="relative block h-1 w-full rounded-full bg-panel2 transition-[height] group-hover:h-1.5">
        {/* hover 预览 */}
        {hoverPct != null && playable && (
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-line-strong/70"
            style={{ width: `${hoverPct}%` }}
          />
        )}
        {/* 已播放 */}
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-accent"
          style={{ width: `${pct}%` }}
        />
        {/* 拖柄 */}
        {playable && (
          <span
            className={cn(
              'absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-card transition-opacity',
              dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
            style={{ left: `${pct}%` }}
          />
        )}
      </span>
    </div>
  )
}

/** 随机开关 + 循环三态（Spotify 式：随机在左、循环在右，开启时点亮并带指示点）。
 *  与旧版播放器「顺序/循环/单曲/随机 四选一」不同 —— 随机是独立开关，
 *  可以和任意循环模式组合，这是主流音乐 App 的通行做法。 */
export function PlayModeControls({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const { shuffle, repeat, toggleShuffle, cycleRepeat } = usePlayer()
  const btn = size === 'lg' ? 'size-11' : 'size-9'
  const icon = size === 'lg' ? 'size-5' : 'size-4'
  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat

  return (
    <>
      <button
        type="button"
        onClick={toggleShuffle}
        aria-pressed={shuffle}
        aria-label={shuffle ? '关闭随机播放' : '开启随机播放'}
        title={shuffle ? '随机播放：开' : '随机播放：关'}
        className={cn(
          btn,
          'relative flex items-center justify-center rounded-full transition-colors',
          shuffle ? 'text-accent hover:bg-accent-soft' : 'text-dim hover:bg-panel2 hover:text-ink',
        )}
      >
        <Shuffle className={icon} />
        {shuffle && (
          <span className="absolute bottom-1 size-1 rounded-full bg-accent" aria-hidden />
        )}
      </button>

      <button
        type="button"
        onClick={cycleRepeat}
        aria-label={`循环模式：${REPEAT_LABEL[repeat]}（点击切换）`}
        title={`循环：${REPEAT_LABEL[repeat]}`}
        className={cn(
          btn,
          'relative flex items-center justify-center rounded-full transition-colors',
          repeat !== 'off' ? 'text-accent hover:bg-accent-soft' : 'text-dim hover:bg-panel2 hover:text-ink',
        )}
      >
        <RepeatIcon className={icon} />
        {repeat !== 'off' && (
          <span className="absolute bottom-1 size-1 rounded-full bg-accent" aria-hidden />
        )}
      </button>
    </>
  )
}

/** 传输控件：随机 / 上一首 / 播放暂停 / 下一首 / 循环。
 *  桌面与移动共用，只调尺寸；showMode=false 时只保留核心三键（空间紧张处用）。 */
export function TransportControls({
  size = 'md',
  showMode = false,
}: {
  size?: 'md' | 'lg'
  showMode?: boolean
}) {
  const { status, toggle, next, prev, queue, current } = usePlayer()
  const playing = status === 'playing'
  const loading = status === 'loading'
  const hasTrack = !!current
  const canSkip = queue.length > 1

  const iconBtn = size === 'lg' ? 'size-11' : 'size-9'
  const iconSize = size === 'lg' ? 'size-6' : 'size-5'

  return (
    <div className="flex items-center gap-2">
      {showMode && <PlayModeControls size={size} />}

      <button
        type="button"
        onClick={prev}
        disabled={!hasTrack}
        aria-label="上一首"
        title="上一首（Shift + ←）"
        className={cn(
          iconBtn,
          'flex items-center justify-center rounded-full text-dim transition-colors hover:bg-panel2 hover:text-ink disabled:pointer-events-none disabled:text-faint',
        )}
      >
        <SkipBack className={iconSize} />
      </button>

      <button
        type="button"
        onClick={toggle}
        disabled={!hasTrack}
        aria-label={playing ? '暂停' : '播放'}
        title={`${playing ? '暂停' : '播放'}（空格）`}
        className={cn(
          size === 'lg' ? 'size-14' : 'size-10',
          'flex items-center justify-center rounded-full bg-accent text-white shadow-card transition-all',
          'hover:bg-accent-hover active:scale-95 disabled:pointer-events-none disabled:bg-panel2 disabled:text-faint',
        )}
      >
        {loading ? (
          <span className={cn('animate-spin rounded-full border-2 border-current border-t-transparent', size === 'lg' ? 'size-6' : 'size-4')} />
        ) : playing ? (
          <Pause className={cn(iconSize, 'fill-current')} />
        ) : (
          <Play className={cn(iconSize, 'translate-x-px fill-current')} />
        )}
      </button>

      <button
        type="button"
        onClick={next}
        disabled={!canSkip}
        aria-label="下一首"
        title="下一首（Shift + →）"
        className={cn(
          iconBtn,
          'flex items-center justify-center rounded-full text-dim transition-colors hover:bg-panel2 hover:text-ink disabled:pointer-events-none disabled:text-faint',
        )}
      >
        <SkipForward className={iconSize} />
      </button>
    </div>
  )
}

/** 时间 + 进度行（桌面播放栏与全屏播放页共用） */
export function ProgressRow({ className }: { className?: string }) {
  const { position, duration, seek, status } = usePlayer()
  const disabled = status === 'idle' || status === 'error'
  return (
    <div className={cn('flex w-full items-center gap-2', className)}>
      <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-faint">
        {formatTime(position)}
      </span>
      <ProgressBar value={position} max={duration} onSeek={seek} disabled={disabled} className="flex-1" />
      <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-faint">
        {formatTime(duration)}
      </span>
    </div>
  )
}

export { ProgressBar }
