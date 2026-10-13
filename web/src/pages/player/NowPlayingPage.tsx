import * as React from 'react'
import { Link } from 'react-router-dom'
import { Download, Loader2, Music2, Search, TriangleAlert } from 'lucide-react'
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

/** 全屏播放页（/now-playing）：大封面 + 传输控制 + 歌词/队列。
 *  - 歌词：自动滚动当前行、点行跳转、逐字卡拉 OK 高亮（Lyrics.tsx）
 *  - 取色：封面主色覆盖 --accent（SPlayer 式），取不到则回落默认靛蓝 */
export default function NowPlayingPage() {
  const player = usePlayer()
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
        <Button asChild>
          <Link to="/search">
            <Search className="size-4" /> 去搜索音乐
          </Link>
        </Button>
      </div>
    )
  }

  const total = duration > 0 ? duration : intervalToSeconds(current.interval)
  const subtitle = [current.singer, current.albumName].filter(Boolean).join(' · ')

  return (
    <div
      style={accentStyle}
      className="accent-fade rise mx-auto grid w-full max-w-5xl gap-6 py-2 md:gap-8 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:items-start lg:gap-10 lg:py-4"
    >
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
  )
}
