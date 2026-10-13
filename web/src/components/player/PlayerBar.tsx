import * as React from 'react'
import { Link } from 'react-router-dom'
import { Download, ListMusic, Loader2, Maximize2, Music2, Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { coverUrl } from '@/lib/music'
import { usePlayer } from '@/lib/player'
import { useToast } from '@/components/ui'
import { downloadSong } from '@/lib/download'
import { ProgressRow, TransportControls } from '@/components/player/TransportControls'
import QualityMenu from '@/components/player/QualityMenu'

/** 音量条（含静音切换） */
function VolumeControl() {
  const { volume, muted, setVolume, toggleMute } = usePlayer()
  const effective = muted ? 0 : volume
  const Icon = muted || volume === 0 ? VolumeX : Volume2

  return (
    <div className="flex items-center gap-1.5">
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

/** 现正播放曲目的封面块（带唱片黑胶与声学动感） */
export function CoverThumb() {
  const { current, status } = usePlayer()
  const cover = coverUrl(current)
  const isPlaying = status === 'playing'

  if (cover) {
    return (
      <div className="relative size-12 shrink-0 group">
        <img
          src={cover}
          alt={current?.name ?? ''}
          loading="lazy"
          className="relative z-10 size-12 rounded-xl border border-line/80 object-cover shadow-xs transition-transform group-hover:scale-105"
        />
        {/* 背景氛围柔光 */}
        <div
          className={cn(
            'pointer-events-none absolute -inset-1 rounded-xl opacity-35 blur-md transition-opacity',
            isPlaying ? 'bg-accent/40 opacity-50' : 'opacity-0',
          )}
        />
      </div>
    )
  }
  return (
    <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-line bg-panel-2 text-faint shadow-2xs">
      <Music2 className="size-5 text-faint" />
    </span>
  )
}

/** 底部常驻播放栏（**仅桌面 ≥1024px**）。
 *  顶研级流体毛玻璃质感与精细声学交互。 */
export default function PlayerBar() {
  const { current, status, resolvedQuality, sourceName, error, queue } = usePlayer()
  const { toast } = useToast()
  const [downloading, setDownloading] = React.useState(false)
  const isPlaying = status === 'playing'

  const subtitle = current
    ? [current.singer, sourceName ?? resolvedQuality ?? null].filter(Boolean).join(' · ')
    : ''

  const handleDownloadCurrent = async () => {
    if (!current || downloading) return
    setDownloading(true)
    toast({
      title: `正在准备下载《${current.name}》`,
      description: '正在获取高保真音频并注入元数据标签与歌词...',
    })
    try {
      const res = await downloadSong(current)
      toast({
        title: `已开始下载《${current.name}》`,
        description: `音质：${res.quality} · 文件：${res.filename}`,
        variant: 'success',
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '下载准备失败'
      toast({
        title: `下载《${current.name}》失败`,
        description: message,
        variant: 'destructive',
      })
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      role="region"
      aria-label="播放栏"
      className="fixed inset-x-0 bottom-0 z-40 hidden h-[var(--playerbar-h)] border-t border-line/70 bg-panel/95 backdrop-blur-3xl shadow-pop lg:block"
    >
      <div className="mx-auto flex h-full w-full max-w-6xl items-center gap-4 px-4 md:gap-6 md:px-8">
        {/* 左：当前曲目（空态 → 搜索入口；有曲目 → 全屏播放页入口） */}
        <Link
          to={current ? '/now-playing' : '/search'}
          className="group flex min-w-0 flex-1 max-w-[280px] items-center gap-3.5"
          title={current ? '展开全屏播放页' : '未在播放 · 点击去搜索'}
        >
          <CoverThumb />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-ink group-hover:text-accent transition-colors">
                {current ? current.name : '未在播放'}
              </span>
              {/* 播放中跳动声学均衡器小波形 */}
              {isPlaying && (
                <span className="flex items-end gap-0.5 h-3 shrink-0" aria-label="正在播放动画">
                  <span className="w-0.5 bg-accent rounded-full animate-eq-1" />
                  <span className="w-0.5 bg-accent rounded-full animate-eq-2" />
                  <span className="w-0.5 bg-accent rounded-full animate-eq-3" />
                  <span className="w-0.5 bg-accent rounded-full animate-eq-4" />
                </span>
              )}
            </span>
            <span className="block truncate text-xs text-dim/90 transition-colors mt-0.5">
              {error ? (
                <span className="text-danger">{error}</span>
              ) : (
                subtitle || '搜索并点播喜爱的音乐'
              )}
            </span>
          </span>
        </Link>

        {/* 中：播放控制 + 进度（含随机/循环） */}
        <div className="flex min-w-0 flex-1 max-w-lg flex-col items-center gap-1.5">
          <TransportControls showMode />
          <ProgressRow className="w-full" />
        </div>

        {/* 右：音质 / 下载 / 音量 / 队列 / 展开播放页 */}
        <div className="flex shrink-0 items-center justify-end gap-2 md:gap-2.5">
          <QualityMenu showLabel />
          {current && (
            <button
              type="button"
              onClick={handleDownloadCurrent}
              disabled={downloading}
              aria-label={`下载当前歌曲 ${current.name}`}
              title={downloading ? '正在准备下载...' : `下载当前歌曲 (${current.name})`}
              className="flex size-8.5 items-center justify-center rounded-xl text-dim transition-all hover:bg-accent-soft hover:text-accent active:scale-95 disabled:opacity-50"
            >
              {downloading ? (
                <Loader2 className="size-4 animate-spin text-accent" />
              ) : (
                <Download className="size-4" />
              )}
            </button>
          )}
          <VolumeControl />
          <Link
            to="/playlist"
            aria-label="播放队列"
            title={queue.length ? `播放队列（${queue.length} 首）` : '播放队列'}
            className="relative flex size-8.5 items-center justify-center rounded-xl text-dim transition-all hover:bg-panel-2 hover:text-ink active:scale-95"
          >
            <ListMusic className="size-4" />
            {queue.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-semibold leading-4 text-white shadow-2xs">
                {queue.length > 99 ? '99+' : queue.length}
              </span>
            )}
          </Link>
          <Link
            to="/now-playing"
            aria-label="展开全屏播放页"
            title="全屏沉浸播放"
            className="flex size-8.5 items-center justify-center rounded-xl text-dim transition-all hover:bg-panel-2 hover:text-ink active:scale-95"
          >
            <Maximize2 className="size-4" />
          </Link>
        </div>
      </div>

      {status === 'loading' && (
        <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden" aria-hidden>
          <span className="block h-full w-1/3 animate-pulse bg-gradient-to-r from-accent to-indigo-400" />
        </span>
      )}
      <span className={cn('sr-only')} aria-live="polite">
        {current ? `正在播放 ${current.name}` : '未在播放'}
      </span>
    </div>
  )
}
