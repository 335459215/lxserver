import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  FileMusic,
  Heart,
  Home,
  ListMusic,
  LogOut,
  Menu,
  Search,
  Settings,
  Trophy,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { api, AuthProvider, primaryRole, useAuth } from '@/lib/auth'
import { PlayerProvider, usePlayer } from '@/lib/player'
import { ToastHost } from '@/components/ui'
import PlayerBar from '@/components/player/PlayerBar'
import Dashboard from '@/pages/Dashboard'
import Login from '@/pages/Login'
import SettingsShell from '@/pages/settings/SettingsShell'
import UiShowcase from '@/pages/UiShowcase'
import SearchPage from '@/pages/player/SearchPage'
import PlaylistPage from '@/pages/player/PlaylistPage'
import PlaylistDetailPage from '@/pages/player/PlaylistDetailPage'
import NowPlayingPage from '@/pages/player/NowPlayingPage'
import LeaderboardPage from '@/pages/player/LeaderboardPage'
import { LocalMusicPage } from '@/pages/player/PlannedPages'
import FavoritesPage from '@/pages/player/FavoritesPage'

/** 身份徽章：管理员 > 用户 > 播放器 */
function RoleBadge() {
  const { auth } = useAuth()
  const role = primaryRole(auth)
  if (role === 'admin')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-xs text-ink">
        <span className="size-1.5 rounded-full bg-accent" /> 管理员
      </span>
    )
  if (role === 'user')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-xs text-ink">
        <span className="size-1.5 rounded-full bg-ok" /> {auth.user.username}
      </span>
    )
  if (role === 'player')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-xs text-ink">
        <span className="size-1.5 rounded-full bg-ok" /> 播放器
      </span>
    )
  return null
}

/** 音乐段导航（阶段 C：先壳与路由，页面按序接入） */
const MUSIC_NAV: Array<{ to: string; label: string; icon: LucideIcon; end?: boolean }> = [
  { to: '/', label: '首页', icon: Home, end: true },
  { to: '/search', label: '搜索', icon: Search },
  { to: '/playlist', label: '歌单', icon: ListMusic },
  { to: '/leaderboard', label: '排行榜', icon: Trophy },
  { to: '/favorites', label: '我的收藏', icon: Heart },
  { to: '/local', label: '本地音乐', icon: FileMusic },
]

/** 侧栏：只放「听歌」相关导航。
 *  设置是另一个功能区，收成单个入口（内部有分组导航）——把 9 组设置铺在主侧栏里
 *  会让「这是播放器」这件事被淹没，这也是旧版侧栏最不合理的地方。 */
function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const nav = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
      isActive ? 'bg-accent-soft font-medium text-accent' : 'text-dim hover:bg-panel2 hover:text-ink'
    }`
  return (
    <>
      {MUSIC_NAV.map((m) => (
        <NavLink key={m.to} to={m.to} end={m.end} className={nav} onClick={onNavigate}>
          <m.icon className="size-4" /> {m.label}
        </NavLink>
      ))}

      <div className="my-3 border-t border-line" />

      <NavLink to="/settings" className={nav} onClick={onNavigate}>
        <Settings className="size-4" /> 设置
      </NavLink>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3">
        <NavLink
          to="/dev"
          onClick={onNavigate}
          className="text-[11px] text-faint transition-colors hover:text-dim"
        >
          组件展示
        </NavLink>
        <a
          href="/"
          className="text-[11px] text-faint transition-colors hover:text-dim"
          title="旧版播放器（仍在 /，作为功能对照）"
        >
          旧版播放器
        </a>
      </div>
    </>
  )
}

/** 已登录骨架：顶栏（品牌 + 身份）+ 左侧边栏（桌面）/ 抽屉（移动）+ 底部播放栏 */
function Shell() {
  const { auth, refresh } = useAuth()
  const player = usePlayer()
  const navigate = useNavigate()
  const [drawer, setDrawer] = useState(false)

  return (
    <div className="min-h-screen">
      {/* 顶栏 */}
      <header className="sticky top-0 z-40 border-b border-line bg-panel/90 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4 md:px-6">
          <button
            className="rounded-lg p-2 text-dim hover:bg-panel2 hover:text-ink lg:hidden"
            onClick={() => setDrawer(true)}
            aria-label="打开导航"
          >
            <Menu className="size-5" />
          </button>
          <NavLink to="/" className="flex items-center gap-2 lg:hidden">
            <span className="size-2.5 rounded-full bg-accent" />
            <span className="font-semibold tracking-tight text-ink">lxserver</span>
            <span className="hidden text-xs text-faint sm:inline">音乐</span>
          </NavLink>
          <div className="ml-auto flex items-center gap-2">
            <RoleBadge />
            {(auth.admin.ok || auth.user.ok) && (
              <button
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-dim hover:bg-panel2 hover:text-ink"
                onClick={async () => {
                  // 退出即停播：否则音频元素（挂在 App 根部，跨登录态存活）
                  // 会在登录页背后继续出声，且没有任何可见控件可以停它
                  player.clear()
                  await api.logoutAll()
                  await refresh()
                  navigate('/')
                }}
              >
                <LogOut className="size-3.5" /> 退出
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 内容区：底部给常驻播放栏让位（--playerbar-h 与 PlayerBar 同源） */}
      <div className="mx-auto flex w-full max-w-6xl pb-[var(--playerbar-h)]">
        {/* 桌面侧边栏 */}
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem-var(--playerbar-h))] w-56 shrink-0 flex-col overflow-y-auto border-r border-line px-3 py-4 lg:flex">
          <NavItems />
        </aside>

        {/* 移动抽屉 */}
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-zinc-950/25" onClick={() => setDrawer(false)} />
            <div className="absolute inset-y-0 left-0 w-64 overflow-y-auto border-r border-line bg-panel p-4 shadow-pop rise">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">导航</span>
                <button className="rounded-md p-1.5 text-faint hover:text-ink" onClick={() => setDrawer(false)}>
                  <X className="size-4" />
                </button>
              </div>
              <NavItems onNavigate={() => setDrawer(false)} />
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 p-4 md:p-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/playlist" element={<PlaylistPage />} />
            <Route path="/playlist/:id" element={<PlaylistDetailPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/favorites" element={<FavoritesPage />} />
            <Route path="/local" element={<LocalMusicPage />} />
            <Route path="/now-playing" element={<NowPlayingPage />} />
            <Route path="/settings" element={<SettingsShell />} />
            <Route path="/settings/:group" element={<SettingsShell />} />
            <Route path="/dev" element={<UiShowcase />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      <PlayerBar />
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
  if (primaryRole(auth) === 'none') return <Login />
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
