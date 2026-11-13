import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  Download,
  FileMusic,
  Heart,
  History,
  Home,
  Keyboard,
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
import { clearSearchSnapshot } from '@/lib/searchSession'
import { ToastHost } from '@/components/ui'
import { cn } from '@/lib/utils'
import { usePwaInstall } from '@/hooks/usePwaInstall'
import ErrorBoundary from '@/components/ErrorBoundary'
import PlayerBar from '@/components/player/PlayerBar'
import MobileTabBar from '@/components/player/MobileTabBar'
import NowPlayingPanel from '@/components/player/NowPlayingPanel'
import KeyboardShortcuts from '@/components/player/KeyboardShortcuts'
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
      <span className="flex size-5 sm:size-6 items-center justify-center rounded-full bg-accent/15 text-accent font-semibold text-[11px]">
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
              <m.icon className="size-4" />
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
              <m.icon className="size-4" />
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
              <Settings className="size-4" />
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
            <Download className="size-4 text-accent" />
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

  // 【v2.50.2：换路由时把内层滚动容器归零】
  //
  // 旧版滚动发生在 document 上，换页时浏览器自己就把位置重置了，没人写过这行代码。
  // 改成「内层 main 自己滚」之后这个行为就丢了 —— 从长列表点进详情会**停在上一次的
  // 滚动位置**（实测从首页滚到 553px 再点「排行榜」，新页面直接从中间开始）。
  // 这是切换滚动容器必然要补的一步，不是可选项。
  //
  // 依赖只写 pathname：同一页内的 query 变化（搜索词）不该把位置清掉，
  // 那会打断「搜到一半接着往下翻」。
  useEffect(() => {
    const el = document.getElementById('app-scroll')
    if (el) el.scrollTop = 0
    // 桌面宽屏下浏览器可能仍把 window 当滚动容器（例如某些扩展注入），一并归零。
    if (window.scrollY !== 0) window.scrollTo(0, 0)
  }, [pathname])

  return (
    // 【v2.50.2：滚动收进内层容器，html/body 不再参与滚动】
    //
    // 之前的写法是「整页滚动 + sticky 顶栏 + fixed 底栏」，在 Chrome 里没问题，
    // 但在 iOS Safari（尤其 iOS 26 折叠地址栏）上不稳定：
    //   - 页面滚到底、地址栏收缩时，浏览器会**整体位移视口**，
    //     `position: fixed` / `sticky` 元素跟着一起位移；
    //   - 表现为顶部导航消失、底部 Tab 栏浮到页面中部（用户截图就是这样），
    //     也就是「导航栏没有固定，跟着上下活动一起走了」。
    // 现在的结构是**不滚动的外壳 + 内层滚动区**：
    //   html/body 高度锁 100%（index.css），外壳 h-[100dvh] overflow-hidden，
    //   中间 #app-scroll 自己 overflow-y:auto。
    // 根节点不再是滚动容器 → 浏览器没有「折叠地址栏把整页推走」的机会，
    // 两条导航栏相对于一个静止的盒子定位，真机上就不会再漂。
    // 注意：`overflow-hidden` 只加在外壳上，不能加到 html/body 上 ——
    // 那会让 Safari 的地址栏不再收缩，且返回时丢失滚动位置。
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      {/* 全局快捷键（渲染 null）：必须在 ToastHost + PlayerProvider 之内 */}
      <KeyboardShortcuts />
      {/* 顶栏：流体毛玻璃质感与全局搜索 */}
      {/* 顶栏：流体毛玻璃质感与全局搜索。
          PWA standalone 下（viewport-fit=cover）页面会铺到状态栏底下，
          顶部要加 safe-area-inset-top 避让刘海 —— 桌面/普通浏览器里 env() 为 0，零影响。

          【v2.50.2：sticky → shrink-0（不参与滚动，自然不需要 sticky）】
          外壳不再滚动，顶栏就是 flex 列的第一行，本来就恒在顶部；
          保留 sticky 只会让它在内层滚动容器之外「看似 sticky」，
          反而在 iOS 上叠一层没必要的位移计算风险。 */}
      <header
        className="z-40 shrink-0 border-b border-line/70 bg-panel/85 backdrop-blur-xl"
        style={{ paddingTop: 'var(--safe-top)' }}
      >
        <div className="flex h-[var(--header-h)] items-center gap-4 px-4 md:px-8">
          <button
            className="-ml-2 flex size-10 max-md:size-11 items-center justify-center rounded-xl text-dim hover:bg-panel-2 hover:text-ink lg:hidden transition-colors"
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

          {/* 全局桌面搜索快捷条。
              ⚠️ 搜索条在 `md`(768) 就出现，而汉堡/侧栏要到 `lg`(1024) 才切换 ——
              768~1023 这一档顶栏要同时装下「汉堡 + 品牌 + 搜索 + 右控件簇」。
              必须给本容器与内层都加 `min-w-0`：flex 项默认 `min-width:auto`，
              最小宽 = 文字宽（实测 238px），**不会随视口收窄**，于是整条顶栏的
              min-content 被锁死在 835px —— 768~834px 下每页横向溢出 67px、
              右侧控件被裁到屏幕外（check-overflow 的 tablet-768 常年红）。
              另加 `lg:min-w-[9rem]` 下限，避免 768 下搜索框被压成只剩图标一条缝。 */}
          <div className="hidden md:flex items-center flex-1 min-w-0 lg:min-w-[9rem] max-w-md mx-3 lg:mx-6">
            <div
              onClick={() => navigate('/search')}
              className="group flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-full border border-line/80 bg-panel-2/80 px-4 py-2 text-xs text-dim transition-all hover:border-accent/40 hover:bg-panel hover:shadow-xs"
            >
              <Search className="size-3.5 shrink-0 text-faint group-hover:text-accent transition-colors" />
              <span className="flex-1 truncate">搜索海量音乐、歌手、专辑...</span>
              <kbd className="hidden lg:inline-block rounded-md border border-line bg-panel px-1.5 py-0.5 text-[10px] font-mono text-faint shadow-2xs">
                /
              </kbd>
            </div>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2 xl:gap-3">
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

            {/* 无损母带品质标识：纯装饰（无交互），lg 以下隐藏 ——
                它是顶栏最宽的非必要元素（实测 121px），768~1023 这一档
                先牺牲它，把空间让给搜索与账号操作。 */}
            <div className="hidden lg:flex items-center gap-1.5 rounded-full border border-ok/30 bg-ok/5 px-2.5 py-1 text-[11px] font-medium text-ok">
              <Sparkles className="size-3" />
              <span>Hi-Res Lossless</span>
            </div>

            {/* 正在播放抽屉开关 */}
            {/* 快捷键帮助入口：真正的开关在 KeyboardShortcuts 里监听这个事件 */}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('lx:shortcuts-help'))}
              aria-label="键盘快捷键"
              title="键盘快捷键（?）"
              aria-haspopup="dialog"
              className="hidden size-9 items-center justify-center rounded-xl border border-transparent text-dim transition-all hover:border-line/60 hover:bg-panel-2 hover:text-ink md:flex"
            >
              <Keyboard className="size-4" />
            </button>

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
                className="flex h-9 max-md:h-11 max-md:min-w-11 items-center justify-center gap-1.5 rounded-xl border border-line/70 px-3 py-1.5 text-xs font-medium text-dim hover:border-danger/30 hover:bg-danger/5 hover:text-danger transition-all"
                onClick={async () => {
                  player.clear()
                  // 搜索快照是账号相关的临时态：退出/切换账号后不该把上一个人的
                  // 搜索结果带到下一个会话里（与 player.clear 同一语义）。
                  clearSearchSnapshot()
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
          两者在各自断点下非零、另一断点为 0，所以这里一条 pb- 就够，不用写两个媒体查询。

          【为什么移动端还要再加 --safe-bottom】
          --mobile-tabbar-h 是「迷你播放条 + Tab 行」的固定高度，不含 iOS 手势条安全区；
          而 Tab 行自己用 pb-[var(--safe-bottom)] 把内容顶了上来 —— 也就是栏的实际高度
          会多出安全区那一截。内容区不多留这一截，滚到底时最后一行会压在通道上。
          env() 在桌面恒为 0，这条 calc 在桌面上等于原值。

          【v2.50.2 结构：一条「不滚动」的 flex 行，只有 main 自己滚】
            ├─ aside      桌面侧栏（不滚，固定一列）
            ├─ main       内层滚动容器（overscroll-contain）
            └─ aside      右侧正在播放面板（不滚，固定一列）
          侧栏与右面板**不能**放进滚动容器里：那样一滚就跟着走（桌面回归里实测到）。
          只有 main 滚，才是桌面端原本的手感，也顺带让两条栏的定位基准保持静止。
          `overscroll-contain` 防止滚到边界后把滚动「传给」外层（iOS 上这会把地址栏
          弹出来、连带位移视口，正是导航栏漂移的触发条件之一）。 */}
      <div className="flex w-full flex-1 overflow-hidden">
        {/* 内容列：居中限宽。外层 flex 行满宽（滚动条贴内容区右缘），内容按 max-w 居中。 */}
        <div
          className={cn(
            'mx-auto flex w-full overflow-hidden',
            showPanel ? 'max-w-[104rem]' : 'max-w-6xl',
          )}
        >
          {/* 桌面侧边栏（高度 = 视口 − 顶栏 − 播放栏，自身可滚，位置不随内容移动） */}
          <aside className="hidden h-[calc(100dvh-var(--header-h)-1px-var(--playerbar-h))] w-56 shrink-0 flex-col overflow-y-auto border-r border-line px-3 py-4 lg:flex">
            <NavItems
              onInstall={triggerInstall}
              isInstalled={isInstalled}
              canPromptNative={canPromptNative}
            />
          </aside>

          <main
            id="app-scroll"
            className={cn(
              'min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 md:p-8',
              // 全屏播放页不渲染迷你播放条（见 MobileTabBar），底部只需给 Tab 行让位，
              // 否则歌词框与 Tab 栏之间会空出 --miniplayer-h 那么高的死白。
              pathname.startsWith('/now-playing')
                ? 'pb-[calc(var(--mobile-tabbar-h)-var(--miniplayer-h)+var(--safe-bottom))] lg:pb-[var(--playerbar-h)]'
                : 'pb-[calc(var(--mobile-tabbar-h)+var(--safe-bottom))] lg:pb-[var(--playerbar-h)]',
            )}
          >

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
      </div>

      {/* 移动抽屉 */}
      {/* 【v2.50.2：抽屉挂在 Shell 根下，与滚动容器平级】
          fixed 在滚动容器**内部**时，部分 WebKit 版本会把它的包含块认成那个滚动容器，
          于是抽屉的 inset-0 只盖住内容区而不是整屏，遮罩漏出顶栏与底栏。
          放在这里（滚动区之外）后，它覆盖的才是整个视口。 */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-zinc-950/25" onClick={() => setDrawer(false)} />
          {/* 抽屉要避开刘海与手势条：横向（横屏左缘）+ 顶部 + 底部。
              padding-bottom 用 calc 叠加，横屏时左缘用 padding-left 避开刘海。 */}
          <div
            className="absolute inset-y-0 left-0 w-64 overflow-y-auto border-r border-line bg-panel p-4 shadow-pop rise"
            style={{
              paddingLeft: 'calc(1rem + var(--safe-left))',
              paddingTop: 'calc(1rem + var(--safe-top))',
              paddingBottom: 'calc(1rem + var(--safe-bottom))',
            }}
          >
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

      {/* 底部两条栏都在滚动容器之外，所以它们只相对视口定位，不会随内容滚动。 */}
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
