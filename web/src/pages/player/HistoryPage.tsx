import * as React from 'react'
import { History, Loader2, Play, TriangleAlert, Trash2 } from 'lucide-react'
import { Button, Stack, useToast } from '@/components/ui'
import { clearHistory, fetchHistory, historyToSong, type HistoryItem } from '@/lib/history'
import { useAsyncResource } from '@/lib/asyncResource'
import { usePlayer } from '@/lib/player'
import { useAuth } from '@/lib/auth'
import SongList from '@/components/player/SongList'

/** 播放历史（`/history`）：服务端按用户存最近听过的歌。
 *
 *  数据源是后端接口（不是 localStorage），所以换设备/换浏览器都能看到同一份历史。
 *  服务端按 `source|songmid` 去重：同一首歌重复播放只更新时间戳并置顶，
 *  因此这里是「最近听过什么」而不是「播放流水」。
 *
 *  取数用 `useAsyncResource`（项目通用异步资源钩子）：它把「key 变才重新请求」与
 *  loading/error 状态收敛在一处，避免在 effect 里同步 setState
 *  （那会触发 eslint 的 set-state-in-effect，本质是级联渲染）。
 *  key 传空串 = 条件不满足先不请求 —— 未登录时正是如此。 */

const PAGE_SIZE = 50

export default function HistoryPage() {
  const player = usePlayer()
  const { toast } = useToast()
  const { auth } = useAuth()

  // 历史是用户级数据：未登录时不发请求（key 空 → idle）
  const loggedIn = auth.user.ok

  const res = useAsyncResource<{ list: HistoryItem[]; total: number; hasMore: boolean }>(
    loggedIn ? 'history:first' : '',
    async () => {
      const page = await fetchHistory(1, PAGE_SIZE)
      return { list: page.list, total: page.total, hasMore: page.hasMore }
    },
  )

  // 追加分页是「用户主动触发的增量」，与首屏取数语义不同，用独立 state 管理
  const [extra, setExtra] = React.useState<HistoryItem[]>([])
  const [page, setPage] = React.useState(1)
  const [hasMore, setHasMore] = React.useState(false)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [total, setTotal] = React.useState(0)
  const [clearing, setClearing] = React.useState(false)

  const firstList = React.useMemo(() => res.data?.list ?? [], [res.data])

  // 首屏数据到位后用派生值表达 total/hasMore（不在 effect 里 setState）
  const effectiveTotal = extra.length ? total : res.data?.total ?? 0
  const effectiveHasMore = extra.length ? hasMore : res.data?.hasMore ?? false
  const items = React.useMemo(
    () => (extra.length ? [...firstList, ...extra] : firstList),
    [firstList, extra],
  )

  const songs = React.useMemo(() => items.map(historyToSong), [items])

  const loadMore = React.useCallback(async () => {
    if (loadingMore || !effectiveHasMore) return
    setLoadingMore(true)
    const next = page + 1
    try {
      const r2 = await fetchHistory(next, PAGE_SIZE)
      // 按 key 去重后再追加：翻页期间若有新播放插到最前，会导致页边界重叠
      setExtra((prev) => {
        const seen = new Set([...firstList, ...prev].map((x) => x.key))
        return [...prev, ...r2.list.filter((x) => !seen.has(x.key))]
      })
      setTotal(r2.total)
      setPage(next)
      setHasMore(r2.hasMore)
    } catch {
      // 追加失败不该把已拿到的结果弄丢，静默停止
      setHasMore(false)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, effectiveHasMore, page, firstList])

  const playAll = () => {
    if (!songs.length) return
    player.playQueue(songs, 0)
    toast({ title: `开始播放 ${songs.length} 首`, description: '播放历史' })
  }

  const onClear = async () => {
    if (clearing) return
    setClearing(true)
    try {
      await clearHistory()
      setExtra([])
      setTotal(0)
      setHasMore(false)
      // **必须一并重置 page**：否则清空后又产生新记录时，「加载更多」会从
      // 清空前那页的下一页开始请求（如清空前加载到第 3 页 → 清空后请求第 4 页），
      // 把第 2、3 页的数据永久跳过。这是一个真实的分页 off-by-one。
      setPage(1)
      res.reload()
      toast({ title: '已清空播放历史' })
    } catch (e) {
      toast({
        title: '清空失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setClearing(false)
    }
  }

  // 未登录：历史属于账号，必须登录才能看
  if (!loggedIn) {
    return (
      <Shell>
        <EmptyCard
          title="需要以用户身份登录"
          desc="播放历史属于登录账号，管理与查看都需要用户身份。管理员密码看不到它。"
          action={{ label: '去登录', href: '/app/settings/users' }}
        />
      </Shell>
    )
  }

  if (res.status === 'loading' || res.status === 'idle') {
    return (
      <Shell>
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
      </Shell>
    )
  }

  if (res.status === 'error') {
    return (
      <Shell>
        <div className="rounded-2xl border border-dashed border-danger/40 bg-danger/5 p-8 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-panel2 text-danger">
            <TriangleAlert className="size-5" />
          </span>
          <p className="mt-3 text-sm font-medium text-ink">读取播放历史失败</p>
          <p className="mx-auto mt-1 max-w-md break-words text-xs leading-relaxed text-dim">{res.error}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={res.reload}>
            重试
          </Button>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <Header
        count={effectiveTotal}
        onPlayAll={playAll}
        onClear={onClear}
        clearing={clearing}
        disabled={!songs.length}
      />

      {items.length === 0 ? (
        <EmptyCard
          title="还没有播放记录"
          desc="播放过的歌会自动记到这里，方便回头再听。同一首歌重复播放只会刷新时间，不会堆一堆重复项。"
        />
      ) : (
        <>
          <SongList songs={songs} onPlay={(_, i) => player.playQueue(songs, i)} />
          {effectiveHasMore && (
            <div className="flex justify-center pt-1">
              <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {loadingMore ? '加载中…' : `加载更多（还有 ${Math.max(0, effectiveTotal - items.length)} 首）`}
              </Button>
            </div>
          )}
          {!effectiveHasMore && items.length > PAGE_SIZE && (
            <p className="pt-1 text-center text-xs text-faint">已经到底了</p>
          )}
        </>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Stack gap={5} className="w-full rise">
      {children}
    </Stack>
  )
}

function EmptyCard({
  title,
  desc,
  action,
}: {
  title: string
  desc: string
  action?: { label: string; href: string }
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-10 text-center">
      <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-panel2 text-faint">
        <History className="size-5" />
      </span>
      <p className="mt-3 text-sm font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-dim">{desc}</p>
      {action && (
        <Button asChild variant="outline" size="sm" className="mt-4">
          <a href={action.href}>{action.label}</a>
        </Button>
      )}
    </div>
  )
}

function Header({
  count,
  onPlayAll,
  onClear,
  clearing,
  disabled,
}: {
  count: number
  onPlayAll: () => void
  onClear?: () => void
  clearing?: boolean
  disabled?: boolean
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">播放历史</h1>
        <p className="mt-1 text-sm text-dim">
          最近听过的歌，按时间倒序。{count > 0 ? `共 ${count} 首。` : ''}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {onClear && (
          <Button variant="ghost" size="sm" onClick={onClear} disabled={disabled || clearing}>
            {clearing ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            清空
          </Button>
        )}
        <Button size="sm" onClick={onPlayAll} disabled={disabled}>
          <Play className="size-3.5 fill-current" />
          播放全部
        </Button>
      </div>
    </header>
  )
}
