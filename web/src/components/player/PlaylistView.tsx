import * as React from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Download, Loader2, ListMusic, Play, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { coverUrl, formatTotalDuration, intervalToSeconds } from '@/lib/music'
import { usePlayer } from '@/lib/player'
import { downloadSongsQueue } from '@/lib/download'
import {
  findPlaylist,
  LIST_DEFAULT_ID,
  LIST_LOVE_ID,
  removeSongsFromPlaylist,
  type Playlist,
} from '@/lib/lists'
import { useLists } from '@/lib/useLists'
import SongList from '@/components/player/SongList'

/** 歌单封面：取第一首有封面的曲目，带高保真柔和光晕 */
function ListCover({ songs, size = 'lg' }: { songs: Playlist['songs']; size?: 'sm' | 'lg' }) {
  const cover = songs.map((s) => coverUrl(s)).find(Boolean)
  const cls = size === 'lg' ? 'size-32 md:size-44' : 'size-12'

  return (
    <div className="relative shrink-0 group">
      {cover && size === 'lg' && (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-3 rounded-3xl opacity-40 blur-xl saturate-200 transition-opacity"
          style={{
            backgroundImage: `url(${cover})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      )}
      {cover ? (
        <img
          src={cover}
          alt=""
          className={`${cls} relative z-10 shrink-0 rounded-2xl md:rounded-3xl border border-white/80 object-cover shadow-lg transition-transform duration-300 group-hover:scale-102`}
        />
      ) : (
        <div
          className={`${cls} relative z-10 flex shrink-0 items-center justify-center rounded-2xl md:rounded-3xl border border-line/80 bg-gradient-to-tr from-indigo-50 to-purple-50 text-accent shadow-sm`}
        >
          <ListMusic className={size === 'lg' ? 'size-12' : 'size-5'} />
        </div>
      )}
    </div>
  )
}

/** 单条歌单详情视图：被 /app/playlist/:id 与 /app/favorites 共用。
 *  listId 为 'default' / 'love' / 用户歌单 id。 */
export default function PlaylistView({ listId, backTo = '/playlist' }: { listId: string; backTo?: string }) {
  const player = usePlayer()
  const { toast } = useToast()
  const { snapshot, loading, error, reload } = useLists()
  const [removing, setRemoving] = React.useState<string | null>(null)
  const [batchDownloading, setBatchDownloading] = React.useState(false)
  const [batchProgress, setBatchProgress] = React.useState<{ current: number; total: number } | null>(null)

  const playlist = React.useMemo(() => findPlaylist(snapshot, listId), [snapshot, listId])

  // 试听列表与收藏是内置列表，不能整体删除曲目（收藏另有语义）；用户歌单可移除
  const canRemove = listId !== LIST_DEFAULT_ID && listId !== LIST_LOVE_ID

  const totalSeconds = React.useMemo(
    () => (playlist?.songs ?? []).reduce((acc, s) => acc + intervalToSeconds(s.interval), 0),
    [playlist],
  )

  const handleDownloadAll = React.useCallback(async () => {
    if (!playlist || !playlist.songs.length || batchDownloading) return
    setBatchDownloading(true)
    setBatchProgress({ current: 0, total: playlist.songs.length })
    toast({
      title: `开始下载歌单《${playlist.name}》`,
      description: `准备依次下载全部 ${playlist.songs.length} 首歌曲并注入标签...`,
    })
    try {
      const result = await downloadSongsQueue(playlist.songs, {
        onProgress: (p) => {
          setBatchProgress({ current: p.current, total: p.total })
        },
      })
      toast({
        title: `歌单《${playlist.name}》下载完成`,
        description: `成功：${result.success} 首${result.failed > 0 ? ` · 失败：${result.failed} 首` : ''}`,
        variant: result.failed > 0 ? 'default' : 'success',
      })
    } catch (err: unknown) {
      toast({
        title: '批量下载中断',
        description: err instanceof Error ? err.message : '未知错误',
        variant: 'destructive',
      })
    } finally {
      setBatchDownloading(false)
      setBatchProgress(null)
    }
  }, [playlist, batchDownloading, toast, setBatchDownloading, setBatchProgress])

  const handleRemove = React.useCallback(
    async (songId: string, songName: string) => {
      if (!playlist) return
      setRemoving(songId)
      try {
        await removeSongsFromPlaylist(playlist.id, [songId])
        toast({ title: '已移除', description: songName })
        await reload(true)
      } catch (e) {
        toast({
          title: '移除失败',
          description: e instanceof Error ? e.message : '未知错误',
          variant: 'destructive',
        })
      } finally {
        setRemoving(null)
      }
    },
    [playlist, reload, toast],
  )

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-dim">
        <Loader2 className="size-4 animate-spin" /> 正在读取歌单…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-10 text-center">
        <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-panel2 text-danger">
          <TriangleAlert className="size-5" />
        </span>
        <p className="mt-3 text-sm font-medium text-ink">读不到歌单</p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-dim">{error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void reload()}>
          <RefreshCw className="size-3.5" /> 重试
        </Button>
      </div>
    )
  }

  if (!playlist) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-10 text-center">
        <p className="text-sm font-medium text-ink">找不到这个歌单</p>
        <p className="mt-1 text-xs text-dim">它可能已被删除。</p>
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link to={backTo}>返回歌单列表</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="w-full rise flex flex-col gap-6">
      {/* 返回上一级 */}
      <div>
        <Link
          to={backTo}
          className="inline-flex items-center gap-1.5 rounded-full border border-line/80 bg-panel px-3 py-1.5 text-xs font-medium text-dim transition-all hover:border-accent/40 hover:bg-accent-soft hover:text-accent shadow-2xs"
        >
          <ArrowLeft className="size-3.5" />
          <span>返回歌单库</span>
        </Link>
      </div>

      {/* 歌单主信息区：Apple Music 风格大画幅 */}
      <header className="flex flex-col gap-6 md:flex-row md:items-end rounded-3xl border border-line/80 bg-panel p-6 md:p-8 shadow-card">
        <ListCover songs={playlist.songs} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent mb-2">
            <span>官方歌单</span>
            <span>·</span>
            <span>{listId === LIST_LOVE_ID ? '特别收藏' : '自建珍藏'}</span>
          </div>
          <h1 className="truncate text-2xl md:text-3xl font-extrabold tracking-tight text-ink">
            {playlist.name}
          </h1>
          <p className="mt-2 text-sm text-dim flex items-center gap-2">
            <span className="font-semibold text-ink">{playlist.songs.length} 首歌曲</span>
            {totalSeconds > 0 && (
              <>
                <span className="text-faint">·</span>
                <span>总时长 {formatTotalDuration(totalSeconds)}</span>
              </>
            )}
            {listId === LIST_LOVE_ID && (
              <>
                <span className="text-faint">·</span>
                <span className="text-rose-500 font-medium">心动喜好</span>
              </>
            )}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              disabled={!playlist.songs.length}
              onClick={() => {
                player.playQueue(playlist.songs, 0)
                toast({ title: `开始播放「${playlist.name}」`, description: `共 ${playlist.songs.length} 首` })
              }}
              className="rounded-full px-6 font-semibold shadow-md shadow-accent/20 hover:scale-102 active:scale-95 transition-all"
            >
              <Play className="size-4 fill-current mr-1.5" /> 播放全部
            </Button>

            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                const shuffled = [...playlist.songs]
                for (let i = shuffled.length - 1; i > 0; i--) {
                  const j = Math.floor(Math.random() * (i + 1))
                  ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
                }
                player.playQueue(shuffled, 0)
              }}
              disabled={playlist.songs.length < 2}
              className="rounded-full px-5 font-medium border-line hover:border-line-strong hover:bg-panel-2"
            >
              <RefreshCw className="size-4 mr-1.5" /> 随机播放
            </Button>

            <Button
              variant="outline"
              size="lg"
              disabled={!playlist.songs.length || batchDownloading}
              onClick={handleDownloadAll}
              title={`下载本歌单全部 ${playlist.songs.length} 首歌`}
              className="rounded-full px-5 font-medium border-line hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
            >
              {batchDownloading ? (
                <>
                  <Loader2 className="size-4 animate-spin text-accent mr-1.5" />
                  <span>
                    下载中 {batchProgress ? `(${batchProgress.current}/${batchProgress.total})` : ''}
                  </span>
                </>
              ) : (
                <>
                  <Download className="size-4 mr-1.5" />
                  <span>下载全部</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </header>

      {/* 批量下载进度条通知 */}
      {batchDownloading && batchProgress && (
        <div className="rounded-2xl border border-accent/30 bg-accent-soft/70 p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-accent mb-2">
            <span className="flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" />
              <span>正在批量高速离线下载</span>
            </span>
            <span className="font-mono">
              {batchProgress.current} / {batchProgress.total} (
              {Math.round((batchProgress.current / batchProgress.total) * 100)}%)
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent to-indigo-500 transition-all duration-300"
              style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* 曲目明细列表 */}
      <section className="rounded-3xl border border-line/80 bg-panel p-5 md:p-6 shadow-card">
        {playlist.songs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-panel-2/50 p-12 text-center">
            <p className="text-sm font-semibold text-ink">这个歌单还是空的</p>
            <p className="mt-1 text-xs text-dim">
              去 <Link to="/search" className="text-accent hover:underline font-medium">搜索</Link> 找歌，或从试听列表里收藏。
            </p>
          </div>
        ) : (
          <SongList
            songs={playlist.songs}
            onRemove={
              canRemove
                ? (song, i) => {
                    const id = String(song.id ?? `${song.source}-${song.name}-${i}`)
                    if (removing) return
                    void handleRemove(id, song.name)
                  }
                : undefined
            }
          />
        )}
      </section>

      {canRemove && playlist.songs.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-faint px-2">
          <Trash2 className="size-3.5" /> 提示：悬停曲目行右侧可移除单曲
        </p>
      )}
    </div>
  )
}
