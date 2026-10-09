import { Link } from 'react-router-dom'
import { ListMusic, Music2, Search, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui'
import { coverUrl, formatTime, intervalToSeconds, sameSong, sourceLabel } from '@/lib/music'
import { usePlayer } from '@/lib/player'
import { ProgressRow, TransportControls } from '@/components/player/TransportControls'
import { cn } from '@/lib/utils'

/** 全屏播放页（/now-playing）：大封面 + 传输控制 + 进度 + 队列。
 *  歌词滚动与封面取色在后续版本接入。 */
export default function NowPlayingPage() {
  const player = usePlayer()
  const { current, status, error, attempts, queue, index, duration, resolvedQuality, sourceName } =
    player

  // 空态
  if (!current) {
    return (
      <div className="rise mx-auto flex w-full max-w-xl flex-col items-center gap-6 py-2 md:gap-8 md:py-6">
        <div className="flex aspect-square w-52 items-center justify-center rounded-3xl border border-line bg-panel shadow-pop md:w-64">
          <Music2 className="size-12 text-faint" />
        </div>
        <div className="text-center">
          <h1 className="text-lg font-semibold tracking-tight text-ink">还没有正在播放的歌曲</h1>
          <p className="mt-1 text-sm text-dim">搜索并播放一首歌，这里会显示大封面与控制。</p>
        </div>
        <Button asChild>
          <Link to="/search">
            <Search className="size-4" /> 去搜索音乐
          </Link>
        </Button>
      </div>
    )
  }

  const cover = coverUrl(current)
  const total = duration > 0 ? duration : intervalToSeconds(current.interval)
  const subtitle = [current.singer, current.albumName].filter(Boolean).join(' · ')

  return (
    <div className="rise mx-auto flex w-full max-w-xl flex-col items-center gap-5 py-2 md:gap-6 md:py-4">
      {/* 大封面 */}
      {cover ? (
        <img
          src={cover}
          alt={current.name}
          className="aspect-square w-52 rounded-3xl border border-line object-cover shadow-pop md:w-64"
        />
      ) : (
        <div className="flex aspect-square w-52 items-center justify-center rounded-3xl border border-line bg-panel shadow-pop md:w-64">
          <Music2 className="size-12 text-faint" />
        </div>
      )}

      {/* 标题 */}
      <div className="w-full text-center">
        <h1 className="truncate text-lg font-semibold tracking-tight text-ink" title={current.name}>
          {current.name}
        </h1>
        <p className="mt-1 truncate text-sm text-dim">{subtitle || '未知歌手'}</p>
        <p className="mt-1 text-xs text-faint">
          {sourceName ?? sourceLabel(current.source)}
          {resolvedQuality ? ` · ${resolvedQuality}` : ''}
          {total > 0 ? ` · ${formatTime(total)}` : ''}
        </p>
      </div>

      {/* 进度 + 控制 */}
      <div className="flex w-full flex-col items-center gap-4">
        <ProgressRow />
        <TransportControls size="lg" />
      </div>

      {/* 解析失败：说明试过哪些源，并给一键换源重试 */}
      {status === 'error' && (
        <div className="w-full rounded-2xl border border-line bg-panel p-4 text-xs text-dim">
          <p className="flex items-start gap-2">
            <TriangleAlert className="mt-px size-4 shrink-0 text-danger" />
            <span className="min-w-0 break-words">
              {error ?? '这首歌暂时解析不出来'}
              {attempts.length > 0 && (
                <span className="mt-1 block text-faint">
                  已尝试：
                  {attempts
                    .map((a) => a.name ?? a.sourceName)
                    .filter(Boolean)
                    .join('、')}
                </span>
              )}
            </span>
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" onClick={player.retry}>
              换源重试
            </Button>
            <Button variant="ghost" size="sm" onClick={player.next}>
              下一首
            </Button>
          </div>
        </div>
      )}

      {/* 队列 */}
      {queue.length > 0 && (
        <section className="w-full rounded-2xl border border-line bg-panel p-4 shadow-card">
          <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-widest text-faint">
            <ListMusic className="size-3.5" /> 播放队列 · {queue.length} 首
          </p>
          <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
            {queue.map((song, i) => {
              const active = i === index || sameSong(song, current)
              return (
                <li key={`${song.source}-${song.songmid ?? song.id ?? i}`}>
                  <button
                    type="button"
                    onClick={() => player.playAt(i)}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                      active ? 'bg-accent-soft text-accent' : 'text-dim hover:bg-panel2 hover:text-ink',
                    )}
                  >
                    <span className="w-5 shrink-0 text-center font-mono text-[10px] text-faint">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className={cn('block truncate', active && 'font-medium')}>{song.name}</span>
                      <span className="block truncate text-[11px] text-faint">{song.singer}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
