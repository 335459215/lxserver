import * as React from 'react'
import { Link } from 'react-router-dom'
import { Music2, Search, TriangleAlert } from 'lucide-react'
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui'
import { coverUrl, formatTime, intervalToSeconds, sourceLabel } from '@/lib/music'
import { useCoverAccent } from '@/lib/coverColor'
import { usePlayer } from '@/lib/player'
import { ProgressRow, TransportControls } from '@/components/player/TransportControls'
import QualityMenu from '@/components/player/QualityMenu'
import Lyrics from '@/components/player/Lyrics'
import QueueList from '@/components/player/QueueList'

/** 全屏播放页（/now-playing）：大封面 + 传输控制 + 歌词/队列。
 *  - 歌词：自动滚动当前行、点行跳转、逐字卡拉 OK 高亮（Lyrics.tsx）
 *  - 取色：封面主色覆盖 --accent（SPlayer 式），取不到则回落默认靛蓝 */
export default function NowPlayingPage() {
  const player = usePlayer()
  const { current, status, error, attempts, duration, sourceName } = player

  const cover = coverUrl(current)
  const tokens = useCoverAccent(cover)

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
      {/* 左：封面 + 信息 + 控制（桌面吸顶，滚动歌词时控制不跑掉） */}
      <section className="flex flex-col items-center gap-5 lg:sticky lg:top-20">
        <div className="relative">
          {/* 氛围光：封面放大模糊铺底，全平台可用（不依赖读像素） */}
          {cover && (
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-3 rounded-[2.25rem] opacity-50 blur-2xl saturate-150"
              style={{ backgroundImage: `url(${cover})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
            />
          )}
          {cover ? (
            <img
              src={cover}
              alt={current.name}
              className="relative aspect-square w-52 rounded-3xl border border-line object-cover shadow-pop md:w-60"
            />
          ) : (
            <div className="relative flex aspect-square w-52 items-center justify-center rounded-3xl border border-line bg-panel shadow-pop md:w-60">
              <Music2 className="size-12 text-faint" />
            </div>
          )}
        </div>

        <div className="w-full text-center">
          <h1 className="truncate text-lg font-semibold tracking-tight text-ink" title={current.name}>
            {current.name}
          </h1>
          <p className="mt-1 truncate text-sm text-dim">{subtitle || '未知歌手'}</p>
          {/* 元信息一行：源 · 音质 · 时长。音质用可点的 QualityMenu，
              让「这首歌音质不对」的当下能就地改掉，不必跑设置页。 */}
          <p className="mt-1 flex flex-wrap items-center justify-center gap-x-1 text-xs text-faint">
            <span>{sourceName ?? sourceLabel(current.source)}</span>
            <span aria-hidden>·</span>
            <QualityMenu className="h-5 px-1 text-xs text-faint hover:text-ink" />
            {total > 0 && (
              <>
                <span aria-hidden>·</span>
                <span>{formatTime(total)}</span>
              </>
            )}
          </p>
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

      {/* 右：歌词 / 队列 */}
      <Tabs defaultValue="lyric" className="flex h-[26rem] min-h-0 flex-col lg:h-[calc(100vh-11rem)] lg:min-h-[28rem]">
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
