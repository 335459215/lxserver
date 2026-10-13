import * as React from 'react'
import { Link } from 'react-router-dom'
import { Disc3, Download, Loader2, Play, X } from 'lucide-react'
import { coverUrl, formatTime, intervalToSeconds, sameSong, sourceLabel, type Song } from '@/lib/music'
import { firstSingerName, supportsArtistPages } from '@/lib/discover'
import { usePlayer } from '@/lib/player'
import { useToast } from '@/components/ui'
import { downloadSong } from '@/lib/download'
import { cn } from '@/lib/utils'

/** 曲目行：点整行即播；歌手名与专辑名可点进对应详情页；提供下载与移除等操作。
 *
 *  DOM 结构说明（改这里前必读）：
 *  `<a>` 不能嵌在 `<button>` 里，而整行又必须可点播放。故用「整行播放热区 + 视觉层」：
 *    - 一个 `absolute inset-0` 的 button 铺满整行，承载播放；
 *    - 视觉内容放在它**之后**的 `relative` 层里，默认 `pointer-events-none`，
 *      点击直接穿透到下面的播放热区；只有歌手/专辑链接和操作按钮声明 `pointer-events-auto`。
 *  这样既保留「点任意空白处即播」，又让链接与操作按钮独立自洽。 */
function SongRow({
  song,
  index,
  active,
  playing,
  loading,
  showSource,
  linkSinger,
  linkAlbum,
  allowDownload = true,
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
  allowDownload?: boolean
  onPlay: () => void
  onRemove?: () => void
}) {
  const { toast } = useToast()
  const [downloading, setDownloading] = React.useState(false)
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

  // link-inline：把命中区抬到 WCAG 2.2 AA 的 24px 而不改变排版（见 index.css 注释）。
  const linkCls =
    'link-inline pointer-events-auto transition-colors hover:text-accent hover:underline'

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (downloading) return
    setDownloading(true)
    toast({
      title: `正在准备下载《${song.name}》`,
      description: '正在解析高保真音源并嵌入元数据与歌词...',
    })
    try {
      const res = await downloadSong(song)
      toast({
        title: `已开始下载《${song.name}》`,
        description: `音质：${res.quality} · 文件：${res.filename}`,
        variant: 'success',
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '下载准备失败'
      toast({
        title: `下载《${song.name}》失败`,
        description: message,
        variant: 'destructive',
      })
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      className={cn(
        'group relative flex w-full items-center gap-3.5 rounded-2xl border px-3.5 py-2.5 transition-all duration-200',
        active
          ? 'border-accent/40 bg-accent/8 shadow-xs'
          : 'border-transparent hover:border-line/80 hover:bg-panel-2/70 hover:shadow-2xs',
      )}
    >
      <button
        type="button"
        onClick={onPlay}
        aria-label={`播放 ${song.name} - ${song.singer}`}
        className="absolute inset-0 rounded-2xl focus:outline-none"
      />

      <span className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-3.5">
        <span className="w-6 shrink-0 text-center font-mono text-xs text-faint">
          {active && loading ? (
            <Loader2 className="mx-auto size-3.5 animate-spin text-accent" />
          ) : active && playing ? (
            <span className="mx-auto flex h-3.5 items-end justify-center gap-0.5" aria-hidden>
              <span className="h-1.5 w-0.5 rounded-full bg-accent animate-eq-1" />
              <span className="h-3 w-0.5 rounded-full bg-accent animate-eq-2" />
              <span className="h-2 w-0.5 rounded-full bg-accent animate-eq-3" />
            </span>
          ) : (
            <>
              <span className="group-hover:hidden font-medium">{index + 1}</span>
              <Play className="mx-auto hidden size-3.5 fill-current text-accent group-hover:block transition-transform hover:scale-110" />
            </>
          )}
        </span>

        {cover ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            className="size-11 shrink-0 rounded-xl border border-line/70 object-cover shadow-2xs transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line/70 bg-panel-2 text-faint shadow-2xs">
            <Disc3 className="size-5" />
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-sm font-semibold tracking-tight', active ? 'text-accent' : 'text-ink')}>
            {song.name}
          </span>
          <span className="block truncate text-xs text-dim mt-0.5">
            {singerHref ? (
              <Link to={singerHref} className={linkCls} title={`查看歌手 ${singerName}`}>
                {song.singer}
              </Link>
            ) : (
              <span>{song.singer}</span>
            )}
            {album && (
              <>
                <span className="text-faint/80"> · </span>
                {albumHref ? (
                  <Link to={albumHref} className={linkCls} title={`查看专辑 ${album}`}>
                    {album}
                  </Link>
                ) : (
                  <span className="text-faint">{album}</span>
                )}
              </>
            )}
          </span>
        </span>

        {showSource && (
          <span className="hidden shrink-0 rounded-lg border border-line/80 bg-panel px-2 py-0.5 text-[10px] font-medium text-dim shadow-2xs sm:block">
            {sourceLabel(song.source)}
          </span>
        )}
        <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-faint">
          {duration > 0 ? formatTime(duration) : '--:--'}
        </span>
      </span>

      {/* 独立操作区：下载 / 移除 */}
      <div className="relative z-10 flex shrink-0 items-center gap-1">
        {allowDownload && (
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            aria-label={`下载 ${song.name} - ${song.singer}`}
            title={downloading ? '正在准备下载...' : `下载到本地 (${song.name})`}
            className="flex size-8.5 items-center justify-center rounded-xl text-dim opacity-70 transition-all hover:bg-accent-soft hover:text-accent focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40 active:scale-95"
          >
            {downloading ? (
              <Loader2 className="size-4 animate-spin text-accent" />
            ) : (
              <Download className="size-4" />
            )}
          </button>
        )}

        {onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            aria-label={`从列表移除 ${song.name}`}
            title="从列表移除"
            className="flex size-8.5 items-center justify-center rounded-xl text-faint opacity-60 transition-all hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 active:scale-95"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}

export interface SongListProps {
  songs: Song[]
  /** 点歌回调；不传则默认按整个列表播放 */
  onPlay?: (song: Song, index: number) => void
  /** 是否显示平台徽标（搜索结果需要，歌单内不必） */
  showSource?: boolean
  /** 是否允许单曲下载（默认 true） */
  allowDownload?: boolean
  /** 提供则每行显示「移除」按钮 */
  onRemove?: (song: Song, index: number) => void
  /** 歌手名是否可点进歌手页（默认开；在歌手自己的页面上关掉） */
  linkSinger?: boolean
  /** 专辑名是否可点进专辑页（默认开；在专辑自己的页面上关掉） */
  linkAlbum?: boolean
  className?: string
}

/** 曲目列表：自动高亮当前播放曲、显示加载态、支持在线点播与单曲下载 */
export default function SongList({
  songs,
  onPlay,
  showSource = false,
  allowDownload = true,
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
            allowDownload={allowDownload}
            onPlay={() => (onPlay ? onPlay(song, i) : player.playQueue(songs, i))}
            onRemove={onRemove ? () => onRemove(song, i) : undefined}
          />
        </li>
      ))}
    </ul>
  )
}

