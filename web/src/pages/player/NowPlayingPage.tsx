import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, Download, Gauge, Loader2, MoonStar, MoreHorizontal, Music2, Search, TriangleAlert } from 'lucide-react'
import {
  Button,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from '@/components/ui'
import { coverUrl, formatTime, intervalToSeconds, sourceLabel } from '@/lib/music'
import { useCoverAccent } from '@/lib/coverColor'
import { usePlayer } from '@/lib/player'
import { downloadSong } from '@/lib/download'
import { ProgressRow, TransportControls } from '@/components/player/TransportControls'
import QualityMenu from '@/components/player/QualityMenu'
import { Share2 } from 'lucide-react'
import { buildShareCardData, renderShareCard } from '@/lib/shareCard'
import { activeLineIndex, useLyric } from '@/lib/lyric'
import SleepTimerMenu from '@/components/player/SleepTimerMenu'
import PlaybackRateMenu from '@/components/player/PlaybackRateMenu'
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
  const [sharing, setSharing] = React.useState(false)
  // 歌词行给分享卡片用。 Lyrics 组件内部也有一个 useLyric —— 这里再来一个
  // 是刻意的：歌词接口带 max-age=86400，第二个消费者命中浏览器缓存，
  // 代价 ≈ 0；而为了省一次缓存命中的请求把歌词状态提升成全局 context 不值得。
  const lyric = useLyric(current)

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

  /** 生成分享卡片（封面+歌名+当前歌词行）并下载 PNG */
  const handleShareCard = async () => {
    if (!current || sharing) return
    setSharing(true)
    try {
      const lines = lyric.data?.lines ?? []
      const active = activeLineIndex(lines, player.position)
      const data = buildShareCardData(current, active >= 0 ? lines[active].text : null, sourceLabel(current.source), tokens?.accent ?? '#6366f1')
      const blob = await renderShareCard(data, cover)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `分享卡片-${current.name}.png`
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 5000)
      toast({ title: '已生成分享卡片', description: '已保存为图片，去发给你想分享的人吧' })
    } catch (e) {
      toast({
        title: '分享卡片生成失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setSharing(false)
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

  // 移动端「更多操作」抽屉开关（v2.49.5：把挤成一坨的低频按钮收进来）
  const [moreOpen, setMoreOpen] = React.useState(false)

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
        // 【v2.49.5 移动端改成一屏布局】
        // 原来移动端是"把桌面两列纵向堆起来"：封面 + 标题 + 6 个胶囊 + 进度 + 5 个
        // 播放控制 + 26rem 高的歌词区 → 实测内容 1200px，而视口只有 862px，
        // 整页要滚才能看到歌词，且底部 Tab 栏还会盖住内容。
        // 现在：移动端 h-full 撑满内容区、内部不再整页滚；
        // gap 收到 3，py 收到 0，把省下的高度全给歌词。
        // 【v2.49.5 关键：根容器在移动端必须有**确定高度**】
        // 之前两次都栽在同一件事上：给歌词区算一个 calc 高度，但"上方内容"的
        // 实际高度会随封面/字号/是否换行而变（实测 419→473 差 54px），
        // 于是 calc 里的常量永远对不上，要么溢出要么留白。
        // 正确做法：根容器高度 = 内容区可用高度，交给 flex 分配：
        //   封面区 auto（内容多高就多高） + 歌词区 flex-1 min-h-0（吃掉剩下的）
        // 这样封面变大/变小、文案换行，都不需要再改任何魔数。
        // 【v2.49.6 一层关键约束】移动端这里必须是**固定高度**：
        // 歌词区（下方 Tabs）用 flex-1 吃剩余空间，而它内部的 Lyrics 是 h-full ——
        // 只有父级高度**确定**时，flex-grow 才会真正算出剩余值。
        // 之前试过改成 min-h（想让它必要时滚动），结果歌词内层退回按内容撑开，
        // 实测直接变成 3374px。所以：固定高度 + 上方 section 加 shrink-0。
        // 【v2.49.7 桌面端溢出 55px 的根因】
        // 原来 Tabs 自己算 `100dvh - 顶栏 - 播放栏 - 6rem`，但根容器里还有
        // 返回条(30) + gap(40) + py-4(32)，这三块没被扣掉 → 合计比可用高度多 55px。
        // 现在根容器自己给确定高度（扣掉顶栏/播放栏/main 的 p-8），
        // 第二行交给 grid 的 stretch 填满，Tabs 不再自己算 —— 一个数只在一处出现。
        // 扣掉的 main 上下内边距必须跟着断点变：
        //   手机 p-4  → 上下合计 2rem
        //   md:p-8    → 上下合计 4rem（这里之前只扣 2rem，平板因此溢出 33px）
        className="accent-fade rise relative z-40 mx-auto flex h-[calc(100dvh-var(--header-h)-var(--mobile-tabbar-h)-var(--safe-bottom)-2rem)] w-full max-w-5xl flex-col gap-2 py-0 sm:gap-4 md:h-[calc(100dvh-var(--header-h)-var(--mobile-tabbar-h)-var(--safe-bottom)-4rem)] lg:grid lg:h-[calc(100dvh-var(--header-h)-var(--playerbar-h)-4rem)] lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:items-stretch lg:gap-10 lg:py-4"
      >
        {/* 返回：按钮 + 下拉手势两条路都给。
            图标用 ChevronDown 而不是箭头向左 —— 本页的返回语义就是「往下拉走」，
            图标和手势方向一致，用户不用猜。
            移动端顶部留一条显式把手（那条小横杠），暗示这里可以往下拖。 */}
        <div className="relative col-span-full flex items-center gap-2 lg:-mb-4">
          <button
            type="button"
            onClick={goBack}
            aria-label="返回上一页"
            className="flex items-center gap-1.5 rounded-full border border-line/80 bg-panel px-3 py-1.5 text-xs font-medium text-dim shadow-2xs transition-all hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
          >
            <ChevronDown className="size-3.5" />
            <span>返回</span>
          </button>
          {/* 顶部把手：绝对居中，不再占一行 flex 宽度（移动端每省 1 行都是收益） */}
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 h-1 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-line-strong/70 sm:hidden"
          />
        </div>

      {/* 左：封面 + 唱片反光与声学动感 + 控制（桌面吸顶，滚动歌词时控制不跑掉） */}
      <section className="flex w-full min-w-0 shrink-0 flex-col items-center gap-2.5 sm:gap-6 lg:sticky lg:top-20 lg:self-start">
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
              // 【v2.49.5 移动端不显示黑胶】390px 下封面 224px + 黑胶右移 32~48px
              // 会直接顶出容器右边界，被 overflow 裁出一条黑色直角 —— 截图里很明显。
              // 黑胶是"桌面彩蛋"，窄屏只留封面本体。
              'absolute right-0 top-1/2 hidden -translate-y-1/2 translate-x-4 size-64 rounded-full bg-zinc-950 p-2 shadow-2xl transition-all duration-700 sm:block',
              status === 'playing' ? 'sm:translate-x-12 rotate-12' : 'sm:translate-x-2',
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

          {/* 专辑封面封套主体。
              移动端封面按屏宽走：min(78vw, 17rem) —— 390px 屏约 292px，
              比原来的 224px 大得多，这才是「全屏播放器」该有的主角；
              桌面端维持 16rem（sm:w-64）。 */}
          <div className="relative z-10 aspect-square w-[var(--np-cover)] shrink-0 sm:w-56 lg:w-64 rounded-2xl sm:rounded-3xl border border-white/80 bg-panel shadow-2xl overflow-hidden group">
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
          <h1 className="truncate text-lg sm:text-xl md:text-2xl font-extrabold tracking-tight text-ink" title={current.name}>
            {current.name}
          </h1>
          <p className="mt-1 truncate text-sm font-medium text-dim">{subtitle || '未知歌手'}</p>

          {/* 【v2.49.5 移动端元信息条重做】
              原来 6 个胶囊（音源/音质/倍速/圆角定时/时长/下载/分享）在 390px 下
              折成 5 行 —— 截图里那些小方块挤成一坨，是"没适配"最直观的地方。
              现在：
               · 移动端只留 **音源 + 音质** 两个（用户常看的），其余收进右侧「更多」；
               · ≥sm 恢复原来的完整一行（桌面空间够，多一个点击反而慢）。
              所有被收起的控件在「更多」里都是以**整行大按钮**出现，触摸区域 ≥44px。 */}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-xs sm:mt-3 sm:gap-2">
            <span className="rounded-md border border-line bg-panel-2/80 px-2 py-0.5 font-medium text-dim">
              {sourceName ?? sourceLabel(current.source)}
            </span>
            <QualityMenu className="h-6 px-2 rounded-md border border-accent/25 bg-accent/10 font-semibold text-accent hover:bg-accent/20" />
            {/* 桌面端：以下全部展示 */}
            <span className="hidden sm:contents">
              <PlaybackRateMenu />
              <SleepTimerMenu className="h-6 px-2 rounded-md border border-line bg-panel-2/80 hover:border-accent/30" />
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
                {downloading ? <Loader2 className="size-3 animate-spin text-accent" /> : <Download className="size-3" />}
                <span>下载本曲</span>
              </button>
              <button
                type="button"
                onClick={() => void handleShareCard()}
                disabled={sharing}
                aria-label="生成分享卡片"
                title="生成封面+歌词的分享图片"
                className="inline-flex h-6 items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 text-xs font-semibold text-dim shadow-2xs transition-all hover:border-accent/40 hover:bg-accent-soft hover:text-accent disabled:opacity-50 active:scale-95"
              >
                {sharing ? <Loader2 className="size-3 animate-spin text-accent" /> : <Share2 className="size-3" />}
                <span>分享卡片</span>
              </button>
            </span>
            {/* 移动端：一个「更多」入口，把这些低频动作收进去 */}
            <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  aria-label="更多操作"
                  className="inline-flex h-9 items-center gap-1 rounded-md border border-line bg-panel px-2.5 text-xs font-semibold text-dim shadow-2xs transition-all hover:border-accent/40 hover:text-accent active:scale-95 sm:hidden"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </SheetTrigger>
              <SheetContent side="bottom" className="rounded-t-2xl p-4 pb-[calc(1rem+var(--safe-bottom))]">
                <SheetTitle className="text-sm font-semibold text-ink">更多</SheetTitle>
                <div className="mt-4 flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => { setMoreOpen(false); handleDownload() }}
                    disabled={downloading}
                    className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium text-ink transition-colors hover:bg-panel2 disabled:opacity-50"
                  >
                    <Download className="size-4 text-dim" /> 下载本曲
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMoreOpen(false); void handleShareCard() }}
                    disabled={sharing}
                    className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium text-ink transition-colors hover:bg-panel2 disabled:opacity-50"
                  >
                    <Share2 className="size-4 text-dim" /> 生成分享卡片
                  </button>
                  {/* 倍速 / 睡眠定时 / 时长：这三个是「选项型」，直接复用原菜单组件，整行显示 */}
                  <div className="mt-2 flex items-center justify-between gap-3 rounded-xl px-3 py-2">
                    <span className="flex items-center gap-3 text-sm font-medium text-ink">
                      <Gauge className="size-4 text-dim" /> 播放倍速
                    </span>
                    <PlaybackRateMenu />
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-2">
                    <span className="flex items-center gap-3 text-sm font-medium text-ink">
                      <MoonStar className="size-4 text-dim" /> 睡眠定时
                    </span>
                    <SleepTimerMenu className="h-9 px-2 rounded-md border border-line bg-panel-2/80" />
                  </div>
                  {total > 0 && (
                    <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm">
                      <span className="text-dim">时长</span>
                      <span className="font-mono text-faint">{formatTime(total)}</span>
                    </div>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        <div className="flex w-full flex-col items-center gap-2.5 sm:gap-4">
          <ProgressRow showPreview />
          <TransportControls size="lg" showMode showFavorite />
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
      {/* 【v2.49.5】移动端原来固定 26rem（416px）—— 加上上面所有内容必然溢出。
          改成 min-h-0 flex-1：占满 grid 第 3 行剩余空间，歌词在自身容器内滚动。
          桌面端维持原来的精确 calc（那里一屏本来放得下）。 */}
      {/* 【v2.49.5 移动端歌词高度】
          之前固定 26rem(416px) 必然溢出；改成 flex-1 后，因为 Lyrics 内部是
          `h-full`（依赖父级有**确定**高度），而 grid/flex 的剩余空间在移动端
          解析成 auto，歌词就被内容撑到 3000+px。
          这里给一个相对视口的确定值 h-[42dvh]：390×844 下约 355px，
          足够显示 8~10 行歌词，且整页高度落在视口内。
          桌面端仍用原来精确的 calc（那边一屏本来放得下）。 */}
      <Tabs
        defaultValue="lyric"
        // 【v2.49.5】移动端必须让歌词吃「剩下的那点高度」，而不是给个固定值：
        // 固定值时「上方内容 + 固定值」必然超一屏（实测溢出 200px）。
        //
        // 这里的数字是**实测出来的**，不是拍脑袋：
        //   390×844 实测：根容器 765 = 返回条 30 + 封面区 419 + gap 2×12 + 歌词区
        //   375×667 实测：根容器 649 = 30 + 419 + 24 + 歌词区
        // 可见「上方固定内容」= 30 + 419 + 24(gap) = 473px ≈ 29.5rem，与我先前估的 21rem 差很远。
        // 于是：歌词高 = 100dvh - 顶栏 - 底部Tab栏 - 安全区 - main 上下padding - 473
        //   → 844 高：844 - 61 - 124 - 0 - 32 - 473 = 154px（约 4 行，够用且不滚）
        //   → 667 高：667 - 61 - 124 - 0 - 32 - 473 = -23 → 由 min-h 兜住（页面在大屏以下）。
        // 用 calc 而不是 JS 量：CSS 变量改顶栏/播放栏时自动跟着对，不用回来改魔数。
        // 【v2.49.6】矮屏（iPhone SE 667/640）原来歌词只剩 64px（2~3 行），太憋屈。
        // 现在给歌词一个「视口占比」下限 min-h-[30dvh]，并让**封面主动让位**：
        // 封面尺寸来自 CSS 变量 --np-cover，在 index.css 里按视口高度分档
        // （矮屏 40vw/22vh、常规 52vw/26vh），这样两者不再互相挤。
        className="flex min-h-[26dvh] flex-1 flex-col lg:h-full lg:min-h-0 lg:flex-none"
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
