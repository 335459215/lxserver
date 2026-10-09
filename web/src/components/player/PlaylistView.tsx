import * as React from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2, ListMusic, Play, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { coverUrl, formatTotalDuration, intervalToSeconds } from '@/lib/music'
import { usePlayer } from '@/lib/player'
import {
  findPlaylist,
  LIST_DEFAULT_ID,
  LIST_LOVE_ID,
  removeSongsFromPlaylist,
  type Playlist,
} from '@/lib/lists'
import { useLists } from '@/lib/useLists'
import SongList from '@/components/player/SongList'

/** 歌单封面：取第一首有封面的曲目 */
function ListCover({ songs, size = 'lg' }: { songs: Playlist['songs']; size?: 'sm' | 'lg' }) {
  const cover = songs.map((s) => coverUrl(s)).find(Boolean)
  const cls = size === 'lg' ? 'size-28 md:size-32' : 'size-12'

  if (cover) {
    return (
      <img
        src={cover}
        alt=""
        className={`${cls} shrink-0 rounded-2xl border border-line object-cover shadow-card`}
      />
    )
  }
  return (
    <span
      className={`${cls} flex shrink-0 items-center justify-center rounded-2xl border border-line bg-panel2 text-faint shadow-card`}
    >
      <ListMusic className={size === 'lg' ? 'size-8' : 'size-5'} />
    </span>
  )
}

/** 单条歌单详情视图：被 /app/playlist/:id 与 /app/favorites 共用。
 *  listId 为 'default' / 'love' / 用户歌单 id。 */
export default function PlaylistView({ listId, backTo = '/playlist' }: { listId: string; backTo?: string }) {
  const player = usePlayer()
  const { toast } = useToast()
  const { snapshot, loading, error, reload } = useLists()
  const [removing, setRemoving] = React.useState<string | null>(null)

  const playlist = React.useMemo(() => findPlaylist(snapshot, listId), [snapshot, listId])

  // 试听列表与收藏是内置列表，不能整体删除曲目（收藏另有语义）；用户歌单可移除
  const canRemove = listId !== LIST_DEFAULT_ID && listId !== LIST_LOVE_ID

  const totalSeconds = React.useMemo(
    () => (playlist?.songs ?? []).reduce((acc, s) => acc + intervalToSeconds(s.interval), 0),
    [playlist],
  )

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
    <div className="w-full rise">
      <Link to={backTo} className="inline-flex w-fit items-center gap-1 text-xs text-dim hover:text-ink">
        <ArrowLeft className="size-3.5" /> 返回歌单
      </Link>

      <header className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end">
        <ListCover songs={playlist.songs} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">{playlist.name}</h1>
          <p className="mt-1 text-sm text-dim">
            {playlist.songs.length} 首
            {totalSeconds > 0 && ` · ${formatTotalDuration(totalSeconds)}`}
            {listId === LIST_LOVE_ID && ' · 你喜欢的歌'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              disabled={!playlist.songs.length}
              onClick={() => {
                player.playQueue(playlist.songs, 0)
                toast({ title: `开始播放「${playlist.name}」`, description: `共 ${playlist.songs.length} 首` })
              }}
            >
              <Play className="size-4 fill-current" /> 播放全部
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                // 打乱顺序后播放
                const shuffled = [...playlist.songs]
                for (let i = shuffled.length - 1; i > 0; i--) {
                  const j = Math.floor(Math.random() * (i + 1))
                  ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
                }
                player.playQueue(shuffled, 0)
              }}
              disabled={playlist.songs.length < 2}
            >
              <RefreshCw className="size-3.5" /> 随机播放
            </Button>
          </div>
        </div>
      </header>

      <section className="mt-6">
        {playlist.songs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-10 text-center">
            <p className="text-sm font-medium text-ink">这个歌单还是空的</p>
            <p className="mt-1 text-xs text-dim">
              去 <Link to="/search" className="text-accent hover:underline">搜索</Link> 找歌，或从试听列表里收藏。
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
        <p className="mt-3 flex items-center gap-1.5 text-xs text-faint">
          <Trash2 className="size-3.5" /> 悬停曲目行可移除单曲
        </p>
      )}
    </div>
  )
}
