import { ListMusic } from 'lucide-react'
import { sameSong } from '@/lib/music'
import { usePlayer } from '@/lib/player'
import { cn } from '@/lib/utils'

/** 播放队列列表：当前曲目高亮、点行跳播。
 *  全屏播放页的「播放队列」页签与右侧「正在播放」面板共用。 */
export default function QueueList({ className }: { className?: string }) {
  const { queue, index, current, playAt } = usePlayer()

  if (queue.length === 0) {
    return (
      <div
        className={cn(
          'flex h-full min-h-48 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-panel/60 p-6 text-center',
          className,
        )}
      >
        <ListMusic className="size-6 text-faint" />
        <p className="text-sm text-dim">播放队列是空的</p>
        <p className="text-xs text-faint">从搜索或歌单里点一首歌就会进来。</p>
      </div>
    )
  }

  return (
    <div className={cn('h-full overflow-y-auto rounded-2xl border border-line bg-panel p-2', className)}>
      <ul className="space-y-0.5">
        {queue.map((song, i) => {
          const active = i === index || sameSong(song, current)
          return (
            <li key={`${song.source}-${song.songmid ?? song.id ?? i}`}>
              <button
                type="button"
                onClick={() => playAt(i)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                  active ? 'bg-accent-soft text-accent' : 'text-dim hover:bg-panel2 hover:text-ink',
                )}
              >
                <span className="w-5 shrink-0 text-center font-mono text-[10px] text-faint">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <span className={cn('block truncate', active && 'font-medium')}>{song.name}</span>
                  <span className="block truncate text-[11px] text-faint">{song.singer}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
