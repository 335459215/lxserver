import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2, Play, RefreshCw, TriangleAlert, Trophy } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { MUSIC_SOURCES, formatTotalDuration, intervalToSeconds } from '@/lib/music'
import { useLeaderboardBoards, useLeaderboardSongs } from '@/lib/discover'
import { usePlayer } from '@/lib/player'
import SongList from '@/components/player/SongList'
import { cn } from '@/lib/utils'

/** 排行榜：左选榜、右看曲，整榜可播。
 *  布局参考 Spotify/Apple Music 的「导航列 + 内容列」，宽屏不再浪费横向空间。 */
export default function LeaderboardPage() {
  const player = usePlayer()
  const { toast } = useToast()

  const [source, setSource] = React.useState<string>('kw')
  /** 用户手动选过的榜单；换平台后若失效则自动回到第一个榜 */
  const [pickedBangid, setPickedBangid] = React.useState<string | null>(null)

  // 支持 /leaderboard?source=yy&bangid=zz —— 首页的榜单卡直接深链过来
  const [params] = useSearchParams()
  React.useEffect(() => {
    const s = params.get('source')
    const b = params.get('bangid')
    if (!s && !b) return
    // 同上：响应 URL 变化，非渲染期派生
    /* eslint-disable react-hooks/set-state-in-effect */
    if (s) setSource(s)
    if (b) setPickedBangid(b)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [params])

  const boardsRes = useLeaderboardBoards(source)
  const boards = boardsRes.data ?? []

  // 派生选中项，避免用 effect 同步（换平台时 pickedBangid 可能已不属于新平台）
  const bangid =
    pickedBangid && boards.some((b) => b.bangid === pickedBangid)
      ? pickedBangid
      : (boards[0]?.bangid ?? null)
  const boardName = boards.find((b) => b.bangid === bangid)?.name ?? ''

  const songsRes = useLeaderboardSongs(source, bangid)
  // 缓存住引用：`data?.list ?? []` 每次渲染都会新建数组，会让下面的 useMemo 失效
  const songs = React.useMemo(() => songsRes.data?.list ?? [], [songsRes.data])
  const totalSeconds = React.useMemo(
    () => songs.reduce((acc, s) => acc + intervalToSeconds(s.interval), 0),
    [songs],
  )

  const playAll = () => {
    if (!songs.length) return
    player.playQueue(songs, 0)
    toast({ title: `开始播放「${boardName}」`, description: `${songs.length} 首` })
  }

  return (
    <div className="rise flex w-full flex-col gap-5">
      {/* 页头：标题与平台切换同一行，省一层高度 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">排行榜</h1>
          <p className="mt-0.5 text-sm text-dim">五平台榜单，选一个榜直接听。</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {MUSIC_SOURCES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSource(s.key)}
              aria-pressed={source === s.key}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                source === s.key
                  ? 'border-accent bg-accent text-white'
                  : 'border-line bg-panel text-dim hover:border-accent/40 hover:text-ink',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-6">
        {/* 榜单列表 */}
        <section className="lg:sticky lg:top-20 lg:self-start">
          <p className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-medium tracking-widest text-faint">
            <Trophy className="size-3.5" /> 榜单
          </p>

          {boardsRes.status === 'loading' && (
            <div className="space-y-1.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="block h-8 rounded-lg bg-panel2" />
              ))}
            </div>
          )}

          {boardsRes.status === 'error' && (
            <div className="rounded-xl border border-dashed border-danger/40 bg-danger/5 p-3 text-xs text-dim">
              <p className="flex items-center gap-1.5 text-ink">
                <TriangleAlert className="size-3.5 text-danger" /> 榜单加载失败
              </p>
              <p className="mt-1 break-words">{boardsRes.error}</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={boardsRes.reload}>
                <RefreshCw className="size-3" /> 重试
              </Button>
            </div>
          )}

          {boardsRes.status === 'ready' && boards.length === 0 && (
            <p className="px-1 text-xs text-faint">该平台暂无榜单。</p>
          )}

          {boards.length > 0 && (
            <ul className="flex gap-1.5 overflow-x-auto pb-1 lg:max-h-[calc(100vh-11rem)] lg:flex-col lg:overflow-y-auto lg:pb-0 lg:pr-1">
              {boards.map((b) => {
                const active = b.bangid === bangid
                return (
                  <li key={b.id} className="shrink-0 lg:shrink">
                    <button
                      type="button"
                      onClick={() => setPickedBangid(b.bangid)}
                      aria-current={active ? 'true' : undefined}
                      className={cn(
                        'w-full whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-sm transition-colors lg:whitespace-normal',
                        active
                          ? 'bg-accent-soft font-medium text-accent'
                          : 'text-dim hover:bg-panel2 hover:text-ink',
                      )}
                    >
                      {b.name}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* 曲目 */}
        <section className="min-w-0">
          {songsRes.status === 'loading' && (
            <ul className="space-y-1" aria-busy="true" aria-label="榜单加载中">
              {Array.from({ length: 10 }).map((_, i) => (
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

          {songsRes.status === 'error' && (
            <div className="rounded-2xl border border-dashed border-danger/40 bg-danger/5 p-8 text-center">
              <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-panel2 text-danger">
                <TriangleAlert className="size-5" />
              </span>
              <p className="mt-3 text-sm font-medium text-ink">榜单曲目加载失败</p>
              <p className="mx-auto mt-1 max-w-md break-words text-xs text-dim">{songsRes.error}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={songsRes.reload}>
                <RefreshCw className="size-3.5" /> 重试
              </Button>
            </div>
          )}

          {songsRes.status === 'ready' && songs.length > 0 && (
            <>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-dim">
                  <span className="font-medium text-ink">{boardName}</span>
                  <span className="text-faint">
                    {' '}
                    · {songs.length} 首
                    {totalSeconds > 0 ? ` · ${formatTotalDuration(totalSeconds)}` : ''}
                  </span>
                </p>
                <Button variant="outline" size="sm" onClick={playAll}>
                  <Play className="size-3.5 fill-current" /> 播放全部
                </Button>
              </div>
              <SongList songs={songs} />
            </>
          )}

          {songsRes.status === 'ready' && songs.length === 0 && (
            <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-10 text-center">
              <Loader2 className="mx-auto size-5 text-faint" />
              <p className="mt-2 text-sm text-dim">这个榜单暂时没有曲目</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
