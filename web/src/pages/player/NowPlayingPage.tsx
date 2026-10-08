import { Link } from 'react-router-dom'
import { Music2, Play, Search, SkipBack, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui'

/** 全屏播放页壳（/now-playing）：大封面 + 控制骨架 + 歌词骨架。
 * 从底部播放栏右侧展开进入；真实播放状态、逐字歌词与封面取色在后续版本接入。 */
export default function NowPlayingPage() {
  return (
    <div className="rise mx-auto flex w-full max-w-xl flex-col items-center gap-6 py-2 md:gap-8 md:py-6">
      <div className="flex aspect-square w-52 items-center justify-center rounded-3xl border border-line bg-panel shadow-pop md:w-64">
        <Music2 className="size-12 text-faint" />
      </div>

      <div className="text-center">
        <h1 className="text-lg font-semibold tracking-tight text-ink">还没有正在播放的歌曲</h1>
        <p className="mt-1 text-sm text-dim">播放后这里会显示大封面、播放控制与滚动歌词。</p>
      </div>

      <div className="flex items-center gap-4" aria-hidden>
        <span className="flex size-9 items-center justify-center rounded-full text-faint">
          <SkipBack className="size-5" />
        </span>
        <span className="flex size-12 items-center justify-center rounded-full bg-panel2 text-faint">
          <Play className="size-5 translate-x-px" />
        </span>
        <span className="flex size-9 items-center justify-center rounded-full text-faint">
          <SkipForward className="size-5" />
        </span>
      </div>

      <Button asChild variant="outline">
        <Link to="/search">
          <Search className="size-4" /> 去搜索音乐
        </Link>
      </Button>

      <section className="w-full rounded-2xl border border-line bg-panel p-5 shadow-card">
        <p className="text-[11px] font-medium tracking-widest text-faint">歌词</p>
        <div className="mt-3 space-y-2.5" aria-hidden>
          {[92, 78, 64, 84, 52].map((w) => (
            <span key={w} className="block h-3 rounded-full bg-panel2" style={{ width: `${w}%` }} />
          ))}
        </div>
        <p className="mt-4 text-xs text-faint">歌词滚动与封面取色将在「全屏播放页」版本接入。</p>
      </section>
    </div>
  )
}
