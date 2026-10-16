import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Loader2, Play, Search, TriangleAlert, UserRound, X } from 'lucide-react'
import {
  Button,
  Input,
  useToast,
} from '@/components/ui'
import {
  MUSIC_SOURCES,
  SOURCE_LABEL,
  dedupeSongs,
  searchMusic,
  searchMusicAggregatePage,
  sourceLabel,
  type Song,
} from '@/lib/music'
import {
  ARTIST_SOURCES,
  searchSingers,
  supportsArtistPages,
  type SingerHit,
} from '@/lib/discover'
import { createSearchPager } from '@/lib/searchPaging'
import { usePlayer } from '@/lib/player'
import { useSentinel } from '@/lib/useSentinel'
import SongList from '@/components/player/SongList'
import { cn } from '@/lib/utils'

type Phase = 'idle' | 'loading' | 'done' | 'error'
/** 搜索类型：歌曲（默认）或歌手。歌手类型只有 wy/tx 支持，见 discover.ts 的说明。 */
type Kind = 'song' | 'singer'

/** 服务端歌曲搜索每页固定 20 条（`PAGE_SIZE`）。
 *  返回条数 < 该值即说明已经到最后一页。 */
const PAGE_SIZE = 20

export default function SearchPage() {
  const player = usePlayer()
  const { toast } = useToast()

  const [keyword, setKeyword] = React.useState('')
  const [source, setSource] = React.useState<string>('all')
  const [kind, setKind] = React.useState<Kind>('song')
  const [phase, setPhase] = React.useState<Phase>('idle')
  const [results, setResults] = React.useState<Song[]>([])
  const [singers, setSingers] = React.useState<SingerHit[]>([])
  const [error, setError] = React.useState<string | null>(null)
  /** 上一次真正发起搜索的关键词，用于结果区标题与重试 */
  const [searchedFor, setSearchedFor] = React.useState('')

  // ===== 分页追加 =====
  // 注意：页码本身不再放 React state —— 它由 pager 持有（唯一真相），
  // 这里只保留渲染需要的两个标志位。多存一份页码就会出现两份状态不同步。
  const [hasMore, setHasMore] = React.useState(false)
  const [loadingMore, setLoadingMore] = React.useState(false)

  const abortRef = React.useRef<AbortController | null>(null)
  /** 翻页控制器：**已通过 test/searchPaging.test.ts 验证的实现**。
   *
   *  【为什么分页状态不直接用 React state 管理】
   *  分页有三个互相纠缠的约束（代次隔离、上游原始分页状态、失败重试），
   *  写在组件里既难测、又容易在后续改动中被悄悄破坏。
   *  交给纯逻辑控制器后，回归测试覆盖的就是**线上真正跑的那份代码**，
   *  而不是一份「和它长得很像」的副本。React state 只负责渲染镜像。 */
  const pagerRef = React.useRef<ReturnType<typeof createSearchPager<Song>> | null>(null)
  // 用 `== null` 而不是 `!`：lint 规则认可这种「只初始化一次」的写法
  // （直接读 ref.current 做真值判断会被判为 render 期访问 ref）。
  if (pagerRef.current == null) {
    pagerRef.current = createSearchPager<Song>({ pageSize: PAGE_SIZE, dedupe: dedupeSongs })
  }
  /** 当前查询的取消控制器（初搜与翻页各一个，互不干扰） */
  const moreAbortRef = React.useRef<AbortController | null>(null)
  React.useEffect(() => () => {
    abortRef.current?.abort()
    moreAbortRef.current?.abort()
  }, [])

  /** 把控制器的状态同步到渲染用的 React state */
  const syncFromPager = React.useCallback(() => {
    const p = pagerRef.current!
    const s = p.state()
    setResults(p.items())
    setHasMore(s.hasMore)
    setLoadingMore(s.loadingMore)
  }, [])

  const runSearch = React.useCallback(async (name: string, src: string, k: Kind) => {
    const q = name.trim()
    if (!q) return

    abortRef.current?.abort()
    // 新查询作废一切在途翻页：控制器内部代次 +1，旧翻页的回写会被丢弃
    moreAbortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setPhase('loading')
    setError(null)
    setSearchedFor(q)
    setHasMore(false)
    setLoadingMore(false)

    try {
      if (k === 'singer') {
        const targetSrc = src === 'all' ? 'wy' : src
        const hits = supportsArtistPages(targetSrc)
          ? await searchSingers({ name: q, source: targetSrc, signal: ac.signal })
          : []
        if (ac.signal.aborted) return
        // 歌手模式没有分页，控制器重置掉即可
        pagerRef.current!.reset()
        setSingers(hits)
        setResults([])
      } else {
        await pagerRef.current!.loadFirst(async (page, _epoch) => {
          if (src === 'all') {
            const agg = await searchMusicAggregatePage({ name: q, page, signal: ac.signal })
            // 聚合必须用**原始**分页状态判断是否还有下一页：
            // 去重后条数必然少于原始条数，用展示条数判断会让第一页就误判到底。
            return { ...agg, rawHasMore: agg.rawHasMore }
          }
          const list = await searchMusic({ name: q, source: src, page, pages: 1, signal: ac.signal })
          return {
            items: list,
            rawCounts: [list.length],
            // 单平台：返回条数 < 页大小才是真的到底
            rawHasMore: list.length >= PAGE_SIZE,
            anyFulfilled: true,
          }
        })
        if (ac.signal.aborted) return
        syncFromPager()
        setSingers([])
      }
      setPhase('done')
    } catch (e) {
      if (ac.signal.aborted) return
      if (e instanceof DOMException && e.name === 'AbortError') return
      pagerRef.current!.reset()
      setResults([])
      setSingers([])
      setHasMore(false)
      setError(e instanceof Error ? e.message : '搜索失败')
      setPhase('error')
    }
    // syncFromPager 是稳定引用（useCallback([])），列进依赖不会导致重建
  }, [syncFromPager])

  /** 支持 /search?q=xxx&source=yy&type=singer —— 首页搜索框、热搜标签、列表里的歌手/专辑链接
   *  都会带参数跳过来，不用再手输一次。参数变化（含从首页再点一个热搜）都会重新搜。 */
  const [params] = useSearchParams()
  const search = params.toString()
  React.useEffect(() => {
    const p = new URLSearchParams(search)
    const q = p.get('q')
    if (!q) return
    const k: Kind = p.get('type') === 'singer' ? 'singer' : 'song'
    const src = p.get('source') ?? 'all'
    /* eslint-disable react-hooks/set-state-in-effect */
    setKind(k)
    setSource(src)
    setKeyword(q)
    /* eslint-enable react-hooks/set-state-in-effect */
    void runSearch(q, src, k)
  }, [search, runSearch])

  const playAll = React.useCallback(() => {
    if (!results.length) return
    player.playQueue(results, 0)
    toast({ title: `开始播放全部 ${results.length} 首`, description: searchedFor })
  }, [player, results, searchedFor, toast])

  /** 追加下一页。触底自动触发，也可点「加载更多」手动触发。
   *
   *  代次隔离、上游分页状态判断、失败重试、single-flight 全部由
   *  createSearchPager 负责（见 lib/searchPaging.ts 与 test/searchPaging.test.ts）。
   *  这里只做两件事：把参数翻译成取数函数、把结果同步给 React。 */
  const loadMore = React.useCallback(async () => {
    if (kind !== 'song' || !searchedFor) return
    const p = pagerRef.current!
    if (p.state().loadingMore || !p.state().hasMore) return

    const ac = new AbortController()
    moreAbortRef.current?.abort()
    moreAbortRef.current = ac
    setLoadingMore(true)

    try {
      await p.loadMore(async (page) => {
        if (source === 'all') {
          const agg = await searchMusicAggregatePage({ name: searchedFor, page, signal: ac.signal })
          return agg
        }
        const list = await searchMusic({ name: searchedFor, source, page, pages: 1, signal: ac.signal })
        return {
          items: list,
          rawCounts: [list.length],
          rawHasMore: list.length >= PAGE_SIZE,
          anyFulfilled: true,
        }
      })
      if (ac.signal.aborted) return
      syncFromPager()
    } catch (e) {
      // 网络错误**不能**当成「到底了」—— 那会让一次抖动永久终止翻页。
      // 控制器内部已保证不推进页码、不关 hasMore，这里只需解锁并提示。
      if (e instanceof DOMException && e.name === 'AbortError') return
      console.warn('[搜索] 加载下一页失败，保持可重试:', e)
      syncFromPager()
    } finally {
      if (!ac.signal.aborted) setLoadingMore(false)
    }
  }, [kind, searchedFor, source, syncFromPager])

  const sentinelRef = useSentinel(() => void loadMore(), phase === 'done' && hasMore && !loadingMore)

  /** 切换搜索类型：立刻用当前关键词重搜，避免出现「切换了但结果还是旧的」 */
  const switchKind = (k: Kind) => {
    setKind(k)
    const q = keyword.trim() || searchedFor
    if (q) void runSearch(q, source, k)
  }

  return (
    <div className="w-full rise flex flex-col gap-5 md:gap-6">
      {/* 搜索控制台卡片：移动端极简，仅保留单条纯粹搜索框；桌面端展示完整控制台 */}
      <section className="rounded-2xl md:rounded-3xl border border-line/80 bg-panel p-3.5 md:p-6 shadow-card">
        {/* 桌面端标题与分类Tab：移动端彻底隐藏，绝不占用垂直空间 */}
        <div className="hidden md:flex md:flex-row md:items-center justify-between gap-4 mb-5">
          <div>
            <h1 className="text-xl md:text-2xl font-extrabold tracking-tight text-ink">搜索发现</h1>
            <p className="mt-1 text-xs text-dim">聚合五大主流平台海量高品质音源，一键即听、随心珍藏。</p>
          </div>

          {/* 搜索类型胶囊（歌曲 / 歌手） */}
          <div className="flex items-center rounded-xl bg-panel-2/90 p-1 border border-line/60">
            {(
              [
                ['song', '歌曲搜索'],
                ['singer', '歌手检索'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={kind === key}
                onClick={() => switchKind(key)}
                className={cn(
                  'rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all',
                  kind === key
                    ? 'bg-panel text-accent shadow-2xs'
                    : 'text-dim hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 搜索主输入框：在移动端就是最纯粹、全宽的搜索框 */}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void runSearch(keyword, source, kind)
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 md:left-4 top-1/2 size-4.5 -translate-y-1/2 text-faint" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索歌曲、歌手、专辑…"
              aria-label="搜索关键词"
              autoComplete="off"
              className="h-11 md:h-12 pl-10 md:pl-11 pr-8 md:pr-10 text-sm rounded-xl md:rounded-2xl bg-panel-2/70 border-line/80 focus:border-accent"
            />
            {keyword && (
              <button
                type="button"
                onClick={() => setKeyword('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-faint hover:text-ink transition-colors"
                aria-label="清空输入"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <Button
            type="submit"
            size="lg"
            disabled={!keyword.trim() || phase === 'loading'}
            className="h-11 md:h-12 px-4 md:px-7 rounded-xl md:rounded-2xl font-semibold shadow-xs shrink-0"
          >
            {phase === 'loading' ? (
              <Loader2 className="size-4 animate-spin md:mr-1" />
            ) : (
              <Search className="size-4 md:mr-1" />
            )}
            <span className="hidden md:inline">搜索</span>
          </Button>
        </form>

        {/* 快捷平台切换药丸标签：仅在桌面端显示；移动端默认聚合搜索，无冗余按钮 */}
        <div className="hidden md:flex flex-wrap items-center gap-2 pt-3 mt-4 border-t border-line/40">
          <span className="text-xs font-semibold text-faint mr-1">音源平台：</span>
          {MUSIC_SOURCES.map((s) => {
            const active = source === s.key
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  setSource(s.key)
                  const q = keyword.trim() || searchedFor
                  if (q) void runSearch(q, s.key, kind)
                }}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all',
                  active
                    ? 'bg-accent/10 border border-accent/30 text-accent font-semibold shadow-2xs'
                    : 'bg-panel-2/70 border border-line/70 text-dim hover:border-line-strong hover:bg-panel hover:text-ink',
                )}
              >
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    active ? 'bg-accent' : 'bg-faint/60',
                  )}
                />
                <span>{s.label}</span>
              </button>
            )
          })}
        </div>
      </section>

      {kind === 'singer' && !supportsArtistPages(source) && (
        <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-6 text-center">
          <span className="mx-auto flex size-9 items-center justify-center rounded-xl bg-panel2 text-faint">
            <UserRound className="size-4" />
          </span>
          <p className="mt-2 text-sm font-medium text-ink">「{sourceLabel(source)}」不支持按歌手搜索</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-dim">
            目前只有网易云与 QQ音乐 提供歌手数据，换一个平台即可。
          </p>
          <div className="mt-3 flex justify-center gap-2">
            {ARTIST_SOURCES.map((s) => (
              <Button
                key={s}
                variant="outline"
                size="sm"
                onClick={() => {
                  setSource(s)
                  const q = keyword.trim() || searchedFor
                  if (q) void runSearch(q, s, 'singer')
                }}
              >
                换到{SOURCE_LABEL[s]}
              </Button>
            ))}
          </div>
        </div>
      )}

      {phase === 'loading' && (
        <ul className="space-y-1" aria-busy="true" aria-label="搜索中">
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

      {phase === 'error' && (
        <div className="rounded-2xl border border-dashed border-danger/40 bg-danger/5 p-8 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-panel2 text-danger">
            <TriangleAlert className="size-5" />
          </span>
          <p className="mt-3 text-sm font-medium text-ink">搜索失败</p>
          <p className="mx-auto mt-1 max-w-md break-words text-xs leading-relaxed text-dim">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => void runSearch(searchedFor, source, kind)}
          >
            重试
          </Button>
        </div>
      )}

      {phase === 'done' && kind === 'song' && results.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-10 text-center">
          <p className="text-sm font-medium text-ink">没有找到「{searchedFor}」</p>
          <p className="mt-1 text-xs text-dim">换个关键词，或换一个音源平台再试。</p>
        </div>
      )}

      {phase === 'done' && kind === 'singer' && supportsArtistPages(source) && singers.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-10 text-center">
          <p className="text-sm font-medium text-ink">没有找到歌手「{searchedFor}」</p>
          <p className="mt-1 text-xs text-dim">试试只填名字（不要带「、」连接的合唱者），或换一个平台。</p>
        </div>
      )}

      {/* 歌手结果：卡片网格，点进歌手详情页 */}
      {phase === 'done' && kind === 'singer' && singers.length > 0 && (
        <section>
          <p className="mb-2 text-sm text-dim">
            「{searchedFor}」· 歌手 · {sourceLabel(source)} · 共 {singers.length} 位
          </p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {singers.map((s) => (
              <li key={String(s.id)}>
                <Link
                  to={`/artist/${encodeURIComponent(String(s.id))}?source=${encodeURIComponent(source)}`}
                  className="group block rounded-2xl p-3 text-center transition-colors hover:bg-panel2"
                >
                  <span className="mx-auto block size-20 overflow-hidden rounded-full border border-line bg-panel2 sm:size-24">
                    {s.picUrl ? (
                      <img
                        src={s.picUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                      />
                    ) : (
                      <span className="flex size-full items-center justify-center text-faint">
                        <UserRound className="size-7" />
                      </span>
                    )}
                  </span>
                  <span className="mt-2 block truncate text-sm text-ink" title={s.name}>
                    {s.name}
                  </span>
                  <span className="block truncate text-xs text-faint">
                    {[s.alias?.[0], s.albumSize ? `${s.albumSize} 张专辑` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {phase === 'done' && kind === 'song' && results.length > 0 && (
        <section className="rounded-3xl border border-line/80 bg-panel p-5 md:p-6 shadow-card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-line/60">
            <div className="flex items-center gap-2 text-xs font-semibold text-dim">
              <span className="rounded-md bg-accent/10 px-2 py-0.5 text-accent font-bold">
                {sourceLabel(source)}
              </span>
              <span>
                「{searchedFor}」共找到 <span className="text-ink font-bold">{results.length}</span> 首歌曲
              </span>
            </div>
            <Button
              size="sm"
              onClick={playAll}
              className="rounded-xl font-medium shadow-xs"
            >
              <Play className="size-3.5 fill-current mr-1" /> 播放全部
            </Button>
          </div>
          <SongList songs={results} showSource />

          {/* 触底哨兵：滚到这里自动追加下一页（rootMargin 提前 300px 触发） */}
          <div ref={sentinelRef} aria-hidden className="h-px" />

          <div className="mt-4 flex justify-center pt-2">
            {loadingMore && (
              <p className="flex items-center gap-2 text-xs text-faint">
                <Loader2 className="size-3.5 animate-spin text-accent" /> 正在加载更多音源…
              </p>
            )}
            {!loadingMore && hasMore && (
              <Button variant="outline" size="sm" onClick={() => void loadMore()} className="rounded-xl">
                加载更多歌曲
              </Button>
            )}
            {!loadingMore && !hasMore && (
              <p className="text-xs text-faint">已展示全部结果（共 {results.length} 首）</p>
            )}
          </div>
        </section>
      )}

      {/* 失败提示条：搜索页内也能看到状态并一键换源 */}
      {player.current && player.status === 'error' && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel p-3 text-xs text-dim">
          <TriangleAlert className="size-4 shrink-0 text-danger" />
          <span className="min-w-0 flex-1 break-words">
            上一首解析失败：{player.error}
            {player.attempts.length > 0 && (
              <span className="text-faint">
                （已尝试：
                {player.attempts
                  .map((a) => a.name ?? a.sourceName)
                  .filter(Boolean)
                  .join('、')}
                ）
              </span>
            )}
          </span>
          <Button variant="outline" size="sm" onClick={player.retry}>
            换源重试
          </Button>
        </div>
      )}

      {player.current && player.status !== 'error' && (
        <div className="flex items-center gap-2 text-xs text-faint">
          <span className="size-1.5 animate-pulse rounded-full bg-accent" />
          正在播放：<span className="text-dim">{player.current.name}</span>
          {player.sourceName && <span>· {player.sourceName}</span>}
        </div>
      )}
    </div>
  )
}
