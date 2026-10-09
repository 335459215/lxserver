import * as React from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Disc3, Play, TriangleAlert, UserRound } from 'lucide-react'
import { Button, Stack, useToast } from '@/components/ui'
import { sourceLabel } from '@/lib/music'
import {
  ARTIST_SOURCES,
  supportsArtistPages,
  useArtistAlbums,
  useArtistDetail,
  useArtistSongs,
} from '@/lib/discover'
import { usePlayer } from '@/lib/player'
import SongList from '@/components/player/SongList'

/** 每次「显示更多」追加的曲目数。头部歌手（如 QQ 音乐的周杰伦 1000+ 首）必须增量渲染，
 *  否则一次挂上千个 DOM 行会明显卡顿。 */
const PAGE_STEP = 50

/** 歌手详情页（`/artist/:id?source=`）。
 *
 *  数据源：`artistDetail` / `artistSongs` / `artistAlbums`。
 *  **只有网易云与 QQ音乐支持这三个接口**（其余平台 500），故先用 supportsArtistPages 判断，
 *  不支持的平台给明确提示而不是抛错。
 *
 *  「播放热门歌曲」按当前排序播全部，「播放全部」同义 —— 保留两个入口是因为
 *  热门排序下用户预期是「先听最热的」，与全量播放的语义不同，文案上区分更清楚。 */
export default function ArtistPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const source = params.get('source') ?? 'wy'
  const navigate = useNavigate()
  const player = usePlayer()
  const { toast } = useToast()

  const [order, setOrder] = React.useState<'hot' | 'time'>('hot')
  const [visible, setVisible] = React.useState(PAGE_STEP)
  const [descOpen, setDescOpen] = React.useState(false)

  const supported = supportsArtistPages(source)
  // 不支持的平台把 id 置空 → 三个 hook 全部停在 idle，不发请求
  const aid = supported ? id : ''

  const detail = useArtistDetail(source, aid)
  const songs = useArtistSongs(source, aid, order)
  const albums = useArtistAlbums(source, aid)

  const allSongs = songs.data ?? []
  const shown = allSongs.slice(0, visible)

  const play = React.useCallback(
    (from: number, label: string) => {
      if (!allSongs.length) return
      player.playQueue(allSongs, from)
      toast({ title: label, description: detail.data?.name })
    },
    [allSongs, player, toast, detail.data?.name],
  )

  if (!supported) {
    return (
      <Stack gap={5} className="w-full rise">
        <BackLink onClick={() => navigate(-1)} />
        <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-10 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-panel2 text-faint">
            <UserRound className="size-5" />
          </span>
          <p className="mt-3 text-sm font-medium text-ink">该平台暂不支持歌手页</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-dim">
            「{sourceLabel(source)}」没有提供歌手详情接口。换到网易云或 QQ音乐 打开同一个歌手即可。
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={`/search?q=${encodeURIComponent(detail.data?.name ?? '')}&source=wy&type=singer`}>
                去网易云找这位歌手
              </Link>
            </Button>
          </div>
        </div>
      </Stack>
    )
  }

  return (
    <Stack gap={6} className="w-full rise">
      <BackLink onClick={() => navigate(-1)} />

      {/* Hero */}
      <section className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <div className="size-28 shrink-0 overflow-hidden rounded-full border border-line bg-panel2 sm:size-36">
          {detail.data?.avatar ? (
            <img
              src={detail.data.avatar}
              alt={detail.data.name}
              className="size-full object-cover"
            />
          ) : (
            <span className="flex size-full items-center justify-center text-faint">
              <UserRound className="size-10" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs text-faint">歌手 · {sourceLabel(source)}</p>
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight text-ink">
            {detail.data?.name ?? (detail.status === 'loading' ? '加载中…' : '未知歌手')}
          </h1>
          {detail.data && (
            <p className="mt-2 text-xs text-dim">
              {detail.data.musicSize ?? allSongs.length} 首歌曲
              {detail.data.albumSize ? ` · ${detail.data.albumSize} 张专辑` : ''}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => play(0, '开始播放')} disabled={!allSongs.length}>
              <Play className="size-4 fill-current" /> 播放全部
            </Button>
          </div>
        </div>
      </section>

      {/* 简介 */}
      {detail.data?.desc && (
        <section className="rounded-2xl border border-line bg-panel p-5 shadow-card">
          <h2 className="text-sm font-medium text-ink">歌手简介</h2>
          <p
            className={
              descOpen
                ? 'mt-2 whitespace-pre-line text-xs leading-relaxed text-dim'
                : 'mt-2 line-clamp-3 whitespace-pre-line text-xs leading-relaxed text-dim'
            }
          >
            {detail.data.desc}
          </p>
          {detail.data.desc.length > 120 && (
            <button
              type="button"
              onClick={() => setDescOpen((v) => !v)}
              className="mt-2 text-xs text-accent transition-colors hover:text-accent-hover"
            >
              {descOpen ? '收起' : '展开'}
            </button>
          )}
        </section>
      )}

      {/* 简介区块已在上方按「有 desc 才渲染」自动降级，这里只在实际拿不到时提示。
          各接口是独立降级的：实测曾出现 artistDetail 单独 500 而 artistSongs/artistAlbums
          正常的情况，所以不要用 detail 的状态去代表整个页面。 */}
      {detail.status === 'error' && (songs.status === 'ready' || albums.status === 'ready') && (
        <p className="rounded-xl border border-line bg-panel/60 px-4 py-2 text-xs text-dim">
          歌手简介暂时取不到（{detail.error}），歌曲与专辑不受影响。
        </p>
      )}

      {songs.status === 'error' && (
        <ArtistFallback error={songs.error} source={source} name={detail.data?.name ?? ''} onRetry={songs.reload} />
      )}

      {/* 歌曲 */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium text-ink">歌曲</h2>
            <div className="flex rounded-lg border border-line p-0.5">
              {(
                [
                  ['hot', '最热'],
                  ['time', '最新'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={order === key}
                  onClick={() => {
                    setOrder(key)
                    setVisible(PAGE_STEP)
                  }}
                  className={
                    order === key
                      ? 'rounded-md bg-accent px-2.5 py-1 text-xs text-white'
                      : 'rounded-md px-2.5 py-1 text-xs text-dim transition-colors hover:text-ink'
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {songs.status === 'ready' && (
            <p className="text-xs text-faint">
              共 {allSongs.length} 首
              {allSongs.length > visible ? `，已显示 ${visible} 首` : ''}
            </p>
          )}
        </div>

        {songs.status === 'loading' && <RowsSkeleton />}
        {songs.status === 'ready' && allSongs.length === 0 && (
          <EmptyBox text="这位歌手暂无可用曲目。" />
        )}
        {songs.status === 'ready' && allSongs.length > 0 && (
          <>
            {/* linkSinger=false：整页就是这个歌手，再链回自己没意义；专辑链接保留 */}
            <SongList
              songs={shown}
              linkSinger={false}
              onPlay={(_song, i) => player.playQueue(allSongs, i)}
            />
            {allSongs.length > visible && (
              <div className="mt-3 flex justify-center">
                <Button variant="outline" size="sm" onClick={() => setVisible((v) => v + PAGE_STEP)}>
                  显示更多（还有 {allSongs.length - visible} 首）
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      {/* 专辑 */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-ink">
          专辑
          {albums.status === 'ready' && albums.data && albums.data.total > 0 && (
            <span className="ml-2 text-xs font-normal text-faint">{albums.data.total} 张</span>
          )}
        </h2>
        {albums.status === 'loading' && <RowsSkeleton count={5} />}
        {albums.status === 'error' && <ErrorPanel message={albums.error} onRetry={albums.reload} />}
        {albums.status === 'ready' && (albums.data?.list.length ?? 0) === 0 && (
          <EmptyBox text="暂无专辑信息。" />
        )}
        {albums.status === 'ready' && (albums.data?.list.length ?? 0) > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {albums.data!.list.map((a) => (
              <li key={String(a.id)}>
                <Link
                  to={`/album/${a.id}?source=${encodeURIComponent(source)}`}
                  className="group block rounded-2xl p-2 transition-colors hover:bg-panel2"
                >
                  <span className="relative block aspect-square overflow-hidden rounded-xl border border-line bg-panel2">
                    {a.img ? (
                      <img
                        src={a.img}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                      />
                    ) : (
                      <span className="flex size-full items-center justify-center text-faint">
                        <Disc3 className="size-6" />
                      </span>
                    )}
                  </span>
                  <span className="mt-2 block truncate text-sm text-ink" title={a.name}>
                    {a.name}
                  </span>
                  <span className="block truncate text-xs text-faint">
                    {[a.publishTime, a.total ? `${a.total} 首` : null].filter(Boolean).join(' · ')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
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

function RowsSkeleton({ count = 8 }: { count?: number }) {
  return (
    <ul className="space-y-1" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
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
  )
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-8 text-center text-sm text-dim">
      {text}
    </div>
  )
}

function ErrorPanel({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-danger/40 bg-danger/5 p-6 text-center">
      <span className="mx-auto flex size-9 items-center justify-center rounded-xl bg-panel2 text-danger">
        <TriangleAlert className="size-4" />
      </span>
      <p className="mt-2 text-sm font-medium text-ink">加载失败</p>
      <p className="mx-auto mt-1 max-w-md break-words text-xs text-dim">{message}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        重试
      </Button>
    </div>
  )
}

/** 歌手页加载失败时的兜底：除了重试，还给出**换平台**的出路。
 *
 *  必要性：网易云的歌手详情类接口（artistDetail / artistAlbums / artistSongs）会不定期
 *  被上游拒掉（返回 `Network Error` → 服务端 500），而此时同平台搜索、以及 QQ音乐的
 *  同名接口都还正常（2026-10-09 实测）。原来的错误面板只说「加载失败」，用户无从下手。 */
function ArtistFallback({
  error,
  source,
  name,
  onRetry,
}: {
  error: string | null
  source: string
  name: string
  onRetry: () => void
}) {
  const alt = ARTIST_SOURCES.find((s) => s !== source)
  return (
    <div className="rounded-2xl border border-dashed border-danger/40 bg-danger/5 p-6 text-center">
      <span className="mx-auto flex size-9 items-center justify-center rounded-xl bg-panel2 text-danger">
        <TriangleAlert className="size-4" />
      </span>
      <p className="mt-2 text-sm font-medium text-ink">歌手信息加载失败</p>
      <p className="mx-auto mt-1 max-w-md break-words text-xs text-dim">{error}</p>
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-faint">
        这类接口偶尔会被上游临时拒绝，稍后重试通常即可恢复；也可以换到另一个平台查找这位歌手。
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
        {alt && name && (
          <Button asChild variant="outline" size="sm">
            <Link to={`/artist-name/${encodeURIComponent(name)}?source=${alt}`}>
              换到{sourceLabel(alt)}找「{name}」
            </Link>
          </Button>
        )}
      </div>
    </div>
  )
}
