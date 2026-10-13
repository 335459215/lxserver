import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  Disc3,
  FileMusic,
  Flame,
  Heart,
  History,
  ListMusic,
  Music2,
  Play,
  Search,
  Sparkles,
  Trophy,
} from 'lucide-react'
import { Button, Input } from '@/components/ui'
import { api, isAdmin, useAuth } from '@/lib/auth'
import {
  useHotSearch,
  useAggregatedLeaderboardBoards,
  useAggregatedLeaderboardSongs,
} from '@/lib/discover'
import { useLists } from '@/lib/useLists'
import { usePlayer } from '@/lib/player'
import SongList from '@/components/player/SongList'
import { cn } from '@/lib/utils'

/** 首页默认取榜单/热搜的平台：酷我接口最稳、无需额外参数 */
const HOME_SOURCE = 'kw'
/** 首页榜单卡展示几个 */
const BOARD_PREVIEW = 6
/** 首页「热门榜单」试听几首 */
const SONG_PREVIEW = 10

function SectionHeader({
  title,
  to,
  icon: Icon,
  extra,
}: {
  title: string
  to?: string
  icon?: LucideIcon
  extra?: ReactNode
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-ink">
        {Icon && (
          <span className="flex size-7 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Icon className="size-4" />
          </span>
        )}
        <span>{title}</span>
      </h2>
      <div className="flex items-center gap-2">
        {extra}
        {to && (
          <Link
            to={to}
            className="group flex items-center gap-1 text-xs font-medium text-dim transition-colors hover:text-accent"
          >
            <span>全部</span>
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>
    </div>
  )
}

function EntryCard({
  to,
  icon: Icon,
  label,
  hint,
  color = 'accent',
  delay = 0,
}: {
  to: string
  icon: LucideIcon
  label: string
  hint: string
  color?: 'accent' | 'rose' | 'emerald' | 'amber' | 'blue'
  delay?: number
}) {
  const colorMap = {
    accent: 'bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white',
    rose: 'bg-rose-50 text-rose-600 group-hover:bg-rose-600 group-hover:text-white',
    emerald: 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white',
    amber: 'bg-amber-50 text-amber-600 group-hover:bg-amber-600 group-hover:text-white',
    blue: 'bg-sky-50 text-sky-600 group-hover:bg-sky-600 group-hover:text-white',
  }

  return (
    <Link
      to={to}
      className="group rise relative flex flex-col justify-between rounded-2xl border border-line/80 bg-panel p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            'flex size-10 items-center justify-center rounded-xl transition-colors duration-300',
            colorMap[color],
          )}
        >
          <Icon className="size-5" />
        </span>
        <ArrowRight className="size-4 text-faint opacity-0 transition-all -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0" />
      </div>
      <div className="mt-4">
        <span className="block truncate text-sm font-bold text-ink">{label}</span>
        <span className="block truncate text-xs text-faint mt-0.5">{hint}</span>
      </div>
    </Link>
  )
}

interface StatusShape {
  uptime?: number
  cpuUsage?: number | string
  memory?: number
  totalMemory?: number
  freeMemory?: number
  sourcesCount?: number
}

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d} 天 ${h} 小时`
  if (h > 0) return `${h} 小时 ${m} 分`
  return `${m} 分钟`
}

// 预设几种质感渐变色给排行榜卡片
const BOARD_GRADIENTS = [
  'from-indigo-600 to-purple-600',
  'from-pink-500 to-rose-600',
  'from-amber-500 to-orange-600',
  'from-emerald-500 to-teal-600',
  'from-cyan-500 to-blue-600',
  'from-violet-600 to-indigo-700',
]

/** 首页：顶研级音乐中心。
 *  精选 Hero 焦点横幅 + 现代搜索热词 + 音乐库磁贴 + 热门榜单试听与即点即下。 */
export default function Dashboard() {
  const navigate = useNavigate()
  const { auth } = useAuth()
  const player = usePlayer()
  const [keyword, setKeyword] = useState('')

  const hot = useHotSearch(HOME_SOURCE)
  const boardsRes = useAggregatedLeaderboardBoards()
  const { snapshot } = useLists()

  const boards = (boardsRes.data ?? []).slice(0, BOARD_PREVIEW)
  const firstBoard = boardsRes.data?.[0] ?? null
  const boardName = firstBoard?.name ?? ''
  const previewRes = useAggregatedLeaderboardSongs(firstBoard?.targets)
  const previewSongs = (previewRes.data?.list ?? []).slice(0, SONG_PREVIEW)

  // 服务器状态（仅管理员拉取并展示于底部）
  const [status, setStatus] = useState<StatusShape | null>(null)
  const adminUser = isAdmin(auth)
  useEffect(() => {
    if (!adminUser) return
    let alive = true
    const load = () =>
      api
        .status()
        .then((d) => alive && setStatus(d as StatusShape))
        .catch(() => {})
    load()
    const timer = setInterval(load, 10_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [adminUser])

  const hotList = hot.data ?? []
  const loveCount = snapshot?.loveList.length ?? 0
  const playlistCount = snapshot?.userList.length ?? 0

  const goSearch = (q: string) => {
    const kw = q.trim()
    if (!kw) return
    navigate(`/search?q=${encodeURIComponent(kw)}`)
  }

  const handlePlayHero = () => {
    if (previewSongs.length > 0) {
      player.playQueue(previewSongs, 0)
    } else {
      navigate('/search')
    }
  }

  return (
    <div className="rise flex w-full flex-col gap-8">
      {/* 1. Hero Spotlight 焦点横幅：仅在桌面端显示，移动端直接展示搜索与音乐库 */}
      <section className="hidden md:block relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950 p-6 md:p-9 text-white shadow-xl">
        {/* 动态光晕与声学背景纹理 */}
        <div className="pointer-events-none absolute -right-20 -top-20 size-96 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-1/3 size-80 rounded-full bg-purple-500/15 blur-3xl" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold backdrop-blur-md text-indigo-200">
              <Sparkles className="size-3.5 text-indigo-300" />
              <span>今日声学精选 · 沉浸体验</span>
            </div>
            <h1 className="mt-3 text-2xl md:text-3xl font-extrabold tracking-tight text-white leading-tight">
              探索海量高保真音乐，随时随地离线珍藏
            </h1>
            <p className="mt-2 text-sm text-slate-300 leading-relaxed">
              聚合五大主流平台优质音源，享受母带级 Hi-Res/FLAC 纯净音质。一键在线点播、精准实时歌词同步，亦可直接下载到本地随身畅听。
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                onClick={handlePlayHero}
                className="rounded-full bg-indigo-500 font-semibold text-white shadow-lg shadow-indigo-500/30 hover:bg-indigo-400 active:scale-95 transition-all"
              >
                <Play className="size-4 fill-current mr-1" />
                <span>即刻播放精选</span>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="rounded-full border-white/20 bg-white/5 font-semibold text-white backdrop-blur hover:bg-white/15 transition-all"
              >
                <Link to="/leaderboard">
                  <Trophy className="size-4 mr-1 text-amber-300" />
                  <span>浏览官方榜单</span>
                </Link>
              </Button>
            </div>
          </div>

          {/* 拟物专辑封面与黑胶装饰 */}
          <div className="hidden lg:flex items-center justify-center shrink-0 pr-4">
            <div className="relative group cursor-pointer" onClick={handlePlayHero}>
              {/* 旋转黑胶唱片 */}
              <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-12 size-36 rounded-full bg-zinc-950 p-1 shadow-2xl transition-all duration-700 group-hover:translate-x-16">
                <div
                  className="size-full rounded-full border-2 border-zinc-900/90 flex items-center justify-center animate-vinyl"
                  style={{
                    background:
                      'radial-gradient(circle, #27272a 20%, #09090b 22%, #18181b 45%, #09090b 47%, #27272a 70%, #09090b 72%)',
                  }}
                >
                  <div className="size-10 rounded-full bg-indigo-500 flex items-center justify-center">
                    <div className="size-3 rounded-full bg-zinc-950" />
                  </div>
                </div>
              </div>

              {/* 封套封面 */}
              <div className="relative z-10 size-40 rounded-2xl border border-white/20 bg-gradient-to-tr from-indigo-500 to-purple-600 p-4 shadow-2xl flex flex-col justify-between">
                <div className="flex items-center justify-between text-white/80">
                  <Music2 className="size-5" />
                  <span className="font-mono text-[10px] tracking-wider uppercase font-semibold">HQ AUDIO</span>
                </div>
                <div>
                  <span className="block text-xs font-bold text-white">流行精选周榜</span>
                  <span className="block text-[10px] text-white/70">Top Trending Hits</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. 搜索：听歌第一交互通道 */}
      <section className="rounded-3xl border border-line/80 bg-panel p-5 md:p-6 shadow-card">
        <form
          className="flex gap-2.5"
          onSubmit={(e) => {
            e.preventDefault()
            goSearch(keyword)
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4.5 -translate-y-1/2 text-faint" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索歌曲、歌手、专辑或歌单名称…"
              aria-label="搜索关键词"
              autoComplete="off"
              className="h-12 pl-11 pr-4 text-sm rounded-2xl bg-panel-2/70 border-line/80 focus:border-accent"
            />
          </div>
          <Button
            type="submit"
            size="lg"
            disabled={!keyword.trim()}
            className="h-12 px-6 rounded-2xl font-semibold shadow-xs"
          >
            搜索
          </Button>
        </form>

        {/* 热搜胶囊标签 */}
        {hot.status === 'loading' && (
          <div className="mt-3.5 flex flex-wrap gap-2" aria-busy="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <span
                key={i}
                className="h-7 rounded-full bg-panel-2 animate-pulse"
                style={{ width: `${60 + ((i * 19) % 50)}px` }}
              />
            ))}
          </div>
        )}

        {hotList.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="mr-1 flex items-center gap-1 text-xs font-semibold text-faint">
              <Flame className="size-3.5 text-amber-500" /> 热搜榜
            </span>
            {hotList.slice(0, 10).map((k, idx) => (
              <button
                key={k}
                type="button"
                onClick={() => goSearch(k)}
                className="group flex items-center gap-1.5 rounded-full border border-line/70 bg-panel-2/60 px-3 py-1 text-xs font-medium text-dim transition-all hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
              >
                <span
                  className={cn(
                    'font-mono text-[10px] font-bold',
                    idx < 3 ? 'text-accent' : 'text-faint',
                  )}
                >
                  {idx + 1}
                </span>
                <span>{k}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 3. 我的音乐快捷入口 */}
      <section>
        <SectionHeader title="音乐资料库" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <EntryCard
            to="/search"
            icon={Search}
            label="搜索发现"
            hint="五大主流平台"
            color="accent"
            delay={0}
          />
          <EntryCard
            to="/playlist"
            icon={ListMusic}
            label="我的歌单"
            hint={playlistCount > 0 ? `${playlistCount} 个歌单` : '自建与同步'}
            color="rose"
            delay={30}
          />
          <EntryCard
            to="/favorites"
            icon={Heart}
            label="我喜欢的"
            hint={loveCount > 0 ? `${loveCount} 首歌曲` : '红心收藏'}
            color="amber"
            delay={60}
          />
          <EntryCard
            to="/history"
            icon={History}
            label="播放历史"
            hint="最近听过的歌"
            color="emerald"
            delay={90}
          />
          <EntryCard
            to="/local"
            icon={FileMusic}
            label="本地音乐"
            hint="离线服务端目录"
            color="blue"
            delay={120}
          />
        </div>
      </section>

      {/* 4. 排行榜：顶研级多色卡片 */}
      <section>
        <SectionHeader title="权威排行榜" to="/leaderboard" icon={Trophy} />
        {boardsRes.status === 'loading' && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: BOARD_PREVIEW }).map((_, i) => (
              <span key={i} className="h-36 rounded-2xl bg-panel-2 animate-pulse" />
            ))}
          </div>
        )}
        {boards.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {boards.map((b, i) => (
              <Link
                key={b.id}
                to={`/leaderboard?name=${encodeURIComponent(b.name)}`}
                className="group rise flex flex-col rounded-2xl border border-line/80 bg-panel p-3 shadow-card transition-all hover:-translate-y-1 hover:border-line-strong hover:shadow-pop"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                {/* 封面渐变色块 */}
                <span
                  className={cn(
                    'relative flex h-24 items-center justify-center rounded-xl bg-gradient-to-tr text-white shadow-xs overflow-hidden',
                    BOARD_GRADIENTS[i % BOARD_GRADIENTS.length],
                  )}
                >
                  <Disc3 className="size-8 opacity-80 transition-transform duration-500 group-hover:scale-110" />
                  <span className="absolute bottom-2 right-2 flex size-7 translate-y-1 items-center justify-center rounded-full bg-white text-ink opacity-0 shadow-md transition-all group-hover:translate-y-0 group-hover:opacity-100">
                    <Play className="size-3.5 fill-current translate-x-0.5" />
                  </span>
                </span>
                <span className="mt-2.5 truncate text-xs font-bold text-ink">
                  {b.name}
                </span>
                <span className="text-[10px] text-faint">全网聚合榜</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* 5. 热门榜单精选试听与单曲下载 */}
      {previewSongs.length > 0 && (
        <section className="rounded-3xl border border-line/80 bg-panel p-5 md:p-6 shadow-card">
          <SectionHeader
            title={`榜单精选 · ${boardName || '热门推荐'}`}
            to="/leaderboard"
            extra={
              <Button
                variant="outline"
                size="sm"
                onClick={() => player.playQueue(previewSongs, 0)}
                className="rounded-xl border-line font-medium hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
              >
                <Play className="size-3.5 fill-current mr-1" />
                <span>播放全部</span>
              </Button>
            }
          />
          <SongList songs={previewSongs} />
        </section>
      )}

      {/* 6. 服务器状态：极简微型状态栏，仅对管理员展示 */}
      {adminUser && status && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line/60 bg-panel-2/50 px-4 py-2.5 text-xs text-faint">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-medium text-ink">
              <span className="size-2 rounded-full bg-ok animate-pulse" /> 服务在线
            </span>
            <span>·</span>
            <span>运行时长 {fmtUptime(status.uptime ?? 0)}</span>
            <span>·</span>
            <span>已加载音源 {status.sourcesCount ?? 0} 个</span>
            <span>·</span>
            <span>
              CPU{' '}
              {status.cpuUsage !== undefined
                ? typeof status.cpuUsage === 'number'
                  ? `${status.cpuUsage.toFixed(1)}%`
                  : `${status.cpuUsage}%`
                : '—'}
            </span>
            {status.totalMemory ? (
              <>
                <span>·</span>
                <span>
                  内存 {Math.round(100 - ((status.freeMemory ?? 0) / status.totalMemory) * 100)}%
                </span>
              </>
            ) : null}
          </div>
          <Link to="/settings/system" className="font-medium text-accent hover:underline">
            进入控制台 →
          </Link>
        </div>
      )}
    </div>
  )
}
