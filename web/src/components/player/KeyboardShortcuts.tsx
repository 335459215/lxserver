import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { isLoggedIn, useAuth } from '@/lib/auth'
import { REPEAT_LABEL, REPEAT_ORDER, usePlayer, type RepeatMode } from '@/lib/player'
import type { Song } from '@/lib/music'
import { addSongsToPlaylist, fetchLists, removeSongsFromPlaylist, LIST_LOVE_ID } from '@/lib/lists'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  useToast,
} from '@/components/ui'
import { cn } from '@/lib/utils'

type ToastFn = (t: { title: string; description?: string; variant?: 'default' | 'success' | 'destructive' }) => void

/** 收藏/取消收藏当前曲（L 键）。
 *
 *  【为什么匹配用 source+songmid 而不是 id】收藏里可能混着不同客户端写入的
 *  条目（落雪桌面的 id 格式与本站不同），按 id 判「已在收藏」会漏判重复收藏；
 *  source+songmid 是平台的自然键，任何客户端写进来的条目都带。
 *  移除时用**条目自己的 id**（它是什么格式就删什么），不要用我们生成的。
 */
async function toggleLove(song: Song, toast: ToastFn): Promise<void> {
  const snapshot = await fetchLists()
  const sameSong = (it: Song): boolean =>
    it.source === song.source &&
    String(it.songmid ?? it.meta?.songId ?? '') === String(song.songmid ?? song.id ?? '')
  const existing = snapshot.loveList.find(sameSong)

  if (existing) {
    await removeSongsFromPlaylist(LIST_LOVE_ID, [String(existing.id ?? '')].filter(Boolean))
    toast({ title: '已取消收藏', description: song.name })
    return
  }
  await addSongsToPlaylist(LIST_LOVE_ID, [
    {
      ...song,
      // 列表条目需要稳定 id（服务端按 id 去重）；本站统一用 source_songmid
      id: song.id ?? `${song.source}_${song.songmid ?? song.name}`,
      interval: song.interval ?? null,
    },
  ])
  toast({ title: '已收藏', description: song.name, variant: 'success' })
}

/** 全局快捷键（v2.32.0；v2.33.0 加帮助面板）。挂在 Shell 内（ToastHost + PlayerProvider 之内）。
 *
 *  已有的三个键（空格 / Shift+←/→，见 lib/player.tsx 的全局监听）不动，
 *  这里补齐主流播放器的常用集 —— 对齐 YouTube Music / Spotify 的习惯：
 *
 *    /      聚焦搜索框（顶栏搜索条上一直画着这个 kbd 提示，此前从未实现）
 *    ←/→    快退/快进 5 秒
 *    ↑/↓    音量 ±5%
 *    M      静音
 *    S      随机播放开关（toast 反馈 —— 这个状态不在当前页面上就看不见）
 *    R      循环模式：关闭 → 列表循环 → 单曲循环（toast 反馈）
 *    L      收藏/取消收藏当前曲（toast 反馈；此前「加入收藏」没有任何入口）
 *    ?      本帮助面板（Shift+/；8 个键没有可发现性等于不存在 —— Gmail/GitHub 同款惯例）
 *
 *  【为什么单独一个组件而不是塞回 player.tsx】收藏要读歌单快照、toast 要
 *  ToastHost 的 context —— 塞回内核会倒逼调整 Provider 层级。两个 keydown
 *  监听各管各的键（那边管空格/Shift+方向键，这边管其余），互不重叠。
 */
export default function KeyboardShortcuts() {
  const player = usePlayer()
  const { auth } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  /** L 键进行中的守卫：连按两次会并发读快照，可能重复收藏 */
  const loveBusyRef = React.useRef(false)
  /** 帮助面板（v2.33.0）：? 键或顶栏键盘按钮打开。 */
  const [helpOpen, setHelpOpen] = React.useState(false)

  // 顶栏的键盘图标按钮在 App.tsx 里，不在这里 —— 用自定义事件解耦，
  // 免得为了一个按钮把状态提到 Shell
  React.useEffect(() => {
    const open = () => setHelpOpen(true)
    window.addEventListener('lx:shortcuts-help', open)
    return () => window.removeEventListener('lx:shortcuts-help', open)
  }, [])

  // player/api 对象随播放状态每秒都变（position 也在里面），监听器要稳定，
  // 只能读「最新值」—— 与 lib/lyric.ts 的 songRef 同一处理方式
  const playerRef = React.useRef(player)
  React.useEffect(() => {
    playerRef.current = player
  })

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl/Meta/Alt 组合是浏览器/系统的键（Ctrl+R 刷新等），一律不碰
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      // target 可能是 document（无焦点时），它没有 closest —— 用可选调用兜底
      // 焦点在滑块（进度/音量条）上时方向键归它自己的 onKeyDown 管，
      // 这里再处理一次就会「一步顶两步」
      if (t?.closest?.('[role="slider"]')) return
      // Radix 弹层（音质菜单/对话框）打开时不抢键：弹层有自己的键盘语义
      if (t?.closest?.('[role="menu"], [role="dialog"], [role="listbox"]')) return
      // ←/→ 带 Shift 是切歌（player.tsx 既有行为），不在这里重复处理
      if (e.shiftKey && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) return

      const p = playerRef.current

      switch (e.code) {
        case 'Slash': {
          e.preventDefault()
          // Shift+/（即 ?）是帮助面板；不带 Shift 才是聚焦搜索
          if (e.shiftKey) {
            setHelpOpen((v) => !v)
            return
          }
          navigate('/search')
          // SPA 跳转后输入框才挂载；轮询聚焦，最多等 1 秒
          let tries = 0
          const focus = () => {
            const el = document.querySelector<HTMLInputElement>('input[aria-label="搜索关键词"]')
            if (el) el.focus()
            else if (++tries < 20) window.setTimeout(focus, 50)
          }
          window.setTimeout(focus, 0)
          return
        }
        case 'ArrowRight':
          e.preventDefault()
          if (p.current && p.duration > 0) p.seek(p.position + 5)
          return
        case 'ArrowLeft':
          e.preventDefault()
          if (p.current && p.duration > 0) p.seek(Math.max(0, p.position - 5))
          return
        case 'ArrowUp':
          e.preventDefault()
          // 步进 5% 后取整到 0.05 的倍数，避免 0.30000000000000004 这种浮点漂移
          p.setVolume(Math.round((p.volume + 0.05) * 20) / 20)
          return
        case 'ArrowDown':
          e.preventDefault()
          p.setVolume(Math.round((p.volume - 0.05) * 20) / 20)
          return
        case 'KeyM':
          e.preventDefault()
          p.toggleMute()
          return
        case 'KeyS': {
          e.preventDefault()
          const next = !p.shuffle
          p.toggleShuffle()
          toast({ title: next ? '随机播放：开' : '随机播放：关' })
          return
        }
        case 'KeyR': {
          e.preventDefault()
          const next = REPEAT_ORDER[(REPEAT_ORDER.indexOf(p.repeat) + 1) % REPEAT_ORDER.length]
          p.cycleRepeat()
          toast({ title: `循环模式：${REPEAT_LABEL[next as RepeatMode]}` })
          return
        }
        case 'KeyL': {
          e.preventDefault()
          const song = p.current
          if (!song) return
          if (!isLoggedIn(auth)) {
            toast({ title: '收藏属于登录账号，请先登录', variant: 'destructive' })
            return
          }
          if (loveBusyRef.current) return
          loveBusyRef.current = true
          void toggleLove(song, toast)
            .catch((err: unknown) => {
              toast({
                title: '收藏操作失败',
                description: err instanceof Error ? err.message : String(err),
                variant: 'destructive',
              })
            })
            .finally(() => {
              loveBusyRef.current = false
            })
          return
        }
        default:
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toast, navigate, auth])

  return (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>键盘快捷键</DialogTitle>
          <DialogDescription>不区分大小写；焦点在输入框里时快捷键不生效（正常打字）。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-1.5 text-xs font-medium text-faint">{group.title}</h3>
              <ul className="space-y-1.5">
                {group.items.map((it) => (
                  <li key={it.label} className="flex items-center justify-between gap-4">
                    <span className="text-dim">{it.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {it.keys.map((k, i) => (
                        <React.Fragment key={k + i}>
                          {i > 0 && <span className="text-[10px] text-faint">+</span>}
                          <Kbd>{k}</Kbd>
                        </React.Fragment>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** kbd 徽章：与顶栏搜索条上的提示同款式（App.tsx），略大一号 */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        'rounded-md border border-line bg-panel px-1.5 py-0.5 text-[11px] font-mono text-dim shadow-2xs',
      )}
    >
      {children}
    </kbd>
  )
}

/** 帮助面板的内容。改键位时**必须**同步改这里 ——
 *  护栏（verify-menu-fit 快捷键段）断言面板里列出了 L/空格/?，
 *  漏了会红；但其余键位靠这个清单自觉维护。 */
const SHORTCUT_GROUPS: Array<{ title: string; items: Array<{ label: string; keys: string[] }> }> = [
  {
    title: '播放与选曲',
    items: [
      { label: '播放 / 暂停', keys: ['Space'] },
      { label: '上一首', keys: ['Shift', '←'] },
      { label: '下一首', keys: ['Shift', '→'] },
      { label: '快退 5 秒', keys: ['←'] },
      { label: '快进 5 秒', keys: ['→'] },
    ],
  },
  {
    title: '音量',
    items: [
      { label: '音量 +5%', keys: ['↑'] },
      { label: '音量 −5%', keys: ['↓'] },
      { label: '静音 / 取消静音', keys: ['M'] },
    ],
  },
  {
    title: '播放模式',
    items: [
      { label: '随机播放开关', keys: ['S'] },
      { label: '循环模式：关 → 列表 → 单曲', keys: ['R'] },
    ],
  },
  {
    title: '收藏与搜索',
    items: [
      { label: '收藏 / 取消收藏当前曲', keys: ['L'] },
      { label: '聚焦搜索框', keys: ['/'] },
      { label: '显示本帮助', keys: ['?'] },
    ],
  },
]
