/**
 * iOS 安装引导（v2.40.0 重建，此前 PwaInstallModal 在 v2.38 重构中被删）。
 *
 * 【为什么需要它】iOS Safari **不触发** `beforeinstallprompt`（那是 Chromium 的机制），
 * `usePwaInstall` 的 canPromptNative 在 iOS 上永远为 false → 顶栏的「安装应用」按钮
 * 在 iPhone 上**从不出现**，用户完全没有「装到主屏」的入口。
 * iOS 唯一的安装路径是手动：分享 → 添加到主屏幕。这个组件就是把这条路教给用户。
 *
 * 【什么时候显示】
 * - iOS（iPadOS 也算）+ 非 standalone（还没装）+ 用户没关过这个提示（localStorage）。
 * - 以一张底部卡片的形式出现在首页顶部区域，可关闭（关了 30 天内不再出现）。
 * - Android/桌面 Chrome 用户走原生 beforeinstallprompt（顶栏按钮），不经过这里。
 */
import * as React from 'react'
import { Share, PlusSquare, X } from 'lucide-react'

const DISMISS_KEY = 'lx.pwa.ios-guide-dismissed'
const DISMISS_DAYS = 30

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS 13+ 的 UA 伪装成 macOS，靠「Mac + 触屏」识别
  const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)
  return /iPhone|iPod/.test(ua) || isIPad
}

function dismissedRecently(): boolean {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY) || 0)
    return t > 0 && Date.now() - t < DISMISS_DAYS * 86400_000
  } catch {
    return false
  }
}

/** 该不该显示：iOS + 未安装 + 最近没关过。
 *  抽成纯函数：① 单测可测；② setState 可以走 useState 的惰性初始化
 *  （react-hooks/set-state-in-effect 禁止 effect 里同步 setState —— 级联渲染）。 */
function shouldShowGuide(): boolean {
  if (typeof window === 'undefined') return false
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  return isIOS() && !standalone && !dismissedRecently()
}

export default function IosInstallGuide() {
  // 惰性初始化：首渲染就拿到正确值，不需要 effect 里再 setState。
  const [show, setShow] = React.useState(shouldShowGuide)

  if (!show) return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      /* 隐私模式写不进就算了 */
    }
    setShow(false)
  }

  return (
    <div
      role="note"
      aria-label="安装到主屏幕的引导"
      className="relative mx-1 rounded-2xl border border-accent/25 bg-accent-soft/60 p-4"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="关闭安装引导"
        className="absolute right-2 top-2 rounded-full p-1.5 text-faint transition-colors hover:bg-panel hover:text-ink"
      >
        <X className="size-4" />
      </button>
      <p className="text-sm font-semibold text-ink">把 LX Music 装到主屏幕</p>
      <p className="mt-1 text-xs leading-relaxed text-dim">
        像原生 App 一样全屏使用，从主屏图标直接进入。
      </p>
      <ol className="mt-3 space-y-2 text-xs text-dim">
        <li className="flex items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-bold text-accent">1</span>
          <Share className="size-3.5 shrink-0 text-accent" />
          <span>点浏览器底部的「分享」按钮</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-bold text-accent">2</span>
          <PlusSquare className="size-3.5 shrink-0 text-accent" />
          <span>选择「添加到主屏幕」</span>
        </li>
      </ol>
    </div>
  )
}
