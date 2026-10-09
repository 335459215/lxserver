import { Link } from 'react-router-dom'
import { Disc3, Loader2, Play, X } from 'lucide-react'
import { coverUrl, formatTime, intervalToSeconds, sameSong, sourceLabel, type Song } from '@/lib/music'
import { firstSingerName, supportsArtistPages } from '@/lib/discover'
import { usePlayer } from '@/lib/player'
import { cn } from '@/lib/utils'

/** 曲目行：点整行即播；歌手名与专辑名可点进对应详情页。
 *
 *  DOM 结构说明（改这里前必读）：
 *  `<a>` 不能嵌在 `<button>` 里，而整行又必须可点播放。故用「整行播放热区 + 视觉层」：
 *    - 一个 `absolute inset-0` 的 button 铺满整行，承载播放；
 *    - 视觉内容放在它**之后**的 `relative` 层里，默认 `pointer-events-none`，
 *      点击直接穿透到下面的播放热区；只有歌手/专辑链接自己 `pointer-events-auto`。
 *  这样既保留「点任意空白处即播」，又让元信息可点。 */
function SongRow({
  song,
  index,
  active,
  playing,
  loading,
  showSource,
  linkSinger,
  linkAlbum,
  onPlay,
  onRemove,
}: {
  song: Song
  index: number
  active: boolean
  playing: boolean
  loading: boolean
  showSource: boolean
  linkSinger: boolean
  linkAlbum: boolean
  onPlay: () => void
  onRemove?: () => void
}) {
  const cover = coverUrl(song)
  const duration = intervalToSeconds(song.interval)
  const album = song.albumName ?? song.meta?.albumName
  const albumId = song.albumId ?? (song.meta as { albumId?: string | number } | undefined)?.albumId

  // 只有平台支持（wy/tx）且字段齐备时才渲染链接 —— 否则就是死链
  const singerName = firstSingerName(song.singer)
  const artistOk = supportsArtistPages(song.source)
  const singerHref =
    linkSinger && artistOk && singerName
      ? `/artist-name/${encodeURIComponent(singerName)}?source=${encodeURIComponent(song.source)}`
      : null
  const albumHref =
    linkAlbum && artistOk && albumId != null && album
      ? `/album/${encodeURIComponent(String(albumId))}?source=${encodeURIComponent(song.source)}`
      : null

  const linkCls = 'pointer-events-auto transition-colors hover:text-accent hover:underline'

  return (
    <div
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors',
        active ? 'border-accent/40 bg-accent-soft' : 'border-transparent hover:border-line hover:bg-panel2/60',
      )}
    >
      <button
        type="button"
        onClick={onPlay}
        aria-label={`播放 ${song.name} - ${song.singer}`}
        className="absolute inset-0 rounded-xl"
      />

      <span className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-3">
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
            {singerHref ? (
              <Link to={singerHref} className={linkCls} title={`查看歌手 ${singerName}`}>
                {song.singer}
              </Link>
            ) : (
              song.singer
            )}
            {album && (
              <>
                {' · '}
                {albumHref ? (
                  <Link to={albumHref} className={linkCls} title={`查看专辑 ${album}`}>
                    {album}
                  </Link>
                ) : (
                  album
                )}
              </>
            )}
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
      </span>

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`从列表移除 ${song.name}`}
          title="从列表移除"
          className="relative flex size-7 shrink-0 items-center justify-center rounded-lg text-faint opacity-0 transition-all hover:bg-panel2 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
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
  /** 歌手名是否可点进歌手页（默认开；在歌手自己的页面上关掉） */
  linkSinger?: boolean
  /** 专辑名是否可点进专辑页（默认开；在专辑自己的页面上关掉） */
  linkAlbum?: boolean
  className?: string
}

/** 曲目列表：自动高亮当前播放曲、显示加载态 */
export default function SongList({
  songs,
  onPlay,
  showSource = false,
  onRemove,
  linkSinger = true,
  linkAlbum = true,
  className,
}: SongListProps) {
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
            linkSinger={linkSinger}
            linkAlbum={linkAlbum}
            onPlay={() => (onPlay ? onPlay(song, i) : player.playQueue(songs, i))}
            onRemove={onRemove ? () => onRemove(song, i) : undefined}
          />
        </li>
      ))}
    </ul>
  )
}
