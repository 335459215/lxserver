import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, Download, Loader2, Music2, Search, TriangleAlert } from 'lucide-react'
import { Button, Tabs, TabsContent, TabsList, TabsTrigger, useToast } from '@/components/ui'
import { coverUrl, formatTime, intervalToSeconds, sourceLabel } from '@/lib/music'
import { useCoverAccent } from '@/lib/coverColor'
import { usePlayer } from '@/lib/player'
import { downloadSong } from '@/lib/download'
import { ProgressRow, TransportControls } from '@/components/player/TransportControls'
import QualityMenu from '@/components/player/QualityMenu'
import Lyrics from '@/components/player/Lyrics'
import QueueList from '@/components/player/QueueList'
import { cn } from '@/lib/utils'

/** 只有从屏幕顶部这一带开始的拖动才算「下拉返回」。
 *  为什么不整页都能拖：下面歌词区/队列区本来就要能上下滚动，
 *  整页接管手势会让歌词划不动。用户要的也正是「从上方往下拉」。 */
const TOP_ZONE_PX = 140
/** 松手时位移超过这个值就判定为「要返回」，否则弹回去 */
const DISMISS_PX = 110
/** 跟手阻尼：手指走 100px，页面只走 65px —— 有「拉得动但有点重」的手感 */
const DRAG_DAMPING = 0.65
/** 关闭动画时长，必须与下面 transition 里的 260ms 一致（超时后才会真正跳路由） */
const CLOSE_MS = 260

/** 下拉返回手势。
 *
 *  【为什么监听挂在 window 上，而不是页面根节点上】
 *  第一版把 onTouchStart 挂在播放页自己的 div 上，实测**手势完全不生效**：
 *  页面 div 的顶边在顶栏（约 57px）+ main 的 p-4 之下，也就是从 ~73px 才开始；
 *  用户「从最上方往下拉」时手指落在**顶栏**上，事件在顶栏那棵子树里冒泡，
 *  永远走不到播放页的 div。挂在 window 上则整个视口顶部都能起手，
 *  这才是「从上方往下拉」应有的手感。
 *
 *  【为什么用原生监听而不是 React 的 onTouchMove】
 *  需要 preventDefault 阻止拖拽期间页面跟着滚动，而 React 17+ 把 touchmove
 *  注册成 passive，在合成事件里调用 preventDefault 会被忽略并告警。
 *  原生监听加 `{ passive: false }` 才拦得住。
 *
 *  【为什么只在顶部起手】
 *  下面歌词区/队列区本来就要能上下滚动，整页接管手势会让歌词划不动。
 *
 *  【为什么关闭动画结束后才 navigate】
 *  直接 navigate 会让本页瞬间卸载，用户看到的是「拖到一半突然跳走」；
 *  先把页面推到底（transform 到视口高度）再跳，视觉上才是「把它拉下去收走」。 */
function usePullDownToClose(onClose: () => void) {
  const [offset, setOffset] = React.useState(0)
  const [dragging, setDragging] = React.useState(false)
  const [closing, setClosing] = React.useState(false)
  const startY = React.useRef<number | null>(null)
  // finish 里要读最新位移，但它被注册在 effect 里（闭包会captured 旧值），用 ref 兜住
  const offsetRef = React.useRef(0)
  const closingRef = React.useRef(false)

  React.useEffect(() => {
    offsetRef.current = offset
  }, [offset])
  React.useEffect(() => {
    closingRef.current = closing
  }, [closing])

  React.useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (closingRef.current || e.touches.length !== 1) return
      if (e.touches[0].clientY > TOP_ZONE_PX) return
      startY.current = e.touches[0].clientY
    }

    const onMove = (e: TouchEvent) => {
      if (startY.current === null || e.touches.length !== 1) return
      const dy = e.touches[0].clientY - startY.current
      if (dy <= 0) {
        // 往上推不做事：本页没有「上滑」语义，交给内部滚动
        setOffset(0)
        return
      }
      setDragging(true)
      setOffset(dy * DRAG_DAMPING)
      // 拖拽期间阻止页面跟着滚，否则会出现「拉一半内容自己滚上去了」
      if (e.cancelable) e.preventDefault()
    }

    const finish = () => {
      if (startY.current === null) return
      startY.current = null
      setDragging(false)
      if (offsetRef.current > DISMISS_PX) {
        setClosing(true)
        setOffset(window.innerHeight)
        window.setTimeout(onClose, CLOSE_MS)
      } else {
        setOffset(0)
      }
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', finish)
    window.addEventListener('touchcancel', finish)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', finish)
      window.removeEventListener('touchcancel', finish)
    }
  }, [onClose])

  return { offset, dragging, closing }
}

/** 全屏播放页（/now-playing）：大封面 + 传输控制 + 歌词/队列。
 *  - 歌词：自动滚动当前行、点行跳转、逐字卡拉 OK 高亮（Lyrics.tsx）
 *  - 取色：封面主色覆盖 --accent（SPlayer 式），取不到则回落默认靛蓝 */
export default function NowPlayingPage() {
  const player = usePlayer()
  const navigate = useNavigate()
  const { current, status, error, attempts, duration, sourceName } = player
  const { toast } = useToast()
  const [downloading, setDownloading] = React.useState(false)

  const cover = coverUrl(current)
  const tokens = useCoverAccent(cover)

  const handleDownload = async () => {
    if (!current || downloading) return
    setDownloading(true)
    toast({
      title: `正在准备下载《${current.name}》`,
      description: '正在获取音频流并写入 ID3 标签、封面及歌词...',
    })
    try {
      const res = await downloadSong(current)
      toast({
        title: `已开始下载《${current.name}》`,
        description: `音质：${res.quality} · 文件：${res.filename}`,
        variant: 'success',
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '下载准备失败'
      toast({
        title: `下载《${current.name}》失败`,
        description: message,
        variant: 'destructive',
      })
    } finally {
      setDownloading(false)
    }
  }

  // 封面取色只在「本页 + 本曲」生效：变量挂在页面根节点上，离开本页即恢复默认靛蓝。
  // `--accent*-rgb` 必须一起写：Tailwind 的 `bg-accent/60` / `ring-accent/40` 靠三元组合成透明度，
  // 只写 hsl 形式会让这些半透明类留在这首歌的取色上不跟随。
  const accentStyle = React.useMemo(
    () =>
      tokens
        ? ({
            '--accent': tokens.accent,
            '--accent-hover': tokens.hover,
            '--accent-soft': tokens.soft,
            '--accent-rgb': tokens.accentRgb,
            '--accent-hover-rgb': tokens.hoverRgb,
            '--accent-soft-rgb': tokens.softRgb,
          } as React.CSSProperties)
        : undefined,
    [tokens],
  )

  /** 返回上一页。优先回退历史（保留来路，比如从歌单点进来的就回歌单）；
   *  直接刷新打开本页时没有历史可退，落到首页而不是把用户卡在白页。
   *  React Router v7 会在 history.state.idx 里维护栈深度，用它判断比
   *  `history.length > 1` 准（后者在 SPA 里常年为 1，会把回退做成「无反应」）。 */
  const goBack = React.useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/')
  }, [navigate])

  // 下拉返回：hook 必须在 `if (!current)` 之前调用（Hook 不能有条件）
  const { offset, dragging, closing } = usePullDownToClose(goBack)

  // 空态
  if (!current) {
    return (
      <div className="rise mx-auto flex w-full max-w-xl flex-col items-center gap-6 py-2 md:gap-8 md:py-6">
        <div className="flex aspect-square w-52 items-center justify-center rounded-3xl border border-line bg-panel shadow-pop md:w-64">
          <Music2 className="size-12 text-faint" />
        </div>
        <div className="text-center">
          <h1 className="text-lg font-semibold tracking-tight text-ink">还没有正在播放的歌曲</h1>
          <p className="mt-1 text-sm text-dim">搜索并播放一首歌，这里会显示大封面、歌词与控制。</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={goBack}>
            <ChevronDown className="size-4" /> 返回
          </Button>
          <Button asChild>
            <Link to="/search">
              <Search className="size-4" /> 去搜索音乐
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  const total = duration > 0 ? duration : intervalToSeconds(current.interval)
  const subtitle = [current.singer, current.albumName].filter(Boolean).join(' · ')

  // 拖动进度（0~1）用来同步压暗遮罩，让「越往下拉、底下的页面越暗」成立
  const pullRatio = Math.min(offset / 320, 1)

  return (
    <>
      {/* 下拉时露出的遮罩：拉得越深越暗，给「正在把这一页收走」的反馈。
          只在本页覆盖内容区，不做整屏 fixed —— 底部播放栏/Tab 栏要保持可见。 */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-30 bg-zinc-950 transition-opacity duration-200"
        style={{ opacity: offset > 0 ? pullRatio * 0.35 : 0 }}
      />

      {/* 【为什么手势位移要单独套一层 wrapper】
          把 transform 直接写在带 `rise` 入场动画的那个元素上，实测**完全不生效**：
          CSS 动画（animation）在层叠里属于更高优先级，会盖掉同一元素上的
          inline transform —— 表现是 inline style 里明明写着 translateY(91px)，
          getComputedStyle 却依然是单位矩阵，页面纹丝不动。
          拆成两层各管一件事：外层只做手势位移（transform），内层保留入场动画，
          两者互不覆盖。 */}
      <div
        style={{
          transform: offset > 0 ? `translateY(${offset}px) scale(${1 - pullRatio * 0.04})` : undefined,
          transformOrigin: 'top center',
          // 跟手阶段必须去掉过渡，否则会有明显的「延迟黏滞」；
          // 松手/关闭阶段才交给缓动曲线把它送回去或送出去。
          transition: dragging ? 'none' : `transform ${CLOSE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
          opacity: closing ? 1 - pullRatio * 0.6 : 1,
        }}
      >
      <div
        style={accentStyle}
        className="accent-fade rise relative z-40 mx-auto grid w-full max-w-5xl gap-6 py-2 md:gap-8 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:items-start lg:gap-10 lg:py-4"
      >
        {/* 返回：按钮 + 下拉手势两条路都给。
            图标用 ChevronDown 而不是箭头向左 —— 本页的返回语义就是「往下拉走」，
            图标和手势方向一致，用户不用猜。
            移动端顶部留一条显式把手（那条小横杠），暗示这里可以往下拖。 */}
        <div className="col-span-full -mb-2 flex items-center gap-2 lg:-mb-4">
          <button
            type="button"
            onClick={goBack}
            aria-label="返回上一页"
            className="flex items-center gap-1.5 rounded-full border border-line/80 bg-panel px-3 py-1.5 text-xs font-medium text-dim shadow-2xs transition-all hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
          >
            <ChevronDown className="size-3.5" />
            <span>返回</span>
          </button>
          <span
            aria-hidden
            className="mx-auto h-1 w-10 rounded-full bg-line-strong/70 lg:hidden"
          />
        </div>

      {/* 左：封面 + 唱片反光与声学动感 + 控制（桌面吸顶，滚动歌词时控制不跑掉） */}
      <section className="flex flex-col items-center gap-6 lg:sticky lg:top-20">
        <div className="relative mx-auto flex items-center justify-center">
          {/* 氛围光：封面放大模糊铺底 */}
          {cover && (
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-4 rounded-[2.5rem] opacity-50 blur-3xl saturate-200 transition-opacity"
              style={{ backgroundImage: `url(${cover})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
            />
          )}

          {/* 拟物黑胶唱片（在封面背后探出半截并转动） */}
          <div
            className={cn(
              'absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 size-56 md:size-64 rounded-full bg-zinc-950 p-2 shadow-2xl transition-all duration-700',
              status === 'playing' ? 'translate-x-8 md:translate-x-12 rotate-12' : 'translate-x-2',
            )}
          >
            <div
              className={cn(
                'size-full rounded-full border-4 border-zinc-900/90 flex items-center justify-center',
                status === 'playing' ? 'animate-vinyl' : 'animate-vinyl animate-vinyl-paused',
              )}
              style={{
                background:
                  'radial-gradient(circle, #27272a 18%, #09090b 20%, #18181b 38%, #09090b 40%, #27272a 60%, #09090b 62%, #18181b 80%, #09090b 82%)',
              }}
            >
              <div className="size-16 md:size-20 rounded-full border-2 border-white/20 bg-accent/85 flex items-center justify-center">
                <div className="size-5 rounded-full bg-zinc-950" />
              </div>
            </div>
          </div>

          {/* 专辑封面封套主体 */}
          <div className="relative z-10 aspect-square w-56 md:w-64 rounded-3xl border border-white/80 bg-panel shadow-2xl overflow-hidden group">
            {cover ? (
              <img
                src={cover}
                alt={current.name}
                className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
            ) : (
              <div className="flex size-full items-center justify-center bg-panel-2 text-faint">
                <Music2 className="size-16" />
              </div>
            )}
          </div>
        </div>

        <div className="w-full text-center">
          <h1 className="truncate text-xl md:text-2xl font-extrabold tracking-tight text-ink" title={current.name}>
            {current.name}
          </h1>
          <p className="mt-1 truncate text-sm font-medium text-dim">{subtitle || '未知歌手'}</p>

          {/* 元信息标签栏：音源平台 · 无损音质 · 时长 · 一键高保真下载 */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs">
            <span className="rounded-md border border-line bg-panel-2/80 px-2 py-0.5 font-medium text-dim">
              {sourceName ?? sourceLabel(current.source)}
            </span>
            <QualityMenu className="h-6 px-2 rounded-md border border-accent/25 bg-accent/10 font-semibold text-accent hover:bg-accent/20" />
            {total > 0 && (
              <span className="rounded-md border border-line bg-panel-2/80 px-2 py-0.5 font-mono text-faint">
                {formatTime(total)}
              </span>
            )}
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              aria-label={`下载当前歌曲 ${current.name}`}
              title={downloading ? '正在准备下载...' : `下载到本地 (${current.name})`}
              className="inline-flex h-6 items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 text-xs font-semibold text-dim shadow-2xs transition-all hover:border-accent/40 hover:bg-accent-soft hover:text-accent disabled:opacity-50 active:scale-95"
            >
              {downloading ? (
                <Loader2 className="size-3 animate-spin text-accent" />
              ) : (
                <Download className="size-3" />
              )}
              <span>下载本曲</span>
            </button>
          </div>
        </div>

        <div className="flex w-full flex-col items-center gap-4">
          <ProgressRow showPreview />
          <TransportControls size="lg" showMode />
        </div>

        {/* 解析失败：说明试过哪些源，并给一键换源重试 */}
        {status === 'error' && (
          <div className="w-full rounded-2xl border border-line bg-panel p-4 text-xs text-dim">
            <p className="flex items-start gap-2">
              <TriangleAlert className="mt-px size-4 shrink-0 text-danger" />
              <span className="min-w-0 break-words">
                {error ?? '这首歌暂时解析不出来'}
                {attempts.length > 0 && (
                  <span className="mt-1 block text-faint">
                    已尝试：
                    {attempts
                      .map((a) => a.name ?? a.sourceName)
                      .filter(Boolean)
                      .join('、')}
                  </span>
                )}
              </span>
            </p>
            <div className="mt-3 flex gap-2">
              <Button variant="outline" size="sm" onClick={player.retry}>
                换源重试
              </Button>
              <Button variant="ghost" size="sm" onClick={player.next}>
                下一首
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* 右：歌词 / 队列
          【为什么高度是这串 calc 而不是 `lg:h-[calc(100vh-11rem)]`】
          原来的 11rem 是**手工试出来的魔数，且对不上真实布局**：
          桌面端要留出的是 顶栏(3.5625rem) + 播放栏(5rem) + main 的 p-8(4rem)
          + grid 的 lg:py-4(2rem) = 14.5625rem。
          少算的部分会让整页比视口高，全屏播放页凭空多出一条滚动条
          （实测 57px，看着像「一滑就跑偏」）。
          现在改成「从视口高度里减掉真实存在的几块」，且各块都引用 CSS 变量：
          改顶栏/播放栏高度时它自动跟着对，不用再回头调魔数。
          ⚠️ 改 main 的 p-* 或本 grid 的 py-* 时，这里的 rem 要同步改。 */}
      <Tabs
        defaultValue="lyric"
        className="flex h-[26rem] min-h-0 flex-col lg:h-[calc(100dvh-var(--header-h)-var(--playerbar-h)-6rem)] lg:min-h-[28rem]"
      >
        <TabsList className="self-start">
          <TabsTrigger value="lyric">歌词</TabsTrigger>
          <TabsTrigger value="queue">播放队列</TabsTrigger>
        </TabsList>
        <TabsContent value="lyric" className="min-h-0 flex-1">
          <Lyrics className="h-full" />
        </TabsContent>
        <TabsContent value="queue" className="min-h-0 flex-1">
          <QueueList />
        </TabsContent>
      </Tabs>
      </div>
      </div>
    </>
  )
}
