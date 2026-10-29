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
import {
  isRestorable,
  loadSearchSnapshot,
  saveSearchScrollY,
  saveSearchSnapshot,
  type SearchSnapshot,
} from '@/lib/searchSession'
import {
  clearSearchHistory,
  loadSearchHistory,
  pushSearchHistory,
  removeSearchHistory,
} from '@/lib/searchHistory'
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

  /** 本次挂载要恢复的上次会话（返回搜索页时）。
   *
   *  【恢复条件：URL 必须带着同一次搜索的 q】从结果点歌 → 播放页 → 返回，
   *  history 里回到的是 `/search?q=周杰伦`，正是当初进入搜索页的那个 URL。
   *  而用户从侧栏/顶栏点「搜索发现」（`/search`，**没有 q**）时，
   *  他要的是一个新的搜索页 —— 若也把上次结果翻出来，会显得「清不掉」。
   *  所以只在 URL 与快照完全对得上时才恢复；其它入口一律空态。
   *
   *  【为什么过 isRestorable】只恢复 done 终态。离开时还在 loading 的请求
   *  卸载即被 abort，恢复一个永远转圈的骨架屏比空态更糟（见 searchSession.ts）。 */
  const [restored] = React.useState<SearchSnapshot | null>(() => {
    const s = loadSearchSnapshot()
    if (!isRestorable(s)) return null
    const p = new URLSearchParams(window.location.search)
    const q = p.get('q')
    if (!q) return null
    const sameSearch =
      s.searchedFor === q &&
      s.keyword === q &&
      s.kind === (p.get('type') === 'singer' ? 'singer' : 'song') &&
      s.source === (p.get('source') ?? 'all')
    return sameSearch ? s : null
  })

  const [keyword, setKeyword] = React.useState(restored?.keyword ?? '')
  const [source, setSource] = React.useState<string>(restored?.source ?? 'all')
  const [kind, setKind] = React.useState<Kind>(restored?.kind ?? 'song')
  const [phase, setPhase] = React.useState<Phase>(restored?.phase ?? 'idle')
  const [results, setResults] = React.useState<Song[]>(restored?.results ?? [])
  const [singers, setSingers] = React.useState<SingerHit[]>(restored?.singers ?? [])
  const [error, setError] = React.useState<string | null>(restored?.error ?? null)
  /** 上一次真正发起搜索的关键词，用于结果区标题与重试 */
  const [searchedFor, setSearchedFor] = React.useState(restored?.searchedFor ?? '')

  // ===== 分页追加 =====
  // 注意：页码本身不再放 React state —— 它由 pager 持有（唯一真相），
  // 这里只保留渲染需要的两个标志位。多存一份页码就会出现两份状态不同步。
  const [hasMore, setHasMore] = React.useState(restored?.hasMore ?? false)
  const [loadingMore, setLoadingMore] = React.useState(false)

  const abortRef = React.useRef<AbortController | null>(null)
  /** 最近搜索：提交即记录（含 URL 参数带来的搜索 —— 点热搜也算「搜过」） */
  const [history, setHistory] = React.useState<string[]>(() => loadSearchHistory())
  /** 翻页控制器：**已通过 test/searchPaging.test.ts 验证的实现**。
   *
   *  【为什么分页状态不直接用 React state 管理】
   *  分页有三个互相纠缠的约束（代次隔离、上游原始分页状态、失败重试），
   *  写在组件里既难测、又容易在后续改动中被悄悄破坏。
   *  交给纯逻辑控制器后，回归测试覆盖的就是**线上真正跑的那份代码**，
   *  而不是一份「和它长得很像」的副本。React state 只负责渲染镜像。
   *
   *  【为什么创建时就把恢复结果灌进去】恢复的会话必须接管页码，
   *  否则恢复后「加载更多」会因 loadedPage=0 被 loadMore 的守卫直接挡掉
   *  （按钮点了没反应）。在惰性初始化里做（而不是 render 里操作 ref），
   *  既符合 react-hooks/refs 规则，也保证只执行一次。 */
  const pagerRef = React.useRef<ReturnType<typeof createSearchPager<Song>> | null>(null)
  // 用 `== null` 而不是 `!`：lint 规则认可这种「只初始化一次」的写法
  // （直接读 ref.current 做真值判断会被判为 render 期访问 ref）。
  if (pagerRef.current == null) {
    const pager = createSearchPager<Song>({ pageSize: PAGE_SIZE, dedupe: dedupeSongs })
    if (restored && restored.kind === 'song' && restored.results.length > 0) {
      pager.hydrate(restored.results, restored.hasMore)
    }
    pagerRef.current = pager
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
    // 记录最近搜索：提交即记（失败也留痕 —— 用户想搜的词本身就有复用价值）
    setHistory(pushSearchHistory(q))

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
   *  都会带参数跳过来，不用再手输一次。参数变化（含从首页再点一个热搜）都会重新搜。
   *
   *  【返回时不重搜】从结果点歌 → 播放页 → 返回，URL 仍是 `/search?q=xxx`
   *  （当初就是这么进来的）。若这里照常跑搜索，恢复出来的结果会被骨架屏冲掉、
   *  还白打一遍上游。这里只跳过**恢复时那一组参数**（记在
   *  restoredSearchRef 里），之后用户换成别的关键词（`?q=王菲`）仍会正常重搜。 */
  const [params] = useSearchParams()
  const search = params.toString()
  /** 本次恢复所对应的那组 URL 参数；只跳过它一次，不影响后续任何导航。 */
  const restoredSearchRef = React.useRef<string | null>(restored ? search : null)
  React.useEffect(() => {
    const p = new URLSearchParams(search)
    const q = p.get('q')
    if (!q) return
    // 这一组参数正是本次挂载恢复出来的那组：结果已在屏幕上，不重复搜
    if (restoredSearchRef.current === search) {
      restoredSearchRef.current = null
      return
    }
    const k: Kind = p.get('type') === 'singer' ? 'singer' : 'song'
    const src = p.get('source') ?? 'all'
    /* eslint-disable react-hooks/set-state-in-effect */
    setKind(k)
    setSource(src)
    setKeyword(q)
    /* eslint-enable react-hooks/set-state-in-effect */
    void runSearch(q, src, k)
  }, [search, runSearch])

  /** 每次搜索状态变化都把快照写回模块级单例 —— 用户从这里点歌进播放页、
   *  再从播放页返回时，SearchPage 会重新挂载并从快照恢复（见文件顶部注释）。
   *
   *  【为什么 phase=loading 时不覆盖快照】上一次成功的 done 结果比「正在搜」
   *  更有恢复价值。用户点了新搜索又立刻点走时，恢复上一次的完整结果，
   *  比恢复成空态/转圈体验更好（新搜索本来就没完成，没有可展示的东西）。
   *  error 同理：保留上一次成功结果，不让一次失败抹掉整页内容。
   *
   *  【为什么不做防抖】快照只是一次对象拷贝（结果数组按引用共享，不深克隆），
   *  写入成本可忽略；而防抖会引入「刚搜完立刻点走 → 快照还没落盘」的窗口，
   *  正是本缺陷最容易复现的路径。 */
  React.useEffect(() => {
    if (phase !== 'done') return
    saveSearchSnapshot({
      keyword,
      searchedFor,
      source,
      kind,
      phase,
      results,
      singers,
      error,
      hasMore,
      // 保留既有滚动位置：本 effect 在**每次结果变化**时都会跑，
      // 若直接写 0 会把用户当前位置清掉（返回后永远从页顶开始）。
      scrollY: loadSearchSnapshot()?.scrollY ?? 0,
    })
  }, [keyword, searchedFor, source, kind, phase, results, singers, error, hasMore])

  /** 恢复滚动位置（只在挂载时跑一次）。
   *
   *  【为什么等两帧】列表刚挂载时高度还没铺开，立刻 scrollTo 会被浏览器夹到 0
   *  （内容高度 < 目标值）。等两帧后 React 已完成提交、浏览器也完成布局。 */
  React.useEffect(() => {
    if (!restored || restored.scrollY <= 0) return
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        window.scrollTo(0, restored.scrollY)
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
    // 只在挂载时恢复一次：之后用户自己的滚动由浏览器接管
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 卸载时把当前滚动位置写进快照（组件切走 → 进播放页 → 返回）。
   *
   *  【为什么要和上面的恢复 effect 分开】恢复是「挂载时读」，这里是「卸载时写」；
   *  两者语义相反且生命周期不重叠。合并成一个 effect 会让恢复逻辑在依赖变化时
   *  重跑，把用户滚动到一半的位置又拽回去。
   *
   *  【为什么必须放在最后一个 effect】React 按注册顺序执行清理函数。
   *  本组件卸载时，先注册的清理先跑 —— 若它排在「保存快照」之后，
   *  就会把刚写进去的 scrollY 覆盖成 0（复原后永远在页顶）。 */
  React.useEffect(() => {
    return () => {
      saveSearchScrollY(window.scrollY)
    }
  }, [])

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
            <Search className="pointer-events-none absolute left-3.5 md:left-4 top-1/2 size-4 -translate-y-1/2 text-faint" />
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

        {/* 最近搜索（v2.34.0）：只在「还没搜过任何东西」的 idle 态展示 ——
            搜出结果后这里的每个词都已体现在结果里，再占一屏就是噪声。
            词是点得动的（等于替用户填好关键词再搜），词尾的 X 删单条。 */}
        {phase === 'idle' && history.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-3 mt-4 border-t border-line/40">
            <span className="text-xs font-semibold text-faint mr-1">最近搜索：</span>
            {history.map((word) => (
              <span
                key={word}
                className="group inline-flex items-center gap-0.5 rounded-full border border-line/70 bg-panel-2/70 pl-3 pr-1.5 py-1 text-xs text-dim transition-all hover:border-accent/40 hover:text-ink"
              >
                <button
                  type="button"
                  onClick={() => {
                    setKeyword(word)
                    void runSearch(word, source, kind)
                  }}
                  className="max-w-40 truncate transition-colors group-hover:text-accent"
                  title={word}
                >
                  {word}
                </button>
                <button
                  type="button"
                  onClick={() => setHistory(removeSearchHistory(word))}
                  className="rounded-full p-0.5 text-faint transition-colors hover:bg-danger/10 hover:text-danger"
                  aria-label={`删除搜索记录 ${word}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => {
                clearSearchHistory()
                setHistory([])
              }}
              className="ml-auto text-xs text-faint transition-colors hover:text-danger"
            >
              清空
            </button>
          </div>
        )}

        {/* 平台快捷切换：此前只在桌面端显示，移动端搜特定平台要靠桌面一样的一排按钮。
            移动端场景：聚合搜不到想要版本（翻唱/Live）时，切单平台重搜是高频动作。 */}
        <div className="flex flex-wrap items-center gap-2 pt-3 mt-1 md:pt-3 md:mt-4 border-t border-line/40">
          <span className="text-xs font-semibold text-faint mr-1">音源：</span>
          {MUSIC_SOURCES.map((s) => {
            const active = source === s.key
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setSource(s.key)
                  const q = keyword.trim() || searchedFor
                  if (q) void runSearch(q, s.key, kind)
                }}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all active:scale-95',
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

      {/* 空态引导（v2.40.0）：首进搜索页时整页只有一条搜索框、下方全空 ——
          实测截图里就是一整屏白。新用户不知道能搜什么、老用户没有可点的词。
          给三样东西：热门场景词（点词即搜）、平台入口说明、最近搜索（上面已有）。
          只在 idle 且无历史时出现；一旦有历史，上面的 chips 已经承担引导职责。 */}
      {phase === 'idle' && history.length === 0 && (
        <div className="flex flex-col items-center gap-5 py-10 text-center md:py-16">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <Search className="size-6" />
          </span>
          <div>
            <p className="text-base font-semibold text-ink">搜一首想听的歌</p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-dim">
              支持歌名、歌手、专辑；全网聚合一次搜五平台，
              也可以在上方切到单一平台精确查找。
            </p>
          </div>
          <div className="flex max-w-md flex-wrap justify-center gap-2">
            {['周杰伦', '王菲', '薛之谦', '经典老歌', '轻音乐', '粤语', '日语', '钢琴'].map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => {
                  setKeyword(w)
                  void runSearch(w, source, kind)
                }}
                className="rounded-full border border-line/80 bg-panel px-3.5 py-1.5 text-xs font-medium text-dim shadow-2xs transition-all hover:border-accent/40 hover:bg-accent-soft hover:text-accent active:scale-95"
              >
                {w}
              </button>
            ))}
          </div>
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
