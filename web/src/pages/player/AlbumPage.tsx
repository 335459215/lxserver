import * as React from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Disc3, Play, TriangleAlert } from 'lucide-react'
import { Button, Stack, useToast } from '@/components/ui'
import { coverUrl, sourceLabel } from '@/lib/music'
import { firstSingerName, supportsArtistPages, useAlbumSongs } from '@/lib/discover'
import { usePlayer } from '@/lib/player'
import SongList from '@/components/player/SongList'

/** 专辑详情页（`/album/:id?source=`）。
 *
 *  数据源：`albumSongs` → `{ name, publishTime, total, list }`。
 *  接口本身不返回专辑封面与歌手，用首曲的 `img` / `singer` 兜底（同一张专辑内一致）。
 *  **同样只有网易云与 QQ音乐支持**，其余平台给降级提示。 */
export default function AlbumPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const source = params.get('source') ?? 'wy'
  const navigate = useNavigate()
  const player = usePlayer()
  const { toast } = useToast()

  const supported = supportsArtistPages(source)
  const album = useAlbumSongs(source, supported ? id : '')

  const songs = React.useMemo(() => album.data?.list ?? [], [album.data])
  const first = songs[0]
  const cover = coverUrl(first)
  const singer = first?.singer
  const singerQuery = firstSingerName(singer)

  const playAll = React.useCallback(() => {
    if (!songs.length) return
    player.playQueue(songs, 0)
    toast({ title: `开始播放《${album.data?.name ?? '专辑'}》`, description: `${songs.length} 首` })
  }, [songs, player, toast, album.data?.name])

  if (!supported) {
    return (
      <Stack gap={5} className="w-full rise">
        <BackLink onClick={() => navigate(-1)} />
        <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-10 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-panel2 text-faint">
            <Disc3 className="size-5" />
          </span>
          <p className="mt-3 text-sm font-medium text-ink">该平台暂不支持专辑页</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-dim">
            「{sourceLabel(source)}」没有提供专辑曲目接口。换到网易云或 QQ音乐 打开同一张专辑即可。
          </p>
        </div>
      </Stack>
    )
  }

  return (
    <Stack gap={6} className="w-full rise">
      <BackLink onClick={() => navigate(-1)} />

      {/* Hero */}
      <section className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <div className="size-36 shrink-0 overflow-hidden rounded-2xl border border-line bg-panel2 shadow-card sm:size-44">
          {cover ? (
            <img src={cover} alt={album.data?.name ?? '专辑封面'} className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-faint">
              <Disc3 className="size-10" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs text-faint">专辑 · {sourceLabel(source)}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            {album.data?.name || (album.status === 'loading' ? '加载中…' : '未知专辑')}
          </h1>

          {singer && (
            <p className="mt-2 text-sm text-dim">
              {singerQuery ? (
                <Link
                  to={`/search?q=${encodeURIComponent(singerQuery)}&source=${encodeURIComponent(
                    source,
                  )}&type=singer`}
                  className="transition-colors hover:text-accent hover:underline"
                >
                  {singer}
                </Link>
              ) : (
                singer
              )}
            </p>
          )}

          <p className="mt-1 text-xs text-faint">
            {[album.data?.publishTime, songs.length ? `${songs.length} 首` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>

          <div className="mt-4">
            <Button onClick={playAll} disabled={!songs.length}>
              <Play className="size-4 fill-current" /> 播放全部
            </Button>
          </div>
        </div>
      </section>

      {album.status === 'loading' && (
        <ul className="space-y-1" aria-busy="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
              <span className="h-3 w-6 rounded bg-panel2" />
              <span className="size-10 shrink-0 rounded-lg bg-panel2" />
              <span className="flex-1 space-y-1.5">
                <span className="block h-3 w-1/3 rounded bg-panel2" />
                <span className="block h-2.5 w-1/4 rounded bg-panel2" />
              </span>
            </li>
          ))}
        </ul>
      )}

      {album.status === 'error' && (
        <div className="rounded-2xl border border-dashed border-danger/40 bg-danger/5 p-6 text-center">
          <span className="mx-auto flex size-9 items-center justify-center rounded-xl bg-panel2 text-danger">
            <TriangleAlert className="size-4" />
          </span>
          <p className="mt-2 text-sm font-medium text-ink">专辑加载失败</p>
          <p className="mx-auto mt-1 max-w-md break-words text-xs text-dim">{album.error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={album.reload}>
            重试
          </Button>
        </div>
      )}

      {album.status === 'ready' && songs.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-8 text-center text-sm text-dim">
          这张专辑没有可用曲目。
        </div>
      )}

      {album.status === 'ready' && songs.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-ink">曲目</h2>
            <p className="text-xs text-faint">共 {songs.length} 首</p>
          </div>
          {/* linkAlbum=false：整页就是这张专辑；歌手链接保留 */}
          <SongList songs={songs} linkAlbum={false} onPlay={(_song, i) => player.playQueue(songs, i)} />
        </section>
      )}
    </Stack>
  )
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-fit items-center gap-1.5 text-xs text-dim transition-colors hover:text-ink"
    >
      <ArrowLeft className="size-3.5" /> 返回
    </button>
  )
}
