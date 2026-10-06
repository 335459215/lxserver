import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { Home, LogOut, Menu, Shapes, X } from 'lucide-react'
import { useState } from 'react'
import { api, AuthProvider, primaryRole, useAuth } from '@/lib/auth'
import { SETTINGS_GROUPS } from '@/lib/groups'
import { ToastHost } from '@/components/ui'
import Dashboard from '@/pages/Dashboard'
import Login from '@/pages/Login'
import SettingsShell from '@/pages/settings/SettingsShell'
import UiShowcase from '@/pages/UiShowcase'

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

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const nav = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
      isActive ? 'bg-accent-soft font-medium text-accent' : 'text-dim hover:bg-panel2 hover:text-ink'
    }`
  return (
    <>
      <NavLink to="/" end className={nav} onClick={onNavigate}>
        <Home className="size-4" /> 首页
      </NavLink>
      <p className="mt-5 px-3 text-[11px] font-medium tracking-widest text-faint">设置中心</p>
      {SETTINGS_GROUPS.map((g) => (
        <NavLink key={g.key} to={`/settings/${g.key}`} className={nav} onClick={onNavigate}>
          <g.icon className="size-4" /> {g.label}
        </NavLink>
      ))}
      <p className="mt-5 px-3 text-[11px] font-medium tracking-widest text-faint">开发</p>
      <NavLink to="/dev" className={nav} onClick={onNavigate}>
        <Shapes className="size-4" /> 组件展示
      </NavLink>
    </>
  )
}

/** 已登录骨架：顶栏（品牌 + 身份）+ 左侧边栏（桌面）/ 抽屉（移动） */
function Shell() {
  const { auth, refresh } = useAuth()
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
            <span className="hidden text-xs text-faint sm:inline">管理台</span>
          </NavLink>
          <div className="ml-auto flex items-center gap-2">
            <RoleBadge />
            {(auth.admin.ok || auth.user.ok) && (
              <button
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-dim hover:bg-panel2 hover:text-ink"
                onClick={async () => {
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

      <div className="mx-auto flex w-full max-w-6xl">
        {/* 桌面侧边栏 */}
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 flex-col overflow-y-auto border-r border-line px-3 py-4 lg:flex">
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
            <Route path="/settings" element={<SettingsShell />} />
            <Route path="/settings/:group" element={<SettingsShell />} />
            <Route path="/dev" element={<UiShowcase />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
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
      <ToastHost>
        <Gate />
      </ToastHost>
    </AuthProvider>
  )
}
