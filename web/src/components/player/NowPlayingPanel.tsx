import { Link } from 'react-router-dom'
import { Disc3, Maximize2, Music2, PanelRightClose } from 'lucide-react'
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui'
import { coverUrl } from '@/lib/music'
import { usePlayer } from '@/lib/player'
import { ProgressRow, TransportControls } from '@/components/player/TransportControls'
import Lyrics from '@/components/player/Lyrics'
import QueueList from '@/components/player/QueueList'

/** 右侧「正在播放」常驻面板（Spotify 式）。
 *
 *  为什么要有它：底部播放栏只放得下"当前曲目 + 传输键"，全屏播放页又要离开当前页面才能看。
 *  这个面板让「封面 / 歌词 / 队列」在浏览任何页面时都常驻可见，是主流音乐 App 的标准结构。
 *  只在 ≥1280px 显示：更窄的屏幕空间不够，硬塞会把主内容挤扁，那时用底部播放栏 + 全屏页即可。 */
export default function NowPlayingPanel({ onClose }: { onClose: () => void }) {
  const { current } = usePlayer()
  const cover = coverUrl(current)

  return (
    <aside
      aria-label="正在播放"
      className="sticky top-14 hidden h-[calc(100vh-3.5rem-var(--playerbar-h))] w-80 shrink-0 flex-col border-l border-line xl:flex"
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 pl-4 pr-2">
        <span className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-dim">
          <Disc3 className="size-3.5" /> 正在播放
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="收起正在播放面板"
          title="收起"
          className="flex size-7 items-center justify-center rounded-lg text-faint transition-colors hover:bg-panel2 hover:text-ink"
        >
          <PanelRightClose className="size-4" />
        </button>
      </div>

      {!current ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <Music2 className="size-7 text-faint" />
          <p className="text-sm text-dim">还没有正在播放的歌曲</p>
          <Button asChild variant="outline" size="sm">
            <Link to="/search">去搜索音乐</Link>
          </Button>
        </div>
      ) : (
        <>
          {/* 封面：模糊铺底做氛围，和全屏播放页同一套语言 */}
          <div className="shrink-0 px-4">
            <div className="relative">
              {cover && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute -inset-2 rounded-3xl opacity-45 blur-xl saturate-150"
                  style={{
                    backgroundImage: `url(${cover})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                />
              )}
              {cover ? (
                <img
                  src={cover}
                  alt={current.name}
                  className="relative aspect-square w-full rounded-2xl border border-line object-cover shadow-card"
                />
              ) : (
                <div className="relative flex aspect-square w-full items-center justify-center rounded-2xl border border-line bg-panel2">
                  <Music2 className="size-8 text-faint" />
                </div>
              )}
            </div>
          </div>

          {/* 曲目信息 */}
          <div className="shrink-0 px-4 pt-3">
            <p className="truncate text-sm font-medium text-ink" title={current.name}>
              {current.name}
            </p>
            <p className="mt-0.5 truncate text-xs text-dim">
              {[current.singer, current.albumName].filter(Boolean).join(' · ') || '未知歌手'}
            </p>
          </div>

          {/* 进度 + 传输（含随机/循环） */}
          <div className="flex shrink-0 flex-col items-center gap-1 px-4 pt-3">
            <ProgressRow />
            <div className="pt-1">
              <TransportControls showMode />
            </div>
          </div>

          {/* 歌词 / 队列 */}
          <Tabs defaultValue="lyric" className="mt-2 flex min-h-0 flex-1 flex-col px-3">
            <TabsList className="self-start">
              <TabsTrigger value="lyric">歌词</TabsTrigger>
              <TabsTrigger value="queue">队列</TabsTrigger>
            </TabsList>
            <TabsContent value="lyric" className="min-h-0 flex-1">
              <Lyrics className="h-full" compact />
            </TabsContent>
            <TabsContent value="queue" className="min-h-0 flex-1">
              <QueueList />
            </TabsContent>
          </Tabs>

          <div className="shrink-0 border-t border-line p-3">
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link to="/now-playing">
                <Maximize2 className="size-3.5" /> 全屏播放页
              </Link>
            </Button>
          </div>
        </>
      )}
    </aside>
  )
}
