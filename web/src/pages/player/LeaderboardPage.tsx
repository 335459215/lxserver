import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2, Play, RefreshCw, TriangleAlert, Trophy, Layers } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { formatTotalDuration, intervalToSeconds } from '@/lib/music'
import {
  useAggregatedLeaderboardBoards,
  useAggregatedLeaderboardSongs,
} from '@/lib/discover'
import { usePlayer } from '@/lib/player'
import SongList from '@/components/player/SongList'
import { cn } from '@/lib/utils'

/** 排行榜：全网聚合、不分平台，左选榜、右看曲，整榜可播。
 *  榜单名直接显示纯榜单名，自动聚合主流多平台热门曲目。 */
export default function LeaderboardPage() {
  const player = usePlayer()
  const { toast } = useToast()

  // 支持 /leaderboard?name=飙升榜
  const [params] = useSearchParams()
  const nameParam = params.get('name')
  const [pickedName, setPickedName] = React.useState<string | null>(null)

  const boardsRes = useAggregatedLeaderboardBoards()
  const boards = React.useMemo(() => boardsRes.data ?? [], [boardsRes.data])

  // 派生当前选中的聚合榜单
  const currentBoard = React.useMemo(() => {
    const targetName = pickedName ?? nameParam
    if (targetName) {
      const match = boards.find((b) => b.name === targetName)
      if (match) return match
    }
    return boards[0] ?? null
  }, [boards, pickedName, nameParam])

  const boardName = currentBoard?.name ?? ''

  const songsRes = useAggregatedLeaderboardSongs(currentBoard?.targets)
  const songs = React.useMemo(() => songsRes.data?.list ?? [], [songsRes.data])
  const totalSeconds = React.useMemo(
    () => songs.reduce((acc, s) => acc + intervalToSeconds(s.interval), 0),
    [songs],
  )

  const playAll = () => {
    if (!songs.length) return
    player.playQueue(songs, 0)
    toast({ title: `开始播放「${boardName}」`, description: `全网聚合 ${songs.length} 首` })
  }

  return (
    <div className="rise flex w-full flex-col gap-5">
      {/* 页头：极简清爽，全网聚合 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink flex items-center gap-2">
            <span>排行榜</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-600">
              <Layers className="size-3" />
              全网聚合
            </span>
          </h1>
          <p className="mt-0.5 text-sm text-dim">汇聚全网多平台官方权威热度，不分平台直接畅听。</p>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-6">
        {/* 榜单列表：纯榜单名，不加平台名 */}
        <section className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <p className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-medium tracking-widest text-faint">
            <Trophy className="size-3.5" /> 聚合榜单
          </p>

          {boardsRes.status === 'loading' && (
            <div className="space-y-1.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <span key={i} className="block h-8 rounded-lg bg-panel2 animate-pulse" />
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
            <p className="px-1 text-xs text-faint">暂无榜单数据。</p>
          )}

          {boards.length > 0 && (
            <ul className="flex gap-1.5 overflow-x-auto pb-1 lg:max-h-[calc(100vh-11rem)] lg:flex-col lg:overflow-y-auto lg:pb-0 lg:pr-1">
              {boards.map((b) => {
                const active = b.name === boardName
                return (
                  <li key={b.id} className="shrink-0 lg:shrink">
                    <button
                      type="button"
                      onClick={() => setPickedName(b.name)}
                      aria-current={active ? 'true' : undefined}
                      className={cn(
                        'w-full whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-sm transition-colors lg:whitespace-normal font-medium',
                        active
                          ? 'bg-accent-soft text-accent shadow-xs'
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

        {/* 聚合曲目列表 */}
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
                  <span className="font-bold text-ink">{boardName}</span>
                  <span className="text-faint">
                    {' '}
                    · 全网聚合 · {songs.length} 首
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
              <p className="mt-2 text-sm text-dim">这个聚合榜单暂时没有曲目</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
