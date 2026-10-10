import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { FileMusic, History, Home, ListMusic, MoreHorizontal, Search, Settings, Sparkles, Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePlayer } from '@/lib/player'
import { coverUrl } from '@/lib/music'

/** 底部 Tab 的主项（≤5 项：主流大厂共识，也是 Apple HIG / Material 的上限）。
 *  排序按「使用频率 × 拇指友好区」：最常用的搜索放最左（左手拇指最近处），
 *  首页紧邻；「更多」固定在最后一位收拢低频入口。
 *  「更多」刻意用 Sparkles 而不是 MoreHorizontal —— 后者是平台通用的「更多」语汇，
 *  但在这个光秃秃的浅色 Tab 栏里几乎不可识别；Sparkles 本项目的品牌图标（顶栏/登录页在用），
 *  在这里当「探索更多」讲得通，也让最低频的那个 Tab 在视觉上不至于是个占位符。 */
const TAB_NAV: Array<{ to: string; label: string; icon: LucideIcon; end?: boolean }> = [
  { to: '/search', label: '搜索', icon: Search },
  { to: '/', label: '首页', icon: Home, end: true },
  { to: '/playlist', label: '歌单', icon: ListMusic },
  { to: '/leaderboard', label: '排行榜', icon: Trophy },
]

/** 「更多」抽屉里的低频入口（含管理区）。 */
const MORE_NAV: Array<{ to: string; label: string; icon: LucideIcon; hint: string }> = [
  { to: '/favorites', label: '我的收藏', icon: Sparkles, hint: '喜欢过的歌' },
  { to: '/history', label: '播放历史', icon: History, hint: '最近听过什么' },
  { to: '/local', label: '本地音乐', icon: FileMusic, hint: '扫描本机曲库' },
  { to: '/settings', label: '设置', icon: Settings, hint: '音质 / 音源 / 账号' },
]

/** 迷你播放条：PlayerBar 在移动端的呈现。
 *  移动端没有独立播放栏——直接嵌进 Tab 栏上方，让「导航 + 播放」共享一块稳定的
 *  拇指可达区域；同时把可点击区域从 44px 放大到 60px（整行都是全屏播放页入口），
 *  这是手机上一只手最容易点到的位置。 */
function MiniPlayer() {
  const { current, status, position, duration, error } = usePlayer()
  const cover = coverUrl(current)
  const total = duration > 0 ? duration : 0
  const pct = total > 0 ? Math.min(100, (position / total) * 100) : 0

  return (
    <NavLink
      to={current ? '/now-playing' : '/search'}
      aria-label={current ? '展开全屏播放页' : '未在播放 · 去搜索'}
      className="flex min-h-[3.75rem] items-center gap-3 px-4 py-2"
    >
      <span className="relative size-10 shrink-0 overflow-hidden rounded-lg border border-line bg-panel2">
        {cover ? (
          <img src={cover} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-faint">
            <Search className="size-4" />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-5 text-ink">
          {current ? current.name : '未在播放'}
        </span>
        <span className="block truncate text-[11px] leading-4 text-faint">
          {error ?? current?.singer ?? '点这里搜索并播放'}
        </span>
      </span>
      {/* 极简进度：读得出「播到哪了」即可，精确 seek 留给全屏播放页 */}
      <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-panel2" aria-hidden>
        <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </span>
      {/* 播放状态指示：加载中呼吸、播放中常亮。这是条 fixed 栏，用 CSS 动画而不是
          等 position 变化去驱动每一帧 re-render（进度条已经是真值驱动了）。 */}
      {current && (status === 'loading' || status === 'playing') ? (
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full bg-accent',
            status === 'loading' ? 'animate-pulse' : '',
          )}
          aria-hidden
        />
      ) : null}
    </NavLink>
  )
}

/** 移动端底部 Tab 栏 + 迷你播放条（<1024px 常驻）。
 *
 *  为什么需要它：此前 <1024px 只有「顶栏汉堡 → 抽屉」这一条导航路径，
 *  抽屉是**模态**的——看什么就先盖住什么，且必须先进抽屉再出来，两跳才到目的地。
 *  Spotify / Apple Music / YouTube Music 在手机上都是「4–5 个常驻 Tab 常驻在拇指区」，
 *  一跳直达。这是本项目移动端与主流差距最大的一处结构。
 *
 *  「比原来更好」而不是「照抄」：
 *  1. 常驻的迷你播放条**嵌在 Tab 栏上方**（而不是像 Spotify 那样浮在 Tab 栏之上、遮挡它），
 *     于是 Tab 栏永远可点，且整条播放条可点击区域有 60px 高。
 *  2. 抽屉**没有删掉**——顶部汉堡按钮保留，抽屉里是全量导航（含管理区），
 *     等于「常驻快捷入口 + 深度导航」双通道，比只有其中一个都好用。
 *  3. 不引入任何新颜色：选中态用既有 `--accent` / `--accent-soft`，与桌面端同一语言。
 *
 *  定位方式（关键，别改成 position:sticky）：Tab 栏与播放条都是 `position: fixed`
 *  对齐**文档底部**，由 Shell 的 `pb-[var(--mobile-tabbar-h)]` 给内容区让位。
 *  fixed 不参与布局，页面不会因为它的出现/消失而跳动（软键盘弹出、旋转、内容增长都不抖），
 *  也没有 `bottom: 0` 那种「父级一有 transform/filter/contain 就错位」的隐患。
 *  代价是页面滚动后这条固定在**文档底**的栏会沉到视口下方（Windows 触屏等滚动条覆盖
 *  内容的平台会短暂露出一条缝），由下面的 effect 用 `scrollIntoView` 推回视口底。
 *  实测浏览器**不会**对 fixed 元素滚动（`scrollIntoView` 对它是空操作），
 *  所以这个调用是零副作用的，不会引起任何页面跳动。 */
export default function MobileTabBar() {
  const { pathname } = useLocation()
  const [more, setMore] = useState(false)

  useEffect(() => {
    const sync = () => document.getElementById('mobile-tabbar')?.scrollIntoView({ block: 'end' })
    sync()
    window.addEventListener('scroll', sync, { passive: true })
    window.addEventListener('resize', sync)
    return () => {
      window.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
    }
  }, [])

  return (
    <>
      {/* iOS 26 Liquid Glass 的克制版：白底 + 大圆角 + 细边 + 柔阴影。
          用 right-3（同时避开 Windows 覆盖式滚动条），再用 mx-auto + max-w 在
          平板/横屏下不让它被拉成一整条通栏。 */}
      <div
        id="mobile-tabbar"
        className="fixed bottom-0 right-3 z-40 lg:hidden"
        role="navigation"
        aria-label="移动端导航"
      >
        <div className="mx-auto mb-2 w-[min(26rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-line bg-panel/95 shadow-pop backdrop-blur">
          <MiniPlayer />
          <div className="flex items-stretch border-t border-line pb-[env(safe-area-inset-bottom)]">
            {TAB_NAV.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 transition-colors',
                    isActive ? 'text-accent' : 'text-faint active:text-dim',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <t.icon className="size-5" strokeWidth={isActive ? 2.4 : 2} />
                    <span className="text-[10px] leading-none">{t.label}</span>
                  </>
                )}
              </NavLink>
            ))}

            <button
              type="button"
              onClick={() => setMore(true)}
              aria-expanded={more}
              aria-haspopup="dialog"
              className="flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 text-faint transition-colors active:text-dim"
            >
              <MoreHorizontal className="size-5" />
              <span className="text-[10px] leading-none">更多</span>
            </button>
          </div>
        </div>
      </div>

      {/* 「更多」抽屉：复用顶部汉堡抽屉那一套全屏遮罩 + 面板。
          用 `<a>`+NavLink 而非按钮跳转，保住中键/新开标签的行为。 */}
      {more && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-label="更多">
          <div className="absolute inset-0 bg-zinc-950/25" onClick={() => setMore(false)} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-panel p-4 shadow-pop rise">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-ink">更多</span>
              <button
                type="button"
                className="rounded-md p-1.5 text-faint hover:text-ink"
                onClick={() => setMore(false)}
                aria-label="关闭"
              >
                <MoreHorizontal className="size-4 rotate-90" />
              </button>
            </div>
            <NavLink
              to="/playlist"
              onClick={() => setMore(false)}
              className="flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-panel2"
            >
              <ListMusic className="size-5 text-accent" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">全部歌单</span>
                <span className="block truncate text-xs text-faint">自己建的、收藏的都在这里</span>
              </span>
            </NavLink>
            {MORE_NAV.map((m) => (
              <NavLink
                key={m.to}
                to={m.to}
                onClick={() => setMore(false)}
                className="flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-panel2"
              >
                <m.icon className={cn('size-5', pathname === m.to ? 'text-accent' : 'text-dim')} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{m.label}</span>
                  <span className="block truncate text-xs text-faint">{m.hint}</span>
                </span>
              </NavLink>
            ))}
            <div className="mt-2 flex items-center gap-3 border-t border-line px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              <NavLink to="/dev" onClick={() => setMore(false)} className="text-[11px] text-faint hover:text-dim">
                组件展示
              </NavLink>
              {/* [v2.23.0] 「旧版播放器」入口已移除：旧版已于 v2.23.0 彻底删除。 */}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
