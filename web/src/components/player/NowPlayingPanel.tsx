import * as React from 'react'
import { Link } from 'react-router-dom'
import { Disc3, Download, Loader2, Maximize2, Music2, PanelRightClose } from 'lucide-react'
import { Button, Tabs, TabsContent, TabsList, TabsTrigger, useToast } from '@/components/ui'
import { coverUrl } from '@/lib/music'
import { usePlayer } from '@/lib/player'
import { downloadSong } from '@/lib/download'
import { ProgressRow, TransportControls } from '@/components/player/TransportControls'
import Lyrics from '@/components/player/Lyrics'
import QueueList from '@/components/player/QueueList'
import { cn } from '@/lib/utils'

/** 右侧「正在播放」常驻面板（顶研级声学设计）。
 *  整合专辑动态光晕、唱片槽反光动效与分栏声学体验。 */
export default function NowPlayingPanel({ onClose }: { onClose: () => void }) {
  const { current, status, resolvedQuality, sourceName } = usePlayer()
  const { toast } = useToast()
  const [downloading, setDownloading] = React.useState(false)
  const cover = coverUrl(current)
  const isPlaying = status === 'playing'

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

  return (
    <aside
      aria-label="正在播放"
      className="sticky top-[var(--header-h)] hidden h-[calc(100vh-var(--header-h)-var(--playerbar-h))] w-84 shrink-0 flex-col border-l border-line/70 bg-panel/60 backdrop-blur-xl xl:flex"
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-4 border-b border-line/40">
        <span className="flex items-center gap-2 text-xs font-semibold tracking-wide text-ink">
          <Disc3 className={cn('size-4 text-accent', isPlaying && 'animate-spin')} />
          <span>正在播放</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="收起正在播放面板"
          title="收起"
          className="flex size-7 items-center justify-center rounded-lg text-faint transition-all hover:bg-panel-2 hover:text-ink active:scale-95"
        >
          <PanelRightClose className="size-4" />
        </button>
      </div>

      {!current ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-panel-2 border border-line text-faint">
            <Music2 className="size-7" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">未在播放音乐</p>
            <p className="mt-1 text-xs text-dim">从首页或搜索点播一首歌曲</p>
          </div>
          <Button asChild variant="outline" size="sm" className="rounded-xl mt-1">
            <Link to="/search">去发现音乐</Link>
          </Button>
        </div>
      ) : (
        <>
          {/* 封面：黑胶唱片半滑出效果 + 环境漫反射光晕 */}
          <div className="shrink-0 px-6 pt-5">
            <div className="relative mx-auto flex items-center justify-center">
              {/* 环境光晕 */}
              {cover && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute -inset-3 rounded-3xl opacity-50 blur-2xl saturate-200 transition-opacity"
                  style={{
                    backgroundImage: `url(${cover})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                />
              )}

              {/* 拟物黑胶唱片（在封面背后探出半截并转动） */}
              <div
                className={cn(
                  'absolute right-0 top-1/2 -translate-y-1/2 translate-x-3 size-48 rounded-full bg-zinc-950 p-1.5 shadow-xl transition-all duration-700',
                  isPlaying ? 'translate-x-5 rotate-12' : 'translate-x-2',
                )}
              >
                <div
                  className={cn(
                    'size-full rounded-full border-4 border-zinc-900/90 flex items-center justify-center',
                    isPlaying ? 'animate-vinyl' : 'animate-vinyl animate-vinyl-paused',
                  )}
                  style={{
                    background:
                      'radial-gradient(circle, #27272a 18%, #09090b 20%, #18181b 38%, #09090b 40%, #27272a 60%, #09090b 62%, #18181b 80%, #09090b 82%)',
                  }}
                >
                  <div className="size-14 rounded-full border-2 border-white/20 bg-accent/80 flex items-center justify-center">
                    <div className="size-4 rounded-full bg-zinc-950" />
                  </div>
                </div>
              </div>

              {/* 专辑封面封套 */}
              <div className="relative z-10 aspect-square w-48 rounded-2xl border border-white/80 bg-panel shadow-lg overflow-hidden group">
                {cover ? (
                  <img
                    src={cover}
                    alt={current.name}
                    className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center bg-panel-2 text-faint">
                    <Music2 className="size-12" />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 曲目元数据信息 */}
          <div className="shrink-0 px-6 pt-4 text-center">
            <h3 className="truncate text-base font-bold tracking-tight text-ink" title={current.name}>
              {current.name}
            </h3>
            <p className="mt-1 truncate text-xs font-medium text-dim">
              {[current.singer, current.albumName].filter(Boolean).join(' · ') || '未知歌手'}
            </p>
            <div className="mt-2 flex items-center justify-center gap-2">
              {sourceName && (
                <span className="rounded-md border border-line bg-panel-2/90 px-1.5 py-0.5 text-[10px] font-medium text-dim">
                  {sourceName}
                </span>
              )}
              {resolvedQuality && (
                <span className="rounded-md border border-accent/25 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                  {resolvedQuality.toUpperCase()}
                </span>
              )}
            </div>
          </div>

          {/* 进度 + 传输 */}
          <div className="flex shrink-0 flex-col items-center gap-1 px-4 pt-3">
            <ProgressRow />
            <div className="pt-1">
              <TransportControls showMode />
            </div>
          </div>

          {/* 歌词 / 队列 */}
          <Tabs defaultValue="lyric" className="mt-3 flex min-h-0 flex-1 flex-col px-4">
            <TabsList className="grid grid-cols-2 w-full rounded-xl bg-panel-2/80 p-0.5">
              <TabsTrigger value="lyric" className="rounded-lg text-xs font-medium py-1.5">
                实时歌词
              </TabsTrigger>
              <TabsTrigger value="queue" className="rounded-lg text-xs font-medium py-1.5">
                播放队列
              </TabsTrigger>
            </TabsList>
            <TabsContent value="lyric" className="min-h-0 flex-1 pt-2">
              <Lyrics className="h-full" compact />
            </TabsContent>
            <TabsContent value="queue" className="min-h-0 flex-1 pt-2">
              <QueueList />
            </TabsContent>
          </Tabs>

          {/* 底部功能栏 */}
          <div className="flex shrink-0 items-center gap-2.5 border-t border-line/60 p-3 bg-panel/40">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={downloading}
              className="flex-1 rounded-xl font-medium border-line hover:border-accent/40 hover:bg-accent-soft hover:text-accent transition-all"
            >
              {downloading ? (
                <Loader2 className="size-3.5 animate-spin text-accent" />
              ) : (
                <Download className="size-3.5" />
              )}
              <span>下载本曲</span>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="flex-1 rounded-xl font-medium border-line hover:border-accent/40 hover:bg-accent-soft hover:text-accent transition-all"
            >
              <Link to="/now-playing">
                <Maximize2 className="size-3.5" /> 全屏歌词
              </Link>
            </Button>
          </div>
        </>
      )}
    </aside>
  )
}
