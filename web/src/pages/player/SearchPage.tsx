import * as React from 'react'
import { Loader2, Play, Search, TriangleAlert } from 'lucide-react'
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
import { MUSIC_SOURCES, searchMusic, sourceLabel, type Song } from '@/lib/music'
import { usePlayer } from '@/lib/player'
import SongList from '@/components/player/SongList'

type Phase = 'idle' | 'loading' | 'done' | 'error'

export default function SearchPage() {
  const player = usePlayer()
  const { toast } = useToast()

  const [keyword, setKeyword] = React.useState('')
  const [source, setSource] = React.useState<string>('kw')
  const [phase, setPhase] = React.useState<Phase>('idle')
  const [results, setResults] = React.useState<Song[]>([])
  const [error, setError] = React.useState<string | null>(null)
  /** 上一次真正发起搜索的关键词，用于结果区标题与重试 */
  const [searchedFor, setSearchedFor] = React.useState('')

  const abortRef = React.useRef<AbortController | null>(null)
  React.useEffect(() => () => abortRef.current?.abort(), [])

  const runSearch = React.useCallback(async (name: string, src: string) => {
    const q = name.trim()
    if (!q) return

    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setPhase('loading')
    setError(null)
    setSearchedFor(q)

    try {
      const list = await searchMusic({ name: q, source: src, pages: 1, signal: ac.signal })
      if (ac.signal.aborted) return
      setResults(list)
      setPhase('done')
    } catch (e) {
      if (ac.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
      setResults([])
      setError(e instanceof Error ? e.message : '搜索失败')
      setPhase('error')
    }
  }, [])

  const playAll = React.useCallback(() => {
    if (!results.length) return
    player.playQueue(results, 0)
    toast({ title: `开始播放全部 ${results.length} 首`, description: searchedFor })
  }, [player, results, searchedFor, toast])

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
          void runSearch(keyword, source)
        }}
      >
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索歌曲、歌手、专辑…"
          aria-label="搜索关键词"
          autoComplete="off"
          className="min-w-40 flex-1"
        />
        <Select value={source} onValueChange={setSource}>
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
          <Button variant="outline" size="sm" className="mt-4" onClick={() => void runSearch(searchedFor, source)}>
            重试
          </Button>
        </div>
      )}

      {phase === 'done' && results.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-10 text-center">
          <p className="text-sm font-medium text-ink">没有找到「{searchedFor}」</p>
          <p className="mt-1 text-xs text-dim">换个关键词，或换一个音源平台再试。</p>
        </div>
      )}

      {phase === 'done' && results.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm text-dim">
              「{searchedFor}」· {sourceLabel(source)} · 共 {results.length} 首
            </p>
            <Button variant="outline" size="sm" onClick={playAll}>
              <Play className="size-3.5 fill-current" /> 播放全部
            </Button>
          </div>
          <SongList songs={results} showSource />
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
