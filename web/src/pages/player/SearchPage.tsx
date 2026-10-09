import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Loader2, Play, Search, TriangleAlert, UserRound } from 'lucide-react'
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  useToast,
} from '@/components/ui'
import { MUSIC_SOURCES, SOURCE_LABEL, searchMusic, songKey, sourceLabel, type Song } from '@/lib/music'
import {
  ARTIST_SOURCES,
  searchSingers,
  supportsArtistPages,
  type SingerHit,
} from '@/lib/discover'
import { usePlayer } from '@/lib/player'
import { useSentinel } from '@/lib/useSentinel'
import SongList from '@/components/player/SongList'

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
  const [source, setSource] = React.useState<string>('kw')
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
        // 平台不支持时不必发请求（服务端会 500），直接落到空结果由 UI 给换平台提示
        const hits = supportsArtistPages(src) ? await searchSingers({ name: q, source: src, signal: ac.signal }) : []
        if (ac.signal.aborted) return
        setSingers(hits)
        setResults([])
      } else {
        const list = await searchMusic({ name: q, source: src, page: 1, pages: 1, signal: ac.signal })
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
    const src = p.get('source') ?? 'kw'
    // 这是「响应 URL 变化」（首页搜索框 / 热搜 / 列表链接跳转），不是渲染期派生状态；
    // 规则静态看不出差别，与 lib/useLists.ts 的挂载取数同一处理方式
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
   *  两个防死循环的兜底（各平台翻页行为不一致，必须防）：
   *  1. 追加结果按 songKey 去重 —— 翻页结果常与已加载条目重复；
   *  2. 去重后一条新增都没有 → 判定到底，直接收工。
   *     有些平台会无视 page 反复返回同一批，没有这条就会无限追加重复项。 */
  const loadMore = React.useCallback(async () => {
    if (loadingMore || !hasMore || kind !== 'song' || !searchedFor) return
    setLoadingMore(true)
    const next = page + 1
    try {
      const list = await searchMusic({ name: searchedFor, source, page: next, pages: 1 })
      const seen = new Set(results.map(songKey))
      const fresh = list.filter((s) => !seen.has(songKey(s)))
      if (fresh.length === 0) {
        setHasMore(false)
      } else {
        setResults((prev) => [...prev, ...fresh])
        setPage(next)
        if (list.length < PAGE_SIZE) setHasMore(false)
      }
    } catch {
      // 追加失败不该把已经拿到的结果也弄丢，静默停止即可
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
    <Stack gap={5} className="w-full rise">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">搜索</h1>
        <p className="mt-1 text-sm text-dim">聚合主流平台音源，点歌即播。</p>
      </header>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void runSearch(keyword, source, kind)
        }}
      >
        <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="搜索类型">
          {(
            [
              ['song', '歌曲'],
              ['singer', '歌手'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={kind === key}
              onClick={() => switchKind(key)}
              className={
                kind === key
                  ? 'rounded-md bg-accent px-3 py-1.5 text-xs text-white'
                  : 'rounded-md px-3 py-1.5 text-xs text-dim transition-colors hover:text-ink'
              }
            >
              {label}
            </button>
          ))}
        </div>
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={kind === 'singer' ? '搜索歌手名…' : '搜索歌曲、专辑…'}
          aria-label="搜索关键词"
          autoComplete="off"
          className="min-w-40 flex-1"
        />
        <Select
          value={source}
          onValueChange={(v) => {
            // Radix Select 在「受控值找不到已挂载的 Item」时会回调空串 ——
            // SelectItem 在弹层里，未展开时并不挂载，所以深链 `/search?source=wy`
            // 之后这里会把 source 清成 ''（页面标题、平台选择器、歌手/专辑链接全跟着错）。
            // 空串一律忽略。
            if (v) setSource(v)
          }}
        >
          <SelectTrigger className="w-28" aria-label="音源平台">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MUSIC_SOURCES.map((s) => (
              <SelectItem key={s.key} value={s.key}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" disabled={!keyword.trim() || phase === 'loading'}>
          {phase === 'loading' ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          搜索
        </Button>
      </form>

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

      {phase === 'idle' && (
        <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-10 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-panel2 text-faint">
            <Search className="size-5" />
          </span>
          <p className="mt-3 text-sm font-medium text-ink">输入关键词开始搜索</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-dim">
            选好平台后搜索，点任意一行即可播放；播放后由底部播放栏接管。
          </p>
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
        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm text-dim">
              「{searchedFor}」· {sourceLabel(source)} · 已加载 {results.length} 首
            </p>
            <Button variant="outline" size="sm" onClick={playAll}>
              <Play className="size-3.5 fill-current" /> 播放全部
            </Button>
          </div>
          <SongList songs={results} showSource />

          {/* 触底哨兵：滚到这里自动追加下一页（rootMargin 提前 300px 触发） */}
          <div ref={sentinelRef} aria-hidden className="h-px" />

          <div className="mt-3 flex justify-center">
            {loadingMore && (
              <p className="flex items-center gap-2 text-xs text-faint">
                <Loader2 className="size-3.5 animate-spin" /> 正在加载更多…
              </p>
            )}
            {!loadingMore && hasMore && (
              <Button variant="outline" size="sm" onClick={() => void loadMore()}>
                加载更多
              </Button>
            )}
            {!loadingMore && !hasMore && (
              <p className="text-xs text-faint">已全部加载（共 {results.length} 首）</p>
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
    </Stack>
  )
}
