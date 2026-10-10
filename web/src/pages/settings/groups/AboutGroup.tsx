import { useEffect, useState } from 'react'
import { api, useAuth } from '@/lib/auth'
import { Button, Stack, useToast } from '@/components/ui'

interface RuntimeConfig {
  version?: string
  serverName?: string
  'player.enableAuth'?: boolean
}

declare const __APP_VERSION__: string

/** 关于组：版本三源对齐（前端构建 / 服务端 version 文件 / 镜像 OCI label 同源）+ 退出登录 */
export default function AboutGroup() {
  const { refresh } = useAuth()
  const { toast } = useToast()
  const [cfg, setCfg] = useState<RuntimeConfig | null>(null)

  useEffect(() => {
    let alive = true
    // 绝对路径：设置页挂在 /settings/:group 下，相对路径会解析成
    // /settings/config.json → 落到 SPA 回退拿到 HTML → 解析失败。
    fetch('/app/config.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setCfg(d))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  return (
    <Stack gap={3}>
      <div className="rounded-2xl border border-line bg-panel p-5">
        <h3 className="text-sm font-medium text-ink">版本</h3>
        <div className="mt-2 divide-y divide-line">
          <div className="flex justify-between py-2 text-sm">
            <span className="text-dim">服务端 / 镜像</span>
            <span className="font-mono text-ink">{cfg?.version ?? '…'}</span>
          </div>
          <div className="flex justify-between py-2 text-sm">
            <span className="text-dim">前端构建</span>
            <span className="font-mono text-ink">{__APP_VERSION__}</span>
          </div>
          <div className="flex justify-between py-2 text-sm">
            <span className="text-dim">服务器名称</span>
            <span className="text-ink">{cfg?.serverName ?? '…'}</span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-panel p-5">
        <h3 className="text-sm font-medium text-ink">会话</h3>
        <p className="mt-1 text-xs text-faint">清除本浏览器持有的登录凭据（服务端会话随 TTL 过期）。</p>
        <Button
          variant="destructive"
          className="mt-3"
          onClick={async () => {
            await api.logoutAll()
            await refresh()
            toast({ title: '已退出登录' })
          }}
        >
          退出登录
        </Button>
      </div>
    </Stack>
  )
}
