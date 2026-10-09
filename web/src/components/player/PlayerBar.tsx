import { Link } from 'react-router-dom'
import { ListMusic, Maximize2, Music2, Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { coverUrl, intervalToSeconds } from '@/lib/music'
import { usePlayer } from '@/lib/player'
import { ProgressRow, TransportControls } from '@/components/player/TransportControls'

/** 音量条（含静音切换）：桌面显示，移动端交给系统音量 */
function VolumeControl() {
  const { volume, muted, setVolume, toggleMute } = usePlayer()
  const effective = muted ? 0 : volume
  const Icon = muted || volume === 0 ? VolumeX : Volume2

  return (
    <div className="hidden items-center gap-1.5 md:flex">
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? '取消静音' : '静音'}
        title={muted ? '取消静音' : '静音'}
        className="flex size-8 items-center justify-center rounded-lg text-dim transition-colors hover:bg-panel2 hover:text-ink"
      >
        <Icon className="size-4" />
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={effective}
        aria-label="音量"
        onChange={(e) => setVolume(Number.parseFloat(e.target.value))}
        className="h-1 w-20 cursor-pointer appearance-none rounded-full"
        style={{
          background: `linear-gradient(to right, var(--accent) ${effective * 100}%, var(--panel-2) ${effective * 100}%)`,
        }}
      />
    </div>
  )
}

/** 现正播放曲目的封面块（空态显示占位图标） */
function CoverThumb() {
  const { current } = usePlayer()
  const cover = coverUrl(current)

  if (cover) {
    return (
      <img
        src={cover}
        alt={current?.name ?? ''}
        loading="lazy"
        className="size-11 shrink-0 rounded-lg border border-line object-cover"
      />
    )
  }
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-line bg-panel2 text-faint">
      <Music2 className="size-5" />
    </span>
  )
}

/** 底部常驻播放栏。
 *  空态：左区即搜索入口；有曲目：左区变全屏播放页入口，中区显示真实进度与控制。 */
export default function PlayerBar() {
  const { current, status, duration, position, resolvedQuality, sourceName, error, queue } =
    usePlayer()

  // 时长：优先用媒体元素的真实时长，元数据未到时回落到 interval
  const total = duration > 0 ? duration : intervalToSeconds(current?.interval)
  const subtitle = current
    ? [current.singer, sourceName ?? resolvedQuality ?? null].filter(Boolean).join(' · ')
    : ''

  return (
    <div
      role="region"
      aria-label="播放栏"
      className="fixed inset-x-0 bottom-0 z-40 h-[var(--playerbar-h)] border-t border-line bg-panel/95 backdrop-blur"
    >
      <div className="mx-auto flex h-full w-full max-w-6xl items-center gap-3 px-4 md:gap-4 md:px-6">
        {/* 左：当前曲目（空态 → 搜索入口；有曲目 → 全屏播放页入口） */}
        <Link
          to={current ? '/now-playing' : '/search'}
          className="group flex min-w-0 flex-1 items-center gap-3"
          title={current ? '展开全屏播放页' : '未在播放 · 点击去搜索'}
        >
          <CoverThumb />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink">
              {current ? current.name : '未在播放'}
            </span>
            <span className="block truncate text-xs text-faint transition-colors group-hover:text-dim">
              {error ? error : subtitle || '搜索并播放第一首歌'}
            </span>
          </span>
        </Link>

        {/* 中：播放控制 + 进度（桌面） */}
        <div className="hidden min-w-0 flex-1 flex-col items-center gap-1 md:flex">
          <TransportControls />
          <ProgressRow className="max-w-md" />
        </div>

        {/* 右：播放控制（移动）/ 音量 / 队列 / 展开播放页 */}
        <div className="flex shrink-0 items-center justify-end gap-1.5 md:gap-2">
          <div className="md:hidden">
            <TransportControls />
          </div>
          <VolumeControl />
          <Link
            to="/playlist"
            aria-label="播放队列"
            title={queue.length ? `播放队列（${queue.length} 首）` : '播放队列'}
            className="relative hidden size-8 items-center justify-center rounded-lg text-dim transition-colors hover:bg-panel2 hover:text-ink md:flex"
          >
            <ListMusic className="size-4" />
            {queue.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] leading-4 text-white">
                {queue.length > 99 ? '99+' : queue.length}
              </span>
            )}
          </Link>
          <Link
            to="/now-playing"
            aria-label="展开全屏播放页"
            title="全屏播放页"
            className="flex size-8 items-center justify-center rounded-lg text-dim transition-colors hover:bg-panel2 hover:text-ink"
          >
            <Maximize2 className="size-4" />
          </Link>
        </div>
      </div>

      {/* 移动端：极简进度条贴顶，不占额外高度 */}
      <div className="absolute inset-x-0 top-0 h-0.5 bg-panel2 md:hidden" aria-hidden>
        <span
          className="block h-full bg-accent"
          style={{ width: `${total > 0 ? Math.min(100, (position / total) * 100) : 0}%` }}
        />
      </div>
      {status === 'loading' && (
        <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden" aria-hidden>
          <span className="block h-full w-1/3 animate-pulse bg-accent/60" />
        </span>
      )}
      <span className={cn('sr-only')} aria-live="polite">
        {current ? `正在播放 ${current.name}` : '未在播放'}
      </span>
    </div>
  )
}
