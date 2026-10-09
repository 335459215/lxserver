import { Disc3, Loader2, Play, X } from 'lucide-react'
import { coverUrl, formatTime, intervalToSeconds, sameSong, sourceLabel, type Song } from '@/lib/music'
import { usePlayer } from '@/lib/player'
import { cn } from '@/lib/utils'

/** 曲目行：点整行即播。搜索页 / 歌单详情 / 我的收藏共用同一实现。 */
function SongRow({
  song,
  index,
  active,
  playing,
  loading,
  showSource,
  onPlay,
  onRemove,
}: {
  song: Song
  index: number
  active: boolean
  playing: boolean
  loading: boolean
  showSource: boolean
  onPlay: () => void
  onRemove?: () => void
}) {
  const cover = coverUrl(song)
  const duration = intervalToSeconds(song.interval)
  const album = song.albumName ?? song.meta?.albumName

  return (
    <div
      className={cn(
        'group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors',
        active ? 'border-accent/40 bg-accent-soft' : 'border-transparent hover:border-line hover:bg-panel2/60',
      )}
    >
      <button
        type="button"
        onClick={onPlay}
        aria-label={`播放 ${song.name} - ${song.singer}`}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="w-6 shrink-0 text-center font-mono text-xs text-faint">
          {active && loading ? (
            <Loader2 className="mx-auto size-3.5 animate-spin text-accent" />
          ) : active && playing ? (
            <span className="mx-auto flex size-3.5 items-end justify-center gap-px" aria-hidden>
              <span className="h-1.5 w-0.5 animate-pulse bg-accent" />
              <span className="h-3 w-0.5 animate-pulse bg-accent [animation-delay:150ms]" />
              <span className="h-2 w-0.5 animate-pulse bg-accent [animation-delay:300ms]" />
            </span>
          ) : (
            <>
              <span className="group-hover:hidden">{index + 1}</span>
              <Play className="mx-auto hidden size-3.5 fill-current text-accent group-hover:block" />
            </>
          )}
        </span>

        {cover ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            className="size-10 shrink-0 rounded-lg border border-line object-cover"
          />
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-panel2 text-faint">
            <Disc3 className="size-4" />
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-sm', active ? 'font-medium text-accent' : 'text-ink')}>
            {song.name}
          </span>
          <span className="block truncate text-xs text-faint">
            {[song.singer, album].filter(Boolean).join(' · ')}
          </span>
        </span>

        {showSource && (
          <span className="hidden shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[10px] text-faint sm:block">
            {sourceLabel(song.source)}
          </span>
        )}
        <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-faint">
          {duration > 0 ? formatTime(duration) : '--:--'}
        </span>
      </button>

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`从列表移除 ${song.name}`}
          title="从列表移除"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-faint opacity-0 transition-all hover:bg-panel2 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

export interface SongListProps {
  songs: Song[]
  /** 点歌回调；不传则默认按整个列表播放 */
  onPlay?: (song: Song, index: number) => void
  /** 是否显示平台徽标（搜索结果需要，歌单内不必） */
  showSource?: boolean
  /** 提供则每行显示「移除」按钮 */
  onRemove?: (song: Song, index: number) => void
  className?: string
}

/** 曲目列表：自动高亮当前播放曲、显示加载态 */
export default function SongList({ songs, onPlay, showSource = false, onRemove, className }: SongListProps) {
  const player = usePlayer()

  return (
    <ul className={cn('space-y-1', className)}>
      {songs.map((song, i) => (
        <li key={String(song.id ?? `${song.source}-${song.name}-${i}`)}>
          <SongRow
            song={song}
            index={i}
            active={sameSong(song, player.current)}
            playing={player.status === 'playing'}
            loading={player.status === 'loading'}
            showSource={showSource}
            onPlay={() => (onPlay ? onPlay(song, i) : player.playQueue(songs, i))}
            onRemove={onRemove ? () => onRemove(song, i) : undefined}
          />
        </li>
      ))}
    </ul>
  )
}
