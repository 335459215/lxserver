import { useState, useEffect, useCallback } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function checkIsStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(checkIsStandalone)
  const [isModalOpen, setIsModalOpen] = useState(false)

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      // 阻止默认 mini-infobar，保留给用户触发
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }

    const handleAppInstalled = () => {
      setDeferredPrompt(null)
      setIsInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const triggerInstall = useCallback(async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt()
        const choice = await deferredPrompt.userChoice
        if (choice.outcome === 'accepted') {
          setIsInstalled(true)
        }
        setDeferredPrompt(null)
        return
      } catch {
        // 唤起失败则弹窗引导
      }
    }
    // 无原生弹窗时（如普通 HTTP 访问或 iOS），展示指引弹窗
    setIsModalOpen(true)
  }, [deferredPrompt])

  return {
    isInstalled,
    canPromptNative: !!deferredPrompt,
    isModalOpen,
    setIsModalOpen,
    triggerInstall,
  }
}
