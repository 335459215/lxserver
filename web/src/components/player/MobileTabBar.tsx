import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { Home, ListMusic, Search, Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePlayer } from '@/lib/player'
import { coverUrl } from '@/lib/music'

/** 底部 Tab 的主项。
 *  排序按「使用频率 × 拇指友好区」：最常用的搜索放最左（左手拇指最近处），
 *  首页紧邻。
 *
 *  【v2.49.3：删掉「更多」】原来第 5 位是「更多」，点开是个抽屉，里面装
 *  「全部歌单 / 我的收藏 / 播放历史 / 本地音乐 / 设置」。用户反馈「多余、没必要」，
 *  也确实冗余：这些入口在**顶栏汉堡抽屉（App.tsx 的 NAV_DISCOVER/NAV_LIBRARY）里全都有一份**，
 *  于是同一批入口有两套容器，手机上点哪个都能到，反而要多记一次。
 *  删掉后 Tab 栏是 4 项（搜索/首页/歌单/排行榜），每项更宽、更好点；
 *  低频入口统一走顶部汉堡抽屉，只保留一条路径。 */
const TAB_NAV: Array<{ to: string; label: string; icon: LucideIcon; end?: boolean }> = [
  { to: '/search', label: '搜索', icon: Search },
  { to: '/', label: '首页', icon: Home, end: true },
  { to: '/playlist', label: '歌单', icon: ListMusic },
  { to: '/leaderboard', label: '排行榜', icon: Trophy },
]

/** 迷你播放条：PlayerBar 在移动端的呈现。
 *  移动端没有独立播放栏——直接嵌进 Tab 栏上方，让「导航 + 播放」共享一块稳定的
 *  拇指可达区域；同时把可点击区域从 44px 放大到 60px（整行都是全屏播放页入口），
 *  这是手机上一只手最容易点到的位置。 */
function MiniPlayer() {
  const { current, status, position, duration, error, seek } = usePlayer()
  const cover = coverUrl(current)
  const total = duration > 0 ? duration : 0
  const pct = total > 0 ? Math.min(100, (position / total) * 100) : 0
  // 进度条独立可点：点按/拖动跳转。整行NavLink负责「进全屏页」，进度条
  // stopPropagation 后自己吃掉这一下 —— 拇指最常划的就是这条位置。
  const barRef = React.useRef<HTMLSpanElement>(null)
  const seekFromEvent = (e: React.PointerEvent) => {
    if (!total) return
    const r = barRef.current?.getBoundingClientRect()
    if (!r || r.width === 0) return
    const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    seek(p * total)
  }

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
      {/* 可点进度条（v2.40.0）：从「纯指示」升级为「可直接点按跳转」。
          4px 高是/thumb 精度的下限，两端透明命中区各扩 6px（py 增大盒子），
          保证好点但不占视觉高度。点击会 stopPropagation，不触发整行的进全屏页。 */}
      <span
        ref={barRef}
        role="slider"
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(position)}
        tabIndex={current ? 0 : -1}
        onPointerDown={(e) => {
          if (!current) return
          e.stopPropagation()
          e.preventDefault()
          seekFromEvent(e)
          ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!current || e.buttons === 0) return
          e.stopPropagation()
          seekFromEvent(e)
        }}
        className="-my-1.5 flex h-7 w-16 shrink-0 cursor-pointer touch-none items-center py-2.5"
      >
        <span className="h-1 w-full overflow-hidden rounded-full bg-panel2" aria-hidden>
          <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </span>
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
 *  2. 低频入口统一走顶部汉堡抽屉（v2.49.3 起底部「更多」Tab 已删除，
 *     避免与汉堡抽屉放同一批入口、手机上要记两条路径）。
 *  3. 不引入任何新颜色：选中态用既有 `--accent` / `--accent-soft`，与桌面端同一语言。
 *
 *  定位方式：`position: fixed` + `bottom: 0`，由 Shell 的 `pb-[var(--mobile-tabbar-h)]`
 *  给内容区让位；fixed 不参与布局，所以栏的出现/消失不会让页面跳动。
 *
 *  【v2.50.2：删掉「滚动时 scrollIntoView 推回视口底」的 hack —— 那正是漂移的元凶】
 *  旧代码在 `scroll` 事件里调 `document.getElementById('mobile-tabbar')
 *  .scrollIntoView({ block: 'end' })`，注释里的前提是「浏览器不会滚动 fixed 元素，
 *  这个调用是空操作」。实测这个前提不成立：只要 fixed 元素的包含块不再是视口
 *  （祖先有 transform / filter / backdrop-filter / contain / will-change / perspective
 *  任意一条——iOS Safari 上尤其常见），`scrollIntoView` 就会**真的滚动页面**把这个元素
 *  送进视野。而它挂在 scroll 事件上，于是形成「用户滚 → 页面自己滚」的拉扯：
 *  实测在祖先带 contain:paint 时，一次 scrollBy(300) 直接把页面拉到文档最底
 *  （scrollY 300 → 2335），导航栏看起来就是「没固定、跟着内容走」。
 *  结论：这条栏靠 CSS 贴底就够了，**不要**再用 JS 去「纠正」它的位置。
 *  自查脚本：.playwright/_probe-scrollhack.py（对照 hack 开/关的滚动结果）。 */
export default function MobileTabBar() {
  const { pathname } = useLocation()
  const isNowPlaying = pathname === '/now-playing'

  return (
    <>
      {/* iOS 26 Liquid Glass 的克制版：白底 + 大圆角 + 细边 + 柔阴影。
          外层用 mx-auto + max-w 在平板/横屏下不让它被拉成一整条通栏。

          【底部那 8px 缝：这是本次修的真问题】
          浮层卡片用 mb-2（8px）与视口底边留一条"悬浮缝"——浮在**白色**内容上
          时看不出问题；可首页「今日甄选歌单」的封面是整块渐变，滚动到底时
          卡片会贴到浮层下沿，于是那 8px 缝里透出封面色，视觉上就是一条
          橙/绿色杂边（截图里非常显眼，会被当成渲染 bug）。
          两种改法：给缝加底色（仍有缝）、或让卡片真的贴底。
          这里选贴底 + 底部安全区 padding：浮层本来就该坐在安全区之上，
          缝隙交给 shadow-pop 的柔和投影去表达分层，不再靠"露出底色"。

          【定位用 inset-x-0，不是 left:var(--safe-left)】
          旧写法只给了 left、没给 right，fixed 盒子会收缩成内容宽度而非撑满，
          横屏/平板上右侧会露出未遮挡的内容。左右都钉 0 才是"整行占位"。

          【宽度用 100% 而不是 100vw】
          safe-area 非零时（横屏刘海机）`100vw` 是整屏宽度、不扣左右安全区，
          卡片会被顶出屏幕。父级已用 padding 让出安全区 + 0.75rem 视觉边距，
          子元素吃 100% 就是"已经扣好的可用宽度"。 */}
      <div
        id="mobile-tabbar"
        className="fixed inset-x-0 bottom-0 z-40 lg:hidden"
        role="navigation"
        aria-label="移动端导航"
        style={{
          paddingLeft: 'calc(var(--safe-left) + 0.75rem)',
          paddingRight: 'calc(var(--safe-right) + 0.75rem)',
        }}
      >
        <div className="mx-auto w-full max-w-[26rem] overflow-hidden rounded-t-2xl border border-b-0 border-line bg-panel/95 shadow-pop backdrop-blur">
          {!isNowPlaying && <MiniPlayer />}
          <div
            className={cn(
              'flex items-stretch',
              !isNowPlaying && 'border-t border-line',
            )}
          >
            {TAB_NAV.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 pb-[var(--safe-bottom)] transition-colors',
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
          </div>
        </div>
      </div>
    </>
  )
}
