import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ListMusic, Maximize2, Music2, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/** 传输控件骨架：音频内核（<audio ref> + MediaSession）下一版本接入，先统一禁用 */
function SkeletonCtrl({
  label,
  primary,
  className,
  children,
}: {
  label: string
  primary?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      disabled
      aria-label={label}
      title="下一版本接入播放后可用"
      className={cn(
        'flex items-center justify-center rounded-full text-faint',
        primary ? 'size-9 bg-panel2' : 'size-8',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** 底部常驻播放栏（阶段 C 第一步：静态骨架 + 空态）。
 * 空态下左侧信息区即搜索入口；播放后（后续版本）变为展开全屏播放页的入口。 */
export default function PlayerBar() {
  return (
    <div
      role="region"
      aria-label="播放栏"
      className="fixed inset-x-0 bottom-0 z-40 h-[var(--playerbar-h)] border-t border-line bg-panel/95 backdrop-blur"
    >
      <div className="mx-auto flex h-full w-full max-w-6xl items-center gap-3 px-4 md:gap-4 md:px-6">
        {/* 左：当前曲目（空态 → 搜索） */}
        <Link to="/search" className="group flex min-w-0 flex-1 items-center gap-3" title="未在播放 · 点击去搜索">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-panel2 text-faint md:size-11">
            <Music2 className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink">未在播放</span>
            <span className="block truncate text-xs text-faint transition-colors group-hover:text-dim">
              搜索并播放第一首歌
            </span>
          </span>
        </Link>

        {/* 中：播放控制 + 进度（桌面） */}
        <div className="hidden min-w-0 flex-1 flex-col items-center gap-1.5 md:flex">
          <div className="flex items-center gap-3">
            <SkeletonCtrl label="上一首">
              <SkipBack className="size-4" />
            </SkeletonCtrl>
            <SkeletonCtrl label="播放" primary>
              <Play className="size-4 translate-x-px" />
            </SkeletonCtrl>
            <SkeletonCtrl label="下一首">
              <SkipForward className="size-4" />
            </SkeletonCtrl>
          </div>
          <div className="flex w-full max-w-md items-center gap-2">
            <span className="w-10 shrink-0 text-right font-mono text-[11px] text-faint">0:00</span>
            <span className="h-1 flex-1 rounded-full bg-panel2" />
            <span className="w-10 shrink-0 font-mono text-[11px] text-faint">0:00</span>
          </div>
        </div>

        {/* 右：播放（移动）/ 音量 / 队列 / 展开播放页 */}
        <div className="flex shrink-0 items-center justify-end gap-1.5 md:gap-2">
          <SkeletonCtrl label="播放" primary className="md:hidden">
            <Play className="size-4 translate-x-px" />
          </SkeletonCtrl>
          <div className="hidden items-center gap-2 md:flex" title="下一版本接入播放后可用">
            <Volume2 className="size-4 text-faint" />
            <span className="h-1 w-20 rounded-full bg-panel2">
              <span className="block h-full w-[70%] rounded-full bg-line-strong" />
            </span>
          </div>
          <SkeletonCtrl label="播放队列" className="hidden md:flex">
            <ListMusic className="size-4" />
          </SkeletonCtrl>
          <Link
            to="/now-playing"
            aria-label="展开全屏播放页"
            title="全屏播放页"
            className="flex size-8 items-center justify-center rounded-lg text-dim transition-colors hover:bg-panel2 hover:text-ink"
          >
            <Maximize2 className="size-4" />
          </Link>
        </div>
      </div>
    </div>
  )
}
