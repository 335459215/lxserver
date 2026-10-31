import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Download,
  Loader2,
  ListMusic,
  Pencil,
  Play,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  useToast,
} from '@/components/ui'
import { formatTotalDuration, intervalToSeconds } from '@/lib/music'
import { usePlayer } from '@/lib/player'
import { downloadSongsQueue } from '@/lib/download'
import {
  deletePlaylist,
  findPlaylist,
  LIST_DEFAULT_ID,
  LIST_LOVE_ID,
  playlistCoverUrl,
  removeSongsFromPlaylist,
  renamePlaylist,
  type Playlist,
} from '@/lib/lists'
import { useLists } from '@/lib/useLists'
import SongList from '@/components/player/SongList'

/** 歌单封面：优先随机取一首带封面的曲目（每次进页面换一张，便于区分歌单），
 *  带高保真柔和光晕。整个歌单都没封面时画占位图 —— 绝不留白。 */
function ListCover({ songs, size = 'lg' }: { songs: Playlist['songs']; size?: 'sm' | 'lg' }) {
  // 随机封面只在 songs 变化时重算，避免每次渲染都换图闪烁
  const cover = React.useMemo(() => playlistCoverUrl(songs), [songs])
  // 记录**加载失败的那个地址**而不是布尔值：换歌单/换封面时自然重置，
  // 不需要 useEffect 里 setState（本项目 lint 把 set-state-in-effect 设为 error）。
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null)
  const shown = cover && cover !== failedSrc ? cover : undefined
  const cls = size === 'lg' ? 'size-32 md:size-44' : 'size-12'

  return (
    <div className="relative shrink-0 group">
      {shown && size === 'lg' && (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-3 rounded-3xl opacity-40 blur-xl saturate-200 transition-opacity"
          style={{
            backgroundImage: `url(${shown})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      )}
      {shown ? (
        <img
          src={shown}
          alt=""
          // 上游 CDN 偶尔 404 或拒绝 https：退回占位，不留裂图
          onError={() => setFailedSrc(shown)}
          className={`${cls} relative z-10 shrink-0 rounded-2xl md:rounded-3xl border border-white/80 object-cover shadow-lg transition-transform duration-300 group-hover:scale-102`}
        />
      ) : (
        <div
          className={`${cls} relative z-10 flex shrink-0 items-center justify-center rounded-2xl md:rounded-3xl border border-line/80 bg-gradient-to-tr from-indigo-50 via-purple-50 to-pink-50 text-accent shadow-sm`}
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
  const navigate = useNavigate()
  const { snapshot, loading, error, reload } = useLists()
  const [removing, setRemoving] = React.useState<string | null>(null)
  const [batchDownloading, setBatchDownloading] = React.useState(false)
  const [batchProgress, setBatchProgress] = React.useState<{ current: number; total: number } | null>(null)
  const [renaming, setRenaming] = React.useState(false)
  const [nameDraft, setNameDraft] = React.useState('')
  const [renameBusy, setRenameBusy] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleteBusy, setDeleteBusy] = React.useState(false)

  const playlist = React.useMemo(() => findPlaylist(snapshot, listId), [snapshot, listId])

  // 试听列表与收藏是内置列表：既不能整体删除，也不能改名（服务端 restore 会重建它们）。
  // 只有用户自建歌单才给「重命名 / 删除歌单」入口。
  const canRemove = listId !== LIST_DEFAULT_ID && listId !== LIST_LOVE_ID

  const handleRename = React.useCallback(async () => {
    const trimmed = nameDraft.trim()
    if (!playlist || !trimmed || renameBusy) return
    if (trimmed === playlist.name) {
      setRenaming(false)
      return
    }
    setRenameBusy(true)
    try {
      await renamePlaylist(playlist.id, trimmed)
      toast({ title: '已重命名', description: `「${playlist.name}」→「${trimmed}」`, variant: 'success' })
      setRenaming(false)
      await reload(true)
    } catch (e) {
      toast({
        title: '重命名失败',
        description: e instanceof Error ? e.message : '未知错误',
        variant: 'destructive',
      })
    } finally {
      setRenameBusy(false)
    }
  }, [playlist, nameDraft, renameBusy, toast, reload])

  const handleDelete = React.useCallback(async () => {
    if (!playlist || deleteBusy) return
    setDeleteBusy(true)
    try {
      await deletePlaylist(playlist.id)
      toast({ title: '歌单已删除', description: playlist.name, variant: 'success' })
      setDeleteOpen(false)
      // 歌单没了，详情页会变成「找不到这个歌单」，直接回歌单库更顺
      navigate(backTo)
    } catch (e) {
      toast({
        title: '删除失败',
        description: e instanceof Error ? e.message : '未知错误',
        variant: 'destructive',
      })
    } finally {
      setDeleteBusy(false)
    }
  }, [playlist, deleteBusy, toast, navigate, backTo])

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

      {/* 歌单主信息区。
          布局按用户要求定：**封面在左，三个操作按钮在封面右侧竖向排列，
          名称/歌曲数/总时长放在封面下方**。
          上一版是「封面 + 右侧一大段文字（官方歌单 · 自建珍藏 / 标题 / 元信息 / 按钮）」，
          文字里那句「官方歌单 · 自建珍藏」纯属装饰（所有自建歌单都长这样，
          不携带任何信息），已按要求删掉；按钮也挪到封面旁边，让封面下方只剩
          用户真正要看的三样东西。 */}
      <header className="rounded-3xl border border-line/80 bg-panel p-6 md:p-8 shadow-card">
        <div className="flex items-start gap-5">
          <ListCover songs={playlist.songs} />

          {/* 三个按钮：竖向排列在封面右侧 */}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Button
              size="lg"
              disabled={!playlist.songs.length}
              onClick={() => {
                player.playQueue(playlist.songs, 0)
                toast({ title: `开始播放「${playlist.name}」`, description: `共 ${playlist.songs.length} 首` })
              }}
              className="w-full justify-center rounded-full px-5 font-semibold shadow-md shadow-accent/20 transition-all hover:scale-102 active:scale-95"
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
              className="w-full justify-center rounded-full px-5 font-medium border-line hover:border-line-strong hover:bg-panel-2"
            >
              <RefreshCw className="size-4 mr-1.5" /> 随机播放
            </Button>

            <Button
              variant="outline"
              size="lg"
              disabled={!playlist.songs.length || batchDownloading}
              onClick={handleDownloadAll}
              title={`下载本歌单全部 ${playlist.songs.length} 首歌`}
              className="w-full justify-center rounded-full px-5 font-medium border-line hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
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

            {/* 自建歌单才给「重命名 / 删除」——内置的试听列表、我的收藏由服务端重建，
                改了也存不住，放出来只会让人困惑。 */}
            {canRemove && (
              <div className="mt-1 flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setNameDraft(playlist.name)
                    setRenaming(true)
                  }}
                  className="flex-1 justify-center rounded-full text-dim hover:text-accent"
                >
                  <Pencil className="size-3.5 mr-1.5" /> 重命名
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteOpen(true)}
                  className="flex-1 justify-center rounded-full text-dim hover:text-danger"
                >
                  <Trash2 className="size-3.5 mr-1.5" /> 删除歌单
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* 封面下方：只留歌单名称 + 歌曲数量 + 总时长 */}
        <div className="mt-4 min-w-0">
          {renaming ? (
            <div className="flex items-center gap-2">
              <Input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                autoFocus
                maxLength={60}
                placeholder="歌单名"
                className="max-w-md text-lg font-semibold"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleRename()
                  if (e.key === 'Escape') setRenaming(false)
                }}
              />
              <Button size="sm" onClick={() => void handleRename()} disabled={renameBusy || !nameDraft.trim()}>
                {renameBusy ? '保存中…' : '保存'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRenaming(false)} disabled={renameBusy}>
                取消
              </Button>
            </div>
          ) : (
            <h1 className="truncate text-2xl md:text-3xl font-extrabold tracking-tight text-ink">
              {playlist.name}
            </h1>
          )}
          <p className="mt-2 text-sm text-dim flex items-center gap-2">
            <span className="font-semibold text-ink">{playlist.songs.length} 首歌曲</span>
            {totalSeconds > 0 && (
              <>
                <span className="text-faint">·</span>
                <span>总时长 {formatTotalDuration(totalSeconds)}</span>
              </>
            )}
          </p>
        </div>
      </header>

      {/* 删除歌单二次确认：歌单连同曲目一起删除，且服务端只保 10 张快照，
          误删后不一定还能恢复 —— 必须让人看清楚再点。 */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除歌单「{playlist.name}」？</DialogTitle>
            <DialogDescription>
              将连同其中 {playlist.songs.length} 首歌曲一起删除，此操作不可撤销。
              歌单只是收藏关系的集合，**不会删掉你本地的音乐文件**。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button" disabled={deleteBusy}>
                取消
              </Button>
            </DialogClose>
            <Button
              onClick={() => void handleDelete()}
              disabled={deleteBusy}
              className="bg-danger text-white hover:bg-danger/90"
            >
              {deleteBusy ? '删除中…' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              去 <Link to="/search" className="link-inline text-accent hover:underline font-medium">搜索</Link> 找歌，或从试听列表里收藏。
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
