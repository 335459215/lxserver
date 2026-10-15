import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  Download,
  FileMusic,
  Heart,
  History,
  Home,
  ListMusic,
  LogOut,
  Menu,
  Music2,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Settings,
  Sparkles,
  Trophy,
  X,
} from 'lucide-react'
import { api, AuthProvider, isAdmin, isLoggedIn, useAuth } from '@/lib/auth'
import { SETTINGS_GROUPS } from '@/lib/groups'
import { PlayerProvider, usePlayer } from '@/lib/player'
import { ToastHost } from '@/components/ui'
import { cn } from '@/lib/utils'
import { usePwaInstall } from '@/hooks/usePwaInstall'
import ErrorBoundary from '@/components/ErrorBoundary'
import PlayerBar from '@/components/player/PlayerBar'
import MobileTabBar from '@/components/player/MobileTabBar'
import NowPlayingPanel from '@/components/player/NowPlayingPanel'
import Dashboard from '@/pages/Dashboard'
import Login from '@/pages/Login'
import SettingsShell from '@/pages/settings/SettingsShell'
import SearchPage from '@/pages/player/SearchPage'
import PlaylistPage from '@/pages/player/PlaylistPage'
import PlaylistDetailPage from '@/pages/player/PlaylistDetailPage'
import NowPlayingPage from '@/pages/player/NowPlayingPage'
import LeaderboardPage from '@/pages/player/LeaderboardPage'
import ArtistPage from '@/pages/player/ArtistPage'
import ArtistNamePage from '@/pages/player/ArtistNamePage'
import AlbumPage from '@/pages/player/AlbumPage'
import LocalMusicPage from '@/pages/player/LocalMusicPage'
import FavoritesPage from '@/pages/player/FavoritesPage'
import HistoryPage from '@/pages/player/HistoryPage'

/** 身份徽章：登录账号名；管理员额外标注 */
function RoleBadge() {
  const { auth } = useAuth()
  if (!auth.user.ok) return null
  const initial = (auth.user.username?.[0] || 'U').toUpperCase()
  return (
    <div className="flex items-center gap-1.5 sm:gap-2 rounded-full border border-line/80 bg-panel/80 px-2 sm:px-2.5 py-1 text-xs shadow-xs backdrop-blur-sm">
      <span className="flex size-5 sm:size-5.5 items-center justify-center rounded-full bg-accent/15 text-accent font-semibold text-[11px]">
        {initial}
      </span>
      <span className="hidden sm:inline font-medium text-ink max-w-[90px] truncate">{auth.user.username}</span>
      {auth.user.isAdmin ? (
        <span className="rounded-full bg-accent/10 px-1.5 py-0.2 text-[10px] font-semibold text-accent">
          管理员
        </span>
      ) : (
        <span className="size-1.5 rounded-full bg-ok" />
      )}
    </div>
  )
}

/** 音乐库导航（分层结构：发现 / 音乐库） */
const NAV_DISCOVER = [
  { to: '/', label: '精选发现', icon: Home, end: true },
  { to: '/search', label: '搜索发现', icon: Search },
  { to: '/leaderboard', label: '排行榜单', icon: Trophy },
]

const NAV_LIBRARY = [
  { to: '/playlist', label: '我的歌单', icon: ListMusic },
  { to: '/favorites', label: '我喜欢的', icon: Heart },
  { to: '/history', label: '最近播放', icon: History },
  { to: '/local', label: '本地音乐', icon: FileMusic },
]

/** 侧栏：顶研级 Apple Music 质感，优雅分组与悬停微光 */
function NavItems({
  onNavigate,
  onInstall,
  isInstalled,
  canPromptNative,
}: {
  onNavigate?: () => void
  onInstall?: () => void
  isInstalled?: boolean
  canPromptNative?: boolean
}) {
  const { auth } = useAuth()
  const nav = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
      isActive
        ? 'bg-accent/10 text-accent font-semibold shadow-xs'
        : 'text-dim hover:bg-panel-2 hover:text-ink'
    }`
  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-faint uppercase">
          发现
        </div>
        <div className="space-y-1">
          {NAV_DISCOVER.map((m) => (
            <NavLink key={m.to} to={m.to} end={m.end} className={nav} onClick={onNavigate}>
              <m.icon className="size-4.5" />
              <span>{m.label}</span>
            </NavLink>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-faint uppercase">
          我的音乐库
        </div>
        <div className="space-y-1">
          {NAV_LIBRARY.map((m) => (
            <NavLink key={m.to} to={m.to} className={nav} onClick={onNavigate}>
              <m.icon className="size-4.5" />
              <span>{m.label}</span>
            </NavLink>
          ))}
        </div>
      </div>

      {isAdmin(auth) && (
        <div>
          <div className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-faint uppercase">
            管理
          </div>
          <div className="space-y-1">
            <NavLink to="/settings" className={nav} onClick={onNavigate}>
              <Settings className="size-4.5" />
              <span>系统设置</span>
            </NavLink>
          </div>
        </div>
      )}

      {canPromptNative && !isInstalled && onInstall && (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => {
              onInstall()
              onNavigate?.()
            }}
            className="flex w-full items-center gap-3 rounded-xl border border-line/80 bg-panel px-3 py-2.5 text-sm font-medium text-ink shadow-xs hover:border-accent/40 hover:bg-accent-soft hover:text-accent transition-all"
          >
            <Download className="size-4.5 text-accent" />
            <span>安装为独立应用</span>
          </button>
        </div>
      )}
    </div>
  )
}

/** 右侧「正在播放」面板的开关是否持久化（默认开；只在 ≥1280px 真正渲染） */
const STORAGE_PANEL = 'lx.panel.nowPlaying'

function restorePanel(): boolean {
  if (typeof localStorage === 'undefined') return true
  const raw = localStorage.getItem(STORAGE_PANEL)
  return raw === null ? true : raw === '1'
}

/** 把当前路由翻译成一句人话，供错误边界在崩溃时告诉用户「是哪一页炸了」。
 *  设置分组复用 SETTINGS_GROUPS 的 label，避免再维护一份会漂移的对照表。 */
function routeLabel(pathname: string): string {
  if (pathname.startsWith('/settings')) {
    const group = pathname.split('/')[2]
    const hit = SETTINGS_GROUPS.find((g) => g.key === group)
    return hit ? `设置 · ${hit.label}` : '设置'
  }
  const table: Array<[string, string]> = [
    ['/now-playing', '全屏播放'],
    ['/search', '搜索'],
    ['/leaderboard', '排行榜'],
    ['/playlist', '歌单'],
    ['/favorites', '我喜欢的'],
    ['/history', '最近播放'],
    ['/local', '本地音乐'],
    ['/artist', '歌手'],
    ['/album', '专辑'],
    ['/', '首页'],
  ]
  return table.find(([p]) => pathname.startsWith(p))?.[1] ?? '这一页'
}

/** 已登录骨架：顶栏（品牌 + 身份）+ 左侧边栏（桌面）/ 抽屉（移动）+ 主内容 + 右侧「正在播放」+ 底部播放栏 */
function Shell() {  const { auth, refresh } = useAuth()
  const player = usePlayer()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [drawer, setDrawer] = useState(false)
  const [panel, setPanel] = useState(restorePanel)
  const { isInstalled, triggerInstall, canPromptNative } = usePwaInstall()

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PANEL, panel ? '1' : '0')
    } catch {
      // 隐私模式
    }
  }, [panel])

  // 全屏播放页本身就是播放器，再挂右侧面板是重复，还会把内容挤窄
  const showPanel = panel && pathname !== '/now-playing'

  return (
    // 【为什么是 min-h-dvh 而不是 min-h-screen】
    // `min-h-screen` = `min-height: 100vh`，而 100vh **不减去**上面那个 sticky header 的高度
    // （实测 57px）。于是「header + 至少 100vh 的内容」永远比视口高 57px ——
    // 每一页都会出现一条多余的滚动条，全屏播放页尤其明显（沉浸式页面本该整屏不滚动）。
    // 换成 `100dvh`（动态视口高度）同样不解决「要减掉 header」这件事，所以真正的修法是：
    // 让内容区的最小高度 = 视口 − header 高度，两者相加恰好等于视口。
    <div className="flex min-h-[calc(100dvh-var(--header-h))] flex-col">
      {/* 顶栏：流体毛玻璃质感与全局搜索 */}
      <header className="sticky top-0 z-40 border-b border-line/70 bg-panel/85 backdrop-blur-xl">
        <div className="flex h-[var(--header-h)] items-center gap-4 px-4 md:px-8">
          <button
            className="-ml-2 rounded-xl p-2.5 text-dim hover:bg-panel-2 hover:text-ink lg:hidden transition-colors"
            onClick={() => setDrawer(true)}
            aria-label="打开导航"
          >
            <Menu className="size-5" />
          </button>

          {/* 品牌标识 */}
          <NavLink to="/" className="flex items-center gap-3 group">
            <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-tr from-accent to-indigo-400 text-white shadow-sm shadow-accent/25 transition-transform group-hover:scale-105">
              <Music2 className="size-5" />
            </span>
            <div className="flex flex-col">
              <span className="font-bold tracking-tight text-ink text-base leading-none">
                LX Music
              </span>
              <span className="hidden sm:inline text-[10px] font-medium text-faint tracking-wider uppercase mt-0.5">
                Acoustic Studio
              </span>
            </div>
          </NavLink>

          {/* 全局桌面搜索快捷条 */}
          <div className="hidden md:flex items-center flex-1 max-w-md mx-6">
            <div
              onClick={() => navigate('/search')}
              className="group flex w-full cursor-pointer items-center gap-2.5 rounded-full border border-line/80 bg-panel-2/80 px-4 py-2 text-xs text-dim transition-all hover:border-accent/40 hover:bg-panel hover:shadow-xs"
            >
              <Search className="size-3.5 text-faint group-hover:text-accent transition-colors" />
              <span className="flex-1 truncate">搜索海量音乐、歌手、专辑...</span>
              <kbd className="hidden sm:inline-block rounded-md border border-line bg-panel px-1.5 py-0.5 text-[10px] font-mono text-faint shadow-2xs">
                /
              </kbd>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {/* PWA 原生应用安装按钮：当浏览器支持安装且未安装时展示 */}
            {canPromptNative && !isInstalled && (
              <button
                type="button"
                onClick={triggerInstall}
                title="安装为独立桌面应用"
                className="flex items-center gap-1.5 rounded-xl border border-line/70 bg-panel px-2.5 py-1.5 text-xs font-medium text-dim hover:border-accent/40 hover:bg-accent-soft hover:text-accent transition-all"
              >
                <Download className="size-3.5 text-accent" />
                <span className="hidden sm:inline">安装应用</span>
              </button>
            )}

            {/* 无损母带品质标识 */}
            <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-ok/30 bg-ok/5 px-2.5 py-1 text-[11px] font-medium text-ok">
              <Sparkles className="size-3" />
              <span>Hi-Res Lossless</span>
            </div>

            {/* 正在播放抽屉开关 */}
            <button
              type="button"
              onClick={() => setPanel((v) => !v)}
              aria-pressed={panel}
              aria-label="正在播放面板"
              title={panel ? '收起播放面板' : '展开播放面板'}
              className="hidden size-9 items-center justify-center rounded-xl text-dim transition-all hover:bg-panel-2 hover:text-ink xl:flex border border-transparent hover:border-line/60"
            >
              {panel ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
            </button>

            <RoleBadge />

            {isLoggedIn(auth) && (
              <button
                className="flex items-center gap-1.5 rounded-xl border border-line/70 px-3 py-1.5 text-xs font-medium text-dim hover:border-danger/30 hover:bg-danger/5 hover:text-danger transition-all"
                onClick={async () => {
                  player.clear()
                  await api.logoutAll()
                  await refresh()
                  navigate('/')
                }}
              >
                <LogOut className="size-3.5" />
                <span className="hidden sm:inline">退出</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 内容区：底部给常驻播放栏让位。
          桌面是 PlayerBar（--playerbar-h），移动端是 MobileTabBar（--mobile-tabbar-h，含迷你播放条），
          两者在各自断点下非零、另一断点为 0，所以这里一条 pb- 就够，不用写两个媒体查询。 */}
      <div
        className={cn(
          'mx-auto flex w-full pb-[var(--mobile-tabbar-h)] lg:pb-[var(--playerbar-h)]',
          showPanel ? 'max-w-[104rem]' : 'max-w-6xl',
        )}
      >
        {/* 桌面侧边栏 */}
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem-var(--playerbar-h))] w-56 shrink-0 flex-col overflow-y-auto border-r border-line px-3 py-4 lg:flex">
          <NavItems
            onInstall={triggerInstall}
            isInstalled={isInstalled}
            canPromptNative={canPromptNative}
          />
        </aside>

        {/* 移动抽屉 */}
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-zinc-950/25" onClick={() => setDrawer(false)} />
            <div className="absolute inset-y-0 left-0 w-64 overflow-y-auto border-r border-line bg-panel p-4 shadow-pop rise">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">导航</span>
                <button
                  className="rounded-md p-1.5 text-faint hover:text-ink"
                  onClick={() => setDrawer(false)}
                >
                  <X className="size-4" />
                </button>
              </div>
              <NavItems
                onNavigate={() => setDrawer(false)}
                onInstall={triggerInstall}
                isInstalled={isInstalled}
                canPromptNative={canPromptNative}
              />
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 p-4 md:p-8">
          {/* 页面级错误边界：key 绑 pathname，换路由自动重建（=崩溃后点别的导航即可恢复）。
              放在 <main> 内部而不是整个 App 外面，是为了让崩溃时**顶栏/侧栏/底部 Tab 依然活着**，
              用户还有路可走 —— 之前没有边界时整棵树被卸载，连导航都消失了。 */}
          <ErrorBoundary key={pathname} label={routeLabel(pathname)}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/playlist" element={<PlaylistPage />} />
              <Route path="/playlist/:id" element={<PlaylistDetailPage />} />
              <Route path="/leaderboard" element={<LeaderboardPage />} />
              <Route path="/artist/:id" element={<ArtistPage />} />
              <Route path="/artist-name/:name" element={<ArtistNamePage />} />
              <Route path="/album/:id" element={<AlbumPage />} />
              <Route path="/favorites" element={<FavoritesPage />} />
              <Route path="/local" element={<LocalMusicPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/now-playing" element={<NowPlayingPage />} />
              <Route path="/settings" element={<SettingsShell />} />
              <Route path="/settings/:group" element={<SettingsShell />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </main>

        {/* 右侧「正在播放」常驻面板（≥1280px；全屏播放页不重复挂） */}
        {showPanel && <NowPlayingPanel onClose={() => setPanel(false)} />}
      </div>

      <PlayerBar />
      <MobileTabBar />
    </div>
  )
}

function Gate() {
  const { auth } = useAuth()
  if (auth.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-dim">
          <span className="size-2 animate-pulse rounded-full bg-accent" />
          正在连接服务器…
        </div>
      </div>
    )
  }
  // 首访即登录：未持有任何有效身份时不露出任何导航
  if (!isLoggedIn(auth)) return <Login />
  return <Shell />
}

export default function App() {
  return (
    <AuthProvider>
      {/* 播放器内核挂在最外层：<audio> 元素（约束一）必须跨路由/登录态存活，
          不能被任何条件渲染包住，否则切页就会把正在播的元素卸载掉 */}
      <PlayerProvider>
        <ToastHost>
          <Gate />
        </ToastHost>
      </PlayerProvider>
    </AuthProvider>
  )
}
