import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/auth'
import { useConfig } from '@/lib/useConfig'
import { Button, InputField, Stack, SwitchField, useToast } from '@/components/ui'

interface StatusShape {
  uptime?: number
  totalMemory?: number
  freeMemory?: number
  memory?: number
  cpuUsage?: number | string
  processCpuUsage?: number | string
  osUptime?: number
  cpus?: number
  cpuModel?: string
  isWebDAVConfigured?: boolean
  sourcesCount?: number
  nodeVersion?: string
  platform?: string
}

function fmtBytes(n?: number): string {
  if (n === undefined) return '…'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 text-sm transition-colors last:border-b-0 hover:bg-panel2/40">
      <span className="shrink-0 text-dim">{k}</span>
      <span className="truncate text-right font-mono text-ink" title={v}>
        {v}
      </span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-5 shadow-card">
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** 系统组：运行状态 + 可编辑全局配置（POST 支持的 key） + 只读配置视图。
 * 编辑用 Field 原语；保存只发变更的 key，服务端规范化后自动重载。 */
export default function SystemGroup() {
  const { toast } = useToast()
  const { config, error, save } = useConfig()
  const [status, setStatus] = useState<StatusShape | null>(null)
  const [overrides, setOverrides] = useState<Record<string, unknown>>({})
  const [busy, setBusy] = useState(false)

  // 运行状态轮询（10s）
  useEffect(() => {
    let alive = true
    const load = () =>
      api
        .status()
        .then((d) => alive && setStatus(d as StatusShape))
        .catch(() => {})
    load()
    const timer = setInterval(load, 10_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  // draft = 配置基线 + 用户覆盖（无 effect 内 setState，避免级联渲染）
  const draft = useMemo(() => {
    const base: Record<string, unknown> = config
      ? {
          serverName: config.serverName ?? '',
          'frontend.password': '',
          'debug.enabled': config['debug.enabled'] ?? false,
          'list.addMusicLocationType': config['list.addMusicLocationType'] ?? 'top',
          'proxy.enabled': config['proxy.enabled'] ?? false,
          'proxy.header': config['proxy.header'] ?? '',
          maxSnapshotNum: config.maxSnapshotNum ?? 10,
          'system.allowUnsafeVM': config['system.allowUnsafeVM'] ?? false,
        }
      : {}
    return { ...base, ...overrides }
  }, [config, overrides])

  const set = (key: string, value: unknown) => setOverrides((o) => ({ ...o, [key]: value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    // 只发有变更的 key（对比 config 基线）；密码空串不发
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(overrides)) {
      if (k === 'frontend.password' && !v) continue
      patch[k] = v
    }
    if (Object.keys(patch).length === 0) {
      toast({ title: '无变更' })
      setBusy(false)
      return
    }
    try {
      await save(patch)
      toast({ title: '配置已保存', description: `${Object.keys(patch).length} 项`, variant: 'success' })
      setOverrides({})
    } catch (e: unknown) {
      toast({ title: '保存失败', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  if (error) return <div className="text-sm text-danger">{error}</div>
  if (!config || !status) return <div className="text-sm text-dim">加载中…</div>

  return (
    <Stack gap={5}>
      <Section title="运行环境">
        <Row k="平台" v={status.platform ?? '…'} />
        <Row k="Node" v={status.nodeVersion ?? '…'} />
        <Row k="CPU" v={`${status.cpus ?? '…'} 核 · ${status.cpuModel ?? ''}`} />
        <Row
          k="CPU 占用"
          v={
            status.cpuUsage !== undefined
              ? `${typeof status.cpuUsage === 'number' ? status.cpuUsage.toFixed(1) : status.cpuUsage}%`
              : '…'
          }
        />
        <Row k="系统内存" v={`${fmtBytes(status.totalMemory! - (status.freeMemory ?? 0))} / ${fmtBytes(status.totalMemory)}`} />
        <Row k="进程内存" v={fmtBytes(status.memory)} />
        <Row k="系统已运行" v={`${Math.floor((status.osUptime ?? 0) / 3600)} 小时`} />
        <Row k="WebDAV" v={status.isWebDAVConfigured ? '已配置' : '未配置'} />
        <Row k="已载入音源" v={String(status.sourcesCount ?? 0)} />
      </Section>

      <form onSubmit={submit}>
        <Stack gap={5}>
          <Section title="服务器">
            <Stack gap={3}>
              <InputField
                label="服务名称"
                value={draft.serverName as string}
                onChange={(v) => set('serverName', v)}
                placeholder="lxserver"
              />
              <InputField
                label="管理密码"
                description="留空则不修改。修改后需用新密码重新登录。"
                type="password"
                value={draft['frontend.password'] as string}
                onChange={(v) => set('frontend.password', v)}
                placeholder="••••••••"
              />
            </Stack>
          </Section>

          <Section title="播放与列表">
            <Stack gap={3}>
              <SwitchField
                label="调试模式"
                description="开启后输出详细调试日志与音源内部日志（NAS 日志量增大）"
                checked={draft['debug.enabled'] as boolean}
                onChange={(v) => set('debug.enabled', v)}
              />
              <InputField
                label="添加歌曲到列表的位置"
                value={draft['list.addMusicLocationType'] as string}
                onChange={(v) => set('list.addMusicLocationType', v)}
                placeholder="top / bottom"
              />
              <InputField
                label="最大快照数"
                type="number"
                value={draft.maxSnapshotNum as number}
                onChange={(v) => set('maxSnapshotNum', v)}
              />
            </Stack>
          </Section>

          <Section title="代理与安全">
            <Stack gap={3}>
              <SwitchField
                label="启用代理（兜底）"
                description="Music SDK 的外发请求代理总开关。music/customSource 已按需单独禁用。"
                checked={draft['proxy.enabled'] as boolean}
                onChange={(v) => set('proxy.enabled', v)}
              />
              <InputField
                label="代理转发 IP 头"
                description="如 x-real-ip，用于反代场景下记录真实客户端 IP"
                value={draft['proxy.header'] as string}
                onChange={(v) => set('proxy.header', v)}
                placeholder="x-real-ip"
                mono
              />
              <SwitchField
                label="允许不安全 VM"
                description="允许运行 VM 模式自定义源脚本（有安全风险，仅可信源开启）"
                checked={draft['system.allowUnsafeVM'] as boolean}
                onChange={(v) => set('system.allowUnsafeVM', v)}
              />
            </Stack>
          </Section>

          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? '保存中…' : '保存配置'}
            </Button>
          </div>
        </Stack>
      </form>

      <Section title="全部配置（只读）">
        <p className="mb-2 text-xs text-faint">
          以下键当前仅支持只读，可编辑能力随阶段 B 后续切片接入（player / music.url / subsonic 等）。
        </p>
        <div>
          {Object.entries(config)
            .filter(([k]) => !['serverName', 'frontend.password', 'debug.enabled', 'list.addMusicLocationType', 'proxy.enabled', 'proxy.header', 'maxSnapshotNum', 'system.allowUnsafeVM'].includes(k))
            .map(([k, v]) => (
              <Row key={k} k={k} v={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
            ))}
        </div>
      </Section>
    </Stack>
  )
}
