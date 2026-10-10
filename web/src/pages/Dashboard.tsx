import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  FileMusic,
  Heart,
  History,
  ListMusic,
  Loader2,
  Music2,
  Play,
  Search,
  TrendingUp,
  Trophy,
} from 'lucide-react'
import { Button, Input } from '@/components/ui'
import { api, useAuth } from '@/lib/auth'
import { useHotSearch, useLeaderboardBoards, useLeaderboardSongs } from '@/lib/discover'
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
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-ink">
        {Icon && <Icon className="size-4 text-accent" />}
        {title}
      </h2>
      <div className="flex items-center gap-2">
        {extra}
        {to && (
          <Link
            to={to}
            className="group flex items-center gap-0.5 text-xs text-dim transition-colors hover:text-ink"
          >
            查看全部
            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
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
  delay = 0,
}: {
  to: string
  icon: LucideIcon
  label: string
  hint: string
  delay?: number
}) {
  return (
    <Link
      to={to}
      className="group rise flex items-center gap-3 rounded-2xl border border-line bg-panel p-3.5 shadow-card transition-all hover:border-line-strong hover:shadow-pop"
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{label}</span>
        <span className="block truncate text-xs text-faint">{hint}</span>
      </span>
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

/** 首页：音乐优先。
 *  结构＝搜索（听歌第一动作）→ 我的音乐 → 排行榜 → 热门榜试试听。
 *  服务器状态压成一行小字——旧版首页是管理仪表盘，那是「这不是播放器」的根源。 */
export default function Dashboard() {
  const navigate = useNavigate()
  const { auth } = useAuth()
  const player = usePlayer()
  const [keyword, setKeyword] = useState('')

  const hot = useHotSearch(HOME_SOURCE)
  const boardsRes = useLeaderboardBoards(HOME_SOURCE)
  const { snapshot } = useLists()

  const boards = (boardsRes.data ?? []).slice(0, BOARD_PREVIEW)
  const firstBangid = boardsRes.data?.[0]?.bangid ?? null
  const boardName = boardsRes.data?.[0]?.name ?? ''
  const previewRes = useLeaderboardSongs(HOME_SOURCE, firstBangid)
  const previewSongs = (previewRes.data?.list ?? []).slice(0, SONG_PREVIEW)

  // 服务器状态：只有管理员才拉，且不进首屏视觉主体
  const [status, setStatus] = useState<StatusShape | null>(null)
  const isAdmin = auth.admin.ok
  useEffect(() => {
    if (!isAdmin) return
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
  }, [isAdmin])

  const hotList = hot.data ?? []
  const loveCount = snapshot?.loveList.length ?? 0
  const playlistCount = snapshot?.userList.length ?? 0

  const goSearch = (q: string) => {
    const kw = q.trim()
    if (!kw) return
    navigate(`/search?q=${encodeURIComponent(kw)}`)
  }

  const resumable = player.current && player.queue.length > 0

  return (
    <div className="rise flex w-full flex-col gap-7">
      {/* 1. 搜索：听歌的第一个动作，放在最显眼处 */}
      <section className="rounded-3xl border border-line bg-panel p-5 shadow-card">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            goSearch(keyword)
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索歌曲、歌手、专辑…"
              aria-label="搜索关键词"
              autoComplete="off"
              className="h-11 pl-9 text-sm"
            />
          </div>
          <Button type="submit" size="lg" disabled={!keyword.trim()}>
            搜索
          </Button>
        </form>

        {hot.status === 'loading' && (
          <div className="mt-3 flex flex-wrap gap-1.5" aria-busy="true">
            {Array.from({ length: 10 }).map((_, i) => (
              <span
                key={i}
                className="h-6 rounded-full bg-panel2"
                style={{ width: `${52 + ((i * 17) % 44)}px` }}
              />
            ))}
          </div>
        )}

        {hotList.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 flex items-center gap-1 text-xs text-faint">
              <TrendingUp className="size-3.5" /> 热搜
            </span>
            {hotList.slice(0, 12).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => goSearch(k)}
                className="rounded-full border border-line bg-panel2/60 px-2.5 py-1 text-xs text-dim transition-colors hover:border-line-strong hover:bg-accent-soft hover:text-accent"
              >
                {k}
              </button>
            ))}
          </div>
        )}

        {resumable && (
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-line bg-panel2/50 p-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Play className="size-3.5 fill-current" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-faint">继续播放</span>
              <span className="block truncate text-sm text-ink">
                {player.current?.name}
                <span className="text-faint"> · {player.current?.singer}</span>
              </span>
            </span>
            <Button variant="outline" size="sm" onClick={player.toggle}>
              {player.status === 'playing' ? '暂停' : '继续'}
            </Button>
          </div>
        )}
      </section>

      {/* 2. 我的音乐 */}
      <section>
        <SectionHeader title="我的音乐" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <EntryCard to="/search" icon={Search} label="搜索" hint="五平台音源" delay={0} />
          <EntryCard
            to="/playlist"
            icon={ListMusic}
            label="歌单"
            hint={playlistCount > 0 ? `${playlistCount} 个歌单` : '同步账号'}
            delay={40}
          />
          <EntryCard
            to="/favorites"
            icon={Heart}
            label="我的收藏"
            hint={loveCount > 0 ? `${loveCount} 首` : '喜欢的歌'}
            delay={80}
          />
          <EntryCard to="/history" icon={History} label="播放历史" hint="最近听过" delay={100} />
          <EntryCard to="/local" icon={FileMusic} label="本地音乐" hint="服务端目录" delay={120} />
        </div>
      </section>

      {/* 3. 排行榜：给「不知道听什么」的人一个入口 */}
      <section>
        <SectionHeader title="排行榜" to="/leaderboard" icon={Trophy} />
        {boardsRes.status === 'loading' && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: BOARD_PREVIEW }).map((_, i) => (
              <span key={i} className="h-32 rounded-2xl bg-panel2" />
            ))}
          </div>
        )}
        {boards.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {boards.map((b, i) => (
              <Link
                key={b.id}
                to={`/leaderboard?source=${HOME_SOURCE}&bangid=${b.bangid}`}
                className="group rise flex flex-col rounded-2xl border border-line bg-panel p-2.5 shadow-card transition-all hover:border-line-strong hover:shadow-pop"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                {/* 插画块：榜单接口不返回封面，用统一的柔和色块代替，避免彩虹色破坏克制感 */}
                <span className="relative flex h-20 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <Music2 className="size-6" />
                  <span className="absolute bottom-1.5 right-1.5 flex size-6 translate-y-1 items-center justify-center rounded-full bg-accent text-white opacity-0 shadow-card transition-all group-hover:translate-y-0 group-hover:opacity-100">
                    <Play className="size-3 fill-current" />
                  </span>
                </span>
                <span className="mt-2 line-clamp-2 text-xs font-medium leading-5 text-ink">
                  {b.name}
                </span>
              </Link>
            ))}
          </div>
        )}
        {boardsRes.status === 'error' && (
          <p className="text-xs text-faint">榜单暂时取不到，可直接进「排行榜」页重试。</p>
        )}
      </section>

      {/* 4. 热门榜单试听：首页就要能直接听到歌 */}
      {previewSongs.length > 0 && (
        <section>
          <SectionHeader
            title={`热门榜单 · ${boardName}`}
            to="/leaderboard"
            extra={
              <Button
                variant="outline"
                size="sm"
                onClick={() => player.playQueue(previewSongs, 0)}
              >
                <Play className="size-3 fill-current" /> 播放全部
              </Button>
            }
          />
          <SongList songs={previewSongs} />
        </section>
      )}
      {firstBangid && previewRes.status === 'loading' && (
        <ul className="space-y-1" aria-busy="true" aria-label="榜单加载中">
          {Array.from({ length: 6 }).map((_, i) => (
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

      {/* 5. 服务器：一行小字，不抢音乐的位置 */}
      {isAdmin && status && (
        <p className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint')}>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-ok" /> 服务正常
          </span>
          <span>·</span>
          <span>已运行 {fmtUptime(status.uptime ?? 0)}</span>
          <span>·</span>
          <span>音源 {status.sourcesCount ?? 0} 个</span>
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
          <Link to="/settings/system" className="text-accent hover:underline">
            管理 →
          </Link>
        </p>
      )}
      {isAdmin && !status && (
        <p className="flex items-center gap-1.5 text-xs text-faint">
          <Loader2 className="size-3 animate-spin" /> 正在读取服务器状态…
        </p>
      )}
    </div>
  )
}
