import * as React from 'react'
import { MicVocal, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui'
import { activeLineIndex, useLyric, type LyricLine } from '@/lib/lyric'
import { usePlayer } from '@/lib/player'
import { cn } from '@/lib/utils'

/** 单行歌词文本：有逐字数据且是当前行时做卡拉 OK 渐变高亮，否则整行纯文本 */
function LyricText({
  line,
  active,
  position,
}: {
  line: LyricLine
  active: boolean
  position: number
}) {
  const words = line.words
  if (!active || !words || words.length === 0) return <span>{line.text}</span>

  const elapsed = (position - line.time) * 1000

  return (
    <span>
      {words.map((w, i) => {
        const ratio = w.duration > 0 ? (elapsed - w.start) / w.duration : elapsed >= w.start ? 1 : 0
        const pct = Math.max(0, Math.min(1, ratio)) * 100
        return (
          <span
            key={i}
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage: `linear-gradient(90deg, var(--accent) ${pct}%, var(--faint) ${pct}%)`,
            }}
          >
            {w.text}
          </span>
        )
      })}
    </span>
  )
}

export interface LyricsProps {
  className?: string
  /** 紧凑模式：右侧「正在播放」面板这种窄容器用，缩小字号与居中留白 */
  compact?: boolean
}

/** 歌词面板：当前行居中自动滚动、手动滚动暂停跟随、点击任意行跳转播放。
 *  四态：加载骨架 / 暂无歌词 / 加载失败（可重试）/ 正常滚动。 */
export default function Lyrics({ className, compact = false }: LyricsProps) {
  const player = usePlayer()
  const { current, position } = player
  const { status, data, error, reload } = useLyric(current)

  const boxRef = React.useRef<HTMLDivElement | null>(null)
  const lineRefs = React.useRef<Array<HTMLButtonElement | null>>([])
  /** 被用户手动滚动「顶掉」跟随的那首歌；换歌后 key 变化即自动恢复跟随（无需 effect 重置） */
  const [pausedKey, setPausedKey] = React.useState<string | null>(null)
  const resumeTimer = React.useRef<number | null>(null)

  const lines = data?.lines ?? []
  const active = activeLineIndex(lines, position)
  /** 各状态占位框的最小高度：窄容器里不需要那么高 */
  const boxMin = compact ? 'min-h-40' : 'min-h-[16rem]'
  const songKey = current ? `${current.source}:${current.songmid ?? current.id ?? current.name}` : ''
  const following = pausedKey !== songKey

  // 手动滚动 → 暂停跟随，静置 4s 后恢复（否则会和用户抢滚动条）
  const pauseFollowing = React.useCallback(() => {
    setPausedKey(songKey)
    if (resumeTimer.current) window.clearTimeout(resumeTimer.current)
    resumeTimer.current = window.setTimeout(() => setPausedKey(null), 4000)
  }, [songKey])

  React.useEffect(
    () => () => {
      if (resumeTimer.current) window.clearTimeout(resumeTimer.current)
    },
    [],
  )

  // 当前行滚动到容器中央
  React.useEffect(() => {
    if (!following || active < 0) return
    const box = boxRef.current
    const el = lineRefs.current[active]
    if (!box || !el) return
    const top = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2
    box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [active, following])

  const seekTo = (time: number) => {
    player.seek(time)
    if (resumeTimer.current) window.clearTimeout(resumeTimer.current)
    setPausedKey(null)
  }

  if (!current) {
    return (
      <div
        className={cn(
          boxMin,
          'flex h-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-panel/60 p-8 text-center',
          className,
        )}
      >
        <MicVocal className="size-6 text-faint" />
        <p className="text-sm text-dim">播放一首歌后显示歌词</p>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div
        className={cn(boxMin, 'h-full rounded-2xl border border-line bg-panel p-6', className)}
        aria-busy="true"
        aria-label="歌词加载中"
      >
        <div className="mx-auto max-w-md space-y-3.5 pt-4">
          {[72, 54, 86, 62, 78, 50, 68].map((w, i) => (
            <span key={i} className="mx-auto block h-3 rounded bg-panel2" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    )
  }

  if (status === 'empty') {
    return (
      <div
        className={cn(
          boxMin,
          'flex h-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-panel/60 p-8 text-center',
          className,
        )}
      >
        <MicVocal className="size-6 text-faint" />
        <p className="text-sm text-dim">这首歌暂时没有歌词</p>
        <p className="text-xs text-faint">不同平台的歌词覆盖不一样，可以换个音源再试。</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div
        className={cn(
          boxMin,
          'flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-danger/40 bg-danger/5 p-8 text-center',
          className,
        )}
      >
        <p className="text-sm font-medium text-ink">歌词加载失败</p>
        <p className="max-w-sm break-words text-xs leading-relaxed text-dim">{error}</p>
        <Button variant="outline" size="sm" onClick={reload}>
          <RotateCw className="size-3.5" /> 重试
        </Button>
      </div>
    )
  }

  // 纯文本歌词（无时间轴）：原样展示，不参与滚动高亮
  if (data?.plain) {
    return (
      <div className={cn('h-full overflow-y-auto rounded-2xl border border-line bg-panel p-6', className)}>
        <p className="whitespace-pre-wrap text-center text-sm leading-8 text-dim">{data.plain}</p>
      </div>
    )
  }

  return (
    <div
      ref={boxRef}
      onWheel={pauseFollowing}
      onTouchMove={pauseFollowing}
      className={cn(
        'relative h-full overflow-y-auto overscroll-contain rounded-2xl border border-line bg-panel',
        className,
      )}
      aria-label="歌词"
    >
      <ul className={cn('space-y-0.5 px-2', compact ? 'py-12' : 'py-28 md:py-32')}>
        {lines.map((line, i) => {
          const isActive = i === active
          return (
            <li key={`${line.time}-${i}`}>
              <button
                ref={(el) => {
                  lineRefs.current[i] = el
                }}
                type="button"
                onClick={() => seekTo(line.time)}
                aria-current={isActive ? 'true' : undefined}
                title="点击跳转到这一句"
                className={cn(
                  'block w-full rounded-xl text-center transition-colors',
                  compact ? 'px-2 py-1.5 text-[13px] leading-6' : 'px-4 py-2 text-[15px] leading-8',
                  isActive
                    ? 'font-medium text-accent'
                    : 'text-faint hover:bg-panel2/70 hover:text-dim',
                )}
              >
                <LyricText line={line} active={isActive} position={position} />
                {line.roma && (
                  <span
                    className={cn(
                      'mt-0.5 block leading-5',
                      compact ? 'text-[11px]' : 'text-xs',
                      isActive ? 'text-dim' : 'text-faint/80',
                    )}
                  >
                    {line.roma}
                  </span>
                )}
                {line.translation && (
                  <span
                    className={cn(
                      'mt-0.5 block leading-5',
                      compact ? 'text-[11px]' : 'text-xs',
                      isActive ? 'text-dim' : 'text-faint/80',
                    )}
                  >
                    {line.translation}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
