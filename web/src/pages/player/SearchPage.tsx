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
  searchMusicAggregate,
  sourceLabel,
  type Song,
} from '@/lib/music'
import {
  ARTIST_SOURCES,
  searchSingers,
  supportsArtistPages,
  type SingerHit,
} from '@/lib/discover'
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
  /** 已加载到第几页（服务端页码，从 1 开始） */
  const [page, setPage] = React.useState(1)
  const [hasMore, setHasMore] = React.useState(false)
  const [loadingMore, setLoadingMore] = React.useState(false)

  const abortRef = React.useRef<AbortController | null>(null)
  React.useEffect(() => () => abortRef.current?.abort(), [])

  const runSearch = React.useCallback(async (name: string, src: string, k: Kind) => {
    const q = name.trim()
    if (!q) return

    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setPhase('loading')
    setError(null)
    setSearchedFor(q)
    // 新搜索从第一页重来
    setPage(1)
    setHasMore(false)
    setLoadingMore(false)

    try {
      if (k === 'singer') {
        const targetSrc = src === 'all' ? 'wy' : src
        const hits = supportsArtistPages(targetSrc)
          ? await searchSingers({ name: q, source: targetSrc, signal: ac.signal })
          : []
        if (ac.signal.aborted) return
        setSingers(hits)
        setResults([])
      } else {
        const list =
          src === 'all'
            ? await searchMusicAggregate({ name: q, page: 1, signal: ac.signal })
            : await searchMusic({ name: q, source: src, page: 1, pages: 1, signal: ac.signal })
        if (ac.signal.aborted) return
        setResults(list)
        setSingers([])
        // 满一页就假定还有下一页；不足一页即到底
        setHasMore(list.length >= PAGE_SIZE)
      }
      setPhase('done')
    } catch (e) {
      if (ac.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
      setResults([])
      setSingers([])
      setHasMore(false)
      setError(e instanceof Error ? e.message : '搜索失败')
      setPhase('error')
    }
  }, [])

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

  /** 追加下一页。触底自动触发，也可点「加载更多」手动触发。 */
  const loadMore = React.useCallback(async () => {
    if (loadingMore || !hasMore || kind !== 'song' || !searchedFor) return
    setLoadingMore(true)
    const next = page + 1
    try {
      const list =
        source === 'all'
          ? await searchMusicAggregate({ name: searchedFor, page: next })
          : await searchMusic({ name: searchedFor, source, page: next, pages: 1 })
      // 跨平台去重必须用 dedupeSongs（歌手集合有交集）而不是 Set(键)：
      // 同一首歌在不同平台的 singer 写法差很多（`李玟` / `CoCo李玟` /
      // `CoCo李玟、马毓芬、谢文德…`），键相等判不出去重。
      // 做法：把「已有结果 + 新页」整体重跑一次去重，只追加真正新增的部分。
      const mergedAll = dedupeSongs([...results, ...list])
      const fresh = mergedAll.slice(results.length)
      if (fresh.length === 0) {
        setHasMore(false)
      } else {
        setResults(mergedAll)
        setPage(next)
        if (list.length < PAGE_SIZE) setHasMore(false)
      }
    } catch {
      setHasMore(false)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, kind, searchedFor, page, source, results])

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
